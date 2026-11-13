"""Synthetic coverage of scheduled venues, private materials and attendance exports."""
from urllib.parse import quote
import io
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone as dt_timezone
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth.models import AnonymousUser
from django.core import signing
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.signals import request_finished
from django.db import close_old_connections, connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase, override_settings
from django.utils import timezone
from openpyxl import load_workbook
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from .access import ROLE_POLICY, manages_course
from .course_sessions import session_data
from .materials import MAX_BYTES, inspect_file
from .models import Attempt, AuditEvent, Course, CourseMaterial, CourseSession, Enrollment, OutboundEmail, ScormPackage, User
from .notifications import enrollment_notification, message_content
from .services import identity_for_user
from .tests import make_exam, package_zip


@override_settings(DEBUG=True, EMAIL_NOTIFICATIONS_ENABLED=True)

def close_quietly(response):
    # Closing a response fires request_finished; with close_old_connections connected that
    # closes the test transaction's database connection on PostgreSQL (SQLite ignores it).
    request_finished.disconnect(close_old_connections)
    try:
        response.close()
    finally:
        request_finished.connect(close_old_connections)

class OnsiteTests(TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        settings = override_settings(MEDIA_ROOT=Path(self.temp.name))
        settings.enable()
        self.addCleanup(settings.disable)
        self.owner = User.objects.create_user('onsite-owner', role='instructor')
        self.learner = User.objects.create_user('onsite-learner', display_name='Zeta Person', email='zeta@example.test', employee_id='SYN-01', department='Synthetic team', job_title='Synthetic tester')
        self.course = Course.objects.create(title='Synthetic onsite course', owner=self.owner, venue='onsite', delivery_mode='scheduled', published=True)
        self.now = timezone.now()
        self.session = CourseSession.objects.create(course=self.course, title='Synthetic session', location='Room S', meeting_url='https://example.test/meeting', starts_at=self.now-timedelta(hours=1), ends_at=self.now+timedelta(hours=1))
        self.row = Enrollment.objects.create(course=self.course, user=self.learner, session=self.session)
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.base = f'/api/courses/{self.course.pk}/'
        self.session_base = self.base+f'sessions/{self.session.pk}/'

    def mark(self, value='present', **kwargs):
        return self.client.post(self.session_base+'attendance/', {'attendance':value, 'enrollment':self.row.pk, **kwargs}, format='json')

    def upload(self, name='handout.pdf', body=b'%PDF-1.7\nSynthetic document'):
        return self.client.post(self.base+'materials/', {'title':'Synthetic handout', 'file':SimpleUploadedFile(name, body)}, format='multipart')

    def workbook(self, kind='sign-in', **params):
        response = self.client.get(self.session_base+'export/', {'kind':kind, **params})
        self.assertEqual(response.status_code, 200, getattr(response, 'data', None))
        return load_workbook(io.BytesIO(response.content)), response

    def test_venue_requires_scheduled_and_valid_choice(self):
        for data in ({'delivery_mode':'self_paced'}, {'venue':'elsewhere'}):
            self.assertEqual(self.client.patch(self.base, data, format='json').status_code, 400)
        result = self.client.post('/api/courses/', {'title':'New onsite', 'venue':'onsite', 'delivery_mode':'scheduled'}, format='json')
        self.assertEqual(result.status_code, 201)
        self.assertEqual(result.data['venue'], 'onsite')

    def test_cannot_change_venue_with_enrollments_or_remove_scheduled_mode(self):
        self.assertEqual(self.client.patch(self.base, {'venue':'online'}, format='json').status_code, 400)
        self.row.delete()
        self.assertEqual(self.client.patch(self.base, {'venue':'online','delivery_mode':'self_paced'}, format='json').status_code, 400)

    def test_onsite_rejects_text_and_scorm(self):
        self.assertEqual(self.client.patch(self.base, {'blocks':[{'type':'text','text':'No online lesson'}]}, format='json').status_code, 400)
        self.assertEqual(self.client.post(self.base+'upload/', {'file':SimpleUploadedFile('course.zip', package_zip().getvalue())}, format='multipart').status_code, 400)
        self.assertFalse(self.course.packages.exists())

    def test_onsite_cannot_start_or_complete_even_with_legacy_content(self):
        self.course.blocks = [{'type':'text','text':'Old image content'}]
        self.course.save()
        package = ScormPackage.objects.create(course=self.course, version='1.2', launch_path='index.html', title='Synthetic')
        for user in (self.owner, self.learner):
            self.client.force_authenticate(user)
            self.assertFalse(self.client.get(self.base).data['can_learn'])
            self.assertEqual(self.client.get(self.base).data['blocks'], [])
            for endpoint in (self.base+'content/', self.base+'complete/', f'/api/scorm/{package.pk}/launch/'):
                self.assertEqual(self.client.post(endpoint, {}, format='json').status_code, 403)

    def test_session_requires_location_and_https(self):
        for data in ({'location':''}, {'location':'x'*201}, {'meeting_url':'http://example.test'}, {'meeting_url':'javascript:alert(1)'}, {'meeting_url':'https://user:pass@example.test'}):
            self.assertEqual(self.client.patch(self.session_base, {'revision':0, **data}, format='json').status_code, 400)
        good = self.client.patch(self.session_base, {'revision':0, 'location':'Room Updated', 'meeting_url':'https://example.test/new'}, format='json')
        self.assertEqual(good.status_code, 200)
        self.assertEqual(good.data['location'], 'Room Updated')
        self.assertEqual(good.data['meeting_url'], 'https://example.test/new')

    def test_new_onsite_session_requires_location(self):
        data={'title':'Later', 'starts_at':self.now+timedelta(days=1), 'ends_at':self.now+timedelta(days=1,hours=2)}
        self.assertEqual(self.client.post(self.base+'sessions/', data, format='json').status_code, 400)
        self.assertEqual(self.client.post(self.base+'sessions/', {**data,'location':'Room T'}, format='json').status_code, 201)

    def test_online_session_keeps_meeting_but_hides_location(self):
        self.course.venue='online';self.course.save()
        result=self.client.patch(self.session_base, {'revision':0,'location':'Hidden','meeting_url':'https://example.test/online'}, format='json')
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.data['location'],'')
        self.assertEqual(result.data['meeting_url'],'https://example.test/online')

    def test_meeting_visibility_is_own_approved_session_only(self):
        other = CourseSession.objects.create(course=self.course, title='Other', location='Room T', meeting_url='https://example.test/other', starts_at=self.now+timedelta(days=1), ends_at=self.now+timedelta(days=1,hours=1))
        for status in ('approved','pending','rejected','removed','cancelled'):
            self.row.status=status;self.row.save()
            self.client.force_authenticate(self.learner)
            for url in (self.base, self.base+'sessions/'):
                data=self.client.get(url).data
                sessions=data['sessions'] if isinstance(data,dict) else data
                for item in sessions:
                    self.assertEqual('meeting_url' in item, status=='approved' and item['id']==self.session.pk)
                    self.assertTrue(item['location'])
                self.assertNotIn('meeting_url', data.get('enrollment',{}).get('session',{}) if isinstance(data,dict) else {})
        self.client.force_authenticate(self.owner)
        self.assertEqual(len([s for s in self.client.get(self.base).data['sessions'] if 'meeting_url' in s]),2)
        self.assertNotIn('meeting_url', session_data(other))
        self.assertNotIn('meeting_url', session_data(other,user=AnonymousUser()))
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self.base).status_code,403)

    def test_material_valid_formats_and_download_headers(self):
        for ext,marker in (('pptx','ppt/presentation.xml'),('docx','word/document.xml'),('xlsx','xl/workbook.xml')):
            data=io.BytesIO()
            with zipfile.ZipFile(data,'w') as archive:
                archive.writestr('[Content_Types].xml','<Types/>');archive.writestr(marker,'<synthetic/>')
            result=self.upload('資料.'+ext,data.getvalue())
            self.assertEqual(result.status_code,201)
            response=self.client.get(result.data['download_url'])
            self.assertTrue(response['Content-Disposition'].startswith('attachment;'))
            self.assertIn("filename*=UTF-8''%E8%B3%87%E6%96%99",response['Content-Disposition'])
            close_quietly(response)
        self.assertEqual(self.upload('slides.ppt',b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'+b'\0'*20).status_code,201)
        result=self.upload()
        self.assertEqual(result.status_code,201)
        self.assertNotIn('file_key',result.data)
        response=self.client.get(result.data['download_url'])
        self.assertTrue(response['Content-Disposition'].startswith('inline;'))
        self.assertEqual(response['Content-Type'],'application/pdf')
        self.assertEqual(response['X-Content-Type-Options'],'nosniff')
        self.assertEqual(response['Cache-Control'],'private, no-store')
        self.assertEqual(b''.join(response.streaming_content),b'%PDF-1.7\nSynthetic document')
        close_quietly(response)

    def test_material_rejects_extension_magic_empty_and_size(self):
        for name,body in (('bad.exe',b'%PDF-1.7'),('bad.pdf',b'<html>'),('bad.ppt',b'PK\x03\x04'),('bad.pptx',b'PK\x03\x04garbage'),('empty.pdf',b'')):
            self.assertEqual(self.upload(name,body).status_code,400)
        upload=SimpleUploadedFile('large.pdf',b'%PDF-1.7')
        upload.size=MAX_BYTES+1
        with self.assertRaises(ValidationError):inspect_file(upload)
        self.assertEqual(CourseMaterial.objects.count(),0)
        self.assertFalse((Path(self.temp.name)/'materials').exists())

    def test_material_rejects_wrong_office_zip(self):
        data=io.BytesIO()
        with zipfile.ZipFile(data,'w') as archive:
            archive.writestr('[Content_Types].xml','<Types/>');archive.writestr('word/document.xml','<synthetic/>')
        self.assertEqual(self.upload('wrong.pptx',data.getvalue()).status_code,400)

    def test_material_link_validation_and_exclusive_source(self):
        for url in ('http://example.test','javascript:alert(1)','https://user:secret@example.test'):
            self.assertEqual(self.client.post(self.base+'materials/', {'title':'Link','url':url},format='json').status_code,400)
        result=self.client.post(self.base+'materials/', {'title':'Link','url':'https://example.test/material'},format='json')
        self.assertEqual(result.status_code,201)
        self.assertEqual(result.data['url'],'https://example.test/material')
        self.assertEqual(self.client.post(self.base+'materials/', {'title':'Neither'},format='json').status_code,400)
        self.assertEqual(self.client.post(self.base+'materials/', {'title':'Both','url':'https://example.test','file':SimpleUploadedFile('a.pdf',b'%PDF-1.7')},format='multipart').status_code,400)

    def test_material_access_for_all_enrollment_statuses_and_dates(self):
        result=self.upload()
        for status in ('approved','pending','rejected','removed','cancelled'):
            self.row.status=status;self.row.save()
            self.client.force_authenticate(self.learner)
            for moment in (self.session.starts_at-timedelta(days=1),self.now,self.session.ends_at+timedelta(days=1)):
                with patch('django.utils.timezone.now',return_value=moment):
                    for url in (self.base+'materials/',result.data['download_url']):
                        response=self.client.get(url)
                        self.assertEqual(response.status_code,200 if status=='approved' else 403)
                        close_quietly(response)
        self.row.delete()
        self.assertEqual(self.client.get(result.data['download_url']).status_code,403)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(result.data['download_url']).status_code,403)

    def test_material_role_policy_and_owner_scope(self):
        result=self.upload()
        for role in ROLE_POLICY:
            user=User.objects.create_user('role-'+role,role=role)
            self.client.force_authenticate(user)
            expected=200 if manages_course(user,self.course) else 403
            response=self.client.get(result.data['download_url']);self.assertEqual(response.status_code,expected);close_quietly(response)
            self.assertEqual(self.client.patch(self.base+f'materials/{result.data["id"]}/',{'title':'Renamed'},format='json').status_code,expected)
        self.client.force_authenticate(self.owner)
        self.owner.is_active=False;self.owner.save()
        self.assertEqual(self.client.get(result.data['download_url']).status_code,403)

    def test_material_rename_reorder_delete_and_self_paced_denial(self):
        first=self.upload().data
        second=self.client.post(self.base+'materials/', {'title':'Second','url':'https://example.test/link'},format='json').data
        result=self.client.post(self.base+'materials/', {'order':[second['id'],first['id']]},format='json')
        self.assertEqual([item['id'] for item in result.data],[second['id'],first['id']])
        self.assertEqual(self.client.post(self.base+'materials/', {'order':[first['id'],first['id']]},format='json').status_code,400)
        url=self.base+f'materials/{first["id"]}/'
        self.assertEqual(self.client.patch(url,{'title':'New title'},format='json').status_code,200)
        self.assertEqual(self.client.patch(url,{'url':'https://example.test/replacement'},format='json').status_code,400)
        path=Path(self.temp.name)/'materials'/CourseMaterial.objects.get(pk=first['id']).file_key
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.client.delete(url).status_code,204)
        self.assertFalse(path.exists())
        self.course.delivery_mode='self_paced';self.course.save()
        self.assertEqual(self.upload().status_code,400)

    def test_marking_completes_and_undoes_onsite(self):
        with patch('django.utils.timezone.now',return_value=self.now):
            self.assertEqual(self.mark().status_code,200)
        self.row.refresh_from_db()
        self.assertEqual((self.row.progress,self.row.completed_at),(100,self.now))
        self.assertEqual(self.row.attendance_marked_by,self.owner)
        for value in ('absent',''):
            self.assertEqual(self.mark(value).status_code,200)
            self.row.refresh_from_db()
            self.assertEqual((self.row.progress,self.row.completed_at),(0,None))
        self.assertIsNone(self.row.attendance_marked_by)
        self.assertIsNone(self.row.attendance_marked_at)
        with patch('django.utils.timezone.now',return_value=self.session.ends_at+timedelta(days=1)):
            self.mark()
        self.row.refresh_from_db();self.assertEqual(self.row.completed_at,self.session.ends_at)
        for event in AuditEvent.objects.filter(action='course.attendance_marked'):
            self.assertTrue(all(type(v) is int for v in event.detail.values()))

    def test_marking_role_policy_and_other_course_denial(self):
        for role in ROLE_POLICY:
            user=User.objects.create_user('mark-'+role,role=role)
            self.client.force_authenticate(user)
            self.assertEqual(self.mark().status_code,200 if manages_course(user,self.course) else 403)
        other=Course.objects.create(title='Another',owner=self.owner,published=True,delivery_mode='scheduled')
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.post(f'/api/courses/{other.pk}/sessions/{self.session.pk}/attendance/', {'attendance':'present','all_present':True},format='json').status_code,404)

    def test_marking_future_cancelled_and_nonapproved_denied(self):
        with patch('django.utils.timezone.now',return_value=self.session.starts_at-timedelta(microseconds=1)):
            self.assertEqual(self.mark().status_code,400)
        with patch('django.utils.timezone.now',return_value=self.session.starts_at):
            self.assertEqual(self.mark().status_code,200)
        for status in ('pending','rejected','removed','cancelled'):
            self.row.status=status;self.row.save()
            self.assertEqual(self.mark().status_code,404)
        self.session.cancelled=True;self.session.save()
        self.assertEqual(self.mark().status_code,400)

    def test_bulk_marks_only_approved_and_counts(self):
        pending=User.objects.create_user('pending')
        Enrollment.objects.create(course=self.course,session=self.session,user=pending,status='pending')
        result=self.client.post(self.session_base+'attendance/', {'attendance':'present','all_present':True},format='json')
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.data['counts'],{'present':1,'absent':0,'no_record':0})
        self.assertEqual(Enrollment.objects.get(user=pending).attendance,'')
        self.assertEqual(self.client.post(self.session_base+'attendance/', {'attendance':'absent','all_present':True},format='json').status_code,400)

    def test_online_manual_attendance_never_changes_completion(self):
        self.course.venue='online';self.course.save()
        self.row.progress=65;self.row.completed_at=self.now;self.row.attended_at=self.now;self.row.save()
        for value in ('present','absent',''):
            result=self.mark(value)
            self.assertEqual(result.status_code,200)
            self.row.refresh_from_db()
            self.assertEqual((self.row.progress,self.row.completed_at),(65,self.now))
            self.assertEqual(result.data['results'][0]['effective_attendance'],value or 'present')

    def test_text_content_records_only_own_window_idempotently(self):
        self.course.venue='online';self.course.blocks=[{'type':'text','text':'Synthetic lesson'}];self.course.save()
        self.client.force_authenticate(self.learner)
        self.client.get(self.base);self.client.get('/api/courses/')
        self.row.refresh_from_db();self.assertIsNone(self.row.attended_at)
        for moment in (self.session.starts_at-timedelta(microseconds=1),self.session.ends_at):
            with patch('django.utils.timezone.now',return_value=moment):
                self.assertEqual(self.client.post(self.base+'content/',{},format='json').status_code,403)
        with patch('django.utils.timezone.now',return_value=self.session.starts_at):
            self.assertEqual(self.client.post(self.base+'content/',{},format='json').status_code,200)
        self.client.post(self.base+'content/',{},format='json')
        self.row.refresh_from_db();self.assertEqual(self.row.attended_at,self.session.starts_at)
        self.assertEqual(self.row.progress,0)

    def test_preview_other_session_and_pending_are_not_attendance(self):
        self.course.venue='online';self.course.blocks=[{'type':'text','text':'Synthetic'}];self.course.save()
        self.client.post(self.base+'content/',{},format='json')
        self.assertFalse(Enrollment.objects.filter(user=self.owner,attended_at__isnull=False).exists())
        self.row.status='pending';self.row.save();self.client.force_authenticate(self.learner)
        self.assertEqual(self.client.post(self.base+'content/',{},format='json').status_code,403)
        self.row.status='approved';self.row.save()
        self.session.starts_at=self.now+timedelta(days=1);self.session.ends_at=self.now+timedelta(days=1,hours=1);self.session.save()
        CourseSession.objects.create(course=self.course,title='Running, not own',starts_at=self.now-timedelta(hours=1),ends_at=self.now+timedelta(hours=1))
        self.assertEqual(self.client.post(self.base+'content/',{},format='json').status_code,403)
        self.row.refresh_from_db();self.assertIsNone(self.row.attended_at)

    def test_scorm_file_access_records_first_success_only(self):
        from .scorm import content_file
        from django.test import RequestFactory
        self.course.venue='online';self.course.save()
        package=ScormPackage.objects.create(course=self.course,version='1.2',launch_path='index.html',title='Synthetic')
        path=Path(self.temp.name)/'packages'/str(package.pk);path.mkdir(parents=True);(path/'index.html').write_text('Synthetic')
        request=RequestFactory().get('/')
        request.COOKIES['scorm_access_'+str(package.pk)]=signing.dumps({'package':str(package.pk),'user':self.learner.pk},salt='scorm-content')
        self.assertEqual(content_file(request,package.pk,'missing.html').status_code,404)
        self.row.refresh_from_db();self.assertIsNone(self.row.attended_at)
        with patch('django.utils.timezone.now',return_value=self.now):
            response=content_file(request,package.pk,'index.html');self.assertEqual(response.status_code,200);close_quietly(response)
        response=content_file(request,package.pk,'index.html');close_quietly(response)
        self.row.refresh_from_db();self.assertEqual(self.row.attended_at,self.now)
        self.assertEqual(self.row.progress,0)

    def test_scorm_assets_do_not_record_or_query_attendance(self):
        from .scorm import content_file
        from django.test import RequestFactory
        self.course.venue='online';self.course.save()
        package=ScormPackage.objects.create(course=self.course,version='1.2',launch_path='index.html',title='Synthetic')
        path=Path(self.temp.name)/'packages'/str(package.pk);path.mkdir(parents=True);(path/'app.js').write_text('// synthetic')
        request=RequestFactory().get('/')
        request.COOKIES['scorm_access_'+str(package.pk)]=signing.dumps({'package':str(package.pk),'user':self.learner.pk},salt='scorm-content')
        with patch('training.attendance.record_content_access') as record:
            response=content_file(request,package.pk,'app.js');self.assertEqual(response.status_code,200);close_quietly(response)
        record.assert_not_called()
        self.row.refresh_from_db();self.assertIsNone(self.row.attended_at)

    def test_signin_export_heading_order_rows_and_print_settings(self):
        for name,status in (('Alpha Person','pending'),('Hidden Rejected','rejected'),('Hidden Removed','removed'),('Hidden Cancelled','cancelled')):
            user=User.objects.create_user(name.replace(' ','-'),display_name=name)
            Enrollment.objects.create(course=self.course,session=self.session,user=user,status=status)
        wb,response=self.workbook(timezone='America/New_York');ws=wb.active
        self.assertEqual(ws['A1'].value,'Sign-in sheet')
        self.assertEqual(ws['B2'].value,self.course.title)
        self.assertEqual(ws['B3'].value,self.session.title)
        self.assertIn('America/New_York',ws['B4'].value)
        self.assertEqual(ws['B5'].value,'Room S')
        self.assertEqual([cell.value for cell in ws[6]],['No.','Name','Employee ID','Department','Job title','Email','Registration','Signature'])
        self.assertEqual([ws['B7'].value,ws['B8'].value],['Alpha Person','Zeta Person'])
        self.assertEqual(ws['G7'].value,'Pending approval');self.assertEqual(ws['G8'].value,'Confirmed')
        self.assertEqual(ws.max_row,8)
        self.assertIsNone(ws['H7'].value)
        self.assertEqual(ws.page_setup.orientation,'landscape');self.assertEqual(ws.page_setup.fitToWidth,1)
        self.assertIsNone(ws.page_setup.paperSize)
        self.assertEqual(ws.page_setup.fitToHeight,0);self.assertEqual(ws.print_title_rows,'$6:$6')
        self.assertEqual(ws['A7'].border.left.style,'thin');self.assertGreaterEqual(ws.row_dimensions[7].height,36)
        self.assertGreaterEqual(ws.column_dimensions['H'].width,30)
        self.assertEqual(response['Cache-Control'],'private, no-store')

    def test_export_timezone_and_locales(self):
        self.session.starts_at=datetime(2026,1,15,15,tzinfo=dt_timezone.utc);self.session.ends_at=self.session.starts_at+timedelta(hours=1);self.session.save()
        for language,title,location in (('zh-hant','點名單','地點'),('es','Hoja de asistencia','Ubicación'),('en','Sign-in sheet','Location')):
            response=self.client.get(self.session_base+'export/',{'timezone':'America/New_York'},HTTP_ACCEPT_LANGUAGE=language)
            self.assertEqual(response.status_code,200)
            ws=load_workbook(io.BytesIO(response.content)).active
            self.assertEqual(ws['A1'].value,title);self.assertEqual(ws['A5'].value,location)
            self.assertIn('2026-01-15 10:00 EST',ws['B4'].value)
            results=self.client.get(self.session_base+'export/',{'kind':'attendance','timezone':'America/New_York'},HTTP_ACCEPT_LANGUAGE=language)
            sheet=load_workbook(io.BytesIO(results.content)).active
            self.assertEqual(sheet['G7'].value,{'zh-hant':'未記錄','es':'Sin registro','en':'No record'}[language])
            self.assertEqual(sheet['J7'].value,{'zh-hant':'否','es':'No','en':'No'}[language])
        ws=self.workbook()[0].active;self.assertIn('Asia/Taipei',ws['B4'].value)
        self.assertEqual(self.client.get(self.session_base+'export/',{'timezone':'../../etc/passwd'}).status_code,400)

    def test_export_result_columns_obey_sees_results(self):
        visible=make_exam(self.owner);visible.courses.add(self.course)
        other=User.objects.create_user('other-exam-owner',role='instructor')
        hidden=make_exam(other);hidden.title='Hidden exam title';hidden.save();hidden.courses.add(self.course)
        for number,score,passed in ((1,90,True),(2,70,False)):
            Attempt.objects.create(exam=visible,identity=identity_for_user(self.learner),number=number,pass_score=80,deadline=self.now,status='graded',score=score,passed=passed)
        Attempt.objects.create(exam=hidden,identity=identity_for_user(self.learner),number=1,pass_score=80,deadline=self.now,status='graded',score=95,passed=True)
        self.mark()
        ws=self.workbook('attendance')[0].active
        headings=[cell.value for cell in ws[6]]
        self.assertIn(visible.title+' — Best score',headings)
        self.assertNotIn(hidden.title+' — Best score',headings)
        self.assertEqual(ws['M6'].value,hidden.title+' — Passed')
        self.assertEqual(ws['M7'].value,'Passed')
        self.assertEqual(ws['G7'].value,'Present');self.assertEqual(ws['H7'].value,'Marked by organizer')
        self.assertEqual(ws['K7'].value,90);self.assertEqual(ws['L7'].value,'Yes')
        self.owner.role='training_scheduler';self.owner.save()
        ws=self.workbook('attendance')[0].active
        self.assertEqual(ws.max_column,12)
        self.owner.role='training_admin';self.owner.save()
        ws=self.workbook('attendance')[0].active
        self.assertEqual(ws.max_column,14)
        self.assertEqual(ws['A6'].value,'Name')

    def test_export_automatic_manual_absent_no_record_and_completion(self):
        for manual,automatic,expected,source in (('',True,'Present','Opened content during the session'),('absent',True,'Absent','Marked by organizer'),('',False,'No record',None)):
            self.row.attendance=manual;self.row.attended_at=self.now if automatic else None;self.row.attendance_marked_at=self.now if manual else None;self.row.save()
            ws=self.workbook('attendance')[0].active
            self.assertEqual(ws['G7'].value,expected);self.assertEqual(ws['H7'].value,source)
            self.assertEqual(ws['J7'].value,'No')
        self.mark()
        ws=self.workbook('attendance')[0].active;self.assertTrue(ws['J7'].value.startswith('Yes — '))

    def test_export_cells_never_formulas_and_filename_numeric(self):
        self.course.title='=HYPERLINK("bad")';self.course.save()
        self.session.title='+SUM(1)';self.session.location='@command';self.session.save()
        self.learner.display_name='=SUM(1)';self.learner.employee_id='+1';self.learner.department='-1';self.learner.job_title='@name';self.learner.email='\t=1';self.learner.save()
        exam=make_exam(self.owner);exam.title='\r=1';exam.save();exam.courses.add(self.course)
        for kind in ('sign-in','attendance'):
            wb,response=self.workbook(kind)
            ws=wb.active
            for row in ws:
                for cell in row:
                    self.assertNotEqual(cell.data_type,'f')
                    if cell.value is not None:self.assertIn(cell.data_type,('s','n'))
            self.assertEqual(ws['B2'].value,'=HYPERLINK("bad")')
            name=f'HYPERLINK( bad ) - SUM(1) - {kind}.xlsx'
            self.assertEqual(response['Content-Disposition'],f'attachment; filename="{name}"; filename*=UTF-8\'\'{quote(name,safe="")}')

    def test_export_role_policy_and_future_results(self):
        for role in ROLE_POLICY:
            user=User.objects.create_user('export-'+role,role=role)
            self.client.force_authenticate(user)
            for kind in ('sign-in','attendance'):
                self.assertEqual(self.client.get(self.session_base+'export/',{'kind':kind}).status_code,200 if manages_course(user,self.course) else 403)
        self.client.force_authenticate(self.owner)
        with patch('django.utils.timezone.now',return_value=self.session.starts_at-timedelta(seconds=1)):
            self.assertEqual(self.client.get(self.session_base+'export/',{'kind':'attendance'}).status_code,400)
            self.assertEqual(self.client.get(self.session_base+'export/',{'kind':'sign-in'}).status_code,200)

    def test_notification_location_and_only_approved_meeting(self):
        for status in ('approved','pending','rejected','removed','cancelled'):
            self.row.status=status;self.row.revision+=1;self.row.save()
            enrollment_notification(self.row,self.owner,'Synthetic event')
            message=OutboundEmail.objects.latest('pk')
            self.assertIn('Location: Room S',message.body_text)
            self.assertEqual('Meeting link:' in message.body_text,status=='approved')
            self.assertEqual('https://example.test/meeting' in message.body_html,status=='approved')
        self.assertNotIn('Meeting link:',message_content('Public',self.course,session=self.session)[1])

    def test_session_change_notification_checks_each_recipient(self):
        pending=User.objects.create_user('pending-notify',email='pending@example.test')
        Enrollment.objects.create(course=self.course,user=pending,session=self.session,status='pending')
        response=self.client.patch(self.session_base,{'revision':0,'starts_at':self.session.starts_at+timedelta(minutes=1)},format='json')
        self.assertEqual(response.status_code,200)
        for message in OutboundEmail.objects.filter(kind='session_rescheduled'):
            self.assertIn('Where: Room S',message.body_text)
            self.assertIn('Was: ',message.body_text);self.assertIn('Now: ',message.body_text)
            self.assertEqual('Meeting link:' in message.body_text,message.recipient_user_id==self.learner.pk)

    def test_upload_failure_cleans_file_and_rolls_back_metadata(self):
        with patch('training.materials.audit', side_effect=RuntimeError('Synthetic write failure')):
            with self.assertRaises(RuntimeError):
                self.upload()
        self.assertFalse(CourseMaterial.objects.exists())
        self.assertEqual(list((Path(self.temp.name)/'materials').iterdir()), [])

    def test_material_delete_rollback_preserves_file(self):
        result=self.upload().data
        row=CourseMaterial.objects.get(pk=result['id'])
        path=Path(self.temp.name)/'materials'/row.file_key
        with self.captureOnCommitCallbacks(execute=True), patch('training.materials.audit', side_effect=RuntimeError('Synthetic write failure')):
            with self.assertRaises(RuntimeError):
                self.client.delete(self.base+f'materials/{row.pk}/')
        self.assertTrue(path.exists())
        self.assertTrue(CourseMaterial.objects.filter(pk=row.pk).exists())

    def test_new_session_resets_attendance_only_and_onsite_completion(self):
        later=CourseSession.objects.create(course=self.course,title='Next session',location='Room Next',starts_at=self.now+timedelta(days=1),ends_at=self.now+timedelta(days=1,hours=1))
        self.client.force_authenticate(self.learner)
        for venue in ('online','onsite'):
            self.course.venue=venue;self.course.save()
            self.row.status='cancelled';self.row.session=self.session
            self.row.progress=100;self.row.completed_at=self.now
            self.row.attendance='present';self.row.attended_at=self.now
            self.row.attendance_marked_at=self.now;self.row.attendance_marked_by=self.owner;self.row.save()
            response=self.client.post(self.base+'enroll/',{'session':later.pk,'revision':self.row.revision},format='json')
            self.assertEqual(response.status_code,200)
            self.row.refresh_from_db()
            self.assertEqual(self.row.attendance,'');self.assertIsNone(self.row.attended_at)
            self.assertIsNone(self.row.attendance_marked_at);self.assertIsNone(self.row.attendance_marked_by_id)
            self.assertEqual(self.row.progress,100 if venue=='online' else 0)
            self.assertEqual(self.row.completed_at,self.now if venue=='online' else None)

    def test_automatic_evidence_excludes_self_paced_cancelled_and_progress_flush(self):
        self.course.venue='online';self.course.blocks=[{'type':'text','text':'Synthetic'}];self.course.save()
        self.client.force_authenticate(self.learner)
        self.session.cancelled=True;self.session.save()
        self.assertEqual(self.client.post(self.base+'content/',{},format='json').status_code,403)
        self.session.cancelled=False;self.session.save()
        package=ScormPackage.objects.create(course=self.course,title='Synthetic',version='1.2',launch_path='index.html')
        launch=self.client.post(f'/api/scorm/{package.pk}/launch/',{},format='json')
        self.assertEqual(launch.status_code,200)
        with patch('django.utils.timezone.now',return_value=self.session.ends_at+timedelta(seconds=30)):
            commit=self.client.post(f'/api/scorm/{package.pk}/commit/',{'nonce':launch.data['nonce'],'cmi':{'cmi.core.lesson_status':'incomplete'}},format='json')
            self.assertEqual(commit.status_code,200)
        self.row.refresh_from_db();self.assertIsNone(self.row.attended_at)
        package.delete();self.course.delivery_mode='self_paced';self.course.save()
        self.assertEqual(self.client.post(self.base+'content/',{},format='json').status_code,200)
        self.row.refresh_from_db();self.assertIsNone(self.row.attended_at)

    def test_automatic_attendance_audit_is_idempotent_ids_counts_only(self):
        self.course.venue='online';self.course.blocks=[{'type':'text','text':'Synthetic'}];self.course.save()
        self.client.force_authenticate(self.learner)
        for _ in range(2):
            self.assertEqual(self.client.post(self.base+'content/',{},format='json').status_code,200)
        events=AuditEvent.objects.filter(action='course.attendance_recorded')
        self.assertEqual(events.count(),1)
        self.assertEqual(events.get().detail,{'user':self.learner.pk,'count':1})

    def test_unknown_staff_and_inactive_managers_are_denied(self):
        uploaded=self.upload().data
        for role,active in (('unknown',True),('learner',True),('admin',False)):
            user=User.objects.create_user('blocked-'+role,role=role,is_active=active,is_staff=True,is_superuser=True)
            self.client.force_authenticate(user)
            for url in (self.session_base+'export/',self.session_base+'attendance/',self.base+'materials/',uploaded['download_url']):
                self.assertEqual(self.client.get(url).status_code,403)
            self.assertEqual(self.mark().status_code,403)

    def test_owner_roles_follow_same_access_policy_for_new_features(self):
        uploaded=self.upload().data
        for role in ROLE_POLICY:
            self.owner.role=role;self.owner.save()
            expected=200 if manages_course(self.owner,self.course) else 403
            self.assertEqual(self.mark().status_code,expected)
            self.assertEqual(self.client.patch(self.base+f'materials/{uploaded["id"]}/',{'title':'Updated'},format='json').status_code,expected)
            self.assertEqual(self.client.get(self.session_base+'export/').status_code,expected)

    def test_attendance_keeps_linked_exam_online_and_independent(self):
        exam=make_exam(self.owner);exam.courses.add(self.course)
        self.client.force_authenticate(self.learner)
        response=self.client.post(f'/api/exams/{exam.pk}/start/',{},format='json')
        self.assertEqual(response.status_code,200)
        self.row.refresh_from_db();self.assertEqual(self.row.progress,0);self.assertIsNone(self.row.attended_at)

    def test_course_conversion_does_not_silently_discard_text(self):
        self.row.delete();self.session.delete()
        self.course.venue='online';self.course.blocks=[{'type':'text','text':'Preserve me'}];self.course.save()
        self.assertEqual(self.client.patch(self.base,{'venue':'onsite','blocks':[]},format='json').status_code,400)
        self.course.refresh_from_db();self.assertEqual(self.course.blocks[0]['text'],'Preserve me')

    def test_material_filename_and_mount_path(self):
        from .materials import disposition
        header=disposition('../bad\r\n"name.pdf',inline=True)
        self.assertNotIn('\r',header);self.assertNotIn('\n',header);self.assertNotIn('../',header)
        self.assertIn('%22',header)
        with override_settings(APP_BASE_PATH='/training'):
            result=self.upload().data
            self.assertTrue(result['download_url'].startswith('/training/api/'))



