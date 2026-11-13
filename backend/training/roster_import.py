"""Resolve outside the course transaction; admit under the enrollment course lock."""
import csv
import io
import re
import threading
from time import monotonic
from collections import Counter, OrderedDict
from queue import Empty, Queue
from zipfile import ZipFile

from django.db import transaction
from django.db.models import Q
from django.db.models.functions import Lower
from django.shortcuts import get_object_or_404
from django.utils import timezone
from openpyxl import load_workbook
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError

from . import directory
from .access import manages_course
from .i18n import translate
from .models import Course, CourseSession, Enrollment, TrainingGroup, User
from .services import audit

_LOOKUPS = threading.BoundedSemaphore(4)
EMAIL = re.compile(r"[\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[a-zA-Z]{2,}")


class PeopleInput(serializers.Serializer):
    text = serializers.CharField(required=False, default='', allow_blank=True, max_length=200_000, trim_whitespace=False)
    people = serializers.ListField(child=serializers.IntegerField(min_value=1), default=list, max_length=10000)
    groups = serializers.ListField(child=serializers.IntegerField(min_value=1), default=list, max_length=1000)


class RosterInput(PeopleInput):
    session = serializers.IntegerField(min_value=1)
    dry_run = serializers.BooleanField(default=False)
    notify = serializers.BooleanField(default=True)
    move_started = serializers.BooleanField(default=False)
    file = serializers.FileField(required=False)


class CheckFileInput(PeopleInput):
    file = serializers.FileField(required=False)


class CheckInput(serializers.Serializer):
    rosters = PeopleInput(many=True, min_length=1, max_length=10)


def manager_course(user, course_id, lock=False):
    course = get_object_or_404(Course.objects.select_for_update() if lock else Course.objects, pk=course_id)
    if not manages_course(user, course):
        raise PermissionDenied()
    if course.delivery_mode != 'scheduled':
        raise ValidationError(translate('Save the course as Scheduled sessions first.'))
    return course


MAX_PEOPLE = 500
MAX_ENTRIES = 2000
MAX_TEXT = 200_000
LONG_ENTRY = 200
WORD = re.compile(r'\S+')
CELL_SEPARATOR = re.compile(r'[\t,]')
STRIP = ' \t"\'()[]{}<>'
EMAIL_HEADINGS = {'email', 'e-mail', 'email address', 'e-mail address', 'work email', 'mail', '電子郵件', '電子信箱',
                  '信箱', 'correo', 'correo electrónico'}
ID_HEADINGS = {'employee id', 'employee number', 'employee no', 'employee no.', 'emp id', 'emp no', 'id', '員工編號',
               '工號', '員編', 'número de empleado', 'id de empleado'}


def too_many_lines():
    return ValidationError(translate('Use at most 2,000 lines at a time.'))


def cell_text(value):
    if value is None:
        return ''
    if isinstance(value, float) and value.is_integer():
        # Spreadsheets store whole numbers such as employee IDs as floats.
        return str(int(value))
    return str(value).strip()


def decode_csv(raw):
    """UTF-8 (BOM optional), UTF-16 with a BOM, otherwise Windows-1252; never refused for encoding."""
    if raw.startswith((b'\xff\xfe', b'\xfe\xff')):
        return raw.decode('utf-16')
    try:
        return raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        return raw.decode('cp1252', errors='replace')


def file_rows(upload):
    """Rows of cells: CSV, or the first visible worksheet of an XLSX workbook."""
    if upload.size > 1024 * 1024 or not upload.name.lower().endswith(('.csv', '.xlsx')):
        raise ValidationError({'file': translate('Use a CSV or XLSX file up to 1 MB.')})
    rows = []

    def add(cells):
        cells = [cell_text(cell) for cell in cells]
        if any(cells):
            rows.append(cells)
            if len(rows) > MAX_ENTRIES + 1:  # one heading row is allowed on top
                raise OverflowError()

    try:
        if upload.name.lower().endswith('.csv'):
            text = decode_csv(upload.read())
            first = text.split('\n', 1)[0]
            delimiter = '\t' if '\t' in first and ',' not in first else ';' if ';' in first and ',' not in first else ','
            for row in csv.reader(io.StringIO(text), delimiter=delimiter):
                add(row)
            return rows
        with ZipFile(upload) as archive:
            if sum(info.file_size for info in archive.infolist()) > 20 * 1024 * 1024:
                raise ValueError()
        upload.seek(0)
        book = load_workbook(upload, read_only=True, data_only=True)
        try:
            sheet = next((sheet for sheet in book.worksheets if sheet.sheet_state == 'visible'), None)
            for row in (sheet.iter_rows(values_only=True) if sheet is not None else ()):
                add(row)
            return rows
        finally:
            book.close()
    except OverflowError:
        raise too_many_lines() from None
    except Exception:
        raise ValidationError({'file': translate('The roster file could not be read.')}) from None


