from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from .models import User, Course, Exam, Question, Invitation


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
                raise serializers.ValidationError({field: "此登入識別碼已被使用。"})
        if self.instance and any(
            field in data and data[field] != getattr(self.instance, field)
            for field in ("username", "email", "employee_id")
        ):
            raise serializers.ValidationError(
                "登入識別碼建立後不可透過此 API 變更，避免歷史次數歸戶錯誤。"
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
        ]

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
            raise serializers.ValidationError("教材最多 100 個區塊。")
        for block in blocks:
            if (
                not isinstance(block, dict)
                or block.get("type") not in ("heading", "text", "callout")
                or not isinstance(block.get("text"), str)
                or len(block["text"]) > 20000
            ):
                raise serializers.ValidationError("教材區塊格式不正確。")
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
        kind = data.get("type", "single")
        options, solution = data.get("options", []), data.get("solution", [])
        if not isinstance(options, list) or not all(
            isinstance(v, str) and len(v) <= 4000 for v in options
        ):
            raise serializers.ValidationError("選項格式不正確。")
        if not isinstance(solution, list) or not data.get("points", 10) > 0:
            raise serializers.ValidationError("答案或配分不正確。")
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
                    "請設定至少兩個選項及有效的正確答案索引。"
                )
        if kind == "short" and (
            not solution or not all(isinstance(v, str) and v.strip() for v in solution)
        ):
            raise serializers.ValidationError("簡答題需要至少一個標準答案。")
        return data


class ExamSerializer(serializers.ModelSerializer):
    questions = QuestionSerializer(many=True, required=False)
    question_count = serializers.IntegerField(source="questions.count", read_only=True)
    attempts_used = serializers.SerializerMethodField()

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
        ]

    def get_attempts_used(self, obj):
        from .models import AttemptBudget

        row = AttemptBudget.objects.filter(
            exam=obj, identity__user=self.context["request"].user
        ).first()
        return row.used if row else 0

    def validate(self, data):
        if (
            data.get("duration_minutes", 1) < 1
            or data.get("max_attempts", 1) < 1
            or data.get("pass_score", 0) > 100
        ):
            raise serializers.ValidationError("時間、次數或及格標準不正確。")
        start = data.get("starts_at", getattr(self.instance, "starts_at", None))
        end = data.get("ends_at", getattr(self.instance, "ends_at", None))
        if start and end and start >= end:
            raise serializers.ValidationError("結束時間必須晚於開始時間。")
        questions = data.get("questions")
        if questions is not None and len(questions) > 200:
            raise serializers.ValidationError("每份試卷最多 200 題。")
        published = data.get("published", getattr(self.instance, "published", False))
        if published and not (
            questions
            if questions is not None
            else self.instance and self.instance.questions.exists()
        ):
            raise serializers.ValidationError("發布前請先建立題目。")
        course = data.get("course")
        user = self.context["request"].user
        if course and user.role != "admin" and course.owner_id != user.id:
            raise serializers.ValidationError("無權綁定此課程。")
        return data

    def create(self, data):
        questions = data.pop("questions", [])
        exam = Exam.objects.create(**data)
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
        user = self.context["request"].user
        if user.role != "admin" and obj.owner_id != user.id:
            data.pop("questions", None)
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
        ]
