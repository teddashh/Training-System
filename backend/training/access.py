"""The LMS role policy. Unknown/inactive identities receive no elevated access.

Scopes are independent: authoring an exam never implies access to its results.
Django staff flags do not grant LMS rights.
"""
from django.db.models import Q
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission

# courses, exams, results, assign, invitations, system_admin
ROLE_POLICY = {
    'admin':              ('all',  'all',  'all',  True,  True,  True),
    'training_admin':     ('all',  'all',  'all',  True,  True,  False),
    'course_creator':     ('own',  'none', 'none', True,  False, False),
    'exam_admin':         ('none', 'all',  'all',  True,  True,  False),
    'training_scheduler': ('own',  'own',  'none', False, False, False),
    'instructor':         ('own',  'own',  'own',  True,  True,  False),
    'learner':            ('none', 'none', 'none', False, False, False),
}
KEYS = ('courses', 'exams', 'results', 'assign', 'invitations', 'system_admin')
DENIED = ('none', 'none', 'none', False, False, False)


def role_access(role):
    return dict(zip(KEYS, ROLE_POLICY.get(role, DENIED)))


def access_for(user):
    active = bool(user.is_authenticated and user.is_active)
    data = role_access(user.role) if active else dict(zip(KEYS, DENIED))
    data['people'] = active and user.role in ROLE_POLICY and user.role != 'learner'
    # Preserve the existing SCORM trust boundary, including legacy instructor access.
    data['scorm_source'] = active and user.role in ('admin', 'instructor')
    from django.conf import settings
    data['scorm_upload'] = data['scorm_source'] and (
        not settings.SCORM_TRUSTED_SAME_ORIGIN or data['system_admin'])
    return data


def scope(user, resource):
    return access_for(user)[resource]


def scope_q(user, resource, prefix=''):
    value = scope(user, resource)
    if value == 'all':
        return Q(**{prefix + 'pk__isnull': False})
    if value == 'own':
        return Q(**{prefix + 'owner_id': user.pk})
    return Q(**{prefix + 'pk__in': []})


def has_courses(user):
    return scope(user, 'courses') != 'none'


def has_exams(user):
    return scope(user, 'exams') != 'none'


def has_results(user):
    return scope(user, 'results') != 'none'


def manages(user, resource, item):
    value = scope(user, resource)
    return value == 'all' or (value == 'own' and item.owner_id == user.pk)


def manages_course(user, course):
    return manages(user, 'courses', course)


def views_materials(user, course):
    return bool(user.is_authenticated and user.is_active and course.delivery_mode == 'scheduled' and (
        manages_course(user, course) or course.enrollments.filter(user=user, status='approved').exists()))


def views_meeting(user, session):
    if not user.is_authenticated or not user.is_active:
        return False
    if manages_course(user, session.course):
        return True
    from .enrollments import user_enrollment
    row = user_enrollment(user, session.course)
    return bool(row and row.status == 'approved' and row.session_id == session.pk)


def manages_exam(user, exam):
    return manages(user, 'exams', exam)


def sees_results(user, exam):
    return manages(user, 'results', exam)


def can_assign(user, item=None):
    from .models import Course
    return access_for(user)['assign'] and (item is None or (
        manages_course(user, item) if isinstance(item, Course) else manages_exam(user, item)))


def can_invite(user, exam=None):
    return access_for(user)['invitations'] and (exam is None or manages_exam(user, exam))


def system_admin(user):
    return access_for(user)['system_admin']


def people_access(user):
    return access_for(user)['people']


def can_link_course(user, course):
    return scope(user, 'exams') == 'all' or (has_exams(user) and manages_course(user, course))


def scorm_source(user, course):
    return access_for(user)['scorm_source'] and manages_course(user, course)


def scorm_upload(user, course):
    return access_for(user)['scorm_upload'] and manages_course(user, course)


def require_exam(user, exam):
    if not manages_exam(user, exam):
        raise PermissionDenied()


def require_results(user, exam):
    if not sees_results(user, exam):
        raise PermissionDenied()


def require_invite(user, exam):
    if not can_invite(user, exam):
        raise PermissionDenied()


class AdminOnly(BasePermission):
    def has_permission(self, request, view):
        return system_admin(request.user)


def system_admin_users():
    from .models import User
    return User.objects.filter(is_active=True, role__in=[
        role for role in ROLE_POLICY if role_access(role)['system_admin']])