def heading(cells):
    """(column, 'email'|'employee_id') when a cell is a known heading; e-mail headings win."""
    names = [cell.strip().lower() for cell in cells]
    for known, kind in ((EMAIL_HEADINGS, 'email'), (ID_HEADINGS, 'employee_id')):
        for index, name in enumerate(names):
            if name in known:
                return index, kind
    return None


def addresses(text):
    """Linear: the address pattern only runs on words that contain '@' and are at most 254 characters."""
    found = []
    if '@' not in text:
        return found
    for word in WORD.finditer(text):
        value = word.group()
        if len(value) > 254 or '@' not in value:
            continue
        for match in EMAIL.finditer(value):
            email, start = match.group(), match.start()
            # A quote in front of an address is punctuation around it ('alex@example.com'), never part of it.
            while email[:1] in "'`":
                email, start = email[1:], start + 1
            found.append((word.start() + start, word.start() + match.end(), email.lower()))
    return found


def cut(value):
    return value if len(value) <= LONG_ENTRY else value[:LONG_ENTRY] + '…'


def address_entries(text):
    """Rule 1: one entry per address; the address is the only evidence, its name the text in front."""
    found = addresses(text)
    if len({email for _, _, email in found}) == 1:
        return [{'input': text, 'email': found[0][2], 'display_name': cut(text[:found[0][0]].strip(' \t,;<>"\'('))}]
    entries, start, seen = [], 0, set()
    for index, (begin, end, email) in enumerate(found):
        end += text[end:end + 1] == '>'
        stop = len(text) if index == len(found) - 1 else end
        if email not in seen:
            seen.add(email)
            entries.append({'input': text[start:stop].strip(' \t,;'), 'email': email,
                            'display_name': cut(text[start:begin].strip(' \t,;<>"\'('))})
        start = stop
    return entries


def row_entries(cells, text=None):
    """Rules 1 and 2 for one row without a heading. `text` is the pasted line, when there is one."""
    cells = [cell.strip() for cell in cells if cell and cell.strip()]
    joined = '\t'.join(cells)
    raw = text.strip() if text is not None else joined
    if '@' in raw and addresses(raw):
        return address_entries(raw)
    if len(joined) > LONG_ENTRY:
        return [{'input': cut(joined), 'display_name': cut(joined), 'skip': True}]
    values = [cell.strip(STRIP) for cell in cells]
    return [{'input': joined, 'display_name': joined, 'ids': [value.lower() for value in values if value],
             'username': values[0].lower() if len(values) == 1 and values[0] else None}]


def column_entries(value, kind):
    """Rule 3: with a heading only the chosen column is evidence."""
    if kind == 'email':
        if addresses(value):
            return address_entries(value)
        return [{'input': cut(value), 'display_name': cut(value), 'skip': True}]
    clean = value.strip(STRIP)
    return [{'input': cut(value), 'display_name': '', 'ids': [clean.lower()] if clean and len(clean) <= 64 else [],
             'username': None}]


def table_entries(rows, texts=None):
    rows = [(cells, texts[index] if texts else None) for index, cells in enumerate(rows)]
    if not rows:
        return []
    found = heading(rows[0][0]) if texts is None or '\t' in rows[0][1] else None
    entries = []
    if found:
        column, kind = found
        # A two-identifier template chooses evidence per row, never from Name.
        id_column = next((i for i, cell in enumerate(rows[0][0]) if cell.strip().lower() in ID_HEADINGS), None)
        dual = kind == 'email' and id_column is not None
        for cells, _ in rows[1:]:
            value = cells[column].strip() if column < len(cells) else ''
            row_kind = kind
            if dual and not value:
                value = cells[id_column].strip() if id_column < len(cells) else ''
                row_kind = 'employee_id'
            if value:
                entries.extend(column_entries(value, row_kind))
            elif dual:
                # Neither identifier: the row is reported with what it does hold (a name, say).
                joined = '\t'.join(cell.strip() for cell in cells if cell.strip())
                entries.append({'input': cut(joined), 'display_name': cut(joined), 'skip': True})
    else:
        for cells, text in rows:
            entries.extend(row_entries(cells, text))
    return entries


