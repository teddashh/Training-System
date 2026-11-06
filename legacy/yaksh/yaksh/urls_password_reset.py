from django.urls import path
from django.contrib.auth.views import (
    PasswordResetView, PasswordResetConfirmView, PasswordResetDoneView,
    PasswordResetCompleteView, PasswordChangeView, PasswordChangeDoneView,
)
from .forms import GenericPasswordResetForm

urlpatterns = [
    path('forgotpassword/',
         PasswordResetView.as_view(
             form_class=GenericPasswordResetForm,
             success_url='/password_reset/mail_sent/',
             email_template_name='registration/password_reset_email.html',
         ),
         name='password_reset'),

    path('password_reset/<uidb64>/<token>/',
         PasswordResetConfirmView.as_view(
             success_url='/password_reset/complete/'
         ),
         name='password_reset_confirm'),

    path('password_reset/mail_sent/', PasswordResetDoneView.as_view(),
         name='password_reset_done'),

    path('password_reset/complete/', PasswordResetCompleteView.as_view(),
         name='password_reset_complete'),

    path('changepassword/',
         PasswordChangeView.as_view(
             success_url='/password_change/done/'
         ),
         name='password_change'),

    path('password_change/done/', PasswordChangeDoneView.as_view(),
         name='password_change_done'),
]
