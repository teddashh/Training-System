from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import QuerySet
from django.db.models.manager import BaseManager
from rest_framework import serializers

from .access import access_for, role_access, manages_course, manages_exam, sees_results, can_link_course
from .i18n import translate
from .enrollments import can_learn, enrollment_data, user_enrollment
from .models import BankQuestion, Course, Exam, Invitation, Question, QuestionFigure, User
from .question_rules import NUMBER_ERROR, TEXT_MATCHING_MODES, parse_number


class UserSerializer(serializers.ModelSerializer):
    access = serializers.SerializerMethodField()

    def get_access(self, obj):
        return access_for(obj)

    directory_linked = serializers.SerializerMethodField()
    has_signed_in = serializers.SerializerMethodField()
    directory_disabled = serializers.SerializerMethodField()

    def get_directory_linked(self, obj):
        return bool(obj.entra_subject)

    def get_has_signed_in(self, obj):
        return obj.last_login is not None

    def get_directory_disabled(self, obj):
        return obj.directory_disabled_at is not None

    password = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "display_name",
            "employee_id",
            "department",
            "employment",
            "role",
            "access",
            "is_active",
            "password",
            "entra_subject",
            "job_title",
            "directory_linked",
            "has_signed_in",
            "directory_disabled",
            "directory_seen_at",
            "directory_disabled_at",
        ]

        read_only_fields = ["directory_seen_at", "directory_disabled_at"]

    def validate(self, data):
        for field in ("username", "employee_id", "email"):
            value = data.get(field)
            if not value:
                continue
            from django.db.models import Q

            collisions = User.objects.filter(
                Q(username__iexact=value)
                | Q(employee_id__iexact=value)
                | Q(email__iexact=value)
            )
            if self.instance:
                collisions = collisions.exclude(pk=self.instance.pk)
            if collisions.exists():
                raise serializers.ValidationError(
                    {field: translate("This sign-in identifier is already in use.")}
                )
        if self.instance and any(
            field in data and data[field] != getattr(self.instance, field)
            for field in ("username", "email", "employee_id")
        ):
            raise serializers.ValidationError(
                translate(
                    "Sign-in identifiers cannot be changed through this API after creation, to preserve historical attempt ownership."
                )
            )
        if data.get("password") and not settings.PASSWORD_SIGN_IN:
            raise serializers.ValidationError({"password": translate("Password sign-in is off.")})
        if data.get("password"):
            try:
                validate_password(
                    data["password"],
                    self.instance
                    or User(**{k: v for k, v in data.items() if k != "password"}),
                )
            except DjangoValidationError as exc:
                raise serializers.ValidationError({"password": exc.messages})
        return data

    def create(self, data):
        password = data.pop("password", None)
        data["employee_id"] = data.get("employee_id") or None
        return User.objects.create_user(password=password or None, **data)

    def update(self, instance, data):
        password = data.pop("password", None)
        if 'is_active' in data:
            # An explicit local access decision supersedes the sync's ownership.
            data['directory_disabled_at'] = None
        if 'role' in data and not role_access(data['role'])['system_admin']:
            data['is_staff'] = False
            data['is_superuser'] = False
        instance = super().update(instance, data)
        if password:
            instance.set_password(password)
            instance.save(update_fields=["password"])
        return instance