def text_entries(text):
    lines = [line for line in text.splitlines() if line.strip()]
    if len(lines) > MAX_ENTRIES + 1:
        raise too_many_lines()
    return table_entries([CELL_SEPARATOR.split(line) for line in lines], lines)


def chunks(values, size=MAX_ENTRIES):
    values = list(values)
    for index in range(0, len(values), size):
        yield values[index:index + size]


def match_accounts(entries):
    """Bulk: one query for every address, one for every whole cell (IDs and single-cell usernames)."""
    emails = {entry['email'] for entry in entries if entry.get('email')}
    ids = {value for entry in entries for value in entry.get('ids', ()) if len(value) <= 64}
    names = {entry['username'] for entry in entries if entry.get('username') and len(entry['username']) <= 150}
    by_email, by_id, by_name = {}, {}, {}
    for part in chunks(emails):
        for user in User.objects.annotate(roster_email=Lower('email')).filter(roster_email__in=part):
            by_email.setdefault(user.roster_email, []).append(user)
    cells = list(ids | names)
    for part in chunks(cells):
        for user in User.objects.annotate(roster_eid=Lower('employee_id'), roster_name=Lower('username')).filter(
                Q(roster_eid__in=part) | Q(roster_name__in=[value for value in part if value in names])):
            if user.roster_eid in ids:
                by_id.setdefault(user.roster_eid, []).append(user)
            if user.roster_name in names:
                by_name.setdefault(user.roster_name, []).append(user)
    for entry in entries:
        if entry.get('skip'):
            entry['matches'] = []
        elif entry.get('email'):
            entry['matches'] = by_email.get(entry['email'], [])
        else:
            people = {}
            for value in entry.get('ids', ()):
                people.update((user.pk, user) for user in by_id.get(value, []))
            if entry.get('username'):
                people.update((user.pk, user) for user in by_name.get(entry['username'], []))
            entry['matches'] = list(people.values())


_ANSWERS, _ANSWERS_LOCK = OrderedDict(), threading.Lock()
ANSWER_SECONDS, MAX_ANSWERS, PARALLEL = 600, 2000, 4


def remembered(email):
    with _ANSWERS_LOCK:
        item = _ANSWERS.get(email)
        if item and item[0] > monotonic():
            return item[1]
        _ANSWERS.pop(email, None)
        return None


def remember(email, records):
    with _ANSWERS_LOCK:
        _ANSWERS[email] = (monotonic() + ANSWER_SECONDS, records)
        _ANSWERS.move_to_end(email)
        while len(_ANSWERS) > MAX_ANSWERS:
            _ANSWERS.popitem(last=False)


def forget_answers():
    with _ANSWERS_LOCK:
        _ANSWERS.clear()


def lookup_many(emails, deadline):
    """Directory answers for distinct addresses, at most four at a time across all requests.
    Workers only read the directory: a late answer can never create an account."""
    results, todo = {}, Queue()
    for email in emails:
        records = remembered(email)
        if records is not None:
            results[email] = (records, None)
        else:
            todo.put(email)
    waiting = todo.qsize()
    if not waiting:
        return results
    answers = Queue()

    def worker():
        while True:
            try:
                email = todo.get_nowait()
            except Empty:
                return
            remaining = deadline - monotonic()
            if remaining <= 0 or not _LOOKUPS.acquire(timeout=remaining):
                answers.put((email, None, 'not_checked'))
                continue
            try:
                records = directory.graph_email_lookup(email)
            except Exception:
                answers.put((email, None, 'not_checked'))  # errors and timeouts are not remembered
            else:
                remember(email, records)
                answers.put((email, records, None))
            finally:
                _LOOKUPS.release()

    for _ in range(min(PARALLEL, waiting)):
        threading.Thread(target=worker, daemon=True).start()
    for _ in range(waiting):
        try:
            email, records, outcome = answers.get(timeout=max(0, deadline - monotonic()))
        except Empty:
            break
        results[email] = (records, outcome)
    for email in emails:
        results.setdefault(email, (None, 'not_checked'))
    return results


class Resolution:
    """Shared by every roster of one request: one deadline, one cache, one people limit."""

    def __init__(self):
        self.deadline = monotonic() + 20
        self.cache, self.unique, self.entries = {}, set(), 0


