
from .brand import BRAND, TOKENS
from .runtime_settings import settings_snapshot, stored
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone as dt_timezone
from html import escape
from html.parser import HTMLParser
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.conf import settings
from django.core import mail
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.core.management import call_command, CommandError
from django.db import connection, connections, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from .course_sessions import cancel_registration, save_session
from .enrollments import enroll, review
from .email_layout import FOOTER, description_excerpt, render_email
from .mail import GraphMailError
from .models import (Course, CourseSession, EmailCode, Enrollment, Exam, LearningAssignment,
                     OutboundEmail, EmailQueueState, User)
from .notifications import (UNKNOWN, claim_next, deliver_queued, enqueue, format_time, message_content,
                            record_verification, recover_stale, sanitized_error, record_outcome, deliver)
from .tests import make_exam

TEST_SETTINGS = dict(DEBUG=True, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
                     EMAIL_NOTIFICATIONS_ENABLED=True, EMAIL_QUEUE_BATCH=20, EMAIL_DAILY_LIMIT=5000,
                     NOTIFICATION_TIME_ZONE="America/New_York", DEFAULT_FROM_EMAIL="itsupport@example.test")


class ParsedEmail(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.elements = []
        self.text = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))

    def handle_data(self, data):
        self.text.append(data)


@override_settings(**TEST_SETTINGS, APP_ORIGIN="https://learn.example.test", APP_BASE_PATH="/training")
class NotificationContentTests(TestCase):
    def setUp(self):
        self.course = Course(pk=17, title="Team handoffs", description="Learn to share clear updates.",
                             category="Workplace skills", duration_minutes=45)
        self.exam = Exam(pk=23, title="Team assessment", duration_minutes=20, pass_score=80)
        self.actor = User(username="organizer", display_name="Alex Morgan")
        self.start = datetime(2026, 11, 20, 15, 30, tzinfo=dt_timezone.utc)
        self.session = CourseSession(title="Morning workshop", starts_at=self.start,
                                     ends_at=self.start + timedelta(hours=1), location="Room 2",
                                     meeting_url='https://meet.example.test/session?a=1&b="two"')

    def test_assignment_next_steps_and_buttons(self):
        for mode, approval, sentence, button in (
            ("scheduled", False, "Choose a session to reserve your seat.", "Choose a session"),
            ("scheduled", True, "Choose a session to reserve your seat. An organizer reviews your registration.", "Choose a session"),
            ("self_paced", False, "Open the course to start learning.", "Open training"),
            ("self_paced", True, "Request enrollment; an organizer reviews it before learning begins.", "Open training"),
        ):
            with self.subTest(mode=mode, approval=approval):
                self.course.delivery_mode, self.course.requires_approval = mode, approval
                _, text, html = message_content("New training assigned", self.course, actor=self.actor)
                self.assertIn("\n\n" + sentence + "\n\n", text)
                self.assertIn(escape(sentence), html)
                self.assertIn('>' + button + '</a>', html)
                self.assertIn("By: Alex Morgan", text)
                self.assertIn('>Assigned by</td>', html)
        _, text, html = message_content("New training assigned", self.exam)
        self.assertIn("Open the exam when you are ready to begin.", text)
        self.assertIn("Open the exam when you are ready to begin.", html)
        self.assertIn('>Open exam</a>', html)

    def test_event_next_steps_and_buttons(self):
        self.course.delivery_mode = "scheduled"
        seat = "Your seat is reserved. You can add the session to your calendar from My training."
        for event, session, note, sentence, button in (
            # Session mails (registered, approved, cancelled, rescheduled) have their own short layout.
            ("Enrollment approved", None, "", "You can start learning now.", "Open training"),
            ("Enrollment rejected", None, "Review details", "Your enrollment request was not approved. See the organizer's note below.", "Open training"),
            ("Enrollment removed", self.session, "Review details", "Your enrollment was removed. See the organizer's note below.", "Open training"),
            ("Enrollment rejected", None, "", "Your enrollment request was not approved. Contact the organizer if you have questions.", "Open training"),
            ("Enrollment removed", None, "", "Your enrollment was removed. Contact the organizer if you have questions.", "Open training"),
            ("Session cancelled", None, "", "This session was cancelled. Choose another session if one is available.", "Choose a session"),
        ):
            with self.subTest(event=event, session=bool(session), note=bool(note)):
                _, text, html = message_content(event, self.course, session=session, note=note)
                self.assertIn("\n\n" + sentence + "\n\n", text)
                self.assertIn(escape(sentence), html)
                self.assertIn('>' + button + '</a>', html)

    def test_plain_text_facts_order_and_html_parity(self):
        _, text, html = message_content("Enrollment removed", self.course, actor=self.actor,
                                       due_at=self.start, session=self.session, approved=True,
                                       note="First line\n  Second line & details")
        lines = ["By: Alex Morgan", "Due: Fri, Nov 20, 2026, 10:30 AM EST", "Session: Morning workshop",
                 "Starts: Fri, Nov 20, 2026, 10:30 AM EST", "Ends: Fri, Nov 20, 2026, 11:30 AM EST",
                 "Location: Room 2", "Meeting link: " + self.session.meeting_url,
                 "Format: Self-paced", "Duration: About 45 min", "Category: Workplace skills",
                 "Note: First line\n  Second line & details",
                 "About this training: Learn to share clear updates.",
                 "Open training: https://learn.example.test/training/courses?course=17"]
        self.assertIn("Enrollment removed.\n\nTraining: Team handoffs", text)
        self.assertIn('>Reviewed by</td>', html)
        positions = [text.index("\n\n" + line) for line in lines]
        self.assertEqual(positions, sorted(positions))
        visible_html = " ".join(ParsedEmail(html).text)
        for line in lines:
            label, value = line.split(": ", 1)
            self.assertIn(" ".join(value.split()), " ".join(visible_html.split()))
        self.assertTrue(text.endswith(FOOTER))
        self.assertIn(FOOTER, html)
        self.assertIn("First line<br>  Second line &amp; details", html)

    def test_actor_html_labels_preserve_plain_text_by_for_each_event(self):
        for event, label in (
            ("New training assigned", "Assigned by"),
            ("Enrollment approved", "Reviewed by"),
            ("Enrollment rejected", "Reviewed by"),
            ("Enrollment removed", "Reviewed by"),
            ("Session cancelled", "Updated by"),
            ("Session rescheduled", "Updated by"),
            ("Session registration confirmed", "By"),
            ("Other event", "By"),
        ):
            with self.subTest(event=event):
                _, text, html = message_content(event, self.course, actor=self.actor)
                self.assertIn("\n\nBy: Alex Morgan\n\n", text)
                self.assertIn('>' + label + '</td>', html)
                for html_label in ("Assigned by", "Reviewed by", "Updated by"):
                    self.assertNotIn(html_label + ":", text)

    def test_optional_facts_and_formats(self):
        self.course.duration_minutes = 0
        self.course.category = ""
        self.course.description = " \n\t "
        _, text, html = message_content("New training assigned", self.course)
        for label in ("By", "Due", "Session", "Starts", "Ends", "Location", "Meeting link",
                      "Duration", "Category", "Note", "About this training", "Time limit", "Questions", "Passing score"):
            self.assertNotIn(label + ":", text)
            self.assertNotIn('>' + label + '<', html)
        self.actor.display_name = ""
        self.session.title = self.session.location = self.session.meeting_url = ""
        self.session.starts_at = self.session.ends_at = None
        _, text, html = message_content("Enrollment approved", self.course, actor=self.actor,
                                       session=self.session, approved=True)
        self.assertIn("By: organizer", text)
        for label in ("Session", "Starts", "Ends", "Location", "Meeting link"):
            self.assertNotIn(label + ":", text)
            self.assertNotIn('>' + label + '<', html)
        for venue, expected in (("online", "Scheduled online sessions"), ("onsite", "On-site sessions")):
            self.course.delivery_mode, self.course.venue = "scheduled", venue
            _, text, html = message_content("New training assigned", self.course)
            self.assertIn("Format: " + expected, text)
            self.assertIn(expected, html)

    def test_exam_facts_do_not_query_related_questions(self):
        for count in (None, 10):
            self.exam.questions_per_attempt = count
            with settings_snapshot(stored()), self.assertNumQueries(0):
                _, text, html = message_content("New training assigned", self.exam)
            for fact in ("Time limit: 20 min", "Passing score: 80"):
                self.assertIn(fact, text)
                self.assertIn(fact.split(": ")[1], html)
            self.assertIn('>Passing score</td>', html)
            self.assertIn('>80</td>', html)
            self.assertNotIn('80%', text + html)
            self.assertNotIn('Pass mark', text + html)
            self.assertEqual("Questions: 10" in text, count is not None)
            self.assertEqual('>Questions<' in html, count is not None)
            for label in ("Format", "Duration", "Category"):
                self.assertNotIn(label + ":", text)
                self.assertNotIn('>' + label + '<', html)
        self.exam.duration_minutes = 0
        self.exam.pass_score = 0
        _, text, _ = message_content("New training assigned", self.exam)
        self.assertNotIn("Time limit:", text)
        self.assertIn("Passing score: 0", text)

    def test_meeting_link_requires_approved_and_nonempty_url(self):
        for approved in (False, True):
            for meeting_url in ("", "https://meet.example.test/room?a=1&b=2"):
                with self.subTest(approved=approved, meeting_url=meeting_url):
                    self.session.meeting_url = meeting_url
                    _, text, html = message_content("Session rescheduled", self.course,
                                                   session=self.session, approved=approved)
                    self.assertEqual("Meeting link:" in text, bool(approved and meeting_url))
                    links = [attrs['href'] for tag, attrs in ParsedEmail(html).elements if tag == 'a']
                    self.assertEqual(meeting_url in links, bool(approved and meeting_url))

    def test_description_is_plain_collapsed_and_cut_at_word_boundary(self):
        self.assertEqual(description_excerpt("  Clear\n\t useful\u3000updates.  "), "Clear useful updates.")
        for short in ("Short description.", "a < b and c > d", "<p>Clear &amp; useful updates.</p>"):
            self.assertEqual(description_excerpt(short), short)
        self.assertEqual(description_excerpt("x" * 280), "x" * 280)
        for description, expected in (("word " * 100, " ".join(["word"] * 56) + "…"),
                                      ("學習" * 300, "學習" * 140 + "…"),
                                      ("x" * 281, "x" * 280 + "…")):
            self.course.description = description
            excerpt = description_excerpt(description)
            self.assertEqual(excerpt, expected)
            _, text, html = message_content("New training assigned", self.course)
            self.assertIn("About this training: " + excerpt, text)
            self.assertIn(escape(excerpt), html)

    def test_description_backoff_threshold_and_trailing_punctuation(self):
        # An early space must not discard most of a long unbroken description.
        self.assertEqual(description_excerpt("a" * 200 + " " + "b" * 400),
                         "a" * 200 + " " + "b" * 79 + "…")
        self.assertEqual(description_excerpt("a" * 201 + " " + "b" * 400), "a" * 201 + "…")
        for punctuation in ("。，", ",;", "!?", "—:"):
            self.assertEqual(description_excerpt("學" * 278 + punctuation + "習" * 320), "學" * 278 + "…")
        self.assertEqual(description_excerpt("Short text,;"), "Short text,;")

    def test_description_caption_matches_target_and_preserves_plain_text(self):
        description = 'a < b and c > d; <script> &amp; "quoted"'
        for target, caption in ((self.course, "About this training"), (self.exam, "About this exam")):
            with self.subTest(target=target._meta.model_name):
                target.description = description
                _, text, html = message_content("New training assigned", target)
                self.assertIn(caption + ": " + description, text)
                self.assertIn('>' + caption + '</p>', html)
                self.assertIn(escape(description), html)
                self.assertNotIn('<script>', html)
                other_caption = "About this exam" if target == self.course else "About this training"
                self.assertNotIn(other_caption, text + html)
                target.description = " \n\t "
                _, text, html = message_content("New training assigned", target)
                self.assertNotIn(caption, text + html)

    def test_outlook_button_note_cell_and_mobile_gutter(self):
        _, _, html = message_content("New training assigned", self.course, note="First\nSecond")
        elements = ParsedEmail(html).elements
        button = next(attrs for tag, attrs in elements if tag == 'a')
        for side, size in (("top", 12), ("bottom", 12), ("left", 22), ("right", 22)):
            self.assertIn(f"border-{side}:{size}px solid {TOKENS['brand-blue']}", button['style'])
        self.assertNotIn('padding', button['style'])
        note_cells = [attrs for tag, attrs in elements if tag == 'td'
                      and f"border-left:4px solid {TOKENS['brand-blue']}" in attrs.get('style', '')]
        self.assertEqual(len(note_cells), 1)
        self.assertIn('padding:16px', note_cells[0]['style'])
        self.assertIn('background-color:#fafafa', note_cells[0]['style'])
        self.assertIn('First<br>Second', html)
        outer_cell = next(attrs for tag, attrs in elements if tag == 'td')
        self.assertEqual(outer_cell['style'], 'padding:16px 8px')

    def test_escaping_safe_markup_and_only_expected_links(self):
        dangerous = '<script>alert("x")</script> & \'quoted\''
        self.course.title = self.session.title = self.session.location = dangerous
        self.actor.display_name = dangerous
        self.course.category = dangerous
        note = dangerous + "\nNext line"
        _, text, html = message_content("Enrollment removed", self.course, actor=self.actor,
                                       session=self.session, note=note, approved=True)
        self.assertIn("Training: " + dangerous, text)
        self.assertIn("Note: " + note, text)
        self.assertGreaterEqual(html.count(escape(dangerous)), 6)
        parsed = ParsedEmail(html)
        self.assertEqual([a['href'] for tag, a in parsed.elements if tag == 'a'],
                         [self.session.meeting_url, "https://learn.example.test/training/courses?course=17"])
        for forbidden in ('<img', '<style', '<script', 'class=', '<form', 'position:', 'display:flex', 'display:grid'):
            self.assertNotIn(forbidden, html.lower())
        for tag, attrs in parsed.elements:
            self.assertFalse(any(name.startswith('on') for name in attrs))
            if tag == 'table':
                self.assertEqual({key: attrs[key] for key in ('role', 'cellpadding', 'cellspacing', 'border')},
                                 dict(role='presentation', cellpadding='0', cellspacing='0', border='0'))
        self.assertIn('width="600"', html)
        self.assertIn('width:100%;max-width:600px', html)
        self.assertIn('word-break:break-word', html)

    def test_numeric_routes_unchanged_with_and_without_mount(self):
        for base in ("", "/training"):
            with override_settings(APP_BASE_PATH=base):
                for target, mode, route in (
                    (self.course, 'self_paced', '/courses?course=17'),
                    (self.course, 'scheduled', '/courses?course=17&action=register'),
                    (self.exam, None, '/exams?exam=23'),
                ):
                    if mode:
                        target.delivery_mode = mode
                    _, text, html = message_content("New training assigned", target)
                    url = "https://learn.example.test" + base + route
                    self.assertIn("Open training: " + url + "\n\n", text)
                    self.assertEqual([a['href'] for tag, a in ParsedEmail(html).elements if tag == 'a'], [url])
                    self.assertNotIn('redirect', html)
                    self.assertNotIn('#', url)

    def test_samples_are_offline_and_cover_all_events(self):
        with TemporaryDirectory() as directory, self.assertNumQueries(0), patch('training.notifications.send_message') as send:
            call_command('render_notification_samples', directory, stdout=StringIO())
            files = list(Path(directory).glob('*.html'))
            self.assertEqual(len(files), 22)
            for file in files:
                self.assertIn(BRAND['title'], file.read_text())
                self.assertTrue(file.with_suffix('.txt').exists())
            subjects = '\n'.join(file.read_text().splitlines()[0] for file in Path(directory).glob('*.txt'))
            for event in ('New training assigned', 'Enrollment rejected', 'Enrollment removed', 'Registered: ',
                          'Approved: ', 'Requested: ', 'Changed: ', 'Cancelled: ', 'Tomorrow: ', 'Quiz ready: ',
                          'Quiz reminder: '):
                self.assertIn(event, subjects)
            send.assert_not_called()
        with override_settings(DEBUG=False), self.assertRaises(CommandError):
            call_command('render_notification_samples', '/unused', stdout=StringIO())