class CourseSerializer(serializers.ModelSerializer):
    assessments = serializers.SerializerMethodField()

    def get_assessments(self, obj):
        from .assessments import course_assessments
        return course_assessments(obj, self.context)

    server_time = serializers.SerializerMethodField()
    sessions = serializers.SerializerMethodField()
    can_learn = serializers.SerializerMethodField()
    enrollment = serializers.SerializerMethodField()
    can_manage = serializers.SerializerMethodField()
    package = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()
    progress_known = serializers.SerializerMethodField()
    enrolled_count = serializers.SerializerMethodField()

    def get_enrolled_count(self, obj):
        return obj.approved_count if hasattr(obj, "approved_count") else obj.enrollments.filter(status="approved").count()

    def get_can_learn(self, obj):
        return can_learn(self.context["request"].user, obj)

    def get_enrollment(self, obj):
        return enrollment_data(
            user_enrollment(self.context["request"].user, obj)
        )

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not data["can_learn"]:
            data["blocks"] = []
        return data

    class Meta:
        model = Course
        fields = [
            "id",
            "title",
            "description",
            "category",
            "cover",
            "duration_minutes",
            "published",
            "requires_approval",
            "reminders",
            "release_at",
            "delivery_mode",
            "venue",
            "sessions",
            "server_time",
            "can_learn",
            "enrollment",
            "blocks",
            "package",
            "progress",
            "progress_known",
            "enrolled_count",
            "created_at",
            "assessments",
            "can_manage",
        ]

    def get_can_manage(self, obj):
        user = self.context["request"].user
        return manages_course(user, obj)

    def get_sessions(self, obj):
        from .course_sessions import visible_sessions
        return visible_sessions(self.context['request'].user, obj) if obj.delivery_mode == 'scheduled' else []

    def get_server_time(self, obj):
        from django.utils import timezone
        return self.context.setdefault('course_server_time', timezone.now().isoformat())

    def validate(self, data):
        venue = data.get('venue', self.instance.venue if self.instance else 'online')
        mode = data.get('delivery_mode', self.instance.delivery_mode if self.instance else 'self_paced')
        if venue == 'onsite':
            if mode != 'scheduled':
                raise serializers.ValidationError(translate('On-site courses require scheduled sessions.'))
            if (data.get('blocks', self.instance.blocks if self.instance else [])
                    or (self.instance and (self.instance.packages.exists()
                        or (self.instance.venue != venue and self.instance.blocks)))):
                raise serializers.ValidationError(translate('On-site courses cannot contain online lesson content. Create a separate course.'))
            if self.instance and self.instance.sessions.filter(location='').exists():
                raise serializers.ValidationError(translate('Location is required for on-site sessions.'))
        if self.instance and venue != self.instance.venue and self.instance.enrollments.exists():
            raise serializers.ValidationError(translate('Create a separate course to change venue after enrollment.'))
        if self.instance and mode != 'scheduled' and (self.instance.sessions.exists() or self.instance.materials.exists()):
            raise serializers.ValidationError(translate('Courses with sessions or materials must remain scheduled.'))
        if (self.instance and data.get('delivery_mode', self.instance.delivery_mode) != self.instance.delivery_mode
                and self.instance.enrollments.filter(status__in=('approved', 'pending')).exists()):
            raise serializers.ValidationError(translate('Create a separate course for a different delivery mode while participants are enrolled.'))
        return data

    def get_package(self, obj):
        if obj.venue == 'onsite':
            return None
        package = next(iter(obj.ordered_packages), None) if hasattr(obj, "ordered_packages") else obj.packages.order_by("-created_at").first()
        return (
            {
                "id": str(package.id),
                "version": package.version,
                "title": package.title,
                "has_source": package.has_source,
            }
            if package
            else None
        )

    def get_progress(self, obj):
        row = user_enrollment(self.context["request"].user, obj)
        return (
            row.progress
            if row and (row.status == "approved" or row.progress > 0)
            else None
        )

    def get_progress_known(self, obj):
        row = user_enrollment(self.context["request"].user, obj)
        return row.progress_known if row else True

    def validate_cover(self, value):
        from pathlib import Path
        import json
        from django.conf import settings
        catalog = json.loads((Path(settings.LOCALE_ROOT).parent / "brand" / "covers.json").read_text())
        if value and value not in {item["id"] for item in catalog}:
            raise serializers.ValidationError(translate("Choose a cover from the library."))
        return value

    def validate_blocks(self, blocks):
        if not isinstance(blocks, list) or len(blocks) > 100:
            raise serializers.ValidationError(
                translate("A course can contain at most 100 blocks.")
            )
        for block in blocks:
            if (
                not isinstance(block, dict)
                or block.get("type") not in ("heading", "text", "callout")
                or not isinstance(block.get("text"), str)
                or len(block["text"]) > 20000
                or ("source_page" in block and (type(block["source_page"]) is not int or not 1 <= block["source_page"] <= 50))
            ):
                raise serializers.ValidationError(
                    translate("Invalid content block format.")
                )
        return blocks


