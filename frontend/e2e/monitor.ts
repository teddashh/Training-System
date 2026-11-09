import { expect, test, type Browser, type Page } from "@playwright/test";

async function post<T>(page: Page, path: string, data: unknown): Promise<T> {
  return page.evaluate(
    async ({ path, data }) => {
      const cookie = document.cookie
        .split("; ")
        .find((item) => /^(?:__Host-)?training_csrf=/.test(item));
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

// Reuses the already authenticated manager session; no extra sign-in allowance.
export async function monitorWorkflow(page: Page, browser: Browser) {
  const title = `Live monitoring ${Date.now()}`;
  const key = `monitored-${Date.now()}@example.com`;
  const exam = await post<{ id: number }>(page, "exams/", {
    title,
    published: true,
    duration_minutes: 2,
    max_attempts: 1,
    questions: [
      {
        type: "essay",
        description: "Explain the escalation procedure",
        points: 10,
        options: [],
        solution: [],
      },
    ],
  });
  const invitation = await post<{ url: string }>(page, "invitations/issue/", {
    exam: exam.id,
    key,
    max_attempts: 1,
    days: 1,
  });
  const context = await browser.newContext();
  const guest = await context.newPage();
  let release: (() => void) | undefined;
  try {
    await guest.clock.install();
    await guest.goto(invitation.url);
    await guest
      .getByRole("button", { name: "Start / resume exam", exact: true })
      .click();
    await expect(guest).toHaveURL(/\/attempt\//);
    const attemptId = new URL(guest.url()).pathname.split("/").pop()!;
    const endpoint = `**/api/attempts/${attemptId}/`;
    let patches = 0,
      submissions = 0;
    await guest.route(endpoint, async (route) => {
      if (route.request().method() === "POST") submissions++;
      if (route.request().method() === "PATCH" && ++patches === 1) {
        const response = await route.fetch();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        await route.fulfill({ response });
      } else await route.continue();
    });
    const answer = guest.getByRole("textbox", {
      name: "Your answer",
      exact: true,
    });
    await answer.fill("Saved first draft");
    await expect.poll(() => !!release).toBe(true);
    await answer.fill(
      "Preserved response: isolate the hazard and notify the supervisor.",
    );

    await page.goto("/exams");
    const openMonitor = async () => {
      await page
        .getByRole("button", { name: `Monitor ${title}`, exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Live exam monitor", exact: true }),
      ).toBeVisible();
    };
    await openMonitor();
    const monitor = page.getByRole("dialog", {
      name: "Live exam monitor",
      exact: true,
    });
    const row = monitor.locator(".monitor-attempt").filter({ hasText: key });
    await expect(
      row.getByText("1 / 1 answered", { exact: true }),
    ).toBeVisible();
    await expect(
      row.getByText("Recent contact", { exact: true }),
    ).toBeVisible();
    await monitor.getByLabel("Search participants").fill(key);
    await monitor.getByLabel("Attempt number", { exact: true }).fill("1");
    await monitor
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    await expect(row).toHaveCount(1);
    await row
      .getByRole("button", { name: "Inspect saved answers", exact: true })
      .click();
    const inspection = page.getByRole("dialog", {
      name: "Inspect saved answers",
      exact: true,
    });
    await expect(
      inspection.getByText("Saved first draft", { exact: true }),
    ).toBeVisible();
    await expect(
      inspection.getByText(
        "Preserved response: isolate the hazard and notify the supervisor.",
        { exact: true },
      ),
    ).toHaveCount(0);
    await expect(
      inspection.getByRole("button", { name: "Save grades & feedback" }),
    ).toHaveCount(0);
    await inspection
      .getByRole("button", { name: "Close", exact: true })
      .last()
      .click();
    await row
      .getByRole("button", { name: "Time extensions", exact: true })
      .click();
    let extension = page.getByRole("dialog", {
      name: "Time extensions",
      exact: true,
    });
    await extension.getByLabel("Extra minutes", { exact: true }).fill("5");
    await extension
      .getByLabel("Reason for extension", { exact: true })
      .fill("Recover from a network interruption.");
    await extension.locator(".language-picker select").selectOption("zh-TW");
    await expect(
      page
        .getByRole("dialog", { name: "延長作答時間", exact: true })
        .getByLabel("延長時間原因"),
    ).toHaveValue("Recover from a network interruption.");
    await page
      .getByRole("dialog", { name: "延長作答時間", exact: true })
      .locator(".language-picker select")
      .selectOption("es");
    await expect(
      page
        .getByRole("dialog", { name: "Ampliaciones de tiempo", exact: true })
        .getByLabel("Minutos adicionales"),
    ).toHaveValue("5");
    await page
      .getByRole("dialog", { name: "Ampliaciones de tiempo", exact: true })
      .locator(".language-picker select")
      .selectOption("en");
    let grants = 0;
    const requestIds: string[] = [];
    const extensionEndpoint = `**/api/attempts/${attemptId}/extensions/`;
    await page.route(extensionEndpoint, async (route) => {
      if (route.request().method() === "POST") {
        requestIds.push(route.request().postDataJSON().request_id);
        const response = await route.fetch();
        if (++grants === 1) {
          expect(response.status()).toBe(201);
          await route.abort("failed");
        } else await route.fulfill({ response });
      } else await route.continue();
    });
    await extension
      .getByRole("button", { name: "Grant extra time", exact: true })
      .click();
    await expect(
      extension.getByRole("button", {
        name: "Retry extension request",
        exact: true,
      }),
    ).toBeEnabled();
    // Recover the exact pending request even after a manager reload.
    await page.reload();
    await openMonitor();
    await row
      .getByRole("button", { name: "Time extensions", exact: true })
      .click();
    extension = page.getByRole("dialog", {
      name: "Time extensions",
      exact: true,
    });
    await expect(
      extension.getByLabel("Extra minutes", { exact: true }),
    ).toBeDisabled();
    await expect(
      extension.getByLabel("Extra minutes", { exact: true }),
    ).toHaveValue("5");
    await extension
      .getByRole("button", { name: "Retry extension request", exact: true })
      .click();
    await expect(extension.getByRole("status")).toHaveText(
      "Extra time granted: 5 minutes.",
    );
    expect(requestIds).toHaveLength(2);
    expect(requestIds[1]).toBe(requestIds[0]);
    await expect(extension.locator(".extension-record")).toHaveCount(1);
    await extension.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      row.getByText("Extra time granted: 5 minutes.", { exact: true }),
    ).toBeVisible();

    // Cross the original local deadline with a stale PATCH response in flight.
    // No automatic manual-submit request may be queued behind that save.
    await guest.clock.fastForward(130000);
    expect(submissions).toBe(0);
    release!();
    release = undefined;
    await guest.clock.runFor(1200);
    await expect(guest.getByRole("status")).toHaveText(
      "Answers saved automatically",
    );
    await expect(answer).toHaveValue(
      "Preserved response: isolate the hazard and notify the supervisor.",
    );
    await expect(answer).toBeEnabled();
    await expect(
      guest.getByText("Extra time granted: 5 minutes.", { exact: true }),
    ).toBeVisible();
    await expect(guest.locator(".exam-timer strong")).not.toHaveText("00:00");
    expect(submissions).toBe(0);
    const state = await (
      await guest.request.get(`/api/attempts/${attemptId}/`)
    ).json();
    expect(state.status).toBe("in_progress");
    expect(state.answer_revision).toBe(2);
    expect(state.extra_time_minutes).toBe(5);
    // A heartbeat changes contact time, never answer revisions.
    await guest.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await expect
      .poll(
        async () =>
          (
            await (
              await guest.request.get(`/api/attempts/${attemptId}/`)
            ).json()
          ).answer_revision,
      )
      .toBe(2);

    await page.setViewportSize({ width: 390, height: 844 });
    await monitor.locator(".language-picker select").selectOption("es");
    await expect(
      page.getByRole("dialog", {
        name: "Monitor de exámenes en vivo",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("monitor-mobile.png"),
      fullPage: false,
    });
    await page
      .getByRole("dialog", { name: "Monitor de exámenes en vivo", exact: true })
      .locator(".language-picker select")
      .selectOption("en");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: test.info().outputPath("monitor-desktop.png"),
      fullPage: false,
    });
    let failRefresh = true;
    await page.route(`**/api/exams/${exam.id}/monitor/**`, async (route) => {
      if (failRefresh)
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Temporary monitor outage" }),
        });
      else await route.continue();
    });
    await monitor.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      monitor.getByText(
        /Monitor update failed. Displayed data may be out of date./,
      ),
    ).toBeVisible();
    await expect(row).toBeVisible();
    failRefresh = false;
    await monitor.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(monitor.getByText(/Monitor update failed./)).toHaveCount(0);
    await guest
      .getByRole("button", { name: "Finish and submit", exact: true })
      .click();
    await guest
      .getByRole("button", { name: "Confirm submission", exact: true })
      .click();
    await expect(
      guest.getByRole("heading", {
        name: "Submitted, awaiting instructor review",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      row.getByText("Awaiting manual review", { exact: true }),
    ).toBeVisible({ timeout: 12000 });
    await row
      .getByRole("button", { name: "Review submission", exact: true })
      .click();
    await expect(
      page.getByText(
        "Preserved response: isolate the hazard and notify the supervisor.",
        { exact: true },
      ),
    ).toBeVisible();
    const history = await (
      await page.request.get(`/api/attempts/${attemptId}/extensions/`)
    ).json();
    expect(history.count).toBe(1);
    expect(history.results[0].reason).toBe(
      "Recover from a network interruption.",
    );
    expect(grants).toBe(2);

    const review = page.getByRole("dialog", {
      name: "Review attempt",
      exact: true,
    });
    await review.getByLabel("Score", { exact: true }).fill("8");
    await review
      .getByLabel("Feedback", { exact: true })
      .fill("Original assessment feedback");
    await review
      .getByRole("button", { name: "Save grades & feedback", exact: true })
      .click();
    await expect(review).toHaveCount(0);
    await expect(row.getByText("Graded", { exact: true })).toBeVisible();
    await row
      .getByRole("button", { name: "Reopen & history", exact: true })
      .click();
    let reopening = page.getByRole("dialog", {
      name: "Reopen & history",
      exact: true,
    });
    await reopening.getByLabel("Extra minutes", { exact: true }).fill("6");
    await reopening
      .getByLabel("Reason for reopening", { exact: true })
      .fill("Allow clarification after an interrupted submission.");
    await reopening.locator(".language-picker select").selectOption("zh-TW");
    await expect(
      page
        .getByRole("dialog", { name: "重新開放與歷程", exact: true })
        .getByLabel("重新開放原因"),
    ).toHaveValue("Allow clarification after an interrupted submission.");
    await page
      .getByRole("dialog", { name: "重新開放與歷程", exact: true })
      .locator(".language-picker select")
      .selectOption("es");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page
        .getByRole("dialog", { name: "Reabrir e historial", exact: true })
        .getByLabel("Motivo de la reapertura"),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("reopening-mobile-es.png"),
    });
    await page
      .getByRole("dialog", { name: "Reabrir e historial", exact: true })
      .locator(".language-picker select")
      .selectOption("en");
    await page.setViewportSize({ width: 1440, height: 1000 });
    let reopenRequests = 0;
    const reopenIds: string[] = [];
    await page.route(
      `**/api/attempts/${attemptId}/reopenings/`,
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        reopenIds.push(route.request().postDataJSON().request_id);
        const response = await route.fetch();
        if (++reopenRequests === 1) {
          expect(response.status()).toBe(201);
          await route.abort("failed");
        } else {
          expect(response.status()).toBe(200);
          await route.fulfill({ response });
        }
      },
    );
    await reopening
      .getByRole("button", { name: "Reopen submission", exact: true })
      .click();
    await expect(
      reopening.getByRole("button", {
        name: "Retry reopening request",
        exact: true,
      }),
    ).toBeEnabled();
    await page.reload();
    await openMonitor();
    await row
      .getByRole("button", { name: "Reopen & history", exact: true })
      .click();
    reopening = page.getByRole("dialog", {
      name: "Reopen & history",
      exact: true,
    });
    await expect(
      reopening.getByLabel("Extra minutes", { exact: true }),
    ).toHaveValue("6");
    await expect(
      reopening.getByLabel("Extra minutes", { exact: true }),
    ).toBeDisabled();
    await reopening
      .getByRole("button", { name: "Retry reopening request", exact: true })
      .click();
    await expect(reopening.getByRole("status")).toContainText(
      "Submission reopened until",
    );
    expect(reopenIds).toHaveLength(2);
    expect(new Set(reopenIds).size).toBe(1);
    await reopening
      .getByRole("button", { name: "View preserved submission", exact: true })
      .click();
    let preserved = page.getByRole("dialog", {
      name: "Preserved submission",
      exact: true,
    });
    await expect(
      preserved.getByText("Original assessment feedback", { exact: true }),
    ).toBeVisible();
    await expect(
      preserved.getByText("Score: 8 / 10", { exact: true }),
    ).toBeVisible();
    await expect(preserved.getByRole("spinbutton")).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("preserved-submission-desktop.png"),
    });
    await preserved
      .getByRole("button", { name: "Close", exact: true })
      .last()
      .click();
    // Closing the parent uses its header close control; nested history stays read-only.
    await reopening.getByRole("button", { name: "Close", exact: true }).click();
    await guest.goto(invitation.url);
    await guest
      .getByRole("button", { name: "Start / resume exam", exact: true })
      .click();
    await expect(guest).toHaveURL(new RegExp(`/attempt/${attemptId}$`));
    await expect(answer).toHaveValue(
      "Preserved response: isolate the hazard and notify the supervisor.",
    );
    await answer.fill("Revised response after reopening.");
    await guest
      .getByRole("button", { name: "Finish and submit", exact: true })
      .click();
    await guest
      .getByRole("button", { name: "Confirm submission", exact: true })
      .click();
    await expect(
      guest.getByRole("heading", {
        name: "Submitted, awaiting instructor review",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      row.getByText("Awaiting manual review", { exact: true }),
    ).toBeVisible({ timeout: 12000 });
    await row
      .getByRole("button", { name: "Review submission", exact: true })
      .click();
    await expect(
      review.getByText("Revised response after reopening.", { exact: true }),
    ).toBeVisible();
    await expect(review.getByLabel("Score", { exact: true })).toHaveValue("");
    await review.getByLabel("Score", { exact: true }).fill("10");
    await review
      .getByLabel("Feedback", { exact: true })
      .fill("Revised assessment feedback");
    await review
      .getByRole("button", { name: "Save grades & feedback", exact: true })
      .click();
    await expect(review).toHaveCount(0);
    await row
      .getByRole("button", { name: "Reopen & history", exact: true })
      .click();
    await reopening
      .getByRole("button", { name: "View preserved submission", exact: true })
      .click();
    preserved = page.getByRole("dialog", {
      name: "Preserved submission",
      exact: true,
    });
    await expect(
      preserved.getByText("Original assessment feedback", { exact: true }),
    ).toBeVisible();
    await expect(
      preserved.getByText("Revised assessment feedback", { exact: true }),
    ).toHaveCount(0);
    const reopens = await (
      await page.request.get(`/api/attempts/${attemptId}/reopenings/`)
    ).json();
    expect(reopens.count).toBe(1);
    const final = await (
      await guest.request.get(`/api/attempts/${attemptId}/`)
    ).json();
    expect(final.number).toBe(1);
    expect(final.score).toBe(100);
    expect(final.extra_time_minutes).toBe(11);
  } finally {
    release?.();
    await context.close();
  }
}