@override_settings(**TEST_SETTINGS)
class NotificationEventsTests(TestCase):
    def setUp(self):
        # Database users reset between tests; their process-local throttle keys must too.
        cache.clear()
        self.addCleanup(cache.clear)
        self.admin = User.objects.create_user("notice-admin", email="admin@example.test", role="admin", display_name="A <Manager>")
        self.user = User.objects.create_user("notice-learner", email="learner@example.test")
        self.course = Course.objects.create(title='Safety <script>alert("x")</script>', owner=self.admin, published=True)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.start = timezone.now() + timedelta(days=2)

    def assign(self, **values):
        return self.client.post("/api/assignments/", {
            "kind": "course", "target_id": self.course.pk, "audience": "people",
            "people": [self.user.pk], "notes": '<img src=x onerror="bad()">',
            **values,
        }, format="json")

    def session(self):
        self.course.delivery_mode = "scheduled"
        self.course.save()
        return CourseSession.objects.create(course=self.course, title="Morning group",
            starts_at=self.start, ends_at=self.start + timedelta(hours=1), capacity=20)

    def test_assignment_receipt_dedupe_and_html_escaping(self):
        due = datetime(2026, 11, 11, 19, 30, tzinfo=dt_timezone.utc)
        result = self.assign(due_at=due.isoformat())
        self.assertEqual(result.status_code, 201)
        self.assertEqual((result.data['emails_queued'], result.data['people_without_email']), (1, 0))
        row = OutboundEmail.objects.get()
        self.assertIn('New training assigned', row.subject)
        self.assertIn('Wed, Nov 11, 2026, 2:30 PM EST', row.body_text)
        self.assertIn('A <Manager>', row.body_text)
        self.assertIn('&lt;script&gt;', row.body_html)
        self.assertNotIn('<script>', row.body_html)
        self.assertNotIn('<img', row.body_html)
        self.assertIn('Note:', row.body_text)
        assignment = LearningAssignment.objects.get()
        expected = message_content('New training assigned', self.course, actor=self.admin,
                                   due_at=assignment.due_at, note=assignment.notes)
        self.assertEqual((row.subject, row.body_text, row.body_html), expected)
        self.assertEqual(row.context, {'assignment_id': LearningAssignment.objects.get().pk, 'course_id': self.course.pk})
        self.assertEqual(self.assign().data['emails_queued'], 0)
        self.assertEqual(OutboundEmail.objects.count(), 1)

    def test_enqueue_dedupe_key(self):
        args = dict(kind='assignment', user=self.user, target=self.course, event='Assigned', dedupe_key='one-event')
        with transaction.atomic():
            self.assertTrue(enqueue(**args))
            self.assertFalse(enqueue(**args))
        self.assertEqual(OutboundEmail.objects.count(), 1)

    def test_notify_false(self):
        self.assertEqual(self.assign(notify=False).data['emails_queued'], 0)
        self.assertEqual(LearningAssignment.objects.count(), 1)
        self.assertFalse(OutboundEmail.objects.exists())

    def test_missing_email_reported(self):
        self.user.email = ''
        self.user.save()
        response = self.assign()
        self.assertEqual(response.data['people_without_email'], 1)
        self.assertEqual(response.data['emails_queued'], 0)

    def test_inactive_skipped(self):
        self.user.is_active = False
        self.user.save()
        self.assertEqual(self.assign().status_code, 400)
        self.assertFalse(enqueue(kind='assignment', user=self.user, target=self.course, event='Assigned', dedupe_key='inactive'))
        self.assertFalse(OutboundEmail.objects.exists())

    @override_settings(EMAIL_NOTIFICATIONS_ENABLED=False)
    def test_disabled_never_enqueues(self):
        self.assertEqual(self.assign().data['emails_queued'], 0)
        session = self.session()
        enroll(self.user, self.course.pk, {'session': session.pk})
        self.assertFalse(OutboundEmail.objects.exists())

    def test_enqueue_failure_rolls_back_assignment(self):
        with patch('training.notifications.enqueue', side_effect=RuntimeError('local test')):
            with self.assertRaises(RuntimeError):
                self.assign()
        self.assertFalse(LearningAssignment.objects.exists())

    def test_self_paced_stays_quiet_and_pending_gets_receipt(self):
        enroll(self.user, self.course.pk, {})
        self.assertFalse(OutboundEmail.objects.exists())
        other = User.objects.create_user('pending-learner', email='pending@example.test')
        self.course.requires_approval = True
        self.course.save()
        session = self.session()
        row = enroll(other, self.course.pk, {'session': session.pk})
        self.assertEqual(row.status, 'pending')
        self.assertEqual(OutboundEmail.objects.get().kind, 'request_received')

    def test_immediate_scheduled_registration_and_learner_cancellation(self):
        session = self.session()
        row = enroll(self.user, self.course.pk, {'session': session.pk})
        message = OutboundEmail.objects.get()
        # One session only: no session name, just When and Where.
        self.assertNotIn('Morning group', message.body_text)
        self.assertIn('When:', message.body_text)
        self.assertIn('Where:', message.body_text)
        self.assertTrue(message.subject.startswith('Registered: '))
        enroll(self.user, self.course.pk, {'session': session.pk})
        self.assertEqual(OutboundEmail.objects.count(), 1)
        cancel_registration(self.user, self.course.pk, {'revision': row.revision})
        self.assertEqual(OutboundEmail.objects.count(), 2)
        self.assertEqual(OutboundEmail.objects.latest('pk').kind, 'registration_cancelled')

    def test_review_decisions_and_idempotence(self):
        for decision, before in [('approved', 'pending'), ('rejected', 'pending'),
                                 ('removed', 'approved')]:
            with self.subTest(decision=decision, before=before):
                Enrollment.objects.all().delete()
                OutboundEmail.objects.all().delete()
                row = Enrollment.objects.create(user=self.user, course=self.course, status=before)
                data = {'decision': decision, 'revision': 0, 'note': 'Please contact your supervisor.'}
                review(self.admin, self.course.pk, row.pk, data)
                review(self.admin, self.course.pk, row.pk, data)
                message = OutboundEmail.objects.get()
                self.assertEqual(message.kind, 'enrollment_' + decision)
                self.assertIn(data['note'], message.body_text)
                self.assertIn(self.admin.display_name, message.body_text)

    def test_original_roster_rules(self):
        session = self.session()
        row = Enrollment.objects.create(user=self.user, course=self.course, session=session, status='pending')
        url = f'/api/courses/{self.course.pk}/enrollments/{row.pk}/review/'
        for decision in ('cancelled', 'removed'):
            self.assertEqual(self.client.post(url, {'decision': decision, 'revision': 0, 'note': 'Review'}, format='json').status_code, 400)
        row.refresh_from_db()
        self.assertEqual(row.status, 'pending')
        self.assertFalse(OutboundEmail.objects.exists())

    def test_review_notes_only_and_confirmation_has_no_note(self):
        session = self.session()
        row = enroll(self.user, self.course.pk, {'session': session.pk, 'note': 'Learner private request'})
        self.assertNotIn('Learner private request', OutboundEmail.objects.get().body_text)
        row.status = 'pending'; row.save()
        review(self.admin, self.course.pk, row.pk, {'decision': 'approved', 'revision': row.revision, 'note': ''})
        self.assertNotIn('Learner private request', OutboundEmail.objects.latest('id').body_text)
        row.refresh_from_db()
        review(self.admin, self.course.pk, row.pk, {'decision': 'removed', 'revision': row.revision, 'note': 'Reviewer instruction'})
        message = OutboundEmail.objects.latest('id')
        self.assertIn('Reviewer instruction', message.body_text)
        self.assertNotIn('Learner private request', message.body_text)

    def test_reassignment_notifies_once_per_reactivation(self):
        self.assertEqual(self.assign().data['emails_queued'], 1)
        assignment = LearningAssignment.objects.get()
        for _ in range(2):
            self.assertEqual(self.client.post(f'/api/assignments/{assignment.pk}/cancel/', {}, format='json').status_code, 200)
            self.assertEqual(self.assign().data['emails_queued'], 1)
            self.assertEqual(self.assign().data['emails_queued'], 0)
        self.assertEqual(OutboundEmail.objects.count(), 3)
        self.assertEqual(len(set(OutboundEmail.objects.values_list('dedupe_key', flat=True))), 3)

    def test_enqueued_expiry_seven_days_or_session_end(self):
        now = timezone.now()
        with patch('training.notifications.timezone.now', return_value=now):
            self.assign()
        self.assertEqual(OutboundEmail.objects.get().expires_at, now + timedelta(days=7))
        session = self.session()
        enroll(self.user, self.course.pk, {'session': session.pk})
        self.assertEqual(OutboundEmail.objects.latest('id').expires_at, session.ends_at)
        session.ends_at = now + timedelta(days=10)
        with patch('training.notifications.timezone.now', return_value=now):
            enqueue(kind='session_rescheduled', user=self.user, target=self.course, event='Rescheduled', session=session, dedupe_key='long-session')
        self.assertEqual(OutboundEmail.objects.latest('id').expires_at, now + timedelta(days=7))

    def test_reschedule_and_cancel_only_current_registrants(self):
        session = self.session()
        for index, status in enumerate(('approved', 'pending', 'rejected', 'removed', 'cancelled')):
            user = User.objects.create_user(f'registrant-{index}', email=f'registrant-{index}@example.test')
            Enrollment.objects.create(course=self.course, user=user, session=session, status=status)
        inactive = User.objects.create_user('inactive-registrant', email='inactive@example.test', is_active=False)
        Enrollment.objects.create(course=self.course, user=inactive, session=session, status='approved')
        save_session(self.admin, self.course.pk, {'starts_at': self.start + timedelta(hours=2),
            'ends_at': self.start + timedelta(hours=3), 'revision': 0}, session.pk)
        self.assertEqual(OutboundEmail.objects.filter(kind='session_rescheduled').count(), 2)
        save_session(self.admin, self.course.pk, {'cancelled': True, 'revision': 1}, session.pk)
        self.assertEqual(OutboundEmail.objects.filter(kind='session_cancelled').count(), 2)
        save_session(self.admin, self.course.pk, {'cancelled': True, 'revision': 2}, session.pk)
        self.assertEqual(OutboundEmail.objects.count(), 4)

    def test_session_title_or_capacity_change_does_not_notify(self):
        session = self.session()
        Enrollment.objects.create(course=self.course, user=self.user, session=session)
        save_session(self.admin, self.course.pk, {'title': 'Renamed', 'capacity': 30, 'revision': 0}, session.pk)
        self.assertFalse(OutboundEmail.objects.exists())

    def test_review_and_session_notifications_roll_back_with_event(self):
        session = self.session()
        row = Enrollment.objects.create(course=self.course, user=self.user, session=session, status='pending')
        with patch('training.notifications.enqueue', side_effect=RuntimeError('local failure')):
            with self.assertRaises(RuntimeError):
                review(self.admin, self.course.pk, row.pk, {'decision': 'approved', 'revision': 0, 'note': ''})
            with self.assertRaises(RuntimeError):
                save_session(self.admin, self.course.pk, {'cancelled': True, 'revision': 0}, session.pk)
        row.refresh_from_db(); session.refresh_from_db()
        self.assertEqual((row.status, row.revision), ('pending', 0))
        self.assertFalse(session.cancelled)
        self.assertEqual(session.revision, 0)
        self.assertFalse(OutboundEmail.objects.exists())

    def test_end_time_change_notifies(self):
        session = self.session()
        Enrollment.objects.create(course=self.course, user=self.user, session=session)
        save_session(self.admin, self.course.pk, {'ends_at': self.start + timedelta(hours=2), 'revision': 0}, session.pk)
        self.assertEqual(OutboundEmail.objects.get().kind, 'session_rescheduled')

    def test_publication_results_invitation_and_scheduler_do_not_enqueue(self):
        from .services import finalize, identity_for_user, start_attempt
        from django.core.management import call_command
        result = self.client.patch(f'/api/courses/{self.course.pk}/', {'published': False}, format='json')
        self.assertEqual(result.status_code, 200)
        exam = make_exam(self.admin)
        self.assertEqual(self.client.patch(f'/api/exams/{exam.pk}/', {'published': True}, format='json').status_code, 200)
        finalize(start_attempt(exam.pk, identity_for_user(self.user)))
        response = self.client.post('/api/invitations/issue/', {'exam': exam.pk, 'key': self.user.email}, format='json')
        self.assertEqual(response.status_code, 201)
        call_command('expire_attempts', verbosity=0)
        self.assertFalse(OutboundEmail.objects.exists())

    @override_settings(APP_ORIGIN='https://training.example.test', APP_BASE_PATH='/training')
    def test_course_and_exam_numeric_links(self):
        self.assign()
        self.assertIn(f'https://training.example.test/training/courses?course={self.course.pk}', OutboundEmail.objects.get().body_text)
        exam = make_exam(self.admin)
        self.assign(kind='exam', target_id=exam.pk)
        self.assertIn(f'https://training.example.test/training/exams?exam={exam.pk}', OutboundEmail.objects.latest('id').body_text)
        self.assertNotIn('redirect', OutboundEmail.objects.latest('id').body_text)

    def test_timezone_dst(self):
        self.assertEqual(format_time(datetime(2026, 7, 1, 18, 30, tzinfo=dt_timezone.utc)), 'Wed, Jul 1, 2026, 2:30 PM EDT')


