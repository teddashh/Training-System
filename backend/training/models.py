import secrets
import uuid

from django.contrib.auth.models import AbstractUser
from django.core.validators import RegexValidator
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = "admin", "Super administrator"
        TRAINING_ADMIN = "training_admin", "Training administrator"
        COURSE_CREATOR = "course_creator", "Course creator"
        EXAM_ADMIN = "exam_admin", "Exam administrator"
        TRAINING_SCHEDULER = "training_scheduler", "Training scheduler"
        INSTRUCTOR = "instructor", "Instructor"
        LEARNER = "learner", "Learner"

    email = models.EmailField(blank=True)
    employee_id = models.CharField(max_length=64, null=True, blank=True, unique=True)
    display_name = models.CharField(max_length=100, blank=True)
    department = models.CharField(max_length=100, blank=True)
    job_title = models.CharField(max_length=200, blank=True)
    directory_seen_at = models.DateTimeField(null=True, blank=True)
    directory_disabled_at = models.DateTimeField(null=True, blank=True)
    employment = models.CharField(
        max_length=20,
        choices=[("employee", "Employee"), ("contractor", "Contractor")],
        default="employee",
    )
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.LEARNER)
    google_subject = models.CharField(max_length=200, null=True, blank=True, unique=True)
    entra_subject = models.CharField(max_length=200, null=True, blank=True, unique=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                Lower("email"),
                condition=~models.Q(email=""),
                name="unique_user_email_ci",
            ),
            models.UniqueConstraint(Lower("username"), name="unique_username_ci"),
            models.UniqueConstraint(Lower("entra_subject"), name="unique_user_entra_subject_ci"),
        ]


