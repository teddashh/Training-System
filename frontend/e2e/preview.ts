import { expect, type Page } from "@playwright/test";

export async function previewWorkflow(page: Page) {
  async function request(path: string, method = "GET", data?: unknown) {
    return page.evaluate(
      async ({ path, method, data }) => {
        const csrf =
          document.cookie
            .split("; ")
            .find((v) => /^(?:__Host-)?training_csrf=/.test(v))
            ?.split("=")[1] || "";
        const response = await fetch(`/api/${path}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": decodeURIComponent(csrf),
          },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
        if (!response.ok) throw new Error(await response.text());
        return response.status === 204 ? null : response.json();
      },
      { path, method, data },
    );
  }
  const title = `Private preview ${Date.now()}`;
  const exam = await request("exams/", "POST", {
    title,
    published: false,
    max_attempts: 1,
    duration_minutes: 5,
    allow_skip: false,
    allow_response_review: false,
    shuffle_options: true,
    ends_at: new Date(Date.now() - 86400000).toISOString(),
    questions: [
      {
        description: "Preview choice",
        type: "single",
        options: ["Report safely", "Share credentials"],
        solution: [0],
        points: 10,
      },
      {
        description: "Explain the preview procedure",
        type: "essay",
        options: [],
        solution: [],
        points: 10,
      },
    ],
  });
  await page.goto("/exams");
  await page
    .getByRole("button", { name: `Preview ${title}`, exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await expect(modal.locator(".preview-question")).toHaveCount(2);
  await modal
    .getByRole("checkbox", { name: "Show accepted answers", exact: true })
    .check();
  await expect(modal.locator(".accepted-answer").first()).toHaveText(
    "Report safely",
  );
  await modal.locator(".language-picker select").selectOption("es");
  await expect(
    modal.getByRole("button", { name: "Iniciar simulación", exact: true }),
  ).toBeVisible();
  await expect(
    modal.getByRole("checkbox", {
      name: "Mostrar respuestas aceptadas",
      exact: true,
    }),
  ).toBeChecked();
  await modal.locator(".language-picker select").selectOption("zh-TW");
  await expect(
    modal.getByRole("button", { name: "開始不限時測試", exact: true }),
  ).toBeVisible();
  await modal.locator(".language-picker select").selectOption("en");
  await modal
    .getByRole("button", { name: "Start learner simulation", exact: true })
    .click();
  await expect(
    modal.getByText(
      "Learner simulation requires an open, published exam. Use an untimed test for drafts or closed exams.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await modal.screenshot({ path: "/tmp/training-preview-dialog-mobile.png" });
  await modal
    .getByRole("button", { name: "Start untimed test", exact: true })
    .click();
  await expect(page.locator(".exam-timer strong")).toHaveText("Untimed");
  await expect(
    page.getByRole("heading", { name: "Preview choice", exact: true }),
  ).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await expect(
    page.getByRole("button", { name: "Go to question 2", exact: true }),
  ).toBeDisabled();
  await page.getByRole("radio", { name: /Report safely/ }).check();
  await page
    .getByRole("button", { name: "Next question", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Your answer", exact: true })
    .fill("Private practice response");
  await expect(page.getByRole("status")).toContainText(
    "Answers saved automatically",
  );
  await page.locator(".language-picker select").selectOption("es");
  await expect(page.locator(".preview-banner strong")).toHaveText(
    "Prueba sin límite de tiempo",
  );
  await expect(page.locator("textarea")).toHaveValue(
    "Private practice response",
  );
  await page.locator(".language-picker select").selectOption("en");
  await page.reload();
  await expect(
    page.getByRole("radio", { name: /Report safely/ }),
  ).toBeChecked();
  await page
    .getByRole("button", { name: "Back to exams", exact: true })
    .click();
  await page
    .getByRole("button", { name: `Preview ${title}`, exact: true })
    .click();
  await expect(modal.locator(".preview-session")).toHaveCount(1);
  await modal
    .getByRole("button", { name: "Open preview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Go to question 2", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Your answer", exact: true }),
  ).toHaveValue("Private practice response");
  await page
    .getByRole("button", { name: "Finish and submit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm submission", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Submitted, awaiting instructor review",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".response-item")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Inspect test result", exact: true })
    .click();
  await expect(
    modal.getByText("Private practice response", { exact: true }),
  ).toBeVisible();
  await modal.getByRole("spinbutton", { name: "Score", exact: true }).fill("9");
  await modal
    .getByRole("textbox", { name: "Feedback", exact: true })
    .fill("Preview feedback only");
  await modal
    .getByRole("button", { name: "Save grades & feedback", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator(".result-score")).toContainText("95");
  await expect(
    page.getByText("Preview feedback only", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "/tmp/training-preview-result-mobile.png",
    fullPage: true,
  });
  const trial = await request(`previews/${id}/`);
  expect(trial.answers).toEqual({});
  expect(trial.preview_mode).toBe("unrestricted");
  expect((await request(`exams/${exam.id}/`)).attempts_used).toBe(0);
  expect(await request(`results/?exam=${exam.id}`)).toEqual([]);
  await request(`exams/${exam.id}/`, "PATCH", {
    published: true,
    ends_at: null,
  });
  await page
    .getByRole("button", { name: "Back to exams", exact: true })
    .click();
  await page
    .getByRole("button", { name: `Preview ${title}`, exact: true })
    .click();
  await modal
    .getByRole("button", { name: "Delete preview", exact: true })
    .click();
  await expect(modal.locator(".preview-session")).toHaveCount(0);
  await modal
    .getByRole("button", { name: "Start learner simulation", exact: true })
    .click();
  await expect(page.locator(".preview-banner strong")).toHaveText(
    "Learner simulation",
  );
  await expect(page.locator(".exam-timer strong")).toHaveText(/0[45]:\d{2}/);
  await expect(
    page.getByRole("button", { name: "Next question", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Back to exams", exact: true })
    .click();
  await page
    .getByRole("button", { name: `Preview ${title}`, exact: true })
    .click();
  await modal
    .getByRole("button", { name: "Delete preview", exact: true })
    .click();
  await expect(modal.locator(".preview-session")).toHaveCount(0);
  expect((await request(`exams/${exam.id}/`)).attempts_used).toBe(0);
  await page.setViewportSize({ width: 1280, height: 900 });
}