@override_settings(**TEST_SETTINGS)
class EmailWorkerTests(TestCase):
    def setUp(self):
        # Database users reset between tests; their process-local throttle keys must too.
        cache.clear()
        self.addCleanup(cache.clear)
        self.pause = patch('training.notifications.sleep').start()
        self.addCleanup(patch.stopall)
        self.user = User.objects.create_user('queue-user', email='learner@example.test')

    def queued(self, **extra):
        values = dict(kind='assignment', recipient_user=self.user, to_email=self.user.email,
                      subject='Training', body_text='Learn', body_html='<p>Learn</p>',
                      expires_at=timezone.now() + timedelta(days=7))
        return OutboundEmail.objects.create(**(values | extra))

    def resume(self):
        EmailQueueState.objects.filter(pk=1).update(paused_until=timezone.now() - timedelta(seconds=1))

    @override_settings(EMAIL_DAILY_LIMIT=1)
    def test_daily_limit_holds_without_failure_and_still_expires(self):
        record_verification('sign_in_code', self.user.email, user=self.user)
        state = EmailQueueState.objects.get()
        state.consecutive_failures = 3
        state.last_error = 'delivery result unknown'
        state.save()
        pending = self.queued()
        expired = self.queued(expires_at=timezone.now() - timedelta(seconds=1))
        with patch('training.notifications.send_message') as send:
            self.assertEqual(deliver_queued(), 0)
            send.assert_not_called()
        pending.refresh_from_db()
        expired.refresh_from_db()
        state.refresh_from_db()
        self.assertEqual((pending.status, pending.attempts, pending.last_error), ('queued', 0, ''))
        self.assertEqual((expired.status, expired.attempts, expired.last_error),
                         ('cancelled', 0, 'Expired before delivery.'))
        self.assertEqual((state.consecutive_failures, state.last_error, state.paused_until),
                         (3, 'delivery result unknown', None))

    @override_settings(EMAIL_DAILY_LIMIT=1)
    def test_daily_limit_resumes_at_rolling_boundary(self):
        now = timezone.now()
        record_verification('guest_verification', 'guest@example.test')
        OutboundEmail.objects.filter(status='sent').update(sent_at=now - timedelta(hours=24) + timedelta(seconds=1))
        row = self.queued()
        with patch('training.notifications.timezone.now', return_value=now):
            self.assertEqual(deliver_queued(), 0)
        with patch('training.notifications.timezone.now', return_value=now + timedelta(seconds=1)):
            self.assertEqual(deliver_queued(), 1)
        row.refresh_from_db()
        self.assertEqual((row.status, row.attempts), ('sent', 1))

    @override_settings(EMAIL_DAILY_LIMIT=2)
    def test_daily_limit_counts_once_per_batch_and_stops_at_limit(self):
        for _ in range(4):
            self.queued()
        with CaptureQueriesContext(connection) as queries:
            self.assertEqual(deliver_queued(), 2)
        counts = [q['sql'] for q in queries if 'COUNT(' in q['sql'].upper() and 'training_outboundemail' in q['sql']]
        self.assertEqual(len(counts), 1)
        self.assertEqual(OutboundEmail.objects.filter(status='queued', attempts=0).count(), 2)

    @override_settings(EMAIL_DAILY_LIMIT=2)
    def test_daily_limit_accounts_for_acceptance_during_batch(self):
        self.queued()
        waiting = self.queued()
        # A synchronous send can finish between the batch count and the next claim.
        with patch('training.notifications.send_message', side_effect=lambda row:
                   record_verification('guest_verification', 'guest@example.test')) as send:
            self.assertEqual(deliver_queued(), 1)
            self.assertEqual(send.call_count, 1)
        waiting.refresh_from_db()
        self.assertEqual((waiting.status, waiting.attempts), ('queued', 0))

    @override_settings(EMAIL_DAILY_LIMIT=0)
    def test_zero_daily_limit_disables_count_and_hold(self):
        record_verification('sign_in_code', self.user.email, user=self.user)
        self.queued()
        with patch('training.notifications.accepted_last_day') as count:
            self.assertEqual(deliver_queued(), 1)
            count.assert_not_called()

    def test_success_claimed_before_send(self):
        row = self.queued()
        def inspect(message, **kwargs):
            current = OutboundEmail.objects.get(pk=row.pk)
            self.assertEqual((current.status, current.attempts), ('sending', 1))
            self.assertEqual(EmailQueueState.objects.get().active_email_id, row.pk)
            self.assertEqual(message.from_email, settings.DEFAULT_FROM_EMAIL)
            self.assertEqual(message.alternatives[0].mimetype, 'text/html')
            return 1
        with patch('django.core.mail.EmailMultiAlternatives.send', autospec=True, side_effect=inspect):
            self.assertEqual(deliver_queued(), 1)
        row.refresh_from_db()
        self.assertEqual(row.status, 'sent')
        self.assertIsNotNone(row.sent_at)
        self.assertIsNone(EmailQueueState.objects.get().active_email_id)
        self.assertEqual(deliver_queued(), 0)

    def test_locmem_delivery(self):
        self.queued()
        deliver_queued()
        self.assertEqual(len(mail.outbox), 1)

    def test_429_pauses_whole_queue_including_new_rows_without_failure(self):
        first, second = self.queued(), self.queued()
        with patch('training.notifications.send_message', side_effect=GraphMailError('ignored', status_code=429)) as send:
            self.assertEqual(deliver_queued(), 1)
            later = self.queued()
            self.assertEqual(deliver_queued(), 0)
            self.assertIsNone(claim_next())
            self.assertEqual(send.call_count, 1)
        for row in (first, second, later):
            row.refresh_from_db()
            self.assertEqual(row.status, 'queued')
        self.assertEqual([first.attempts, second.attempts, later.attempts], [1, 0, 0])
        self.assertIn('HTTP 429', first.last_error)
        self.resume()
        self.assertEqual(deliver_queued(), 3)
        self.assertEqual(EmailQueueState.objects.get().consecutive_failures, 0)

    def test_retry_after_honoured_and_clamped(self):
        now = timezone.now()
        for status in (429, 503):
            for header, seconds in ((1, 60), (300, 300), (86400, 3600)):
                record_outcome()
                row = self.queued(next_attempt_at=now)
                with patch('training.notifications.timezone.now', return_value=now):
                    with patch('training.notifications.send_message', side_effect=GraphMailError('ignored', status_code=status, retry_after=header)):
                        deliver_queued()
                self.assertEqual(EmailQueueState.objects.get().paused_until, now + timedelta(seconds=seconds))
                self.assertFalse(OutboundEmail.objects.filter(status='failed').exists())
                OutboundEmail.objects.all().delete()

    def test_mailbox_errors_pause_and_never_fail_or_cap_attempts(self):
        for error in [GraphMailError('ignored', status_code=code) for code in (401, 403, 404, 503)] + [
            GraphMailError('Graph mail authentication failed.'),
            GraphMailError('Message sender differs from the configured Graph mailbox.'),
            ImproperlyConfigured('secret text'),
        ]:
            record_outcome()
            row = self.queued(attempts=50)
            with patch('training.notifications.send_message', side_effect=error) as send:
                deliver_queued(); deliver_queued()
                self.assertEqual(send.call_count, 1)
            row.refresh_from_db()
            self.assertEqual((row.status, row.attempts), ('queued', 51))
            self.assertTrue(row.last_error)
            self.assertNotIn('secret', row.last_error)
            OutboundEmail.objects.all().delete()

    def test_consecutive_failures_backoff_and_accepted_message_resets(self):
        row = self.queued()
        with patch('training.notifications.send_message', side_effect=GraphMailError('ignored', status_code=429)):
            for minutes in (1, 2, 4, 8, 15, 15):
                self.resume()
                now = timezone.now()
                with patch('training.notifications.timezone.now', return_value=now):
                    deliver_queued()
                self.assertEqual(EmailQueueState.objects.get().paused_until, now + timedelta(minutes=minutes))
        self.resume()
        deliver_queued()
        row.refresh_from_db()
        self.assertEqual((row.status, row.attempts), ('sent', 7))
        self.assertEqual(EmailQueueState.objects.get().consecutive_failures, 0)
        self.assertIsNone(EmailQueueState.objects.get().paused_until)
        record_outcome(TimeoutError())
        self.assertEqual(EmailQueueState.objects.get().consecutive_failures, 1)

    def test_unknown_outcomes_fail_once_stop_batch_and_log_only_metadata(self):
        errors = [GraphMailError('ignored', status_code=code) for code in (400, 422, 500, 502, 504)]
        errors += [TimeoutError('secret code 123456'), OSError('secret'), RuntimeError('secret')]
        for error in errors:
            record_outcome()
            first, second = self.queued(), self.queued()
            with patch('training.notifications.send_message', side_effect=error) as send:
                with self.assertLogs('training.notifications', level='WARNING') as logs:
                    deliver_queued()
                self.assertEqual(send.call_count, 1)
            first.refresh_from_db(); second.refresh_from_db()
            self.assertEqual((first.status, first.attempts, second.attempts), ('failed', 1, 0))
            self.assertTrue(first.last_error.startswith(UNKNOWN))
            if isinstance(error, GraphMailError):
                self.assertIn(f'HTTP {error.status_code}', first.last_error)
            self.resume()
            deliver_queued()
            first.refresh_from_db()
            self.assertEqual(first.attempts, 1)
            self.assertNotIn('secret', str(logs.output))
            self.assertNotIn(first.to_email, str(logs.output))
            OutboundEmail.objects.all().delete()

    def test_zero_backend_result_is_unknown(self):
        row = self.queued()
        with patch('django.core.mail.EmailMultiAlternatives.send', return_value=0):
            deliver_queued()
        row.refresh_from_db()
        self.assertEqual((row.status, row.last_error), ('failed', UNKNOWN))

    def test_stale_sending_is_failed_without_resending_and_releases_claim(self):
        stale = self.queued(status='sending', attempts=1, next_attempt_at=timezone.now() - timedelta(minutes=16))
        recent = self.queued(status='sending', attempts=1)
        EmailQueueState.objects.create(active_email=stale)
        with patch('training.notifications.send_message') as send:
            deliver_queued()
            send.assert_not_called()
        stale.refresh_from_db(); recent.refresh_from_db()
        self.assertEqual((stale.status, stale.last_error), ('failed', UNKNOWN))
        self.assertEqual(recent.status, 'sending')
        self.assertIsNone(EmailQueueState.objects.get().active_email_id)

    @override_settings(EMAIL_QUEUE_BATCH=2)
    def test_batch_limit_counts_only_send_attempts_not_expired_rows(self):
        for _ in range(3): self.queued(expires_at=timezone.now() - timedelta(seconds=1))
        for _ in range(3): self.queued()
        self.assertEqual(deliver_queued(), 2)
        self.assertEqual(OutboundEmail.objects.filter(status='queued').count(), 1)
        self.assertEqual(OutboundEmail.objects.filter(status='cancelled', attempts=0, last_error='Expired before delivery.').count(), 3)
        self.assertEqual(self.pause.call_count, 2)

    def test_session_expiry_is_cancelled(self):
        row = self.queued(expires_at=timezone.now() + timedelta(hours=1))
        with patch('training.notifications.timezone.now', return_value=timezone.now() + timedelta(hours=2)):
            self.assertEqual(deliver_queued(), 0)
        row.refresh_from_db()
        self.assertEqual((row.status, row.attempts, row.last_error), ('cancelled', 0, 'Expired before delivery.'))

    def test_time_budget(self):
        self.queued(); self.queued()
        with patch('training.notifications.monotonic', side_effect=[0, 0, 31]):
            self.assertEqual(deliver_queued(), 1)

    @override_settings(EMAIL_NOTIFICATIONS_ENABLED=False)
    def test_disabled_worker_idles(self):
        row = self.queued()
        with patch('training.notifications.send_message') as send:
            self.assertEqual(deliver_queued(), 0)
            send.assert_not_called()
        row.refresh_from_db()
        self.assertEqual(row.status, 'queued')

    def test_deleted_and_deactivated_recipients_cancelled(self):
        deleted = User.objects.create_user('deleted', email='gone@example.test')
        disabled = User.objects.create_user('disabled', is_active=False)
        rows = [self.queued(recipient_user=deleted), self.queued(recipient_user=disabled)]
        deleted.delete()
        self.assertEqual(deliver_queued(), 0)
        for row, reason in zip(rows, ('Recipient account no longer exists.', 'Recipient account is inactive.')):
            row.refresh_from_db()
            self.assertEqual((row.status, row.attempts, row.last_error), ('cancelled', 0, reason))

    def test_scheduler_survives_mail_failure_and_logs_class_only(self):
        from .management.commands.run_scheduler import scheduler_tick
        with patch('training.management.commands.run_scheduler.call_command') as duties:
            with patch('training.management.commands.run_scheduler.deliver_queued', side_effect=RuntimeError('secret')):
                with self.assertLogs('training.notifications', level='WARNING') as logs:
                    scheduler_tick(); scheduler_tick()
        self.assertEqual(duties.call_count, 2)
        self.assertIn('exception=RuntimeError', str(logs.output))
        self.assertNotIn('secret', str(logs.output))


