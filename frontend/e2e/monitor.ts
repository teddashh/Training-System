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
  } finally {
    release?.();
    await context.close();
  }
}