class Identity(models.Model):
    """Stable assessment identity shared by accounts and bound invitations."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key = models.CharField(max_length=320, unique=True)
    user = models.OneToOneField(User, null=True, blank=True, on_delete=models.PROTECT)
    label = models.CharField(max_length=100, blank=True)


class TrainingGroup(models.Model):
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=2000, blank=True)
    created_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name='created_training_groups')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    entra_group_id = models.CharField(max_length=36, null=True, blank=True)
    entra_display_name = models.CharField(max_length=256, null=True, blank=True)
    entra_last_synced_at = models.DateTimeField(null=True, blank=True)
    entra_sync_result = models.JSONField(null=True, blank=True)
    members = models.ManyToManyField(User, through='TrainingGroupMembership', through_fields=('group', 'user'), related_name='training_groups')

    class Meta:
        constraints = [
            models.UniqueConstraint(Lower('name'), name='unique_training_group_name_ci'),
            models.UniqueConstraint(Lower('entra_group_id'), name='unique_training_group_entra_ci'),
        ]


class TrainingGroupMembership(models.Model):
    group = models.ForeignKey(TrainingGroup, on_delete=models.CASCADE, related_name='memberships')
    user = models.ForeignKey(User, on_delete=models.PROTECT, related_name='training_group_memberships')
    added_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name='added_training_group_memberships')
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['group', 'user'], name='unique_training_group_member')]


class DirectorySyncState(models.Model):
    """Singleton lock for complete directory runs, including scheduled runs."""

    last_run_at = models.DateTimeField(null=True, blank=True)
    next_scheduled_attempt_at = models.DateTimeField(null=True, blank=True)


class Course(models.Model):
    reminders = models.BooleanField(default=False, db_default=False)
    registration_key = models.CharField(max_length=64, null=True, blank=True, unique=True, db_default=None, editable=False)
    venue = models.CharField(max_length=10, default='online', db_default='online', choices=[
        ('online', 'Online'), ('onsite', 'On-site'),
    ])
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=50, default="General training")
    cover = models.CharField(max_length=80, default="learning-skills", blank=True)
    duration_minutes = models.PositiveIntegerField(default=30)
    published = models.BooleanField(default=False)
    requires_approval = models.BooleanField(default=False)
    release_at = models.DateTimeField(null=True, blank=True)
    delivery_mode = models.CharField(max_length=16, default='self_paced', choices=[
        ('self_paced', 'Self-paced'), ('scheduled', 'Scheduled sessions'),
    ])
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


class CourseSession(models.Model):
    reminders_seen_at = models.DateTimeField(null=True, blank=True, db_default=None, editable=False)
    location = models.CharField(max_length=200, blank=True, default='', db_default='')
    meeting_url = models.URLField(max_length=2000, blank=True, default='', db_default='')
    course = models.ForeignKey(Course, related_name='sessions', on_delete=models.CASCADE)
    title = models.CharField(max_length=100)
    registration_opens_at = models.DateTimeField(null=True, blank=True)
    registration_closes_at = models.DateTimeField(null=True, blank=True)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    capacity = models.PositiveIntegerField(default=100)
    cancelled = models.BooleanField(default=False)
    revision = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['starts_at', 'id']
        constraints = [
            models.CheckConstraint(condition=models.Q(capacity__gte=1, capacity__lte=10000), name='valid_session_capacity'),
            models.CheckConstraint(condition=models.Q(ends_at__gt=models.F('starts_at')), name='valid_session_window'),
        ]


class Enrollment(models.Model):
    attended_at = models.DateTimeField(null=True, blank=True)
    attendance = models.CharField(max_length=7, blank=True, default='', db_default='', choices=[
        ('', 'No record'), ('present', 'Present'), ('absent', 'Absent'),
    ])
    attendance_marked_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL,
                                             related_name='attendance_marks')
    attendance_marked_at = models.DateTimeField(null=True, blank=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    course = models.ForeignKey(
        Course, on_delete=models.CASCADE, related_name="enrollments"
    )
    session = models.ForeignKey(CourseSession, null=True, blank=True, related_name='enrollments', on_delete=models.PROTECT)
    progress = models.PositiveSmallIntegerField(default=0)
    progress_known = models.BooleanField(default=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(
        max_length=12,
        choices=[
            (value, value) for value in ("approved", "pending", "rejected", "removed", "cancelled")
        ],
        default="approved",
    )
    revision = models.PositiveIntegerField(default=0)
    request_note = models.CharField(max_length=1000, blank=True)
    requested_at = models.DateTimeField(null=True, blank=True)
    review_note = models.CharField(max_length=1000, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reviewed_enrollments",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "course"], name="unique_enrollment")
        ]


class CourseMaterial(models.Model):
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='materials')
    title = models.CharField(max_length=200)
    position = models.PositiveIntegerField(default=0)
    file_key = models.CharField(max_length=64, blank=True)
    filename = models.CharField(max_length=255, blank=True)
    size = models.PositiveIntegerField(default=0)
    url = models.URLField(max_length=2000, blank=True)
    created_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['position', 'id']


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
    # Rollback compatibility only; new readers use CourseAssessment links.
    course = models.ForeignKey(Course, null=True, blank=True, on_delete=models.SET_NULL)
    courses = models.ManyToManyField(Course, through="CourseAssessment", related_name="assessments", blank=True)
    owner = models.ForeignKey(User, on_delete=models.PROTECT)
    duration_minutes = models.PositiveIntegerField(default=30)
    max_attempts = models.PositiveSmallIntegerField(default=2)
    retry_interval_minutes = models.PositiveIntegerField(default=0)
    attempt_reset_minutes = models.PositiveIntegerField(default=0)
    allow_skip = models.BooleanField(default=True)
    allow_response_review = models.BooleanField(default=True)
    pass_score = models.PositiveSmallIntegerField(default=70)
    published = models.BooleanField(default=False)
    audience = models.CharField(
        max_length=20,
        default="all",
        choices=[
            ("all", "Everyone"),
            ("course", "Linked course participants only"),
            ("employees", "Employees"),
            ("contractors", "Contractors"),
            ("departments", "Departments"),
            ("people", "Selected people"),
            ("groups", "Groups"),
            ("invitation", "Invitation only"),
        ],
    )
    allowed_departments = models.JSONField(default=list, blank=True)
    allowed_users = models.ManyToManyField(
        User, blank=True, related_name="assigned_exams"
    )
    allowed_groups = models.ManyToManyField(TrainingGroup, blank=True, related_name="exams")
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    shuffle_questions = models.BooleanField(default=False)
    shuffle_options = models.BooleanField(default=False)
    questions_per_attempt = models.PositiveSmallIntegerField(null=True, blank=True)

    def save(self, *args, **kwargs):
        from django.db import transaction
        with transaction.atomic():
            creating = self._state.adding
            initial_course = self.course_id if creating else None
            if not creating:
                Exam.objects.select_for_update().get(pk=self.pk)
                self.course_id = self.assessment_links.order_by('created_at', 'pk').values_list('course_id', flat=True).first()
                if kwargs.get('update_fields') is not None:
                    kwargs['update_fields'] = set(kwargs['update_fields']) | {'course'}
            super().save(*args, **kwargs)
            if initial_course:
                CourseAssessment.objects.get_or_create(exam=self, course_id=initial_course)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(max_attempts__gte=1), name="positive_attempt_limit"
            ),
            models.CheckConstraint(
                condition=models.Q(pass_score__lte=100), name="valid_pass_score"
            ),
            models.CheckConstraint(
                condition=models.Q(retry_interval_minutes__lte=525600),
                name="bounded_retry_interval",
            ),
            models.CheckConstraint(
                condition=models.Q(attempt_reset_minutes__lte=525600),
                name="bounded_attempt_reset",
            ),
        ]


def question_figure_key():
    return secrets.token_urlsafe(32)


class QuestionFigureQuerySet(models.QuerySet):
    def update(self, **kwargs):
        # User deletion may clear attribution; image content is append-only.
        if kwargs != {"created_by": None}:
            raise ValueError("Question figures are immutable.")
        return super().update(**kwargs)

    def delete(self):
        raise ValueError("Question figures cannot be deleted.")


class QuestionFigureManager(models.Manager.from_queryset(QuestionFigureQuerySet)):
    def get_queryset(self):
        return super().get_queryset().defer("data")


class QuestionFigure(models.Model):
    key = models.CharField(max_length=43, unique=True, default=question_figure_key)
    sha256 = models.CharField(max_length=64, unique=True,
                              validators=[RegexValidator(r"^[0-9a-f]{64}$")])
    content_type = models.CharField(max_length=10, choices=[
        ("image/png", "PNG"), ("image/jpeg", "JPEG"), ("image/webp", "WebP"),
    ])
    data = models.BinaryField()
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    size = models.PositiveIntegerField()
    created_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)
    objects = QuestionFigureManager()

    class Meta:
        base_manager_name = "objects"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValueError("Question figures are immutable.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError("Question figures cannot be deleted.")


class Question(models.Model):
    # Based on Yaksh Question's description / points / type / solution model.
    exam = models.ForeignKey(Exam, related_name="questions", on_delete=models.CASCADE)
    description = models.TextField()
    type = models.CharField(
        max_length=20,
        choices=[
            ("single", "Single choice"),
            ("multiple", "Multiple choice"),
            ("short", "Short answer"),
            ("essay", "Written response"),
            ("integer", "Integer answer"),
            ("numeric", "Numeric answer"),
            ("ordering", "Ordering"),
        ],
        default="single",
    )
    options = models.JSONField(default=list, blank=True)
    solution = models.JSONField(default=list, blank=True)
    answer_tolerances = models.JSONField(default=list, blank=True)
    answer_matching = models.JSONField(default=list, blank=True)
    figure = models.ForeignKey(QuestionFigure, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    figure_alt = models.CharField(max_length=2000, blank=True, default="", db_default="")
    figure_caption = models.CharField(max_length=300, blank=True, default="", db_default="")
    grading_guide = models.TextField(blank=True, default="", db_default="")
    points = models.PositiveIntegerField(default=10)
    position = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["position", "id"]


class BankQuestion(models.Model):
    """Reusable source material; exams copy questions and attempts freeze them."""

    owner = models.ForeignKey(User, on_delete=models.PROTECT)
    category = models.CharField(max_length=100, default="General training")
    description = models.TextField()
    type = models.CharField(
        max_length=20, choices=Question._meta.get_field("type").choices
    )
    options = models.JSONField(default=list, blank=True)
    solution = models.JSONField(default=list, blank=True)
    answer_tolerances = models.JSONField(default=list, blank=True)
    answer_matching = models.JSONField(default=list, blank=True)
    figure = models.ForeignKey(QuestionFigure, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    figure_alt = models.CharField(max_length=2000, blank=True, default="", db_default="")
    figure_caption = models.CharField(max_length=300, blank=True, default="", db_default="")
    grading_guide = models.TextField(blank=True, default="", db_default="")
    points = models.PositiveIntegerField(default=10)
    archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class LearningAssignment(models.Model):
    user = models.ForeignKey(User, on_delete=models.PROTECT)
    course = models.ForeignKey(Course, null=True, blank=True, on_delete=models.PROTECT)
    exam = models.ForeignKey(Exam, null=True, blank=True, on_delete=models.PROTECT)
    created_by = models.ForeignKey(
        User, related_name="issued_assignments", on_delete=models.PROTECT
    )
    due_at = models.DateTimeField(null=True, blank=True)
    notes = models.CharField(max_length=1000, blank=True)
    assigned_at = models.DateTimeField(auto_now_add=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(course__isnull=False, exam__isnull=True)
                    | models.Q(course__isnull=True, exam__isnull=False)
                ),
                name="assignment_has_one_target",
            ),
            models.UniqueConstraint(
                fields=["user", "course"], name="unique_course_assignment"
            ),
            models.UniqueConstraint(
                fields=["user", "exam"], name="unique_exam_assignment"
            ),
        ]


class AttemptBudget(models.Model):
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE)
    identity = models.ForeignKey(Identity, on_delete=models.PROTECT)
    limit_override = models.PositiveSmallIntegerField(null=True, blank=True)
    used = models.PositiveIntegerField(default=0)
    round_start_used = models.PositiveIntegerField(default=0)
    round_number = models.PositiveIntegerField(default=1)

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


class InvitationBatch(models.Model):
    # Client-generated request UUID makes retries atomic across API workers.
    id = models.UUIDField(primary_key=True, editable=False)
    created_by = models.ForeignKey(User, on_delete=models.PROTECT)
    exam = models.ForeignKey(Exam, on_delete=models.PROTECT)
    fingerprint = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)


class Invitation(models.Model):
    batch = models.ForeignKey(
        InvitationBatch,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="invitations",
    )
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE)
    identity = models.ForeignKey(Identity, on_delete=models.PROTECT)
    token_hash = models.CharField(max_length=64, unique=True)
    max_attempts = models.PositiveSmallIntegerField(default=1)
    used = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField()
    revoked = models.BooleanField(default=False)
    require_email_verification = models.BooleanField(default=False)
    verification_email = models.EmailField(blank=True)
    created_by = models.ForeignKey(User, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)


class GuestEmailChallenge(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invitation = models.ForeignKey(Invitation, on_delete=models.CASCADE)
    digest = models.CharField(max_length=64)
    expires_at = models.DateTimeField()
    failures = models.PositiveSmallIntegerField(default=0)


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
    answer_revision = models.PositiveIntegerField(default=0)
    grading_revision = models.PositiveIntegerField(default=0)
    # Navigation is frozen at start; completed-review visibility remains live.
    allow_skip = models.BooleanField(default=True)
    unlocked_question_count = models.PositiveSmallIntegerField(default=1)
    manual_grades = models.JSONField(default=dict)
    score = models.FloatField(null=True, blank=True)
    passed = models.BooleanField(null=True, blank=True)
    started_at = models.DateTimeField(auto_now_add=True)
    deadline = models.DateTimeField()
    submitted_at = models.DateTimeField(null=True, blank=True)
    graded_at = models.DateTimeField(null=True, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    last_saved_at = models.DateTimeField(null=True, blank=True)
    extra_time_minutes = models.PositiveSmallIntegerField(default=0)
    reopen_count = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["exam", "identity", "number"], name="unique_attempt_number"
            ),
            models.CheckConstraint(
                condition=models.Q(
                    unlocked_question_count__gte=1, unlocked_question_count__lte=200
                ),
                name="bounded_unlocked_questions",
            ),
            models.CheckConstraint(
                condition=models.Q(extra_time_minutes__lte=1440),
                name="bounded_attempt_extra_time",
            ),
        ]


class AttemptTimeExtension(models.Model):
    # The client retains this key across uncertain network outcomes.
    id = models.UUIDField(primary_key=True, editable=False)
    attempt = models.ForeignKey(Attempt, on_delete=models.PROTECT)
    actor = models.ForeignKey(User, on_delete=models.PROTECT)
    minutes = models.PositiveSmallIntegerField()
    reason = models.CharField(max_length=500)
    previous_deadline = models.DateTimeField()
    new_deadline = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(minutes__gte=1, minutes__lte=240),
                name="bounded_extension_minutes",
            ),
        ]


class AttemptReopening(models.Model):
    """An immutable copy of the withdrawn submission and its reopening grant."""

    id = models.UUIDField(primary_key=True, editable=False)
    attempt = models.ForeignKey(Attempt, on_delete=models.PROTECT)
    actor = models.ForeignKey(User, on_delete=models.PROTECT)
    minutes = models.PositiveSmallIntegerField()
    reason = models.CharField(max_length=500)
    previous_submission = models.JSONField()
    new_deadline = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(minutes__gte=1, minutes__lte=240),
                name="bounded_reopening_minutes",
            ),
        ]


class MarksImport(models.Model):
    """A reviewed plan and durable receipt for an atomic marks import."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    exam = models.ForeignKey(Exam, on_delete=models.PROTECT)
    actor = models.ForeignKey(User, on_delete=models.PROTECT)
    reason = models.CharField(max_length=500)
    status = models.CharField(max_length=12, default="preview")
    plan = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    applied_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class ExamPreview(models.Model):
    """Private instructor trials, deliberately outside participant evidence."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE)
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    mode = models.CharField(
        max_length=20,
        choices=[("learner", "Learner simulation"), ("unrestricted", "Untimed test")],
    )
    status = models.CharField(max_length=20, default="in_progress")
    snapshot = models.JSONField(default=list)
    pass_score = models.PositiveSmallIntegerField()
    answers = models.JSONField(default=dict)
    answer_revision = models.PositiveIntegerField(default=0)
    allow_skip = models.BooleanField(default=True)
    unlocked_question_count = models.PositiveSmallIntegerField(default=1)
    manual_grades = models.JSONField(default=dict)
    score = models.FloatField(null=True, blank=True)
    passed = models.BooleanField(null=True, blank=True)
    started_at = models.DateTimeField(auto_now_add=True)
    deadline = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(db_index=True)

    @property
    def number(self):
        return 1

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(
                    unlocked_question_count__gte=1, unlocked_question_count__lte=200
                ),
                name="bounded_preview_unlocks",
            ),
            models.CheckConstraint(
                condition=models.Q(mode="learner", deadline__isnull=False)
                | models.Q(mode="unrestricted", deadline__isnull=True),
                name="valid_preview_timing",
            ),
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


class EmailQueueState(models.Model):
    """Singleton mailbox circuit state; active_email serializes queued sends."""

    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    paused_until = models.DateTimeField(null=True, blank=True)
    consecutive_failures = models.PositiveIntegerField(default=0)
    accepted_total = models.PositiveBigIntegerField(default=0)
    last_error = models.CharField(max_length=200, blank=True)
    active_email = models.ForeignKey("OutboundEmail", null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        constraints = [models.CheckConstraint(condition=models.Q(id=1), name="single_email_queue_state")]


class OutboundEmail(models.Model):
    """Notification queue and delivery evidence; verification entries have no bodies."""

    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        SENDING = "sending", "Sending"
        SENT = "sent", "Sent"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    kind = models.CharField(max_length=40)
    recipient_user = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="outbound_emails",
    )
    to_email = models.EmailField()
    subject = models.CharField(max_length=500, blank=True)
    body_text = models.TextField(blank=True)
    body_html = models.TextField(blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.QUEUED)
    attempts = models.PositiveIntegerField(default=0)
    last_error = models.CharField(max_length=200, blank=True)
    # While sending this is the claim timestamp, for crash recovery.
    next_attempt_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="created_outbound_emails",
    )
    context = models.JSONField(default=dict)
    dedupe_key = models.CharField(max_length=200, unique=True, null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["status", "next_attempt_at", "id"], name="outbound_queue_idx"),
            models.Index(fields=["status", "sent_at"], name="outbound_accepted_idx"),
        ]


class CourseAssessment(models.Model):
    release = models.CharField(max_length=16, default="immediate", db_default="immediate",
                               choices=[("immediate", "Immediate"), ("after_session", "After session")])
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='assessment_links')
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name='assessment_links')
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        ordering = ['created_at', 'id']
        constraints = [models.UniqueConstraint(fields=['course', 'exam'], name='unique_course_assessment')]


# Cover ORM deletes (including cascades) and related-manager bulk writes.
from django.db.models.signals import post_save, post_delete, pre_delete, m2m_changed
from django.dispatch import receiver


def sync_primary_exam_course(exam_id):
    primary = CourseAssessment.objects.filter(exam_id=exam_id).values_list('course_id', flat=True).first()
    Exam.objects.filter(pk=exam_id).update(course_id=primary)


@receiver(post_save, sender=CourseAssessment)
@receiver(post_delete, sender=CourseAssessment)
def assessment_primary_changed(sender, instance, **kwargs):
    sync_primary_exam_course(instance.exam_id)


@receiver(pre_delete, sender=Course)
def remember_course_assessments(sender, instance, **kwargs):
    instance._assessment_exam_ids = list(instance.assessment_links.values_list('exam_id', flat=True))


@receiver(post_delete, sender=Course)
def deleted_course_primary(sender, instance, **kwargs):
    for exam_id in getattr(instance, '_assessment_exam_ids', []):
        sync_primary_exam_course(exam_id)


@receiver(m2m_changed, sender=Exam.courses.through)
def assessment_many_changed(sender, instance, action, reverse, pk_set, **kwargs):
    if action == 'pre_clear' and reverse:
        instance._assessment_exam_ids = list(instance.assessment_links.values_list('exam_id', flat=True))
    if action in ('post_add', 'post_remove', 'post_clear'):
        ids = (pk_set if pk_set is not None else getattr(instance, '_assessment_exam_ids', [])) if reverse else [instance.pk]
        for exam_id in ids:
            sync_primary_exam_course(exam_id)


class TrainingRequest(models.Model):
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    request_id = models.UUIDField()
    response = models.JSONField(default=dict)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['owner', 'request_id'], name='unique_training_request')]


class ReminderBatch(models.Model):
    session = models.ForeignKey(CourseSession, on_delete=models.CASCADE, related_name='reminder_batches')
    exam = models.ForeignKey(Exam, null=True, on_delete=models.CASCADE)
    kind = models.CharField(max_length=32)
    event_at = models.DateTimeField()
    event_end = models.DateTimeField(null=True)
    scheduled_at = models.DateTimeField()
    produced_at = models.DateTimeField(auto_now_add=True)
    key = models.CharField(max_length=180, unique=True)


class SystemSettings(models.Model):
    """One optional row; an absent row preserves deployment defaults."""
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    organization_name = models.CharField(max_length=80, blank=True)
    logo = models.BinaryField(default=bytes, blank=True)
    logo_hash = models.CharField(max_length=64, blank=True)
    logo_size = models.PositiveIntegerField(default=0)
    logo_width = models.PositiveSmallIntegerField(default=0)
    logo_height = models.PositiveSmallIntegerField(default=0)
    languages = models.JSONField(default=list, blank=True)
    sign_in_provider = models.CharField(max_length=10, default="none")
    sign_in_fields = models.JSONField(default=dict, blank=True)
    email_provider = models.CharField(max_length=10, default="off")
    email_fields = models.JSONField(default=dict, blank=True)
    updated_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=models.Q(id=1), name="singleton_system_settings")]
