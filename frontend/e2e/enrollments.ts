import { expect, type Browser, type Page } from "@playwright/test";

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

export async function enrollmentWorkflow(page: Page, browser: Browser) {
  const title = `Enrollment review ${Date.now()}`;
  const username = `applicant-${Date.now()}`;
  const password = "Local-enrollment-browser-2026!";
  const person = "Taylor Enrollment";
  await post(page, "users/", {
    username,
    email: `${username}@example.com`,
    password,
    display_name: person,
    role: "learner",
    department: "Operations",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/courses");
  await page
    .getByRole("button", { name: "Create course", exact: true })
    .click();
  await page.getByLabel("Course title", { exact: true }).fill(title);
  await page.getByRole("radio", { name: "Text lesson", exact: true }).check();
  await page.getByLabel("Block 2 content").fill("Approval-only lesson content");
  await page.getByLabel("Visible to learners").check();
  await page.getByRole('dialog').locator('summary').filter({ hasText: 'More options' }).click();
  await page.getByLabel("Require approval").check();
  await page.getByRole("button", { name: "Save course", exact: true }).click();
  const card = page.locator(".course-card").filter({ hasText: title });
  await expect(card).toBeVisible();
  const courses = await (await page.request.get("/api/courses/")).json();
  const course = courses.find(
    (item: { title: string }) => item.title === title,
  );

  const context = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  const learner = await context.newPage();
  try {
    await learner.goto("/");
    await expect(
      learner.getByLabel("Email, username or employee ID"),
    ).toBeVisible();
    await post(learner, "auth/login/", { identifier: username, password });
    await learner.goto("/courses");
    const learnerCard = learner
      .locator(".course-card")
      .filter({ hasText: title });
    await learnerCard
      .getByRole("button", { name: "Request enrollment", exact: true })
      .click();
    const access = learner.getByRole("dialog");
    await expect(
      access.getByText("Approval required", { exact: true }),
    ).toBeVisible();
    await access
      .getByLabel("Request note")
      .fill("Required for the Operations team\nPlease review my request.");
    for (const locale of ["zh-TW", "es", "en"]) {
      await access.locator(".language-picker select").selectOption(locale);
      await expect(access.locator("textarea")).toHaveValue(
        "Required for the Operations team\nPlease review my request.",
      );
    }
    await access
      .getByRole("button", { name: "Request enrollment", exact: true })
      .click();
    await expect(
      access.getByText("Awaiting approval", { exact: true }),
    ).toBeVisible();
    await expect(
      learner.getByText("Approval-only lesson content", { exact: true }),
    ).toHaveCount(0);
    const privateCourse = await (
      await learner.request.get(`/api/courses/${course.id}/`)
    ).json();
    expect(privateCourse.blocks).toEqual([]);
    await learner.reload();
    await learnerCard
      .getByRole("button", { name: "View enrollment", exact: true })
      .click();
    await expect(
      access.getByText("Awaiting approval", { exact: true }),
    ).toBeVisible();

    await card
      .getByRole("button", { name: `Manage enrollments for ${title}` })
      .click();
    const roster = page.getByRole("dialog");
    await expect(roster.getByText(person, { exact: true })).toBeVisible();
    await roster
      .getByRole("button", { name: "Reject enrollment", exact: true })
      .click();
    await roster
      .getByLabel("Decision note")
      .fill("Please add your project name.");
    await roster
      .getByRole("button", { name: "Save decision", exact: true })
      .click();
    await expect(roster.getByText("Enrollment decision saved.")).toBeVisible();
    await access
      .getByRole("button", { name: "Refresh status", exact: true })
      .click();
    await expect(
      access.getByText("Enrollment rejected", { exact: true }),
    ).toBeVisible();
    await expect(
      access.getByText("Please add your project name."),
    ).toBeVisible();
    await access
      .getByLabel("Request note")
      .fill("Project: Operations onboarding");
    await access
      .getByRole("button", { name: "Request enrollment again", exact: true })
      .click();
    await expect(
      access.getByText("Awaiting approval", { exact: true }),
    ).toBeVisible();
    await roster.getByRole("button", { name: "Refresh", exact: true }).click();
    await roster
      .getByRole("button", { name: "Approve enrollment", exact: true })
      .click();
    await roster.getByLabel("Decision note").fill("Approved for onboarding.");
    for (const locale of ["zh-TW", "es", "en"]) {
      await roster.locator(".language-picker select").selectOption(locale);
      await expect(roster.locator("textarea")).toHaveValue(
        "Approved for onboarding.",
      );
    }
    // A committed response can be retried from the same review form.
    let lost = false;
    await page.route(
      `**/api/courses/${course.id}/enrollments/*/review/`,
      async (route) => {
        if (lost) {
          await route.continue();
          return;
        }
        lost = true;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort("failed");
      },
    );
    await roster
      .getByRole("button", { name: "Save decision", exact: true })
      .click();
    await expect(roster.getByRole("alert")).toBeVisible();
    await roster
      .getByRole("button", { name: "Save decision", exact: true })
      .click();
    await expect(roster.getByText("Enrollment decision saved.")).toBeVisible();
    await page.unroute(`**/api/courses/${course.id}/enrollments/*/review/`);
    await roster.getByLabel("Enrollment status").selectOption("approved");
    await expect(roster.getByText(person, { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await roster.locator(".language-picker select").selectOption("zh-TW");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    expect(
      await roster.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: "/tmp/training-enrollment-mobile.png",
      fullPage: false,
    });
    await roster.locator(".language-picker select").selectOption("en");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: "/tmp/training-enrollment-review.png",
      fullPage: true,
    });

    await access
      .getByRole("button", { name: "Refresh status", exact: true })
      .click();
    await expect(
      access.getByText("Enrollment approved", { exact: true }),
    ).toBeVisible();
    await access
      .getByRole("button", { name: "Start learning", exact: true })
      .click();
    await expect(
      learner.getByText("Approval-only lesson content", { exact: true }),
    ).toBeVisible();
    await learner
      .getByRole("button", { name: "Mark as completed", exact: true })
      .click();
    await expect(
      learner.getByRole("button", { name: "Learning completed", exact: true }),
    ).toBeDisabled();
    await learner.getByRole("button", { name: "Close", exact: true }).click();
    await roster
      .getByRole("button", { name: "Remove enrollment", exact: true })
      .click();
    await roster
      .getByLabel("Decision note")
      .fill("Training access period ended.");
    await roster
      .getByRole("button", { name: "Save decision", exact: true })
      .click();
    await expect(roster.getByText("Enrollment decision saved.")).toBeVisible();
    await learner.reload();
    await learnerCard
      .getByRole("button", { name: "View enrollment", exact: true })
      .click();
    await expect(
      access.getByText("Enrollment removed", { exact: true }),
    ).toBeVisible();
    await expect(
      access.getByRole("button", { name: "Request enrollment", exact: true }),
    ).toHaveCount(0);
    const removed = await (
      await learner.request.get(`/api/courses/${course.id}/`)
    ).json();
    expect(removed.progress).toBe(100);
    expect(removed.blocks).toEqual([]);
    await roster.getByLabel("Enrollment status").selectOption("removed");
    await roster
      .getByRole("button", { name: "Approve enrollment", exact: true })
      .click();
    await roster
      .getByRole("button", { name: "Save decision", exact: true })
      .click();
    await expect(roster.getByText("Enrollment decision saved.")).toBeVisible();
    await access
      .getByRole("button", { name: "Refresh status", exact: true })
      .click();
    await expect(
      access.getByRole("button", { name: "Start learning", exact: true }),
    ).toBeVisible();
    const restored = await (
      await learner.request.get(`/api/courses/${course.id}/`)
    ).json();
    expect(restored.enrollment.completed_at).toBe(
      removed.enrollment.completed_at,
    );
    await roster.getByRole("button", { name: "Close", exact: true }).click();
  } finally {
    await context.close();
  }
}
