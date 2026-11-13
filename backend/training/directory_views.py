import time
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from .directory import DirectoryError, directory_status, sync_directory
from .i18n import translate
from .views import AdminOnly


@api_view(['GET'])
@permission_classes([AdminOnly])
def status(request):
    return Response(directory_status())


@api_view(['POST'])
@permission_classes([AdminOnly])
def run(request):
    group_deadline = time.monotonic() + 100
    # File paths and the mass-deactivation override are deliberately CLI-only.
    if set(request.data) - {'apply'} or type(request.data.get('apply', False)) is not bool:
        return Response({'detail': translate('Invalid directory sync request.')}, status=400)
    try:
        return Response(sync_directory(apply=request.data.get('apply', False), actor=request.user, group_deadline=group_deadline))
    except DirectoryError as exc:
        status_code = {'not_configured': 503, 'permission': 502, 'throttled': 503,
                       'network': 502, 'invalid_listing': 502, 'busy': 409, 'conflict': 409, 'failed': 500}[exc.code]
        return Response({'code': exc.code, 'detail': translate(str(exc))}, status=status_code)
