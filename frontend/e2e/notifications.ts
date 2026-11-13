import { expect, type Browser, type Page, type Route } from "@playwright/test";

const url = (path: string) => (process.env.E2E_SUBPATH || "") + path;

async function post<T>(page: Page, path: string, data: unknown): Promise<T> {
  const csrf = (await page.context().cookies()).find(cookie => /^(?:__Host-)?training_csrf$/.test(cookie.name))!.value;
  const response = await page.request.post(url("/api/" + path), {
    headers: { "X-CSRFToken": csrf }, data,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

// Hosts call these immediately after their existing administrator login, before
// opening dialogs, changing language or installing any route handlers.
async function expectAdministratorHost(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: "Settings", exact: true })).toHaveCount(1);
}

export async function emailWorkflow(page: Page) {
  await expectAdministratorHost(page);
  const previousUrl = page.url();
  const previousViewport = page.viewportSize();
  const testEmailUrl = "**" + url("/api/email/test/");
  // Never send even to a test mailbox in this UI test; backend delivery is unit-tested.
  const stubTestEmail = (route: Route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ accepted: true, error: "" }),
  });
  await page.route(testEmailUrl, stubTestEmail);
  try {
    await page.goto(url("/manage"));
    await page.locator(".area-tabs").getByRole("link", { name: "Email", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Email", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Delivery log", exact: true })).toBeVisible();
    await page.getByLabel("Email status").selectOption("failed");
    await page.getByRole("button", { name: "Send test email to me" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Test email accepted. Check your inbox." }))
      .toContainText("Test email accepted. Check your inbox.");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("button", { name: "Send test email to me" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  } finally {
    await page.unroute(testEmailUrl, stubTestEmail);
    if (previousViewport) await page.setViewportSize(previousViewport);
    await page.goto(previousUrl);
  }
  await expectAdministratorHost(page);
}

async function signInAtCurrentDestination(page: Page, username: string, password: string) {
  await page.getByLabel("Email, username or employee ID", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const signingIn = page.waitForResponse(response =>
    new URL(response.url()).pathname === url("/api/auth/login/") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Sign in to workspace", exact: true }).click();
  const response = await signingIn;
  expect(response.status(), `Learner sign-in was rate-limited (HTTP 429; Retry-After: ${response.headers()["retry-after"] || "missing"}).`)
    .not.toBe(429);
  expect(response.ok(), `Learner sign-in failed (HTTP ${response.status()}).`).toBeTruthy();
  await expect(page.getByRole("button", { name: "Sign in to workspace", exact: true })).toHaveCount(0);
}

export async function notificationCourseLinkWorkflow(page: Page, browser: Browser) {
  await expectAdministratorHost(page);
  const suffix = Date.now();
  const username = `notification-link-${suffix}`;
  const password = "Zebra-Quartz-Dusk!";
  await post(page, "users/", { username, password, role: "learner" });
  const course = await post<{ id: number }>(page, "courses/", {
    title: `Notification destination ${suffix}`, published: true,
    blocks: [{ type: "text", text: "Synthetic link destination lesson." }],
  });
  // Both old registration links and ordinary course links use the same bounded destination.
  for (const register of [false, true]) {
    const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const learner = await context.newPage();
      const destination = url(`/courses?course=${course.id}${register ? "&action=register" : ""}`);
      await learner.goto(destination + "&redirect=https://example.invalid&from=untrusted");
      await expect(learner.getByRole("button", { name: "Sign in to workspace", exact: true })).toBeVisible();
      await expect.poll(() => learner.evaluate(() => {
        const raw = sessionStorage.getItem("training-registration");
        return raw ? JSON.parse(raw) : null;
      })).toMatchObject({ kind: "course", id: String(course.id), register });
      await signInAtCurrentDestination(learner, username, password);
      await expect(learner).toHaveURL(new URL(destination, page.url()).href);
      await expect(learner.getByRole("dialog")).toContainText(`Notification destination ${suffix}`);
      expect(await learner.evaluate(() => sessionStorage.getItem("training-registration"))).toBeNull();
    } finally {
      await context.close();
    }
  }
}

export async function notificationExamLinkWorkflow(page: Page, browser: Browser) {
  await expectAdministratorHost(page);
  const suffix = Date.now();
  const username = `notification-exam-${suffix}`;
  const password = "Zebra-Quartz-Dusk!";
  await post(page, "users/", { username, password, role: "learner" });
  const title = `Linked assessment ${suffix}`;
  const question = { description: "Synthetic question", type: "single", options: ["Yes", "No"], solution: [0], points: 100 };
  const exam = await post<{ id: number }>(page, "exams/", { title, published: true, questions: [question] });
  const draft = await post<{ id: number }>(page, "exams/", { title: `Draft ${suffix}`, published: false, questions: [question] });
  const restricted = await post<{ id: number }>(page, "exams/", { title: `Restricted ${suffix}`, published: true, audience: "invitation", questions: [question] });
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const learner = await context.newPage();
    await learner.goto(url("/"));
    await signInAtCurrentDestination(learner, username, password);
    let starts = 0;
    learner.on("request", request => {
      if (request.method() === "POST" && /\/api\/exams\/\d+\/start\/$/.test(new URL(request.url()).pathname)) starts++;
    });
    await learner.goto(url(`/exams?exam=${exam.id}`));
    const dialog = learner.getByRole("dialog", { name: "Ready to start?", exact: true });
    await expect(dialog).toContainText(title);
    await expect(dialog.getByRole("button", { name: "Start / resume attempt", exact: true })).toBeEnabled();
    expect((await (await learner.request.get(url(`/api/exams/${exam.id}/`))).json()).attempts_used).toBe(0);
    await dialog.getByRole("button", { name: "Take it later", exact: true }).click();
    for (const id of [999999999, draft.id, restricted.id]) {
      await learner.goto(url(`/exams?exam=${id}`));
      await expect(learner.getByRole("heading", { name: "Exams", exact: true })).toBeVisible();
      await expect(learner.getByRole("dialog")).toHaveCount(0);
    }
    expect(starts).toBe(0);
  } finally {
    await context.close();
  }
}
