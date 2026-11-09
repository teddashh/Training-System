import { readFile } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";

async function post<T>(page: Page, path: string, data: unknown): Promise<T> {
  return page.evaluate(
    async ({ path, data }) => {
      const cookie = document.cookie
        .split("; ")
        .find((v) => /^(?:__Host-)?training_csrf=/.test(v));
      const response = await fetch(`/api/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": decodeURIComponent(cookie?.split("=")[1] || ""),
        },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    { path, data },
  );
}

type Paper = {
  id: string;
  questions: { id: number; type: string }[];
  answer_revision: number;
  grading_revision: number;
  score: number | null;
  number: number;
  manual_grades: Record<string, { points: number; feedback: string }>;
};
function csv(papers: Paper[], scores: number[][], prefix: string) {
  const rows: unknown[][] = [
    [
      "attempt_id",
      "question_id",
      "answer_revision",
      "grading_revision",
      "points",
      "feedback",
    ],
  ];
  papers.forEach((paper, index) =>
    paper.questions.forEach((q, qi) =>
      rows.push([
        paper.id,
        q.id,
        paper.answer_revision,
        paper.grading_revision,
        scores[index][qi],
        `${prefix} ${index + 1}/${qi + 1}, reviewed\nSecond line`,
      ]),
    ),
  );
  return rows
    .map((row) =>
      row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","),
    )
    .join("\r\n");
}

// Shares the reporting test's manager session, keeping the suite at 20 logins.
export async function marksImportWorkflow(page: Page, browser: Browser) {
  const title = `Marks moderation ${Date.now()}`;
  const key = `marks-${Date.now()}@example.com`;
  const exam = await post<{ id: number }>(page, "exams/", {
    title,
    published: true,
    max_attempts: 1,
    questions: [
      {
        type: "single",
        description: "Select the safe response",
        points: 10,
        options: ["Unsafe", "Safe"],
        solution: [1],
      },
      {
        type: "essay",
        description: "Explain the reporting procedure",
        points: 10,
        options: [],
        solution: [],
      },
    ],
  });
  const account = await post<Paper>(page, `exams/${exam.id}/start/`, {});
  const savedAccount = await post<Paper>(page, `attempts/${account.id}/`, {
    answer_revision: 0,
    answers: Object.fromEntries(
      account.questions.map((q) => [
        String(q.id),
        q.type === "essay" ? "Employee response" : 0,
      ]),
    ),
  });
  const link = await post<{ url: string }>(page, "invitations/issue/", {
    exam: exam.id,
    key,
    days: 1,
    max_attempts: 1,
  });
  const context = await browser.newContext();
  const guest = await context.newPage();
  const reviewer = await page.context().newPage();
  try {
    await guest.goto(link.url);
    await guest
      .getByRole("button", { name: "Start / resume exam", exact: true })
      .click();
    await expect(guest).toHaveURL(/\/attempt\//);
    const id = new URL(guest.url()).pathname.split("/").pop()!;
    const active = (await (
      await guest.request.get(`/api/attempts/${id}/`)
    ).json()) as Paper;
    const savedGuest = await post<Paper>(guest, `attempts/${id}/`, {
      answer_revision: active.answer_revision,
      answers: Object.fromEntries(
        active.questions.map((q) => [
          String(q.id),
          q.type === "essay" ? "Guest response" : 0,
        ]),
      ),
    });
    await guest.reload();
    await expect(
      guest.getByRole("heading", {
        name: "Submitted, awaiting instructor review",
        exact: true,
      }),
    ).toBeVisible();
    const open = async (target: Page) => {
      await target.goto("/exams");
      await target
        .getByRole("button", { name: `Monitor ${title}`, exact: true })
        .click();
      return target.getByRole("dialog", {
        name: "Live exam monitor",
        exact: true,
      });
    };
    await open(reviewer);
    const guestRow = reviewer
      .locator(".monitor-attempt")
      .filter({ hasText: key });
    await guestRow
      .getByRole("button", { name: "Review submission", exact: true })
      .click();
    const oldReview = reviewer.getByRole("dialog", {
      name: "Review attempt",
      exact: true,
    });
    await oldReview.getByLabel("Score", { exact: true }).fill("4");
    await oldReview
      .getByLabel("Feedback", { exact: true })
      .fill("Stale reviewer comment");
    const monitor = await open(page);
    await monitor
      .getByRole("button", { name: "Import marks", exact: true })
      .click();
    let dialog = page.getByRole("dialog", {
      name: "Import marks",
      exact: true,
    });
    const downloading = page.waitForEvent("download");
    await dialog
      .getByRole("button", { name: "Download marks template", exact: true })
      .click();
    const downloaded = await downloading;
    const template = await readFile((await downloaded.path())!, "utf8");
    expect(template).toContain(
      "grading_revision,points,feedback,clear_feedback",
    );
    expect(template).toContain(savedAccount.id);
    expect(template).toContain(savedGuest.id);
    const papers = [savedAccount, savedGuest];
    const content = csv(
      papers,
      [
        [6, 10],
        [6, 9],
      ],
      "Imported feedback",
    );
    const invalid = csv(
      papers,
      [
        [6, 100],
        [6, 9],
      ],
      "Invalid feedback",
    );
    await dialog.getByLabel("Marks CSV file", { exact: true }).setInputFiles({
      name: "marks.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(invalid),
    });
    await dialog
      .getByRole("textbox", { name: "Reason for marks import", exact: true })
      .fill("Offline moderation");
    await dialog
      .getByRole("button", { name: "Preview mark changes", exact: true })
      .click();
    await expect(
      dialog.getByText(
        "No marks were changed. Correct every error and preview again.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      (
        await (
          await page.request.get(`/api/results/${account.id}/review/`)
        ).json()
      ).grading_revision,
    ).toBe(0);
    await dialog.getByLabel("Marks CSV file", { exact: true }).setInputFiles({
      name: "marks.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(content),
    });
    await dialog.locator(".language-picker select").selectOption("zh-TW");
    const zh = page.getByRole("dialog", { name: "匯入評分", exact: true });
    await expect(
      zh.getByRole("textbox", { name: "評分 CSV 內容", exact: true }),
    ).toHaveValue(content.replaceAll("\r\n", "\n"));
    await expect(
      zh.getByRole("textbox", { name: "匯入評分原因", exact: true }),
    ).toHaveValue("Offline moderation");
    await zh.locator(".language-picker select").selectOption("es");
    const es = page.getByRole("dialog", {
      name: "Importar calificaciones",
      exact: true,
    });
    await expect(
      es.getByRole("textbox", {
        name: "Motivo de la importación",
        exact: true,
      }),
    ).toHaveValue("Offline moderation");
    await es.locator(".language-picker select").selectOption("en");
    await dialog
      .getByRole("button", { name: "Preview mark changes", exact: true })
      .click();
    await expect(
      dialog.getByText(
        "4 question changes across 2 attempts; 0 unchanged rows skipped.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(dialog.locator(".marks-changes article")).toHaveCount(4);
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.locator(".language-picker select").selectOption("es");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("marks-preview-mobile-es.png"),
    });
    await es.locator(".language-picker select").selectOption("en");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: test.info().outputPath("marks-preview-desktop.png"),
    });
    let appliedId = "",
      applies = 0;
    await page.route(
      `**/api/exams/${exam.id}/marks/imports/*/`,
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        const response = await route.fetch();
        const receipt = await response.json();
        if (++applies === 1) {
          expect(response.status()).toBe(200);
          expect(receipt.status).toBe("applied");
          appliedId = receipt.id;
          await route.abort("failed");
        } else await route.fulfill({ response });
      },
    );
    await dialog
      .getByRole("button", { name: "Apply reviewed marks", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Retry saved import", exact: true }),
    ).toBeEnabled();
    await page.reload();
    await page
      .getByRole("button", { name: `Monitor ${title}`, exact: true })
      .click();
    await monitor
      .getByRole("button", { name: "Import marks", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Import marks", exact: true });
    await expect(dialog.getByRole("status")).toHaveText(
      "Marks applied. This receipt preserves the changes made at that time; later grading may differ.",
    );
    await expect(
      dialog.getByRole("button", { name: "Apply reviewed marks", exact: true }),
    ).toHaveCount(0);
    await post(page, `exams/${exam.id}/marks/imports/${appliedId}/`, {});
    const currentGuest = (await (
      await page.request.get(`/api/results/${id}/review/`)
    ).json()) as Paper;
    const currentAccount = (await (
      await page.request.get(`/api/results/${account.id}/review/`)
    ).json()) as Paper;
    expect(currentGuest.grading_revision).toBe(1);
    expect(currentGuest.score).toBe(75);
    expect(currentAccount.score).toBe(80);
    await guest.reload();
    await expect(guest.locator(".result-score")).toContainText("75");
    await expect(
      guest.getByText("Imported feedback 2/1, reviewed\nSecond line", {
        exact: true,
      }),
    ).toBeVisible();
    await oldReview
      .getByRole("button", { name: "Save grades & feedback", exact: true })
      .click();
    await expect(oldReview.getByRole("alert")).toContainText(
      "The grades have changed. Reopen the review before saving.",
    );
    await oldReview
      .getByRole("button", { name: "Close", exact: true })
      .last()
      .click();
    await dialog
      .getByRole("button", { name: "New import", exact: true })
      .click();
    await dialog
      .getByRole("textbox", { name: "Marks CSV content", exact: true })
      .fill(
        csv(
          [currentAccount, currentGuest],
          [
            [10, 10],
            [10, 10],
          ],
          "Second import",
        ),
      );
    await dialog
      .getByRole("textbox", { name: "Reason for marks import", exact: true })
      .fill("Second moderation preview");
    await dialog
      .getByRole("button", { name: "Preview mark changes", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Apply reviewed marks", exact: true }),
    ).toBeEnabled();
    await guestRow
      .getByRole("button", { name: "Review submission", exact: true })
      .click();
    await expect(
      oldReview.getByText("Imported review · 6 / 10", { exact: true }),
    ).toBeVisible();
    await oldReview.getByLabel("Score", { exact: true }).fill("8");
    await oldReview
      .getByLabel("Feedback", { exact: true })
      .fill("New reviewer feedback");
    await oldReview
      .getByRole("button", { name: "Save grades & feedback", exact: true })
      .click();
    await expect(oldReview).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Apply reviewed marks", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "An attempt changed after preview. No marks were applied. Create a new preview.",
    );
    await expect(
      dialog.getByRole("button", { name: "Apply reviewed marks", exact: true }),
    ).toHaveCount(0);
    const accountAfter = (await (
      await page.request.get(`/api/results/${account.id}/review/`)
    ).json()) as Paper;
    expect(accountAfter.score).toBe(80);
    expect(accountAfter.grading_revision).toBe(1);
    const guestAfter = (await (
      await page.request.get(`/api/results/${id}/review/`)
    ).json()) as Paper;
    expect(guestAfter.score).toBe(70);
    expect(guestAfter.grading_revision).toBe(2);
    const receipt = await (
      await page.request.get(
        `/api/exams/${exam.id}/marks/imports/${appliedId}/`,
      )
    ).json();
    expect(
      receipt.outcomes.find(
        (value: { attempt_id: string }) => value.attempt_id === id,
      ).after.score,
    ).toBe(75);
    expect(
      receipt.changes.find(
        (value: { attempt_id: string; question_id: number }) =>
          value.attempt_id === id &&
          value.question_id === currentGuest.questions[1].id,
      ).after_feedback,
    ).toContain("Imported feedback");
    expect(guestAfter.number).toBe(1);
  } finally {
    await reviewer.close();
    await context.close();
  }
}
