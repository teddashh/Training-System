from rest_framework.authentication import SessionAuthentication


class CsrfSessionAuthentication(SessionAuthentication):
    """Require CSRF on unsafe requests even before login or in guest sessions."""

    def authenticate(self, request):
        if request.method not in ("GET", "HEAD", "OPTIONS", "TRACE"):
            self.enforce_csrf(request)
        return super().authenticate(request)