class OnsiteMigrationTests(TestCase):
    def test_old_models_insert_after_migration_without_new_columns(self):
        # The historical ORM emits exactly the pre-feature column set against today's schema.
        executor=MigrationExecutor(connection)
        old=executor.loader.project_state([('training','0022_training_roles')]).apps
        UserOld=old.get_model('training','User')
        CourseOld=old.get_model('training','Course')
        SessionOld=old.get_model('training','CourseSession')
        EnrollmentOld=old.get_model('training','Enrollment')
        user=UserOld.objects.create(username='old-image',password='!')
        course=CourseOld.objects.create(title='Old writer',owner_id=user.pk,delivery_mode='scheduled')
        session=SessionOld.objects.create(course_id=course.pk,title='Old session',starts_at=timezone.now(),ends_at=timezone.now()+timedelta(hours=1))
        enrollment=EnrollmentOld.objects.create(course_id=course.pk,user_id=user.pk,session_id=session.pk)
        self.assertEqual(Course.objects.get(pk=course.pk).venue,'online')
        current=CourseSession.objects.get(pk=session.pk)
        self.assertEqual((current.location,current.meeting_url),('',''))
        row=Enrollment.objects.get(pk=enrollment.pk)
        self.assertEqual(row.attendance,'')
        self.assertIsNone(row.attended_at);self.assertIsNone(row.attendance_marked_at);self.assertIsNone(row.attendance_marked_by_id)
        # Old images can still read and update an on-site course without knowing venue.
        Course.objects.filter(pk=course.pk).update(venue='onsite')
        legacy=CourseOld.objects.get(pk=course.pk);self.assertEqual(legacy.delivery_mode,'scheduled')
        legacy.title='Old image update';legacy.save()
        self.assertEqual(Course.objects.get(pk=course.pk).venue,'onsite')
