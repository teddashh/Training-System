"""Public course previews. Capabilities travel in POST bodies, never URL paths."""
import secrets

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Prefetch, Q
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_protect
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .access import manages_course
from .course_sessions import released, session_data, selectable_session
from .i18n import translate
from .models import Course, CourseSession
from .services import audit


@transaction.atomic
def registration_link(user, course_id, data):
    course = get_object_or_404(Course.objects.select_for_update(), pk=course_id)
    if not manages_course(user, course):
        raise PermissionDenied()

    class Input(serializers.Serializer):
        rotate = serializers.BooleanField(default=False)

    form = Input(data=data)
    form.is_valid(raise_exception=True)
    if not course.registration_key or form.validated_data['rotate']:
        action = 'course.registration_rotated' if course.registration_key else 'course.registration_created'
        course.registration_key = secrets.token_urlsafe(32)
        course.save(update_fields=['registration_key'])
        audit(user, action, course.pk)
    return Response({'url': settings.APP_ORIGIN + settings.APP_BASE_PATH + '/register#' + course.registration_key},
                    headers={'Cache-Control': 'no-store'})


@csrf_protect
@api_view(['POST'])
@permission_classes([AllowAny])
def lookup(request):
    # Uses the same global anonymous/user throttles and CSRF policy as guest_exchange.
    key = request.data.get('key')
    course = None
    if isinstance(key, str) and 40 <= len(key) <= 64:
        course = Course.objects.prefetch_related(Prefetch('sessions', queryset=CourseSession.objects.annotate(
            reserved_count=Count('enrollments', filter=Q(enrollments__status__in=('approved', 'pending')))
        ))).filter(registration_key=key).first()
    if not course or not released(course):
        return Response({'detail': translate('This registration link is not valid.')}, status=404,
                        headers={'Cache-Control': 'no-store'})
    data = {field: getattr(course, field) for field in (
        'id', 'title', 'description', 'category', 'cover', 'duration_minutes',
        'delivery_mode', 'venue', 'requires_approval',
    )}
    own = course.enrollments.filter(user=request.user).first() if request.user.is_authenticated else None
    if request.user.is_authenticated:
        data['enrollment'] = {'status': own.status, 'session': own.session_id} if own else None
    data['sessions'] = []
    if course.delivery_mode == 'scheduled':
        for session in course.sessions.all():
            values = session_data(session)
            if selectable_session(values) or (own and own.status in ('pending', 'approved') and own.session_id == session.pk):
                public = {field: values[field] for field in ('id', 'title', 'starts_at', 'ends_at', 'state')}
                public['seats_remain'] = values['remaining'] > 0
                # A scarcity hint only: never the capacity or how many people registered.
                public['seats_left'] = values['remaining'] if values['remaining'] <= 5 else None
                if values['state'] == 'upcoming':
                    public['registration_opens_at'] = values['registration_opens_at']
                if course.venue == 'onsite':
                    public['location'] = values['location']
                data['sessions'].append(public)
    return Response(data, headers={'Cache-Control': 'no-store'})
