"""Formula-free, localized session workbooks scoped by the LMS access policy."""
import unicodedata
from io import BytesIO
from urllib.parse import quote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.db.models import Count, Max, Q
from django.http import HttpResponse
from django.utils import timezone
from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.styles import Alignment, Border, Font, Side
from openpyxl.utils import get_column_letter
from rest_framework.exceptions import ValidationError

from .runtime_settings import organization
from .access import sees_results
from .attendance import effective, session_for_manager
from .i18n import translate as t
from .brand import pdf_logo
from .models import Attempt


def session_export(request, course_id, session_id):
    session = session_for_manager(request.user, course_id, session_id)
    kind = request.query_params.get('kind', 'sign-in')
    if kind not in ('sign-in', 'sign-in-pdf', 'attendance'):
        raise ValidationError(t('Choose a valid export.'))
    results = kind == 'attendance'
    if results and timezone.now() < session.starts_at:
        raise ValidationError(t('Attendance results are available from the session start.'))
    try:
        zone = ZoneInfo(request.query_params.get('timezone', settings.TIME_ZONE))
    except (ValueError, ZoneInfoNotFoundError):
        raise ValidationError(t('Choose a valid IANA time zone.'))
    def date(value):
        return value.astimezone(zone).strftime('%Y-%m-%d %H:%M %Z') if value else ''

    exams = list(session.course.assessments.order_by('title', 'pk')) if results else []
    visible = [exam for exam in exams if sees_results(request.user, exam)]
    pass_only = [exam for exam in exams if exam not in visible and exam.published]
    rows = sorted(session.enrollments.filter(status__in=('approved', 'pending')).select_related('user'),
                  key=lambda row: ((row.user.display_name or row.user.username).casefold(), row.pk))
    if kind == 'sign-in-pdf':
        return sign_in_pdf(session, rows, date, zone)
    evidence = {}
    if visible:
        for item in Attempt.objects.filter(exam__in=visible, identity__user_id__in=[row.user_id for row in rows],
                                           status='graded').values('exam_id', 'identity__user_id').annotate(best=Max('score'), passed_any=Count('pk', filter=Q(passed=True))):
            evidence[(item['exam_id'], item['identity__user_id'])] = item
    # Managers may see a published quiz's pass status, without reading its scores.
    if pass_only:
        for item in Attempt.objects.filter(exam__in=pass_only, identity__user_id__in=[row.user_id for row in rows],
                status='graded').values('exam_id', 'identity__user_id').annotate(passed_any=Count('pk', filter=Q(passed=True))):
            evidence[(item['exam_id'], item['identity__user_id'])] = item
    wb = Workbook()
    ws = wb.active
    ws.title = t('Attendance results' if results else 'Sign-in sheet')[:31]

    def write(values):
        # Set the data type explicitly, including headings and user-controlled exam titles.
        # CSV prefix escaping is insufficient for a native Excel workbook.
        index = ws.max_row + 1 if ws.cell(1, 1).value is not None else 1
        for column, value in enumerate(values, 1):
            cell = ws.cell(index, column)
            if type(value) in (int, float):
                cell.value = value
            else:
                cell.value = ILLEGAL_CHARACTERS_RE.sub('', str(value) if value is not None else '')
                cell.data_type = 's'
        return index

    write([t('Attendance results' if results else 'Sign-in sheet')])
    write([t('Course'), session.course.title])
    write([t('Session'), session.title])
    write([t('Date and time'), f'{date(session.starts_at)} — {date(session.ends_at)} ({zone.key})'])
    write([t('Location'), session.location])
    if len(visible) + len(pass_only) != len(exams):
        write([t('Exam result columns are omitted where you do not have result access.')])
    columns = ['Name', 'Employee ID', 'Department', 'Job title', 'Email', 'Registration']
    if results:
        columns += ['Attendance', 'Source', 'Time', 'Course completed']
    else:
        columns = ['No.'] + columns + ['Signature']
    headings = [t(col) for col in columns]
    for exam in visible:
        headings.extend([exam.title + ' — ' + t('Best score'), exam.title + ' — ' + t('Passed')])
    for exam in pass_only:
        headings.append(exam.title + ' — ' + t('Passed'))
    header = write(headings)
    for number, row in enumerate(rows, 1):
        person = row.user
        values = [person.display_name or person.username, person.employee_id or '', person.department,
                  person.job_title, person.email, t('Confirmed' if row.status == 'approved' else 'Pending approval')]
        if results:
            source = 'Marked by organizer' if row.attendance else 'Opened content during the session' if row.attended_at else ''
            values += [t({'present': 'Present', 'absent': 'Absent', '': 'No record'}[effective(row)]), t(source),
                       date(row.attendance_marked_at if row.attendance else row.attended_at),
                       (t('Yes') + ' — ' + date(row.completed_at)) if row.completed_at else t('No')]
            for exam in visible:
                result = evidence.get((exam.pk, person.pk))
                values += [result['best'] if result else '', t('Yes' if result['passed_any'] else 'No') if result else '']
            for exam in pass_only:
                result = evidence.get((exam.pk, person.pk))
                values.append(t('Passed' if result and result['passed_any'] else 'Not passed' if result else 'Not started'))
        else:
            values = [number] + values + ['']
        write(values)
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.orientation = 'landscape'
    # No paperSize: Excel then prints on the printer's default (Letter in the US).
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.print_title_rows = f'{header}:{header}'
    ws.print_options.horizontalCentered = True
    ws.freeze_panes = f'A{header + 1}'
    ws.print_area = f'A1:{get_column_letter(len(headings))}{ws.max_row}'
    side = Side(style='thin')
    border = Border(left=side, right=side, top=side, bottom=side)
    for cells in ws.iter_rows(min_row=header):
        for cell in cells:
            cell.border = border
            cell.alignment = Alignment(vertical='center', wrap_text=True)
            if cell.row == header:
                cell.font = Font(bold=True)
        ws.row_dimensions[cells[0].row].height = 32 if results else 40
    ws.cell(1, 1).font = Font(size=16, bold=True)
    for index, column in enumerate(columns, 1):
        ws.column_dimensions[get_column_letter(index)].width = {'No.': 6, 'Signature': 32, 'Email': 30, 'Time': 27, 'Course completed': 30, 'Source': 28}.get(column, 22)
    for index in range(len(columns)+1, len(headings)+1):
        ws.column_dimensions[get_column_letter(index)].width = 22
    # Heading values span the page, keeping long names/locations readable in print.
    for index in range(1, header):
        ws.merge_cells(start_row=index, start_column=1 if index in (1, 6) else 2,
                       end_row=index, end_column=len(headings))
        ws.cell(index, 1 if index in (1, 6) else 2).alignment = Alignment(wrap_text=True, vertical='center')
        ws.row_dimensions[index].height = 30
    output = BytesIO()
    wb.save(output)
    response = HttpResponse(output.getvalue(), content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    response['Content-Disposition'] = attachment(session, kind, 'xlsx')
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    return response


def attachment(session, kind, extension):
    """'Forklift refresher - Session 1 - sign-in.pdf' with an ASCII fallback for every browser."""
    def clean(value, ascii_only=False):
        value = ''.join(' ' if ch in '"\\/:*?<>|;%' or unicodedata.category(ch)[0] == 'C' else ch for ch in value)
        if ascii_only:
            value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode()
        return ' '.join(value.split())[:100].lstrip('=+-@ .').rstrip(' .')

    def name(ascii_only=False):
        parts = [part for part in (clean(session.course.title, ascii_only), clean(session.title, ascii_only)) if part]
        return ' - '.join(parts or [f'session-{session.pk}']) + f' - {kind}.{extension}'

    return f'attachment; filename="{name(True)}"; filename*=UTF-8\'\'{quote(name(), safe="")}'


# TTFont registration is shared by requests and protected against first-use races.
import threading
_FONT_LOCK = threading.Lock()


def sign_in_pdf(session, rows, date, zone):
    from html import escape
    from pathlib import Path
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from .i18n import format_when

    font = 'TrainingNotoSansTC'
    with _FONT_LOCK:
        if font not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(font, str(Path(__file__).parent / 'fonts' / 'NotoSansTC-Regular.ttf')))
    normal = ParagraphStyle('Roster', fontName=font, fontSize=10, leading=15, wordWrap='CJK')
    heading = ParagraphStyle('Heading', parent=normal, fontSize=15, leading=21, spaceAfter=4)
    label = ParagraphStyle('Label', parent=normal, fontSize=9, leading=12, textColor=colors.HexColor('#616161'))

    def paragraph(value, style=normal):
        return Paragraph(escape(str(value or '')), style)

    class NumberedCanvas(canvas.Canvas):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.pages = []

        def showPage(self):
            self.pages.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self.pages)
            for state in self.pages:
                self.__dict__.update(state)
                self.setFont(font, 9)
                self.drawCentredString(letter[0] / 2, 24, t('Page {page} of {pages}', page=self._pageNumber, pages=total))
                super().showPage()
            super().save()

    output = BytesIO()
    doc = SimpleDocTemplate(output, pagesize=letter, rightMargin=36, leftMargin=36, topMargin=30, bottomMargin=42,
                            title=session.course.title, author=organization()['title'])
    width = letter[0] - 72
    titles = [paragraph(t('Sign-in sheet'), label), paragraph(session.course.title, heading)]
    mark = pdf_logo(126)
    if mark is not None:
        header = Table([[titles, mark]], colWidths=[width - 140, 140], hAlign='LEFT')
        header.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
                                    ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
                                    ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0)]))
        story = [header]
    else:
        story = titles
    story += [paragraph(format_when(session.starts_at, session.ends_at, zone)), paragraph(session.title),
              paragraph(session.location), Spacer(1, 14)]
    data = [[paragraph(t(label)) for label in ('No.', 'Name', 'Employee ID', 'Department', 'Signature')]]
    for number, row in enumerate(rows, 1):
        person = row.user
        data.append([paragraph(value) for value in (number, person.display_name or person.username,
                                                   person.employee_id or '', person.department, '')])
    for number in range(len(rows) + 1, len(rows) + 6):
        data.append([paragraph(number), '', '', '', ''])
    table = Table(data, colWidths=[32, 145, 82, 131, 150], repeatRows=1,
                  minRowHeights=[30] + [34] * (len(data) - 1), hAlign='LEFT')
    table.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), .5, colors.HexColor('#777777')),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#eeeeee')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(table)
    doc.build(story, canvasmaker=NumberedCanvas)
    response = HttpResponse(output.getvalue(), content_type='application/pdf')
    response['Content-Disposition'] = attachment(session, 'sign-in', 'pdf')
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    return response
