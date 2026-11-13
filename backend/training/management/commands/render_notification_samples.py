"""Render synthetic notification previews without database access or delivery."""
from training.brand import BRAND


from datetime import datetime, timedelta, timezone
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.test.utils import override_settings

from training.email_layout import render_email
from training.models import Course, CourseSession, Exam, User, SystemSettings
from training.runtime_settings import settings_snapshot
from training.notifications import message_content


@settings_snapshot(SystemSettings())
def sample_messages():
    actor = User(username="sample.organizer", display_name="Alex Morgan")
    start = datetime(2026, 12, 8, 15, 0, tzinfo=timezone.utc)
    description = "Practice planning your work, sharing updates and preparing a clear handoff with your team."
    course = Course(pk=101, title="Planning and team handoffs", description=description,
                    delivery_mode="scheduled", duration_minutes=60, category="Workplace skills")
    # Session mails are shown for an on-site course; assignment samples keep the online default.
    onsite = Course(pk=101, title=course.title, description=description, delivery_mode="scheduled",
                    venue="onsite", duration_minutes=60, category="Workplace skills")
    session = CourseSession(title="Morning workshop", starts_at=start, ends_at=start + timedelta(hours=1),
                            location="Training room 2", meeting_url="https://meet.example.com/workshop?a=1&b=2")
    earlier = CourseSession(title="Morning workshop", starts_at=start - timedelta(days=1),
                            ends_at=start - timedelta(days=1) + timedelta(hours=1), location="Training room 2")
    samples = {}
    with override_settings(APP_ORIGIN="https://learn.example.com", APP_BASE_PATH="/training",
                           NOTIFICATION_TIME_ZONE="America/New_York"):
        for name, event in (
            ("registered", "You are registered"),
            ("session-changed", "Session changed"),
            ("registration-cancelled", "Registration cancelled"),
            ("request-received", "Request received"),
            ("session-tomorrow", "Session tomorrow"),
            ("assigned-scheduled", "New training assigned"),
            ("registration-confirmed", "Session registration confirmed"),
            ("enrollment-approved-session", "Enrollment approved"),
            ("enrollment-rejected", "Enrollment rejected"),
            ("enrollment-removed", "Enrollment removed"),
            ("session-cancelled", "Session cancelled"),
            ("session-rescheduled", "Session rescheduled"),
        ):
            samples[name] = message_content(
                event, course if event == "New training assigned" else onsite, actor=actor, due_at=start + timedelta(days=7),
                old_session=earlier if event in {'Session changed', 'Session rescheduled'} else None,
                session=None if event == "New training assigned" else session,
                approved=event in {"Session registration confirmed", "Enrollment approved", "Session rescheduled"},
                note="Please check with the organizer about the next session.\nKeep this message for reference.",
            )
        course.requires_approval = True
        samples["assigned-scheduled-approval"] = message_content("New training assigned", course, actor=actor)
        course.venue = "onsite"
        samples["assigned-onsite"] = message_content("New training assigned", course, actor=actor)
        course.delivery_mode = "self_paced"
        course.venue = "online"
        samples["assigned-self-paced-approval"] = message_content("New training assigned", course, actor=actor)
        course.requires_approval = False
        samples["assigned-self-paced"] = message_content("New training assigned", course, actor=actor)
        samples["enrollment-approved-self-paced"] = message_content("Enrollment approved", course, actor=actor)
        exam = Exam(pk=201, title="Team handoffs assessment", description=description,
                    duration_minutes=20, questions_per_attempt=10, pass_score=80,
                    ends_at=start + timedelta(days=14))
        samples['quiz-ready'] = message_content('Your quiz is ready', exam)
        samples['quiz-reminder'] = message_content('Quiz reminder', exam)
        samples["assigned-exam"] = message_content("New training assigned", exam, actor=actor)
        course.delivery_mode = "scheduled"
        course.title = 'Planning <script> & "handoffs"'
        course.description = description * 5
        session.location = "Training room " + "WestWing" * 22
        session.meeting_url = "https://meet.example.com/" + "workshop" * 40 + "?a=1&b=2"
        samples["escaping-and-wrapping"] = message_content(
            "Session rescheduled", course, session=session, approved=True,
            note='Keep <script>alert("sample")</script> as text.\nSecond line & details.',
        )
    text = f"{BRAND['title']}\n\nThis is your requested test email.\n\n{BRAND['email_footer']}"
    _, html = render_email(title="Test email", next_step="This is your requested test email.",
                           footer=BRAND["email_footer"])
    samples["test-email"] = (f"{BRAND['title']}: Test email", text, html)
    return samples


class Command(BaseCommand):
    help = "Write synthetic notification .html/.txt previews, only when DEBUG=true; never query or send mail."
    requires_system_checks = []

    def add_arguments(self, parser):
        parser.add_argument("output_dir", type=Path)

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("Notification samples are disabled when DEBUG=false.")
        output = options["output_dir"]
        output.mkdir(parents=True, exist_ok=True)
        samples = sample_messages()
        for name, (subject, text, html) in samples.items():
            (output / f"{name}.txt").write_text(subject + "\n\n" + text, encoding="utf-8")
            (output / f"{name}.html").write_text(html, encoding="utf-8")
        self.stdout.write(f"Rendered {len(samples)} synthetic samples in {output}.")
