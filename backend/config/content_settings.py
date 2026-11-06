from .settings import *

ROOT_URLCONF = "config.content_urls"
MIDDLEWARE = ["django.middleware.security.SecurityMiddleware"]
INSTALLED_APPS = [app for app in INSTALLED_APPS if app != "django.contrib.admin"]
# Run on an isolated origin. This service has no login, admin or application API.