@override_settings(**TEST_SETTINGS)
class EmailAdministrationTests(TestCase):
    def setUp(self):
        # Database users reset between tests; their process-local throttle keys must too.
        cache.clear()
        self.addCleanup(cache.clear)
        self.admin = User.objects.create_user('email-admin', email='admin@example.test', role='admin')
        self.user = User.objects.create_user('email-learner', email='learner@example.test')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def failed(self, **extra):
        return OutboundEmail.objects.create(kind='assignment', recipient_user=self.user, to_email=self.user.email,
            subject='Training', body_text='Training body', status='failed', **extra)

    @override_settings(EMAIL_DAILY_LIMIT=1)
    def test_daily_limit_reports_all_kinds_without_blocking_codes_or_tests(self):
        record_verification('sign_in_code', self.user.email, user=self.user)
        exam = make_exam(self.admin)
        invitation = self.client.post('/api/invitations/issue/', {
            'exam': exam.pk, 'key': self.user.email, 'require_email_verification': True,
        }, format='json').data
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post('/api/auth/email/request/', {'email': self.user.email}, format='json').status_code, 200)
        token = invitation['url'].split('#')[1]
        self.assertEqual(self.client.post('/api/guest/exchange/', {'token': token}, format='json').status_code, 200)
        self.assertEqual(self.client.post('/api/guest/email/request/', {}, format='json').status_code, 200)
        self.client.force_authenticate(self.admin)
        result = self.client.post('/api/email/test/', {}, format='json')
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.data['accepted'])
        data = self.client.get('/api/email/').data
        self.assertEqual((data['sent_last_24_hours'], data['daily_limit'], data['daily_limit_reached']), (4, 1, True))
        self.assertEqual(EmailQueueState.objects.get().accepted_total, 4)
        self.assertEqual(len(mail.outbox), 3)
        self.assertIsNone(data['paused_until'])
        with override_settings(EMAIL_DAILY_LIMIT=0):
            data = self.client.get('/api/email/').data
            self.assertEqual((data['sent_last_24_hours'], data['daily_limit'], data['daily_limit_reached']), (4, 0, False))

    @override_settings(EMAIL_DAILY_LIMIT=1)
    def test_daily_limit_excludes_old_failed_and_unknown_messages(self):
        self.failed()
        OutboundEmail.objects.create(kind='test', to_email=self.admin.email, status='sent',
                                     sent_at=timezone.now() - timedelta(hours=25))
        data = self.client.get('/api/email/').data
        self.assertEqual((data['sent_last_24_hours'], data['daily_limit_reached']), (0, False))

    def test_admin_only_all_endpoints(self):
        row = self.failed()
        instructor = User.objects.create_user('email-instructor', role='instructor')
        for user in (None, self.user, instructor):
            self.client.force_authenticate(user)
            self.assertEqual(self.client.get('/api/email/').status_code, 403)
            for path in ('test', f'{row.pk}/retry', f'{row.pk}/cancel'):
                self.assertEqual(self.client.post(f'/api/email/{path}/', {}, format='json').status_code, 403)
        self.assertFalse(OutboundEmail.objects.filter(kind='test').exists())

    def test_test_email_own_address_rate_limit_and_success_log(self):
        for _ in range(3):
            result = self.client.post('/api/email/test/', {'to_email': 'outsider@example.test'}, format='json')
            self.assertEqual(result.status_code, 200)
            self.assertTrue(result.data['accepted'])
        self.assertEqual([message.to for message in mail.outbox], [[self.admin.email]] * 3)
        result = self.client.post('/api/email/test/', {}, format='json')
        self.assertEqual(result.status_code, 429)
        self.assertIn('Retry-After', result)
        self.assertEqual(OutboundEmail.objects.filter(kind='test', status='sent').count(), 3)
        OutboundEmail.objects.update(created_at=timezone.now() - timedelta(minutes=11))
        self.assertEqual(self.client.post('/api/email/test/', {}, format='json').status_code, 200)

    def test_test_email_uses_shared_layout_and_preserves_subject_and_text(self):
        self.assertEqual(self.client.post('/api/email/test/', {}, format='json').status_code, 200)
        row = OutboundEmail.objects.get(kind='test')
        self.assertEqual(row.subject, f"{BRAND['title']}: Test email")
        self.assertEqual(row.body_text, f"{BRAND['title']}\n\nThis is your requested test email.\n\n{BRAND['email_footer']}")
        self.assertEqual(row.body_html, render_email(title='Test email', next_step='This is your requested test email.',
                                                   footer=BRAND['email_footer'])[1])
        self.assertIn('>Test email</h1>', row.body_html)
        self.assertIn('width="600"', row.body_html)
        self.assertEqual(mail.outbox[0].alternatives[0][0], row.body_html)

    def test_test_failure_sanitized_and_counted_in_limit(self):
        with patch('training.email_views.send_message', side_effect=RuntimeError('secret token 123456')):
            for _ in range(3):
                result = self.client.post('/api/email/test/', {}, format='json')
                self.assertEqual(result.status_code, 503)
                self.assertEqual(result.data['error'], UNKNOWN)
        self.assertEqual(self.client.post('/api/email/test/', {}, format='json').status_code, 429)
        self.assertNotIn('secret', str(list(OutboundEmail.objects.values())))

    def test_test_missing_email(self):
        self.admin.email = ''; self.admin.save()
        self.assertEqual(self.client.post('/api/email/test/', {}, format='json').status_code, 400)
        self.assertFalse(OutboundEmail.objects.exists())

    def test_retry_cancel_and_races(self):
        row = self.failed(attempts=5)
        retry = f'/api/email/{row.pk}/retry/'
        self.assertEqual(self.client.post(retry, {}, format='json').status_code, 200)
        row.refresh_from_db()
        self.assertEqual((row.status, row.attempts), ('queued', 5))
        self.assertEqual(self.client.post(retry, {}, format='json').status_code, 400)
        self.assertEqual(self.client.post(f'/api/email/{row.pk}/cancel/', {}, format='json').status_code, 200)
        row.status = 'sending'; row.save()
        self.assertEqual(self.client.post(f'/api/email/{row.pk}/cancel/', {}, format='json').status_code, 400)

    def test_retry_renews_expiry_but_not_pause(self):
        row = self.failed(expires_at=timezone.now() - timedelta(days=1))
        record_outcome(GraphMailError('ignored', status_code=429))
        pause = EmailQueueState.objects.get().paused_until
        now = timezone.now()
        with patch('training.email_views.timezone.now', return_value=now):
            self.assertEqual(self.client.post(f'/api/email/{row.pk}/retry/', {}, format='json').status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.expires_at, now + timedelta(days=7))
        self.assertEqual(EmailQueueState.objects.get().paused_until, pause)

    def test_retry_refuses_deleted_or_inactive_account(self):
        row = self.failed()
        self.user.is_active = False; self.user.save()
        self.assertEqual(self.client.post(f'/api/email/{row.pk}/retry/', {}, format='json').status_code, 400)
        self.assertFalse(self.client.get('/api/email/').data['results'][0]['can_retry'])
        self.user.delete()
        self.assertEqual(self.client.post(f'/api/email/{row.pk}/retry/', {}, format='json').status_code, 400)
        self.assertFalse(self.client.get('/api/email/').data['results'][0]['can_retry'])

    def test_successful_administrator_test_ends_pause(self):
        record_outcome(GraphMailError('ignored', status_code=403))
        log = self.client.get('/api/email/').data
        self.assertIsNotNone(log['paused_until'])
        self.assertIn('HTTP 403', log['pause_reason'])
        self.assertEqual(self.client.post('/api/email/test/', {}, format='json').status_code, 200)
        self.assertIsNone(EmailQueueState.objects.get().paused_until)
        self.assertEqual(EmailQueueState.objects.get().consecutive_failures, 0)
        self.assertIsNone(self.client.get('/api/email/').data['paused_until'])

    def test_metadata_and_test_rows_not_retryable(self):
        record_verification('sign_in_code', self.user.email, error=TimeoutError())
        row = OutboundEmail.objects.get()
        self.assertEqual(self.client.post(f'/api/email/{row.pk}/retry/', {}, format='json').status_code, 400)
        self.assertFalse(self.client.get('/api/email/').data['results'][0]['can_retry'])

    def test_pagination_filter_and_no_bodies(self):
        for _ in range(22): self.failed()
        result = self.client.get('/api/email/?status=failed&page=2').data
        self.assertEqual((result['count'], result['page'], len(result['results'])), (22, 2, 2))
        self.assertNotIn('body_text', result['results'][0])
        self.assertNotIn('context', result['results'][0])
        self.assertEqual(result['sender'], settings.DEFAULT_FROM_EMAIL)
        self.assertEqual(result['failed'], 22)
        self.assertEqual(self.client.get('/api/email/?status=bogus').status_code, 400)

    def test_verification_failure_no_code_or_capability_stored(self):
        self.client.force_authenticate(None)
        with patch('training.auth_views.secrets.randbelow', return_value=123456):
            with patch('training.auth_views.send_mail', side_effect=OSError('secret 123456 https://example.test/invite#capability')):
                with self.assertLogs('training.notifications', level='WARNING') as logs:
                    response = self.client.post('/api/auth/email/request/', {'email': self.user.email}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(EmailCode.objects.exists())
        row = OutboundEmail.objects.get()
        self.assertEqual((row.kind, row.status, row.to_email), ('sign_in_code', 'failed', self.user.email))
        self.assertEqual((row.subject, row.body_text, row.body_html, row.context), ('', '', '', {}))
        combined = str(row.__dict__) + '\n'.join(logs.output)
        self.assertNotIn('123456', combined)
        self.assertNotIn('capability', combined)
        self.assertIn('OSError', combined)

    def test_guest_failure_metadata(self):
        exam = make_exam(self.admin)
        invitation = self.client.post('/api/invitations/issue/', {
            'exam': exam.pk, 'key': self.user.email, 'require_email_verification': True,
        }, format='json').data
        self.client.force_authenticate(None)
        token = invitation['url'].split('#')[1]
        self.assertEqual(self.client.post('/api/guest/exchange/', {'token': token}, format='json').status_code, 200)
        with patch('django.core.mail.send_mail', side_effect=TimeoutError('sensitive code')):
            result = self.client.post('/api/guest/email/request/', {}, format='json')
        self.assertEqual(result.status_code, 503)
        row = OutboundEmail.objects.get()
        self.assertEqual((row.kind, row.body_text, row.body_html), ('guest_verification', '', ''))
        self.assertNotIn(token, str(row.__dict__))

    def test_verification_success_remains_synchronous_and_metadata_only(self):
        self.client.force_authenticate(None)
        result = self.client.post('/api/auth/email/request/', {'email': self.user.email}, format='json')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        row = OutboundEmail.objects.get()
        self.assertEqual((row.status, row.body_text, row.body_html), ('sent', '', ''))

    def test_error_allowlist(self):
        self.assertEqual(sanitized_error(GraphMailError('unsafe code 123456')), UNKNOWN)
        self.assertEqual(sanitized_error(GraphMailError('unsafe', status_code=403)), 'Graph mail request failed (HTTP 403).')

    @override_settings(EMAIL_NOTIFICATIONS_ENABLED=False)
    def test_pause_blocks_retry_but_keeps_test_and_verification(self):
        row = self.failed()
        self.assertEqual(self.client.post(f'/api/email/{row.pk}/retry/', {}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/email/test/', {}, format='json').status_code, 200)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post('/api/auth/email/request/', {'email': self.user.email}, format='json').status_code, 200)
        self.assertEqual(len(mail.outbox), 2)

    def test_metadata_record_failure_preserves_auth_response(self):
        self.client.force_authenticate(None)
        with patch('training.notifications.OutboundEmail.objects.create', side_effect=RuntimeError('local failure')):
            result = self.client.post('/api/auth/email/request/', {'email': self.user.email}, format='json')
        self.assertEqual(result.status_code, 200)
        self.assertTrue(EmailCode.objects.exists())
        self.assertEqual(len(mail.outbox), 1)


@override_settings(**TEST_SETTINGS)
class ConcurrentEmailTests(TransactionTestCase):
    def setUp(self):
        # Database users reset between tests; their process-local throttle keys must too.
        cache.clear()
        self.addCleanup(cache.clear)
        if connection.vendor != 'postgresql':
            self.skipTest('PostgreSQL row locks required')

    def test_concurrent_claims_are_unique_and_committed(self):
        user = User.objects.create_user('concurrent-recipient')
        for _ in range(8):
            OutboundEmail.objects.create(kind='assignment', recipient_user=user, to_email='person@example.test', body_text='Learn')
        def claim(_):
            try:
                row = claim_next()
                self.assertFalse(connection.in_atomic_block)
                return row.pk if row else None
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=4) as pool:
            claimed = list(pool.map(claim, range(8)))
        self.assertEqual(len([pk for pk in claimed if pk is not None]), 1)
        self.assertEqual(OutboundEmail.objects.filter(status='sending', attempts=1).count(), 1)
        row = OutboundEmail.objects.get(status='sending')
        with patch('training.notifications.send_message', side_effect=GraphMailError('ignored', status_code=429)):
            deliver(row)
        def paused_claim():
            try: return claim_next()
            finally: connections.close_all()
        with ThreadPoolExecutor(max_workers=1) as pool:
            self.assertIsNone(pool.submit(paused_claim).result(timeout=10))

    def test_locked_row_skipped(self):
        user = User.objects.create_user('lock-recipient')
        first = OutboundEmail.objects.create(kind='assignment', recipient_user=user, to_email='one@example.test', body_text='Learn')
        second = OutboundEmail.objects.create(kind='assignment', recipient_user=user, to_email='two@example.test', body_text='Learn')
        def claim():
            try: return claim_next().pk
            finally: connections.close_all()
        with transaction.atomic():
            OutboundEmail.objects.select_for_update().get(pk=first.pk)
            with ThreadPoolExecutor(max_workers=1) as pool:
                self.assertEqual(pool.submit(claim).result(timeout=10), second.pk)

    def test_test_email_limit_is_serialized_across_workers(self):
        admin = User.objects.create_user('concurrent-mail-admin', email='admin@example.test', role='admin')
        def send(_):
            try:
                client = APIClient()
                client.force_authenticate(admin)
                return client.post('/api/email/test/', {}, format='json').status_code
            finally:
                connections.close_all()
        with patch('training.email_views.send_message'):
            with ThreadPoolExecutor(max_workers=4) as pool:
                statuses = list(pool.map(send, range(4)))
        self.assertEqual(sorted(statuses), [200, 200, 200, 429])
        self.assertEqual(OutboundEmail.objects.filter(kind='test').count(), 3)
