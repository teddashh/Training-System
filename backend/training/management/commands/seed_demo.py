import os
import random
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from training.models import (
    Attempt,
    AttemptBudget,
    BankQuestion,
    Course,
    Enrollment,
    Exam,
    LearningAssignment,
    Question,
    User,
)
from training.services import grade, identity_for_user


class Command(BaseCommand):
    help = "Create explicitly synthetic demonstration data, only when DEBUG=true."

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("Demo data is disabled when DEBUG=false.")
        password = os.getenv("DEMO_PASSWORD")
        if not password or len(password) < 12:
            raise CommandError("Set DEMO_PASSWORD (at least 12 characters).")
        if User.objects.filter(username="demo.admin").exists():
            self.stdout.write("Demo data already exists; no changes made.")
            return
        rng = random.Random(27)
        admin = User.objects.create_superuser(
            "demo.admin",
            "admin@example.com",
            password,
            display_name="Alex Morgan",
            department="People & Development",
            role="admin",
            employee_id="E0001",
        )
        identity_for_user(admin)
        departments = [
            "Product & Engineering",
            "Sales & Marketing",
            "Operations",
            "People & Development",
            "Customer Success",
        ]
        names = [
            "Jamie Chen",
            "Taylor Lin",
            "Sofia Huang",
            "Jordan Chang",
            "Emma Lee",
            "Lucas Wang",
            "Olivia Wu",
            "Noah Liu",
            "Mia Tsai",
            "Ethan Yang",
            "Ava Hsu",
            "Leo Cheng",
            "Isabella Hsieh",
            "Daniel Kuo",
            "Amelia Hung",
            "Oliver Tseng",
            "Charlotte Chiu",
            "Henry Liao",
            "Harper Lai",
            "Grace Hsu",
            "Benjamin Chou",
            "Ella Yeh",
            "Emily Su",
            "William Pan",
        ]
        people = []
        for i, name in enumerate(names):
            u = User.objects.create_user(
                f"demo.learner{i + 1}",
                f"learner{i + 1}@example.com",
                password,
                display_name=name,
                department=departments[i % len(departments)],
                employment="contractor" if i % 4 == 0 else "employee",
                employee_id=f"E{i + 2:04d}",
            )
            identity_for_user(u)
            people.append(u)
        courses = []
        for title, category, description, minutes in [
            (
                "Information security & data privacy",
                "Core training",
                "Build practical security awareness and protect company and personal information in your daily work.",
                45,
            ),
            (
                "Welcome to the team",
                "Onboarding",
                "Explore our team culture, workflows and collaboration tools as you start your new role.",
                30,
            ),
            (
                "Communication & cross-team collaboration",
                "Workplace skills",
                "Practice clear communication and active listening to help every collaboration run smoothly.",
                60,
            ),
            (
                "Microsoft 365 in practice",
                "Digital tools",
                "Use Teams, SharePoint and shared documents to organize your digital workspace.",
                40,
            ),
            (
                "Workplace ethics & compliance",
                "Core training",
                "Build sound workplace judgment around confidentiality, conflicts of interest and reporting concerns.",
                35,
            ),
            (
                "Customer experience & service design",
                "Professional development",
                "Consider the customer perspective and apply practical service methods to improve their experience.",
                50,
            ),
        ]:
            courses.append(
                Course.objects.create(
                    title=title,
                    category=category,
                    description=description,
                    duration_minutes=minutes,
                    published=True,
                    owner=admin,
                    blocks=[
                        {"type": "heading", "text": "Learning through everyday work"},
                        {
                            "type": "text",
                            "text": description
                            + "\n\nThink of a situation from your own work and bring those questions to this lesson.",
                        },
                        {"type": "heading", "text": "Three actions for today"},
                        {
                            "type": "text",
                            "text": "1. Review the company guidelines and processes.\n2. Share a practical example with a colleague.\n3. Set a small goal you can put into practice this week.",
                        },
                        {
                            "type": "callout",
                            "text": "This is demonstration content. An instructor should add company-specific material and learning criteria before publication.",
                        },
                    ],
                )
            )
        for person in [admin] + people:
            for course in rng.sample(courses, 4):
                completed = rng.random() < 0.76
                Enrollment.objects.create(
                    user=person,
                    course=course,
                    progress=100 if completed else 0,
                    completed_at=timezone.now() - timedelta(days=rng.randint(1, 25))
                    if completed
                    else None,
                )
        exams = []
        for i, title in enumerate(
            [
                "Annual information security assessment",
                "New starter knowledge check",
                "Cross-team collaboration assessment",
                "Partner compliance assessment",
            ]
        ):
            exam = Exam.objects.create(
                title=title,
                description="Read each scenario and select the answer that best follows company working practices.",
                owner=admin,
                duration_minutes=30,
                max_attempts=3,
                pass_score=70,
                published=True,
            )
            if i == 0:
                exam.courses.add(courses[0])
            Question.objects.create(
                exam=exam,
                description="What should you do if an unexpected email asks for your company password?",
                options=[
                    "Reply to the email",
                    "Report it to IT through the approved process",
                    "Forward it to everyone",
                    "Click the link to investigate",
                ],
                solution=[1],
                points=40,
                position=0,
            )
            Question.objects.create(
                exam=exam,
                description="Which actions support secure collaboration? Select all that apply.",
                type="multiple",
                options=[
                    "Use approved shared workspaces",
                    "Grant access only to the people who need it",
                    "Write passwords in public documents",
                    "Review access permissions regularly",
                ],
                solution=[0, 1, 3],
                points=40,
                position=1,
            )
            Question.objects.create(
                exam=exam,
                description="Describe one practical way you would improve team communication.",
                type="essay",
                points=20,
                position=2,
            )
            exams.append(exam)
        for i in range(100):
            person = people[i % len(people)]
            exam = exams[(i // len(people)) % len(exams)]
            identity = identity_for_user(person)
            budget, _ = AttemptBudget.objects.get_or_create(
                exam=exam, identity=identity
            )
            budget.used += 1
            budget.save()
            snapshot = list(
                exam.questions.values(
                    "id", "description", "type", "options", "solution", "points"
                )
            )
            when = timezone.now() - timedelta(
                days=rng.randint(0, 29), hours=rng.randint(0, 12)
            )
            attempt = Attempt.objects.create(
                exam=exam,
                identity=identity,
                number=budget.used,
                snapshot=snapshot,
                pass_score=70,
                deadline=when + timedelta(minutes=30),
                submitted_at=when + timedelta(minutes=18),
                answers={
                    str(snapshot[0]["id"]): 1 if rng.random() < 0.87 else 0,
                    str(snapshot[1]["id"]): [0, 1, 3],
                    str(
                        snapshot[2]["id"]
                    ): "Agree on shared goals, then document meeting decisions and responsibilities.",
                },
                manual_grades={}
                if i >= 95
                else {
                    str(snapshot[2]["id"]): {
                        "points": rng.choice([8, 12, 16, 20]),
                        "feedback": "You proposed a practical action.",
                    }
                },
            )
            grade(attempt)
            attempt.save()
            Attempt.objects.filter(pk=attempt.pk).update(started_at=when)
        for index, person in enumerate([admin] + people):
            for offset in range(2):
                LearningAssignment.objects.create(
                    user=person,
                    course=courses[(index + offset) % len(courses)],
                    created_by=admin,
                    due_at=timezone.now()
                    + timedelta(days=-3 if index % 4 == 0 else 14),
                    notes="Complete this required training and discuss any questions with your team lead.",
                )
            LearningAssignment.objects.create(
                user=person,
                exam=exams[index % len(exams)],
                created_by=admin,
                due_at=timezone.now() + timedelta(days=7),
                notes="Achieve the passing score to fulfill this assessment requirement.",
            )
        for question in exams[0].questions.select_related("figure").defer("figure__data"):
            BankQuestion.objects.create(
                owner=admin,
                category="Security & collaboration",
                description=question.description,
                grading_guide=question.grading_guide,
                figure=question.figure,
                figure_alt=question.figure_alt,
                figure_caption=question.figure_caption,
                type=question.type,
                options=question.options,
                solution=question.solution,
                points=question.points,
            )
        self.stdout.write(
            "Synthetic demo ready. Admin: admin@example.com; learner: learner1@example.com. Password comes from DEMO_PASSWORD."
        )