def resolve(values, state=None):
    """Ordered evidence, including unsaved eligible directory profiles."""
    state = state or Resolution()
    entries = text_entries(values.get('text', ''))
    state.entries += len(entries)
    if state.entries > MAX_ENTRIES:
        raise too_many_lines()
    if values.get('file'):
        rows = table_entries(file_rows(values['file']))
        entries.extend(rows)
        state.entries += len(rows)
        if state.entries > MAX_ENTRIES:
            raise too_many_lines()
    match_accounts(entries)
    people = values.get('people', [])
    accounts = User.objects.in_bulk(set(people))
    entries.extend({'input': str(pk), 'display_name': '', 'matches': [accounts[pk]] if pk in accounts else []}
                   for pk in people)
    groups = values.get('groups', [])
    if len(set(groups)) != TrainingGroup.objects.filter(pk__in=groups).count():
        raise ValidationError({'groups': translate('Select valid groups.')})
    for group_id in groups:
        members = User.objects.filter(training_group_memberships__group_id=group_id, is_active=True).order_by('pk')
        entries.extend({'input': str(user.pk), 'display_name': '', 'matches': [user]} for user in members)
    cache, unique = state.cache, state.unique
    if directory.configured():
        unknown = list(dict.fromkeys(entry['email'] for entry in entries if entry.get('email') and not entry['matches']
                                     and entry['email'] not in cache and directory.email_code_domain(entry['email'])))
        for email, (records, outcome) in lookup_many(unknown, state.deadline).items():
            candidate = directory.provision_email_user(email, records=records, dry_run=True) if records is not None else None
            if records is not None and len(records) > 1:
                outcome = 'ambiguous'
            cache[email] = (candidate, records, outcome)
    resolved = []
    for item in entries:
        entry = {'input': item['input'], 'person': None, 'outcome': 'not_found', 'display_name': item['display_name']}
        matches, email = item['matches'], item.get('email')
        if len(matches) > 1:
            entry['outcome'] = 'ambiguous'
        elif matches:
            entry.update(person=matches[0], outcome=None)
        elif email in cache:
            person, records, outcome = cache[email]
            entry.update(person=person, records=records, email=email, outcome=None if person else outcome or 'not_found')
        if entry['person']:
            person = entry['person']
            key = ('user', person.pk) if person.pk else ('directory', person.entra_subject)
            if key in unique:
                entry['outcome'] = 'duplicate'
            unique.add(key)
            if len(unique) > MAX_PEOPLE:
                raise ValidationError(translate('Use at most 500 people at a time.'))
        resolved.append(entry)
    return resolved


def report_row(entry, outcome, person):
    if outcome == 'inactive' or person is None:
        # Inactive accounts are not described: the input only.
        return {'input': entry['input'], 'outcome': outcome, 'user': None,
                'name': '' if outcome == 'inactive' else entry.get('display_name', ''), 'email': '', 'department': ''}
    return {'input': entry['input'], 'outcome': outcome, 'user': person.pk, 'name': person.display_name or person.username,
            'email': person.email, 'department': person.department}


def movable(row, now, move_started=False):
    """Never erase attendance: someone who attended (or may have) stays where they are."""
    from .attendance import effective
    old = row.session
    if effective(row) == 'present':
        return False
    if old is None or old.cancelled or now < old.starts_at or row.attendance == 'absent':
        return True
    return move_started


