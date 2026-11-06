import os
import random
from datetime import timedelta
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from training.models import (
    User,
    Course,
    Enrollment,
    Exam,
    Question,
    Attempt,
    AttemptBudget,
)
from training.services import identity_for_user, grade


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
            "admin@evitina.example",
            password,
            display_name="林以安",
            department="人才發展部",
            role="admin",
            employee_id="E0001",
        )
        identity_for_user(admin)
        departments = [
            "產品研發部",
            "業務行銷部",
            "營運管理部",
            "人才發展部",
            "客戶成功部",
        ]
        names = [
            "陳品蓁",
            "林柏宇",
            "黃思妤",
            "張承翰",
            "李佳穎",
            "王子豪",
            "吳宜庭",
            "劉哲維",
            "蔡雨彤",
            "楊家豪",
            "許雅婷",
            "鄭冠廷",
            "謝欣怡",
            "郭彥廷",
            "洪詩涵",
            "曾宥廷",
            "邱奕辰",
            "廖婉婷",
            "賴冠宇",
            "徐若晴",
            "周柏安",
            "葉子涵",
            "蘇家寧",
            "潘宇軒",
        ]
        people = []
        for i, name in enumerate(names):
            u = User.objects.create_user(
                f"demo.learner{i + 1}",
                f"learner{i + 1}@evitina.example",
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
                "資訊安全與個人資料保護",
                "必修通識",
                "從日常工作出發，建立資訊安全意識，保護企業與個人的重要資料。",
                45,
            ),
            (
                "新夥伴入職指南",
                "新人培訓",
                "認識團隊文化、工作流程與協作工具，展開您的新旅程。",
                30,
            ),
            (
                "高效溝通與跨部門協作",
                "職場技能",
                "練習清晰表達與主動聆聽，讓每一次合作更加順暢。",
                60,
            ),
            (
                "Microsoft 365 工作實踐",
                "數位工具",
                "掌握 Teams、SharePoint 與文件協作，打造有條理的數位工作方式。",
                40,
            ),
            (
                "職場倫理與合規意識",
                "必修通識",
                "建立正確的職場判斷，了解保密、利益衝突及通報原則。",
                35,
            ),
            (
                "客戶體驗與服務設計",
                "專業成長",
                "站在客戶的角度思考，用具體的服務方法創造更好的體驗。",
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
                        {"type": "heading", "text": "從日常工作開始的學習"},
                        {
                            "type": "text",
                            "text": description
                            + "\n\n請先思考自己在工作中遇過的情境，帶著問題開始這次學習。",
                        },
                        {"type": "heading", "text": "今天的三個行動"},
                        {
                            "type": "text",
                            "text": "1. 認識公司既有的規範與流程。\n2. 與同事分享一個實際案例。\n3. 訂下可以在本週實踐的小目標。",
                        },
                        {
                            "type": "callout",
                            "text": "這是示範教材。正式發布前，請由公司講師補充實際內容與學習標準。",
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
                "資訊安全年度評量",
                "新人入職知識檢核",
                "跨部門協作能力評量",
                "合作夥伴合規測驗",
            ]
        ):
            exam = Exam.objects.create(
                title=title,
                description="請閱讀各題情境，選擇最符合公司工作原則的答案。",
                owner=admin,
                course=courses[0] if i == 0 else None,
                duration_minutes=30,
                max_attempts=3,
                pass_score=70,
                published=True,
            )
            Question.objects.create(
                exam=exam,
                description="收到要求提供公司帳號密碼的不明郵件時，應如何處理？",
                options=[
                    "直接回覆郵件",
                    "依公司流程向資訊窗口回報",
                    "轉寄給所有同事",
                    "點擊郵件中的連結確認",
                ],
                solution=[1],
                points=40,
                position=0,
            )
            Question.objects.create(
                exam=exam,
                description="以下哪些行為有助於安全協作？（複選）",
                type="multiple",
                options=[
                    "使用核准的共享空間",
                    "僅授權必要的人員",
                    "將密碼寫在公開文件",
                    "定期檢查存取權限",
                ],
                solution=[0, 1, 3],
                points=40,
                position=1,
            )
            Question.objects.create(
                exam=exam,
                description="請描述一個您會如何改善團隊溝通的具體做法。",
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
                    ): "先確認共同目標，再以書面記錄會議結論與分工。",
                },
                manual_grades={}
                if i >= 95
                else {
                    str(snapshot[2]["id"]): {
                        "points": rng.choice([8, 12, 16, 20]),
                        "feedback": "已提出具體可行的做法。",
                    }
                },
            )
            grade(attempt)
            attempt.save()
            Attempt.objects.filter(pk=attempt.pk).update(started_at=when)
        self.stdout.write(
            "Synthetic demo ready. Admin: admin@evitina.example; learner: learner1@evitina.example. Password comes from DEMO_PASSWORD."
        )