class QuestionFigureField(serializers.SlugRelatedField):
    def __init__(self, **kwargs):
        super().__init__(slug_field="key", queryset=QuestionFigure.objects.defer("data"),
                         required=False, allow_null=True, **kwargs)

    def to_internal_value(self, value):
        if not isinstance(value, str):
            raise serializers.ValidationError(translate("Choose a valid question figure."))
        try:
            return super().to_internal_value(value)
        except serializers.ValidationError:
            raise serializers.ValidationError(translate("Choose a valid question figure."))

    def to_representation(self, value):
        return {"key": value.key, "width": value.width, "height": value.height}


class FigureQuestionListSerializer(serializers.ListSerializer):
    def to_representation(self, data):
        if isinstance(data, BaseManager):
            data = data.all()
        # Respect an existing prefetch; optimize uncached serializer/copy paths too.
        if isinstance(data, QuerySet) and data._result_cache is None:
            data = data.select_related("figure").defer("figure__data")
        return super().to_representation(data)


class QuestionSerializer(serializers.ModelSerializer):
    figure = QuestionFigureField()
    grading_guide = serializers.CharField(required=False, allow_blank=True, max_length=5000)

    class Meta:
        model = Question
        list_serializer_class = FigureQuestionListSerializer
        fields = [
            "id",
            "description",
            "type",
            "options",
            "solution",
            "answer_tolerances",
            "answer_matching",
            "figure",
            "figure_alt",
            "figure_caption",
            "grading_guide",
            "points",
            "position",
        ]

    def validate(self, data):
        figure = data.get("figure", getattr(self.instance, "figure", None))
        alt = data.get("figure_alt", getattr(self.instance, "figure_alt", ""))
        if figure and not alt.strip():
            raise serializers.ValidationError({"figure_alt": translate("Describe the figure for people who cannot see it.")})
        if not figure:
            data["figure_alt"] = ""
            data["figure_caption"] = ""
        kind = data.get("type", getattr(self.instance, "type", "single"))
        if kind != "essay":
            data["grading_guide"] = ""
        options = data.get("options", getattr(self.instance, "options", []))
        solution = data.get("solution", getattr(self.instance, "solution", []))
        tolerances = data.get(
            "answer_tolerances", getattr(self.instance, "answer_tolerances", [])
        )
        if not isinstance(options, list) or not all(
            isinstance(v, str) and len(v) <= 4000 for v in options
        ):
            raise serializers.ValidationError(translate("Invalid option format."))
        if not isinstance(solution, list) or not data.get("points", 10) > 0:
            raise serializers.ValidationError(translate("Invalid answer or points."))
        if kind in ("single", "multiple"):
            if (
                len(options) < 2
                or len(options) > 20
                or not solution
                or (kind == "single" and len(solution) != 1)
                or any(
                    type(v) is not int or v < 0 or v >= len(options) for v in solution
                )
            ):
                raise serializers.ValidationError(
                    translate(
                        "Provide at least two options and valid correct-answer indexes."
                    )
                )
        if kind == "short":
            if not 1 <= len(solution) <= 20 or not all(
                isinstance(value, str) and value.strip() and len(value) <= 20000
                for value in solution
            ):
                raise serializers.ValidationError(
                    translate(
                        "Provide 1–20 non-empty accepted text answers, each at most 20,000 characters."
                    )
                )
            modes = data.get(
                "answer_matching", getattr(self.instance, "answer_matching", [])
            )
            if modes == []:
                modes = ["normalized"] * len(solution)
            if (
                not isinstance(modes, list)
                or len(modes) != len(solution)
                or any(mode not in TEXT_MATCHING_MODES for mode in modes)
            ):
                raise serializers.ValidationError(
                    translate(
                        "Choose one valid matching rule for each accepted text answer."
                    )
                )
            data["answer_matching"] = modes
            data["options"] = []
        else:
            data["answer_matching"] = []
        if kind in ("integer", "numeric"):
            try:
                if not 1 <= len(solution) <= 20:
                    raise ValueError("Provide 1–20 accepted values")
                expected = [
                    parse_number(value, integer=kind == "integer") for value in solution
                ]
            except ValueError:
                raise serializers.ValidationError(
                    translate(
                        "Provide 1–20 accepted whole-number answers."
                        if kind == "integer"
                        else NUMBER_ERROR
                    )
                )
            data["solution"] = [str(value) for value in expected]
            data["options"] = []
        if kind == "numeric":
            try:
                if not isinstance(tolerances, list) or len(tolerances) != len(solution):
                    raise ValueError(
                        "One tolerance is required for each accepted value"
                    )
                margins = [parse_number(value) for value in tolerances]
                if any(value < 0 for value in margins):
                    raise ValueError("Negative tolerance")
            except ValueError:
                raise serializers.ValidationError(
                    translate(
                        "Provide one finite, non-negative tolerance for each accepted numeric answer."
                    )
                )
            data["answer_tolerances"] = [str(value) for value in margins]
        else:
            data["answer_tolerances"] = []
        if kind == "ordering":
            if (
                not 2 <= len(options) <= 20
                or any(not option.strip() for option in options)
                or len({option.strip() for option in options}) != len(options)
                or any(type(index) is not int for index in solution)
                or sorted(solution) != list(range(len(options)))
            ):
                raise serializers.ValidationError(
                    translate(
                        "Provide 2–20 distinct items and a correct order containing every item exactly once."
                    )
                )
            data["options"] = [option.strip() for option in options]
        return data