def apply_roster(actor, course, session, entries, *, dry_run=False, notify=True, move_started=False):
    """Caller holds course lock. Dry-run simulates seats without writing anything."""
    from .course_sessions import released
    if session.cancelled:
        raise ValidationError(translate('This session is cancelled or has ended.'))
    reserved = session.enrollments.filter(status__in=['approved', 'pending']).count()
    now = timezone.now()
    # No mail for a course people cannot open yet; the import itself still works.
    notify = notify and released(course, now)
    rows, notified = [], 0
    for entry in entries:
        person, outcome = entry['person'], entry['outcome']
        row = None
        if person and not person.pk:
            existing = User.objects.filter(email__iexact=person.email, entra_subject=person.entra_subject).first()
            person = existing or person
        if person and person.pk:
            # Recheck activation and enrollment after the course lock was obtained.
            person = User.objects.get(pk=person.pk)
            row = Enrollment.objects.select_related('session').filter(course=course, user=person).first()
        if outcome is None:
            active = row and row.status in ('approved', 'pending')
            if not person.is_active:
                outcome = 'inactive'
            elif active and row.session_id == session.pk:
                outcome = 'already' if row.status == 'approved' else 'approved'
            elif active and not movable(row, now, move_started):
                outcome = 'already'
            elif reserved >= session.capacity:
                outcome = 'full'
            else:
                outcome = 'moved' if active else 'added'
                reserved += 1
        if not dry_run and outcome in ('added', 'moved', 'approved'):
            if not person.pk:
                person = directory.provision_email_user(entry['email'], records=entry['records'], source='roster')
                if person is None:
                    # A simultaneous sign-in may have provisioned this exact address.
                    person = User.objects.filter(email__iexact=entry['email'], entra_subject=entry['person'].entra_subject, is_active=True).first()
                if person is None:
                    outcome = 'not_found'
                    reserved -= 1
                else:
                    row = Enrollment.objects.select_related('session').filter(course=course, user=person).first()
            if person:
                old = row.session if row else None
                cleared = None
                row = row or Enrollment(course=course, user=person)
                if row.session_id != session.pk or row.status not in ('approved', 'pending'):
                    if row.pk:
                        cleared = {'previous_attendance': row.attendance,
                                   'previous_attended_at': row.attended_at.isoformat() if row.attended_at else None,
                                   'previous_progress': row.progress,
                                   'previous_completed_at': row.completed_at.isoformat() if row.completed_at else None}
                    row.attended_at, row.attendance = None, ''
                    row.attendance_marked_at, row.attendance_marked_by = None, None
                    if course.venue == 'onsite':
                        row.progress, row.completed_at = 0, None
                row.session, row.status = session, 'approved'
                row.revision += 1
                row.reviewed_by, row.reviewed_at = actor, now
                row.review_note = ''
                if outcome == 'added':
                    row.requested_at = now
                row.save()
                audit(actor, 'enrollment.roster_' + outcome, row.pk,
                      {'course': course.pk, 'user': person.pk, 'session': session.pk,
                       'previous_session': old.pk if old else None, **(cleared or {})})
                if notify:
                    from .notifications import enrollment_notification, session_changed
                    from .reminders import ready_for_late_enrollment
                    if session.ends_at <= now:
                        # Into a session that is over: the quiz-ready decision only. "You are registered"
                        # for a date in the past helps nobody.
                        eligible, queued = ready_for_late_enrollment(row)
                        sent = queued if eligible else False
                    elif outcome == 'added':
                        sent = enrollment_notification(row, actor, 'You are registered')
                    elif outcome == 'moved':
                        sent = session_changed(row, actor, old)
                    else:
                        sent = enrollment_notification(row, actor, 'Enrollment approved')
                    notified += bool(sent)
        rows.append(report_row(entry, outcome, person))
    return {'session': session.pk, **report(rows), 'notified': notified}


def import_roster(user, course_id, data):
    course = manager_course(user, course_id)
    form = RosterInput(data=data)
    form.is_valid(raise_exception=True)
    values = form.validated_data
    get_object_or_404(CourseSession, pk=values['session'], course=course)
    entries = resolve(values)
    with transaction.atomic():
        course = manager_course(user, course_id, lock=True)
        session = get_object_or_404(CourseSession, pk=values['session'], course=course)
        return apply_roster(user, course, session, entries, dry_run=values['dry_run'], notify=values['notify'],
                            move_started=values['move_started'])


def report(rows):
    return {'counts': dict(Counter(row['outcome'] for row in rows)), 'rows': rows}


def check_people(data, *, flatten):
    """Read-only: resolves who a list names. No account, enrollment, audit row or mail."""
    if hasattr(data, 'getlist'):
        # Multipart carries exactly one roster, optionally with a file.
        form = CheckFileInput(data=data)
        form.is_valid(raise_exception=True)
        rosters, prefix = [form.validated_data], None
    else:
        form = CheckInput(data=data)
        if not form.is_valid():
            raise ValidationError(flatten(form.errors))
        rosters, prefix = form.validated_data['rosters'], 'rosters'
    state, reports = Resolution(), []
    for index, values in enumerate(rosters):
        try:
            entries = resolve(values, state)
        except ValidationError as exc:
            raise (ValidationError(flatten(exc.detail, f'{prefix}[{index}]')) if prefix else exc) from None
        rows = []
        for entry in entries:
            person, outcome = entry['person'], entry['outcome']
            if outcome is None:
                outcome = 'added' if person.is_active else 'inactive'
            rows.append(report_row(entry, outcome, person))
        reports.append(report(rows))
    return {'rosters': reports}
