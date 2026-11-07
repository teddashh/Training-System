from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .i18n import translate
from .models import BankQuestion, Course, Exam, Invitation, Question, User


class UserSerializer(serializers.ModelSerializer):
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
            "is_active",
            "password",
            "entra_subject",
        ]

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
        instance = super().update(instance, data)
        if password:
            instance.set_password(password)
            instance.save(update_fields=["password"])
        return instance


class CourseSerializer(serializers.ModelSerializer):
    can_manage = serializers.SerializerMethodField()
    package = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()
    enrolled_count = serializers.IntegerField(
        source="enrollments.count", read_only=True
    )

    class Meta:
        model = Course
        fields = [
            "id",
            "title",
            "description",
            "category",
            "duration_minutes",
            "published",
            "blocks",
            "package",
            "progress",
            "enrolled_count",
            "created_at",
            "can_manage",
        ]

    def get_can_manage(self, obj):
        user = self.context["request"].user
        return user.role == "admin" or (
            user.role == "instructor" and obj.owner_id == user.id
        )

    def get_package(self, obj):
        package = obj.packages.order_by("-created_at").first()
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
        row = obj.enrollments.filter(user=self.context["request"].user).first()
        return row.progress if row else None

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
            ):
                raise serializers.ValidationError(
                    translate("Invalid content block format.")
                )
        return blocks


class QuestionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Question
        fields = [
            "id",
            "description",
            "type",
            "options",
            "solution",
            "points",
            "position",
        ]

    def validate(self, data):
        kind = data.get("type", getattr(self.instance, "type", "single"))
        options = data.get("options", getattr(self.instance, "options", []))
        solution = data.get("solution", getattr(self.instance, "solution", []))
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
        if kind == "short" and (
            not solution or not all(isinstance(v, str) and v.strip() for v in solution)
        ):
            raise serializers.ValidationError(
                translate("Short-answer questions need at least one accepted answer.")
            )
        return data


class BankQuestionSerializer(QuestionSerializer):
    class Meta:
        model = BankQuestion
        fields = [
            "id",
            "description",
            "type",
            "options",
            "solution",
            "points",
            "category",
            "archived",
            "updated_at",
        ]
        read_only_fields = ["updated_at"]


class ExamSerializer(serializers.ModelSerializer):
    questions = QuestionSerializer(many=True, required=False)
    question_count = serializers.SerializerMethodField()
    attempts_used = serializers.SerializerMethodField()
    effective_attempt_limit = serializers.SerializerMethodField()
    attempts_remaining = serializers.SerializerMethodField()
    active_attempt_id = serializers.SerializerMethodField()
    can_manage = serializers.SerializerMethodField()

    class Meta:
        model = Exam
        fields = [
            "id",
            "title",
            "description",
            "course",
            "duration_minutes",
            "max_attempts",
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
            "audience",
            "allowed_users",
            "allowed_departments",
            "can_manage",
            "shuffle_questions",
            "shuffle_options",
            "questions_per_attempt",
        ]

    def get_can_manage(self, obj):
        user = self.context["request"].user
        return user.role == "admin" or (
            user.role == "instructor" and obj.owner_id == user.id
        )

    def get_question_count(self, obj):
        return obj.questions_per_attempt or obj.questions.count()

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
        return max(
            0, self.get_effective_attempt_limit(obj) - self.get_attempts_used(obj)
        )

    def get_active_attempt_id(self, obj):
        from django.utils import timezone
        from .models import Attempt

        if hasattr(obj, "active_user_attempts"):
            return (
                str(obj.active_user_attempts[0].pk)
                if obj.active_user_attempts
                else None
            )
        row = Attempt.objects.filter(
            exam=obj,
            identity__user=self.context["request"].user,
            status="in_progress",
            deadline__gt=timezone.now(),
        ).first()
        return str(row.pk) if row else None

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
        course = data.get("course")
        user = self.context["request"].user
        if course and user.role != "admin" and course.owner_id != user.id:
            raise serializers.ValidationError(translate("You cannot link this course."))
        return data

    def create(self, data):
        questions = data.pop("questions", [])
        people = data.pop("allowed_users", [])
        exam = Exam.objects.create(**data)
        exam.allowed_users.set(people)
        for q in questions:
            Question.objects.create(exam=exam, **q)
        return exam

    def update(self, instance, data):
        questions = data.pop("questions", None)
        instance = super().update(instance, data)
        if questions is not None:
            instance.questions.all().delete()
            for q in questions:
                Question.objects.create(exam=instance, **q)
        return instance

    def to_representation(self, obj):
        data = super().to_representation(obj)
        if not self.get_can_manage(obj):
            data.pop("questions", None)
            data.pop("allowed_users", None)
            data.pop("allowed_departments", None)
        return data


class InvitationSerializer(serializers.ModelSerializer):
    identity_key = serializers.CharField(source="identity.key", read_only=True)
    exam_title = serializers.CharField(source="exam.title", read_only=True)

    class Meta:
        model = Invitation
        fields = [
            "id",
            "exam",
            "exam_title",
            "identity_key",
            "max_attempts",
            "used",
            "expires_at",
            "revoked",
            "created_at",
            "require_email_verification",
            "verification_email",
        ]