class BankQuestionSerializer(QuestionSerializer):
    class Meta:
        model = BankQuestion
        list_serializer_class = FigureQuestionListSerializer
        fields = [
            "id",
            "description",
            "type",
            "options",
            "solution",
            "answer_tolerances",
            "answer_matching",
            "figure",
            "figure_alt",
            "figure_caption",
            "grading_guide",
            "points",
            "category",
            "archived",
            "updated_at",
        ]
        read_only_fields = ["updated_at"]


class LinkedCoursesField(serializers.Field):
    """Writable course IDs, represented in through-table link order without N+1 queries."""
    def get_attribute(self, instance):
        return instance

    def to_representation(self, instance):
        return [link.course_id for link in instance.assessment_links.all()]

    def to_internal_value(self, data):
        return serializers.PrimaryKeyRelatedField(queryset=Course.objects.all(), many=True).run_validation(data)


class ExamSerializer(serializers.ModelSerializer):
    course = serializers.PrimaryKeyRelatedField(queryset=Course.objects.all(), required=False, allow_null=True, write_only=True)
    courses = LinkedCoursesField(required=False)
    course_links = serializers.SerializerMethodField()
    available_to_me = serializers.SerializerMethodField()
    last_result = serializers.SerializerMethodField()
    assignment_due_at = serializers.SerializerMethodField()

    def get_course_links(self, obj):
        user = self.context['request'].user
        from .course_sessions import released
        return [{'id': link.course_id, 'title': link.course.title, 'can_remove': can_link_course(user, link.course)}
                for link in obj.assessment_links.all()
                if released(link.course) or manages_course(user, link.course) or manages_exam(user, obj)]

    def get_available_to_me(self, obj):
        from .services import exam_audience_sets, visible_exam
        if 'audience_sets' not in self.context:
            self.context['audience_sets'] = exam_audience_sets(self.context['request'].user)
        return obj.published and visible_exam(obj, self.context['request'].user, self.context['audience_sets'])

    def history(self, obj):
        if hasattr(obj, 'user_attempts'):
            return obj.user_attempts
        cache = self.context.setdefault('user_attempts', {})
        if obj.pk not in cache:
            cache[obj.pk] = list(obj.attempt_set.filter(identity__user=self.context['request'].user).order_by('number'))
        return cache[obj.pk]

    def get_last_result(self, obj):
        from django.utils import timezone
        # Opening an expired owned attempt runs the existing finalization path.
        rows = [a for a in self.history(obj) if a.status != 'in_progress' or a.deadline <= timezone.now()]
        if not rows:
            return None
        row = rows[-1]
        # Match public_attempt's release policy: numerical results only after grading.
        return {'id': str(row.pk), 'status': row.status,
                'score': row.score if row.status == 'graded' else None,
                'passed': row.passed if row.status == 'graded' else None}

    def get_assignment_due_at(self, obj):
        from .models import LearningAssignment
        if 'exam_due_dates' not in self.context:
            self.context['exam_due_dates'] = dict(LearningAssignment.objects.filter(
                user=self.context['request'].user, cancelled_at=None, exam__isnull=False,
            ).values_list('exam_id', 'due_at'))
        return self.context['exam_due_dates'].get(obj.pk)

    questions = QuestionSerializer(many=True, required=False)
    question_count = serializers.SerializerMethodField()
    attempts_used = serializers.SerializerMethodField()
    effective_attempt_limit = serializers.SerializerMethodField()
    attempts_remaining = serializers.SerializerMethodField()
    active_attempt_id = serializers.SerializerMethodField()
    next_attempt_at = serializers.SerializerMethodField()
    next_round_at = serializers.SerializerMethodField()
    round_number = serializers.SerializerMethodField()
    round_attempts_used = serializers.SerializerMethodField()
    round_awaiting_grading = serializers.SerializerMethodField()
    server_time = serializers.SerializerMethodField()
    can_manage = serializers.SerializerMethodField()
    can_view_results = serializers.SerializerMethodField()

    class Meta:
        model = Exam
        fields = [
            "id",
            "title",
            "description",
            "course",
            "courses",
            "course_links",
            "available_to_me",
            "last_result",
            "assignment_due_at",
            "duration_minutes",
            "max_attempts",
            "retry_interval_minutes",
            "attempt_reset_minutes",
            "next_round_at",
            "round_number",
            "round_attempts_used",
            "round_awaiting_grading",
            "allow_skip",
            "allow_response_review",
            "pass_score",
            "published",
            "starts_at",
            "ends_at",
            "questions",
            "question_count",
            "attempts_used",
            "effective_attempt_limit",
            "attempts_remaining",
            "active_attempt_id",
            "next_attempt_at",
            "server_time",
            "audience",
            "allowed_users",
            "allowed_groups",
            "allowed_departments",
            "can_manage",
            "can_view_results",
            "shuffle_questions",
            "shuffle_options",
            "questions_per_attempt",
        ]

    def get_can_manage(self, obj):
        user = self.context["request"].user
        return manages_exam(user, obj)

    def get_can_view_results(self, obj):
        return sees_results(self.context["request"].user, obj)

    def get_question_count(self, obj):
        return obj.questions_per_attempt or (obj.question_total if hasattr(obj, "question_total") else obj.questions.count())

    def get_budget(self, obj):
        from .models import AttemptBudget

        cache = self.context.setdefault("attempt_budgets", {})
        if obj.pk not in cache:
            if hasattr(obj, "user_budgets"):
                cache[obj.pk] = obj.user_budgets[0] if obj.user_budgets else None
            else:
                cache[obj.pk] = AttemptBudget.objects.filter(
                    exam=obj, identity__user=self.context["request"].user
                ).first()
        return cache[obj.pk]

    def get_attempts_used(self, obj):
        row = self.get_budget(obj)
        return row.used if row else 0

    def get_effective_attempt_limit(self, obj):
        row = self.get_budget(obj)
        return (row.limit_override if row else None) or obj.max_attempts

    def get_attempts_remaining(self, obj):
        return self.get_round(obj)['attempts_remaining']

    def get_round(self, obj):
        from .attempt_rounds import round_status
        cache = self.context.setdefault('attempt_rounds', {})
        if obj.pk not in cache:
            cache[obj.pk] = round_status(obj, self.get_budget(obj), history=self.history(obj))
        return cache[obj.pk]

    def get_next_round_at(self, obj):
        value = self.get_round(obj)['next_round_at']
        return value.isoformat() if value else None

    def get_round_number(self, obj):
        return self.get_round(obj)['round_number']

    def get_round_attempts_used(self, obj):
        return self.get_round(obj)['round_attempts_used']

    def get_round_awaiting_grading(self, obj):
        return self.get_round(obj)['round_awaiting_grading']

    def get_active_attempt_id(self, obj):
        from django.utils import timezone

        rows = [a for a in self.history(obj) if a.status == 'in_progress' and a.deadline > timezone.now()]
        return str(rows[-1].pk) if rows else None

    def get_next_attempt_at(self, obj):
        from .services import next_attempt_at

        history = self.history(obj)
        started_at = history[-1].started_at if history else None
        value = next_attempt_at(obj, started_at)
        renew = self.get_round(obj)['next_round_at']
        if renew:
            value = max(value, renew) if value else renew
        # Managers also participate in My exams. Keep their editable exam window
        # intact while the existing personal start/cooldown field enforces the gate.
        from .services import exam_opens_for
        from django.utils import timezone
        opens = exam_opens_for(obj, self.context['request'].user, self.context.get('audience_sets'))
        if opens and opens != obj.starts_at and opens > timezone.now():
            value = max(value, opens) if value else opens
        return value.isoformat() if value else None

    def get_server_time(self, obj):
        from django.utils import timezone

        return self.context.setdefault("server_time", timezone.now().isoformat())

    def validate_retry_interval_minutes(self, value):
        if not 0 <= value <= 525600:
            raise serializers.ValidationError(
                translate(
                    "The retry interval must be between 0 and 525600 whole minutes."
                )
            )
        return value

    def validate_attempt_reset_minutes(self, value):
        if not 0 <= value <= 525600:
            raise serializers.ValidationError(translate('Use a waiting period between 0 and 525600 whole minutes.'))
        return value

    def validate(self, data):
        departments = data.get(
            "allowed_departments", getattr(self.instance, "allowed_departments", [])
        )
        if (
            not isinstance(departments, list)
            or len(departments) > 100
            or any(
                not isinstance(value, str) or not value.strip() or len(value) > 100
                for value in departments
            )
        ):
            raise serializers.ValidationError(translate("Select valid departments."))
        audience = data.get("audience", getattr(self.instance, "audience", "all"))
        people = data.get(
            "allowed_users",
            list(self.instance.allowed_users.all()) if self.instance else [],
        )
        groups = data.get('allowed_groups', list(self.instance.allowed_groups.all()) if self.instance else [])
        if audience == 'groups' and not groups:
            raise serializers.ValidationError(translate('Select at least one group.'))
        if (
            audience == "departments"
            and not departments
            or audience == "people"
            and not people
        ):
            raise serializers.ValidationError(
                translate("Select at least one audience member or department.")
            )
        if (
            data.get("duration_minutes", 1) < 1
            or data.get("max_attempts", 1) < 1
            or data.get("pass_score", 0) > 100
        ):
            raise serializers.ValidationError(
                translate("Invalid duration, attempt limit or passing score.")
            )
        start = data.get("starts_at", getattr(self.instance, "starts_at", None))
        end = data.get("ends_at", getattr(self.instance, "ends_at", None))
        if start and end and start >= end:
            raise serializers.ValidationError(
                translate("The closing time must be after the opening time.")
            )
        questions = data.get("questions")
        pool_size = (
            len(questions)
            if questions is not None
            else (self.instance.questions.count() if self.instance else 0)
        )
        selected = data.get(
            "questions_per_attempt",
            getattr(self.instance, "questions_per_attempt", None),
        )
        if selected is not None and not 1 <= selected <= pool_size:
            raise serializers.ValidationError(
                translate(
                    "Questions per attempt must be between 1 and the question pool size."
                )
            )
        if questions is not None and len(questions) > 200:
            raise serializers.ValidationError(
                translate("An exam can contain at most 200 questions.")
            )
        published = data.get("published", getattr(self.instance, "published", False))
        if published and not (
            questions
            if questions is not None
            else self.instance and self.instance.questions.exists()
        ):
            raise serializers.ValidationError(
                translate("Add questions before publishing.")
            )
        user = self.context['request'].user
        current = {link.course_id: link.course for link in self.instance.assessment_links.all()} if self.instance else {}
        requested = {c.pk: c for c in data.get('courses', [])}
        if 'courses' in data:
            # Omitted, inaccessible existing links are preserved, including old clients.
            for pk, course in current.items():
                if not can_link_course(user, course):
                    requested[pk] = course
            for pk in requested.keys() - current.keys():
                if not can_link_course(user, requested[pk]):
                    raise serializers.ValidationError(translate('You cannot link this course.'))
            data['courses'] = list(requested.values())
        legacy = data.get('course')
        if legacy and legacy.pk not in current and not can_link_course(user, legacy):
            raise serializers.ValidationError(translate('You cannot link this course.'))
        return data

    def create(self, data):
        links = data.pop("courses", [])
        legacy = data.pop("course", None)
        if legacy and legacy not in links:
            links.append(legacy)
        questions = data.pop("questions", [])
        people = data.pop("allowed_users", [])
        groups = data.pop('allowed_groups', [])
        if groups:
            from .groups import lock_groups
            lock_groups([g.pk for g in groups])
        exam = Exam.objects.create(**data)
        self.save_links(exam, links)
        exam.allowed_users.set(people)
        exam.allowed_groups.set(groups)
        for q in questions:
            Question.objects.create(exam=exam, **q)
        return exam

    def save_links(self, exam, courses):
        from .models import CourseAssessment, sync_primary_exam_course
        ids = [course.pk for course in courses]
        exam.assessment_links.exclude(course_id__in=ids).delete()
        for course in courses:
            CourseAssessment.objects.get_or_create(exam=exam, course=course, defaults={'created_by': self.context['request'].user})
        sync_primary_exam_course(exam.pk)
        getattr(exam, '_prefetched_objects_cache', {}).pop('assessment_links', None)
        getattr(exam, '_prefetched_objects_cache', {}).pop('courses', None)

    def update(self, instance, data):
        links = data.pop('courses', None)
        legacy = data.pop('course', None)
        if legacy:
            if links is None:
                links = [link.course for link in instance.assessment_links.all()]
            if legacy.pk not in [c.pk for c in links]:
                links.append(legacy)
        questions = data.pop("questions", None)
        if data.get('allowed_groups'):
            from .groups import lock_groups
            lock_groups([g.pk for g in data['allowed_groups']])
        elif data.get('audience', instance.audience) == 'groups':
            from .groups import lock_groups
            lock_groups(instance.allowed_groups.values_list('pk', flat=True))
        instance = super().update(instance, data)
        if links is not None:
            self.save_links(instance, links)
        if questions is not None:
            instance.questions.all().delete()
            for q in questions:
                Question.objects.create(exam=instance, **q)
            if hasattr(instance, "_prefetched_objects_cache"):
                instance._prefetched_objects_cache.pop("questions", None)
        return instance

    def to_representation(self, obj):
        # Do not even load restricted content for learner representations.
        hidden = {}
        if not self.get_can_manage(obj):
            for key in ('questions', 'allowed_users', 'allowed_departments', 'allowed_groups'):
                if key in self.fields:
                    hidden[key] = self.fields[key].write_only
                    self.fields[key].write_only = True
        try:
            data = super().to_representation(obj)
        finally:
            for key, write_only in hidden.items():
                self.fields[key].write_only = write_only
        if not self.get_can_manage(obj):
            from .services import exam_opens_for
            opens = exam_opens_for(obj, self.context['request'].user, self.context.get('audience_sets'))
            data['starts_at'] = opens.isoformat() if opens else None
            data.pop("questions", None)
            data.pop("allowed_users", None)
            data.pop("allowed_departments", None)
            data.pop("allowed_groups", None)
        return data


class InvitationSerializer(serializers.ModelSerializer):
    state = serializers.CharField(read_only=True)
    remaining_new_attempts = serializers.IntegerField(read_only=True)
    can_resume = serializers.BooleanField(read_only=True)
    identity_key = serializers.CharField(source="identity.key", read_only=True)
    exam_title = serializers.CharField(source="exam.title", read_only=True)

    class Meta:
        model = Invitation
        fields = [
            "id",
            "exam",
            "exam_title",
            "identity_key",
            "batch",
            "state",
            "remaining_new_attempts",
            "can_resume",
            "max_attempts",
            "used",
            "expires_at",
            "revoked",
            "created_at",
            "require_email_verification",
            "verification_email",
        ]
