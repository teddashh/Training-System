import uuid
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models.functions import Lower


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = "admin", "管理員"
        INSTRUCTOR = "instructor", "講師"
        LEARNER = "learner", "學員"

    email = models.EmailField(blank=True)
    employee_id = models.CharField(max_length=64, null=True, blank=True, unique=True)
    display_name = models.CharField(max_length=100, blank=True)
    department = models.CharField(max_length=100, blank=True)
    employment = models.CharField(
        max_length=20,
        choices=[("employee", "正式員工"), ("contractor", "非正式員工")],
        default="employee",
    )
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.LEARNER)
    entra_subject = models.CharField(max_length=200, null=True, blank=True, unique=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                Lower("email"),
                condition=~models.Q(email=""),
                name="unique_user_email_ci",
            ),
            models.UniqueConstraint(Lower("username"), name="unique_username_ci"),
        ]


class Identity(models.Model):
    """Stable assessment identity shared by accounts and bound invitations."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key = models.CharField(max_length=320, unique=True)
    user = models.OneToOneField(User, null=True, blank=True, on_delete=models.PROTECT)
    label = models.CharField(max_length=100, blank=True)


class Course(models.Model):
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=50, default="通識培訓")
    duration_minutes = models.PositiveIntegerField(default=30)
    published = models.BooleanField(default=False)
    owner = models.ForeignKey(User, on_delete=models.PROTECT)
    blocks = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class ScormPackage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    course = models.ForeignKey(
        Course, on_delete=models.CASCADE, related_name="packages"
    )
    version = models.CharField(max_length=20)
    launch_path = models.CharField(max_length=500)
    title = models.CharField(max_length=200)
    has_source = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)


class Enrollment(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    course = models.ForeignKey(
        Course, on_delete=models.CASCADE, related_name="enrollments"
    )
    progress = models.PositiveSmallIntegerField(default=0)
    completed_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "course"], name="unique_enrollment")
        ]


class ScormState(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    package = models.ForeignKey(ScormPackage, on_delete=models.CASCADE)
    cmi = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "package"], name="unique_scorm_state"
            )
        ]


class Exam(models.Model):
    # Modernized Yaksh Quiz / QuestionPaper: the course association is optional.
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    course = models.ForeignKey(Course, null=True, blank=True, on_delete=models.SET_NULL)
    owner = models.ForeignKey(User, on_delete=models.PROTECT)
    duration_minutes = models.PositiveIntegerField(default=30)
    max_attempts = models.PositiveSmallIntegerField(default=2)
    pass_score = models.PositiveSmallIntegerField(default=70)
    published = models.BooleanField(default=False)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(max_attempts__gte=1), name="positive_attempt_limit"
            ),
            models.CheckConstraint(
                condition=models.Q(pass_score__lte=100), name="valid_pass_score"
            ),
        ]


class Question(models.Model):
    # Based on Yaksh Question's description / points / type / solution model.
    exam = models.ForeignKey(Exam, related_name="questions", on_delete=models.CASCADE)
    description = models.TextField()
    type = models.CharField(
        max_length=20,
        choices=[
            ("single", "單選"),
            ("multiple", "複選"),
            ("short", "簡答"),
            ("essay", "申論"),
        ],
        default="single",
    )
    options = models.JSONField(default=list, blank=True)
    solution = models.JSONField(default=list, blank=True)
    points = models.PositiveIntegerField(default=10)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]


class AttemptBudget(models.Model):
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE)
    identity = models.ForeignKey(Identity, on_delete=models.PROTECT)
    limit_override = models.PositiveSmallIntegerField(null=True, blank=True)
    used = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["exam", "identity"], name="unique_attempt_budget"
            ),
            models.CheckConstraint(
                condition=models.Q(limit_override__gte=1)
                | models.Q(limit_override=None),
                name="positive_override",
            ),
        ]


class Invitation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE)
    identity = models.ForeignKey(Identity, on_delete=models.PROTECT)
    token_hash = models.CharField(max_length=64, unique=True)
    max_attempts = models.PositiveSmallIntegerField(default=1)
    used = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField()
    revoked = models.BooleanField(default=False)
    created_by = models.ForeignKey(User, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)


class Attempt(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    exam = models.ForeignKey(Exam, on_delete=models.PROTECT)
    identity = models.ForeignKey(Identity, on_delete=models.PROTECT)
    invitation = models.ForeignKey(
        Invitation, null=True, blank=True, on_delete=models.PROTECT
    )
    number = models.PositiveIntegerField()
    status = models.CharField(max_length=20, default="in_progress")
    # Freeze questions, solutions, weights, and pass threshold at start.
    snapshot = models.JSONField(default=list)
    pass_score = models.PositiveSmallIntegerField()
    answers = models.JSONField(default=dict)
    manual_grades = models.JSONField(default=dict)
    score = models.FloatField(null=True, blank=True)
    passed = models.BooleanField(null=True, blank=True)
    started_at = models.DateTimeField(auto_now_add=True)
    deadline = models.DateTimeField()
    submitted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["exam", "identity", "number"], name="unique_attempt_number"
            )
        ]


class AuditEvent(models.Model):
    actor = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)
    action = models.CharField(max_length=100)
    target = models.CharField(max_length=200)
    detail = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)


class EmailCode(models.Model):
    email = models.EmailField(unique=True)
    digest = models.CharField(max_length=64)
    expires_at = models.DateTimeField()
    failures = models.PositiveSmallIntegerField(default=0)


class AuthRate(models.Model):
    key = models.CharField(max_length=64, primary_key=True)
    count = models.PositiveIntegerField(default=0)
    window = models.DateTimeField()
