import { readFileSync } from 'node:fs';
const brand = JSON.parse(readFileSync(new URL(`../../shared/brand/${process.env.BRAND || 'default'}/brand.json`, import.meta.url), 'utf8'));
// The exported player paints the Start button in the pack's dark accent.
const darkAccent = (() => {
  const tokens = readFileSync(new URL(`../../shared/brand/${process.env.BRAND || 'default'}/tokens.css`, import.meta.url), 'utf8');
  const hex = /--brand-burgundy:\s*#([0-9a-f]{6})/i.exec(tokens)![1];
  return `rgb(${[0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
})();
import { navigateArea, moreOptions } from "./navigation";
import { courseAssessmentsWorkflow } from "./course-assessments";
import { uploadGuestFigure, expectFigureLoaded } from "./figures";
import { emailWorkflow, notificationCourseLinkWorkflow, notificationExamLinkWorkflow } from "./notifications";
import { libraryWorkflow } from "./library";
import { roundsSessionsWorkflow } from "./rounds-sessions";
import { simpleTrainingWorkflow } from "./simple-training";
import { learningViewport } from "./learning";
import { contentWorkflow } from "./content";
import { managementWorkflow, peopleManagementWorkflow } from "./administration";
import { enrollmentWorkflow } from "./enrollments";
import { previewWorkflow } from "./preview";
import { monitorWorkflow } from "./monitor";
import { marksImportWorkflow } from "./marks";
import {
  test,
  expect,
  type Page,
  type Request,
  type Response,
  type Route,
} from "@playwright/test";

async function downloadText(download: import("@playwright/test").Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Download stream is unavailable");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/^\uFEFF/, "");
}

async function waitForThrottle(responses: Response[], retry: number) {
  const throttled = responses.filter((response) => response.status() === 429);
  if (!throttled.length) {
    for (const response of responses) expect(response.status()).toBe(200);
    return false;
  }
  let seconds = 0;
  for (const response of throttled) {
    const wait = Number(response.headers()["retry-after"]);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60);
    seconds = Math.max(seconds, wait);
  }
  expect(
    retry,
    "Request remained throttled after bounded retries",
  ).toBeLessThan(3);
  const delay = (seconds + 1) * 1000;
  test.setTimeout(test.info().timeout + delay);
  await new Promise((resolve) => setTimeout(resolve, delay));
  return true;
}

async function login(page: Page) {
  // Real limits remain enabled. StrictMode issues two startup requests: inspect
  // both, since one can succeed while the other exhausts the remaining allowance.
  const sessions: Promise<Response | null>[] = [];
  const collect = (request: Request) => {
    if (new URL(request.url()).pathname === "/api/auth/session/")
      sessions.push(request.response());
  };
  page.on("request", collect);
  try {
    for (let retry = 0; retry < 4; retry++) {
      sessions.length = 0;
      const first = page.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/auth/session/",
      );
      await page.goto("/");
      await first;
      const responses = await Promise.all(sessions);
      for (const response of responses) expect(response).not.toBeNull();
      if (!(await waitForThrottle(responses as Response[], retry))) break;
    }
  } finally {
    page.off("request", collect);
  }
  await page
    .getByLabel("Email, username or employee ID")
    .fill("admin@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.DEMO_PASSWORD || "Demo-Training-2026!");
  for (let retry = 0; retry < 4; retry++) {
    const response = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/auth/login/",
    );
    await page
      .getByRole("button", { name: "Sign in to workspace", exact: true })
      .click();
    if (!(await waitForThrottle([await response], retry))) break;
  }
  await expect(
    page.locator("header.topbar"),
  ).toBeVisible();
}
async function post<T>(page: Page, path: string, data: unknown): Promise<T> {
  return page.evaluate(
    async ({ path, data }) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((v) => /^(?:__Host-)?training_csrf=/.test(v))
          ?.split("=")[1] || "";
      const r = await fetch("/api/" + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": decodeURIComponent(csrf),
        },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    { path, data },
  );
}

test("paginated results, matching exports and multilingual assessment insights", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  await login(page);
  const title = "Reporting evidence " + Date.now();
  const question = "Which action protects company accounts?";
  const exam = await post<{ id: number }>(page, "exams/", {
    title,
    published: true,
    max_attempts: 30,
    questions: [
      {
        description: question,
        type: "single",
        options: ["Enable MFA", "Share passwords"],
        solution: [0],
        points: 100,
      },
    ],
  });
  for (let index = 0; index < 26; index++) {
    const attempt = await post<{ id: string; questions: { id: number }[] }>(
      page,
      `exams/${exam.id}/start/`,
      {},
    );
    await post(page, `attempts/${attempt.id}/`, {
      answers: { [attempt.questions[0].id]: index % 2 },
    });
  }
  await page.goto("/results");
  await page.getByLabel("Filter by exam").selectOption(String(exam.id));
  await expect(page.locator(".table-footer")).toContainText("Total 26 records");
  await expect(page.locator("tbody tr")).toHaveCount(25);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator(".table-footer")).toContainText("2 / 2");
  let downloaded = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Export results CSV", exact: true })
    .click();
  const allRows = await downloadText(await downloaded);
  expect(allRows.trim().split(/\r?\n/)).toHaveLength(27);
  expect(allRows.split(title)).toHaveLength(27);
  await page
    .getByRole("combobox", { name: "Outcome", exact: true })
    .selectOption("not_passed");
  await expect(page.locator(".table-footer")).toContainText("Total 13 records");
  await expect(page.locator("tbody tr")).toHaveCount(13);
  await expect(
    page.locator(".summary-strip").getByText("0", { exact: true }).first(),
  ).toBeVisible();
  downloaded = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Export results CSV", exact: true })
    .click();
  const failedRows = await downloadText(await downloaded);
  expect(failedRows.trim().split(/\r?\n/)).toHaveLength(14);
  expect(failedRows).not.toContain(",True,");
  await page
    .getByRole("button", { name: "Assessment insights", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Assessment insights", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Select assessment")).toHaveValue(
    String(exam.id),
  );
  await expect(page.locator(".assignment-metrics")).toContainText("26");
  await expect(page.locator(".assignment-metrics")).toContainText("50%");
  const questionRow = page.getByRole("row").filter({ hasText: question });
  await expect(questionRow).toContainText("13 / 26");
  await expect(questionRow).toContainText("50 / 100");
  downloaded = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Export question analysis", exact: true })
    .click();
  const analysis = await downloadText(await downloaded);
  expect(analysis).toContain(question);
  expect(analysis.trim().split(/\r?\n/)).toHaveLength(2);
  await page.locator(".language-picker select").first().selectOption("zh-TW");
  await expect(
    page.getByRole("heading", { name: "評量分析", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "滿分比例", exact: true }),
  ).toBeVisible();
  await page.locator(".language-picker select").first().selectOption("es");
  await expect(
    page.getByRole("heading", {
      name: "Análisis de evaluaciones",
      exact: true,
    }),
  ).toBeVisible();
  downloaded = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Exportar análisis de preguntas", exact: true })
    .click();
  expect(await downloadText(await downloaded)).toContain(
    "Respuestas calificadas",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await expect(questionRow).toContainText("13 / 26");
  await page.locator(".language-picker select").first().selectOption("en");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await marksImportWorkflow(page, browser);
});

test("individual attempt limits, live monitoring and safe time extensions", async ({
  page,
  browser,
}) => {
  test.setTimeout(240000);
  await login(page);
  const title = "Individual budget " + Date.now();
  const exam = await post<{ id: number }>(page, "exams/", {
    title,
    published: true,
    max_attempts: 3,
    retry_interval_minutes: 60,
    questions: [
      {
        description: "Choose the safe action",
        type: "single",
        options: ["Report the issue", "Ignore the issue"],
        solution: [0],
        points: 100,
      },
    ],
  });
  await post(page, `exams/${exam.id}/budget/`, {
    key: "admin@example.com",
    limit: 1,
  });
  await page.goto("/my-exams");
  const card = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(card).toContainText("1 attempt remaining");
  await card.getByRole("link", {name: "Start", exact: true}).click();
  const dialog = page.getByRole("dialog", {
    name: "Ready to start?",
    exact: true,
  });
  await expect(dialog).toContainText("1 new attempt remaining");
  await dialog
    .getByRole("button", { name: "Start / resume attempt", exact: true })
    .click();
  await expect(page).toHaveURL(/\/attempt\//);
  const attemptUrl = page.url();
  await page.goto("/my-exams");
  await card.getByRole("link", {name: "Resume", exact: true}).click();
  await expect(dialog).toContainText("0 new attempts remaining");
  await expect(dialog).toContainText(
    "Resuming uses no extra attempt.",
  );
  await dialog
    .getByRole("button", { name: "Start / resume attempt", exact: true })
    .click();
  await expect(page).toHaveURL(attemptUrl);
  await page.getByRole("radio", { name: /Report the issue/ }).check();
  await page
    .getByRole("button", { name: "Finish and submit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm submission", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Congratulations, you passed",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/my-exams");
  await expect(card.getByRole("link", {name: "View results", exact: true})).toBeVisible();
  await expect(card).toContainText("0 attempts remaining");

  // Extra attempts do not bypass the interval, and editor changes persist.
  await post(page, `exams/${exam.id}/budget/`, {
    key: "admin@example.com",
    limit: 3,
  });
  await page.goto("/exams");
  await card
    .getByRole("button", { name: "Edit " + title, exact: true })
    .click();
  const editor = page.getByRole("dialog");
  await editor
    .getByLabel("Retry wait (minutes)")
    .fill("90");
  await editor.locator(".language-picker select").selectOption("es");
  await expect(
    editor.getByLabel("Espera entre intentos (minutos)"),
  ).toHaveValue("90");
  await editor.locator(".language-picker select").selectOption("en");
  await editor.getByRole("button", { name: "Save exam", exact: true }).click();
  await page.goto(`/exams?exam=${exam.id}&action=start`);
  const startButton = dialog.getByRole("button", {
    name: "Start / resume attempt",
    exact: true,
  });
  await expect(dialog).toContainText("2 new attempts remaining");
  await expect(dialog).toContainText("Next attempt available at");
  await expect(startButton).toBeDisabled();
  // The device clock cannot prematurely unlock an attempt.
  await page.clock.setFixedTime(new Date("2099-01-01T00:00:00Z"));
  await dialog.locator(".language-picker select").selectOption("zh-TW");
  const translatedDialog = page.getByRole("dialog");
  await expect(translatedDialog).toContainText("下一次可開始作答的時間");
  await expect(
    translatedDialog.getByRole("button", {
      name: "開始／繼續作答",
      exact: true,
    }),
  ).toBeDisabled();
  await translatedDialog.locator(".language-picker select").selectOption("en");
  await page.clock.setFixedTime(new Date());

  // Exercise the client countdown without delaying the suite for 90 minutes.
  // The server retains the real policy and must reject the premature request.
  const countdownHandler = async (route: Route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.next_attempt_at = new Date(Date.parse(data.server_time) + 1500).toISOString();
    await route.fulfill({response, json: data});
  };
  await page.route(`**/api/exams/${exam.id}/`, countdownHandler);
  await dialog
    .getByRole("button", { name: "Refresh availability", exact: true })
    .click();
  await expect(startButton).toBeEnabled({ timeout: 7000 });
  await page.unroute(`**/api/exams/${exam.id}/`, countdownHandler);
  await startButton.click();
  await expect(dialog.getByRole("alert")).toContainText("waiting period");
  await expect(startButton).toBeDisabled();
  const budget = await (
    await page.request.get(`/api/exams/${exam.id}/`)
  ).json();
  expect(budget.attempts_used).toBe(1);
  expect(budget.retry_interval_minutes).toBe(90);
  await dialog
    .getByRole("button", { name: "Take it later", exact: true })
    .click();

  const session = await (await page.request.get("/api/auth/session/")).json();
  await post(page, "assignments/", {
    kind: "exam",
    target_id: exam.id,
    audience: "people",
    people: [session.user.id],
  });
  await page.goto("/assignments");
  await page
    .getByRole("row")
    .filter({ hasText: title })
    .getByRole("button", { name: "Open assessment", exact: true })
    .click();
  const assignment = page.getByRole("dialog", {
    name: "Open assessment",
    exact: true,
  });
  await expect(assignment).toContainText("Next attempt available at");
  await expect(
    assignment.getByRole("button", {
      name: "Start / resume exam",
      exact: true,
    }),
  ).toBeDisabled();
  await assignment.getByRole("button", { name: "Cancel", exact: true }).click();

  const invitation = await post<{ url: string }>(page, "invitations/issue/", {
    exam: exam.id,
    key: "admin@example.com",
    max_attempts: 2,
    days: 1,
    require_email_verification: false,
  });
  const context = await browser.newContext();
  const guest = await context.newPage();
  try {
    await guest.goto(invitation.url);
    await expect(
      guest.getByRole("button", { name: "Start / resume exam", exact: true }),
    ).toBeDisabled();
    await expect(guest).toHaveURL(/\/invite$/);
    await expect(guest.locator(".retry-availability")).toContainText(
      "Next attempt available at",
    );
    await guest.locator(".language-picker select").selectOption("es");
    await expect(guest.locator(".retry-availability")).toContainText(
      "Próximo intento disponible",
    );
    await guest.setViewportSize({ width: 390, height: 844 });
    expect(
      await guest.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await guest.locator(".language-picker select").selectOption("en");
    await page.goto("/exams");
    await card
      .getByRole("button", { name: "Edit " + title, exact: true })
      .click();
    await editor
      .getByLabel("Retry wait (minutes)")
      .fill("0");
    await editor
      .getByRole("button", { name: "Save exam", exact: true })
      .click();
    await guest
      .getByRole("button", { name: "Refresh availability", exact: true })
      .click();
    await expect(
      guest.getByRole("button", { name: "Start / resume exam", exact: true }),
    ).toBeEnabled();
    await guest
      .getByRole("button", { name: "Start / resume exam", exact: true })
      .click();
    await expect(guest).toHaveURL(/\/attempt\//);
    const after = await (
      await page.request.get(`/api/exams/${exam.id}/`)
    ).json();
    expect(after.attempts_used).toBe(2);
  } finally {
    await context.close();
  }
  await monitorWorkflow(page, browser);
});

test("dashboard, responsive navigation, library and persisted course editor", async ({
  page, browser,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await expect(page.locator('.stat-card, .chart-area')).toHaveCount(0);
  await navigateArea(page, 'Reports', 'Overview');
  await expect(page.getByRole('heading', {name: 'Training overview', exact: true})).toBeVisible();
  await expect(page.getByText('Training participants', {exact: true})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Score distribution', exact: true})).toBeVisible();
  await expect(page.getByLabel('Reporting period')).toBeVisible();
  await navigateArea(page, 'My training', 'Catalog');
  await page
    .getByRole("button", { name: "Create course", exact: true })
    .click();
  const title = "Browser test course " + Date.now();
  await page.getByLabel("Course title", { exact: true }).fill(title);
  await page.getByRole("radio", { name: "Text lesson", exact: true }).check();
  await page
    .getByLabel("Block 2 content")
    .fill("A lesson paragraph used to verify saving and reloading.");
  await page.getByLabel("Visible to learners").check();
  await page.getByRole("button", { name: "Save course", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  const card = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await card
    .getByRole("button", { name: "Start learning", exact: true })
    .click();
  await expect(
    page.getByText("A lesson paragraph used to verify saving and reloading.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Mark as completed", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Learning completed", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await navigateArea(page, 'Home');
  await expect(
    page.locator("header.topbar"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await enrollmentWorkflow(page, browser);
  await managementWorkflow(page, browser);
  await contentWorkflow(page, browser);
  await libraryWorkflow(page);
  await roundsSessionsWorkflow(page, browser);
  await simpleTrainingWorkflow(page, browser);
  expect(errors).toEqual([]);
});

test("guest invitation allows a bounded standalone exam and rejects a second attempt", async ({
  page,
  browser,
}) => {
  await login(page);
  const figure = await uploadGuestFigure(page);
  const exam = await post<{ id: number }>(page, "exams/", {
    title: "Guest attempt test " + Date.now(),
    description: "A standalone exam",
    duration_minutes: 5,
    max_attempts: 1,
    pass_score: 70,
    published: true,
    questions: [
      {
        description: "Choose the safe action",
        figure,
        figure_alt: "Two synthetic network nodes",
        type: "single",
        options: ["Report to IT", "Share passwords publicly"],
        solution: [0],
        points: 100,
      },
    ],
  });
  const invitation = await post<{ url: string }>(page, "invitations/issue/", {
    exam: exam.id,
    key: "guest" + Date.now() + "@example.com",
    max_attempts: 1,
    days: 1,
  });
  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto(invitation.url);
  await expect(guest.getByText("1 attempt", { exact: true })).toBeVisible();
  await guest.locator(".language-picker select").selectOption("es");
  await expect(guest.getByText("1 intento", { exact: true })).toBeVisible();
  await guest.locator(".language-picker select").selectOption("en");
  await expect(
    guest.getByRole("heading", { name: "Welcome to your assessment" }),
  ).toBeVisible();
  await guest
    .getByRole("button", { name: "Start / resume exam", exact: true })
    .click();
  await expect(
    guest.getByRole("heading", { name: "Choose the safe action" }),
  ).toBeVisible();
  await expectFigureLoaded(guest, "Two synthetic network nodes");
  await guest.getByLabel("AReport to IT").check();
  await guest
    .getByRole("button", { name: "Finish and submit", exact: true })
    .click();
  await guest
    .getByRole("button", { name: "Confirm submission", exact: true })
    .click();
  await expect(
    guest.getByRole("heading", { name: "Congratulations, you passed" }),
  ).toBeVisible();
  await guest.getByRole("button", { name: "Back to invitation" }).click();
  await expect(guest.getByText("0 attempts", { exact: true })).toBeVisible();
  await guest.locator(".language-picker select").selectOption("es");
  await expect(guest.getByText("0 intentos", { exact: true })).toBeVisible();
  await guest.locator(".language-picker select").selectOption("en");
  await guest
    .getByRole("button", { name: "Start / resume exam", exact: true })
    .click();
  await expect(guest.getByRole("alert")).toContainText("attempt limit");
  await context.close();
});

test("SCORM upload, isolated execution, commit and resume persist end to end", async ({
  page,
}) => {
  await login(page);
  const course = await post<{ id: number }>(page, "courses/", {
    title: "SCORM browser integration " + Date.now(),
    published: true,
    blocks: [],
  });
  // Build a standards-shaped test SCO that exercises the real API adapter.
  const { default: JSZip } =
    await import("../../vendor/scormly/node_modules/jszip/lib/index.js");
  const zip = new JSZip();
  zip.file(
    "imsmanifest.xml",
    '<manifest xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"><metadata><schemaversion>1.2</schemaversion></metadata><resources><resource identifier="R" adlcp:scormtype="sco" href="index.html"/></resources></manifest>',
  );
  zip.file(
    "index.html",
    `<!doctype html><html><body><h1>SCORM test lesson</h1><p id="resume"></p><button id="finish">Complete lesson</button><button id="bookmark">Buffer bookmark</button><script>const api=parent.API;api.LMSInitialize('');if(api.LMSSetValue(undefined,'0')!=='false'||api.LMSGetValue(undefined)!=='')throw Error('Invalid SCORM keys must not crash the course');document.getElementById('resume').textContent=api.LMSGetValue('cmi.suspend_data');document.getElementById('finish').onclick=()=>{api.LMSSetValue('cmi.suspend_data','bookmark-saved');api.LMSSetValue('cmi.core.lesson_status','completed');api.LMSCommit('')};document.getElementById('bookmark').onclick=()=>api.LMSSetValue('cmi.suspend_data','buffered-until-close');</script></body></html>`,
  );
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "training_csrf",
  )!.value;
  const upload = await page.request.post(`/api/courses/${course.id}/upload/`, {
    headers: { "X-CSRFToken": csrf },
    multipart: {
      file: { name: "course.zip", mimeType: "application/zip", buffer: bytes },
    },
  });
  expect(upload.ok()).toBeTruthy();
  await page.goto("/courses");
  const card = page
    .locator("article")
    .filter({ hasText: "SCORM browser integration" })
    .first();
  await card
    .getByRole("button", { name: "Start learning", exact: true })
    .click();
  const sco = page
    .frameLocator('iframe[title="SCORM course player"]')
    .frameLocator("#sco");
  await expect(
    sco.getByRole("heading", { name: "SCORM test lesson" }),
  ).toBeVisible();
  await sco.getByRole("button", { name: "Complete lesson" }).click();
  await expect(
    page.getByText("Course completed and progress saved", { exact: true }),
  ).toBeVisible();
  await sco.getByRole("button", { name: "Buffer bookmark" }).click();
  await learningViewport(page);
  let rejectSave = true;
  await page.route("**/api/scorm/*/commit/", async (route) => {
    if (rejectSave) {
      rejectSave = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Simulated save outage" }),
      });
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Save and close", exact: true })
    .click();
  await expect(
    page.getByText("Simulated save outage", { exact: true }),
  ).toBeVisible();
  await expect(
    sco.getByRole("heading", { name: "SCORM test lesson" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save and close", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await card.getByRole("button", { name: "Learn again", exact: true }).click();
  await expect(
    sco.getByText("buffered-until-close", { exact: true }),
  ).toBeVisible();
});

for (const version of ["1.2", "2004"] as const) {
  test(`Training Content Studio publishes a real package and editable backup to the LMS (${version})`, async ({
    page,
  }) => {
    await login(page);
    const title = `Training Content Studio ${version} publish test ${Date.now()}`;
    const course = await post<{ id: number }>(page, "courses/", {
      title,
      published: true,
      blocks: [],
    });
    await page.goto("/studio/#/app");
    await page.getByRole("button", { name: /Try sample content/ }).click();
    // Company branding must reach the real exported player, not just its editor.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTitle("Project theme", { exact: true }).click();
    await page.getByRole("button", { name: `${brand.organization} ${brand.organization} brand colors with Fluent-style controls` }).click();
    // Catalog visibility does not imply publication rights. Exercise the picker
    // with a visible course the current author cannot manage.
    await page.route("**/api/courses/", async (route) => {
      const response = await route.fetch();
      const courses = await response.json();
      await route.fulfill({
        response,
        json: [
          ...courses,
          { id: -1, title: "Read-only course", can_manage: false },
        ],
      });
    });
    await expect(
      page
        .getByRole("button", { name: "Publish to course", exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Publish to course", exact: true })
      .filter({ visible: true })
      .click();
    await expect(page.getByLabel("Course", { exact: true })).toBeVisible();
    await page
      .getByLabel("Course", { exact: true })
      .selectOption(String(course.id));
    await expect(
      page.getByLabel("Course", { exact: true }).locator('option[value="-1"]'),
    ).toHaveCount(0);
    await page.unroute("**/api/courses/");
    await page.getByText("Advanced options", { exact: true }).click();
    await page.getByLabel("Package format").selectOption(version);
    const published = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/courses/${course.id}/upload/`) &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Publish to course", exact: true })
      .filter({ visible: true })
      .last()
      .click();
    const upload = await published;
    expect(upload.status()).toBe(201);
    const packageInfo = await upload.json();
    expect(packageInfo.version).toBe(version);
    await expect(
      page.getByRole("status").filter({ hasText: "Published to" }),
    ).toBeVisible({ timeout: 20000 });
    const response = await page.request.get(
      `/api/courses/${course.id}/source/`,
    );
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toBe("application/zip");

    // Run the actual exported player on the isolated origin, then verify its
    // version-specific bookmark survives a confirmed save and relaunch.
    await page.goto("/courses");
    const card = page.locator("article").filter({ hasText: title });
    await card
      .getByRole("button", { name: "Start learning", exact: true })
      .click();
    const sco = page
      .frameLocator('iframe[title="SCORM course player"]')
      .frameLocator("#sco");
    await expect(
      sco.getByRole("button", { name: /^Start course/ }),
    ).toBeVisible();
    await expect(sco.getByRole("button", { name: /^Start course/ })).toHaveCSS(
      "color", darkAccent,
    );
    await expect(sco.locator("html")).toHaveAttribute("data-theme", "company");
    const bookmark =
      version === "2004" ? "cmi.location" : "cmi.core.lesson_location";
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/scorm/${packageInfo.id}/commit/`) &&
        response.request().postDataJSON()?.cmi?.[bookmark] === "0",
    );
    await sco.getByRole("button", { name: /^Start course/ }).click();
    await expect(sco.locator(".lesson-title")).toBeVisible();
    await page
      .getByRole("button", { name: "Save and close", exact: true })
      .click();
    expect((await saved).ok()).toBeTruthy();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await card
      .getByRole("button", { name: "Continue learning", exact: true })
      .click();
    await expect(sco.locator(".lesson-title")).toBeVisible();
    await expect(
      sco.getByRole("button", { name: /^Start course/ }),
    ).toHaveCount(0);
    const restored = await sco.locator("body").evaluate(() => {
      const player = window as typeof window & {
        __SCORMLY_SCORM__: string;
        SCORM: { available(): boolean; getSuspend(): string };
      };
      return {
        version: player.__SCORMLY_SCORM__,
        connected: player.SCORM.available(),
        progress: JSON.parse(player.SCORM.getSuspend()),
      };
    });
    expect(restored.version).toBe(version);
    expect(restored.connected).toBe(true);
    expect(restored.progress.l).toBe(0);
    await page
      .getByRole("button", { name: "Save and close", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goto(`/studio/?course=${course.id}#/app`);
    await page.getByRole("button", { name: "Publish to course", exact: true }).filter({ visible: true }).click();
    await expect(page.getByLabel("Course", { exact: true })).toHaveValue(String(course.id));
    await page.getByText("Advanced options", { exact: true }).click();
    await expect(page.getByLabel("Package format")).toHaveValue(version);
  });
}

test("imported and pasted rich text cannot execute in the signed-in authoring origin", async ({
  page,
}) => {
  await login(page);
  await page.goto("/studio/#/app");
  const { default: JSZip } =
    await import("../../vendor/scormly/node_modules/jszip/lib/index.js");
  const zip = new JSZip();
  const html = `<p><strong>Safe training content</strong></p>
    <img src="data:image/png;base64,invalid" onerror="window.__courseXss=true">
    <svg onload="window.__courseXss=true"></svg>
    <iframe srcdoc="<script>parent.__courseXss=true</script>"></iframe>
    <a href="javascript:window.__courseXss=true">Unsafe link</a>
    <form action="/api/auth/logout/"><input autofocus onfocus="window.__courseXss=true"></form>
    <table><tbody><tr><td>Preserved table</td></tr></tbody></table>`;
  zip.file(
    "project.json",
    JSON.stringify({
      id: "security-" + Date.now(),
      title: "Import security",
      description: "",
      theme: "ocean",
      lessons: [
        {
          id: "lesson-1",
          title: "Safe lesson",
          status: "published",
          blocks: [{ id: "paragraph-1", type: "paragraph", data: { html } }],
        },
      ],
    }),
  );
  await page
    .locator('input[type="file"][accept=".zip,application/zip"]')
    .setInputFiles({
      name: "security-project.zip",
      mimeType: "application/zip",
      buffer: await zip.generateAsync({ type: "nodebuffer" }),
    });
  const editor = page.locator('[contenteditable="true"]').first();
  await expect(editor).toContainText("Safe training content");
  await expect(editor.locator("strong")).toHaveText("Safe training content");
  await expect(editor.locator("td")).toHaveText("Preserved table");
  await expect(
    editor.locator("[onerror], [onload], iframe, svg, form, input"),
  ).toHaveCount(0);
  await expect(editor.locator("a")).not.toHaveAttribute("href", /javascript:/);
  expect(await page.evaluate(() => "__courseXss" in window)).toBe(false);

  await page
    .getByRole("button", { name: "Preview", exact: true })
    .filter({ visible: true })
    .click();
  const preview = page.getByRole("dialog");
  await expect(
    preview.getByText("Safe training content", { exact: true }),
  ).toBeVisible();
  await expect(
    preview.locator("[onerror], [onload], iframe, svg[onload], form"),
  ).toHaveCount(0);
  expect(await page.evaluate(() => "__courseXss" in window)).toBe(false);
  await page.keyboard.press("Escape");

  await editor.focus();
  await editor.evaluate((el) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData(
      "text/html",
      '<p>Pasted safely<img src="data:image/png;base64,invalid" onerror="window.__courseXss=true"></p>',
    );
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(editor).toContainText("Pasted safely");
  await expect(editor.locator("[onerror]")).toHaveCount(0);
  expect(await page.evaluate(() => "__courseXss" in window)).toBe(false);
});

test("three languages default to English and preserve form state and preferences", async ({
  page,
  browser,
}) => {
  await login(page);
  await notificationExamLinkWorkflow(page, browser);
  await navigateArea(page, 'My training', 'Catalog');
  await page
    .getByRole("button", { name: "Create course", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal
    .getByLabel("Course title", { exact: true })
    .fill("Authored content stays unchanged / 教材 / contenido");
  await modal
    .getByRole("combobox", { name: "Interface language" })
    .selectOption("es");
  await expect(
    modal.getByLabel("Título del curso", { exact: true }),
  ).toHaveValue("Authored content stays unchanged / 教材 / contenido");
  await expect(
    modal.getByRole("button", { name: "Crear y editar", exact: true }),
  ).toBeVisible();
  await modal
    .getByRole("combobox", { name: "Idioma de la interfaz" })
    .selectOption("zh-TW");
  await expect(modal.getByLabel("課程名稱", { exact: true })).toHaveValue(
    "Authored content stays unchanged / 教材 / contenido",
  );
  await modal.getByRole("button", { name: "取消", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
  await expect(
    page.getByRole("heading", { name: "課程", exact: true }),
  ).toBeVisible();
  for (const language of ["es", "en", "zh-TW"]) {
    await page
      .locator(".language-picker select")
      .first()
      .selectOption(language);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/studio/#/app");
  await expect(
    page.getByRole("button", { name: /試用範例教材/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /試用範例教材/ }).click();
  await expect(
    page
      .getByRole("button", { name: "發布至課程", exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "介面語言", exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole("button", { name: "Español", exact: true }).click();
  await expect(
    page
      .getByRole("button", { name: "Publicar en el curso", exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await page.goto("/reports");
  await expect(
    page.getByRole("heading", {
      name: "Resumen de formación",
      exact: true,
    }),
  ).toBeVisible();
});

test("changing language preserves answers and the budget of an active exam", async ({
  page,
}) => {
  await login(page);
  const exam = await post<{ id: number }>(page, "exams/", {
    title: "Language continuity " + Date.now(),
    published: true,
    max_attempts: 1,
    questions: [
      {
        description: "Keep this authored question",
        type: "single",
        options: ["Safe answer", "Unsafe answer"],
        solution: [0],
        points: 100,
      },
    ],
  });
  const attempt = await post<{ id: string }>(
    page,
    `exams/${exam.id}/start/`,
    {},
  );
  await page.goto(`/attempt/${attempt.id}`);
  await page.getByLabel("ASafe answer").check();
  await page.locator(".language-picker select").first().selectOption("es");
  await expect(
    page.getByRole("button", { name: "Finalizar y enviar", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("ASafe answer")).toBeChecked();
  await expect(
    page.getByRole("heading", {
      name: "Keep this authored question",
      exact: true,
    }),
  ).toBeVisible();
  await page.locator(".language-picker select").first().selectOption("zh-TW");
  await expect(page.getByLabel("ASafe answer")).toBeChecked();
  await page.getByRole("button", { name: "完成交卷", exact: true }).click();
  await page.getByRole("button", { name: "確認交卷", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "恭喜，通過本次評量", exact: true }),
  ).toBeVisible();
  const budget = await page.request.get(`/api/exams/${exam.id}/`);
  expect((await budget.json()).attempts_used).toBe(1);
});

test("exam policies preserve audience, enforce sequential guest access and release reviewed responses", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  await login(page);
  const title = "Assigned assessment " + Date.now();
  const exam = await post<{ id: number }>(page, "exams/", {
    title,
    published: true,
    questions: [
      {
        description: "A private assessment",
        type: "single",
        options: ["Yes", "No"],
        solution: [0],
        points: 10,
      },
      {
        description: "Explain the private release procedure",
        type: "essay",
        options: [],
        solution: [],
        points: 10,
      },
    ],
  });
  const audience = await (
    await page.request.get("/api/exams/audience-options/?search=demo.learner1")
  ).json();
  const person = audience.people.find(
    (p: { username: string }) => p.username === "demo.learner1",
  );
  await page.goto("/exams");
  await page
    .getByRole("button", { name: "Edit " + title, exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await moreOptions(page);
  await modal
    .getByLabel("Audience", { exact: true })
    .selectOption("people");
  await modal.getByRole("textbox", { name: "Search people", exact: true }).fill(person.username);
  const label =
    person.display_name + (person.department ? " · " + person.department : "");
  await modal.getByRole("checkbox", { name: label, exact: true }).check();
  await modal
    .getByRole("checkbox", {
      name: "Allow skipping",
      exact: true,
    })
    .uncheck();
  await modal
    .getByRole("checkbox", {
      name: "Allow response review",
      exact: true,
    })
    .uncheck();
  await modal.locator(".language-picker select").selectOption("es");
  await expect(
    modal.getByRole("checkbox", { name: label, exact: true }),
  ).toBeChecked();
  await expect(
    modal.getByRole("checkbox", {
      name: "Permitir saltos",
      exact: true,
    }),
  ).not.toBeChecked();
  await modal.locator(".language-picker select").selectOption("zh-TW");
  await expect(
    modal.getByRole("checkbox", {
      name: "允許回顧答案",
      exact: true,
    }),
  ).not.toBeChecked();
  await modal.locator(".language-picker select").selectOption("en");
  await modal.getByRole("button", { name: "Save exam", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("button", { name: "Edit " + title, exact: true })
    .click();
  await expect(
    modal.getByLabel("Audience", { exact: true }),
  ).toHaveValue("people");
  await expect(
    modal.getByRole("checkbox", { name: label, exact: true }),
  ).toBeChecked();
  const stored = await (
    await page.request.get(`/api/exams/${exam.id}/`)
  ).json();
  expect(stored.allowed_users).toEqual([person.id]);
  expect(stored.allow_skip).toBe(false);
  expect(stored.allow_response_review).toBe(false);
  await expect(
    modal.getByRole("checkbox", {
      name: "Allow skipping",
      exact: true,
    }),
  ).not.toBeChecked();
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  const invitation = await post<{ url: string }>(page, "invitations/issue/", {
    exam: exam.id,
    key: `policy-${Date.now()}@example.com`,
    max_attempts: 1,
    days: 1,
  });
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await guest.goto(invitation.url);
    await expect(
      guest.getByText("Save each answer to unlock the next question.", { exact: false }),
    ).toBeVisible();
    await guest
      .getByRole("button", { name: "Start / resume exam", exact: true })
      .click();
    await expect(
      guest.getByRole("heading", { name: "A private assessment", exact: true }),
    ).toBeVisible();
    const attemptId = new URL(guest.url()).pathname.split("/").pop()!;
    const endpoint = `**/api/attempts/${attemptId}/`;
    let release: (() => void) | undefined;
    let firstSave = true;
    let rejectSubmission = true;
    await guest.route(endpoint, async (route) => {
      if (route.request().method() === "POST" && rejectSubmission) {
        rejectSubmission = false;
        await route.fulfill({
          status: 400,
          json: {
            code: "answers_required",
            detail: "Answer every question before submitting this exam.",
          },
        });
        return;
      }
      if (route.request().method() === "PATCH" && firstSave) {
        firstSave = false;
        const response = await route.fetch();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        await route.fulfill({ response });
      } else await route.continue();
    });
    await expect(
      guest.getByRole("button", { name: "Go to question 2", exact: true }),
    ).toBeDisabled();
    await expect(
      guest.getByRole("button", { name: "Next question", exact: true }),
    ).toBeDisabled();
    await expect(
      guest.getByRole("button", { name: "Submit", exact: true }),
    ).toBeDisabled();
    await expect(
      guest.getByText("Explain the private release procedure", { exact: true }),
    ).toHaveCount(0);
    await guest.clock.setFixedTime(new Date("2099-01-01T00:00:00Z"));
    // Let the timer tick: changing the wall clock must neither expire nor submit.
    await guest.waitForTimeout(1200);
    await expect(guest.locator(".exam-timer strong")).not.toHaveText("00:00");
    await expect(
      guest.getByRole("heading", { name: "A private assessment", exact: true }),
    ).toBeVisible();
    await guest.getByRole("radio", { name: /Yes/ }).check();
    await expect.poll(() => !!release).toBe(true);
    await expect(
      guest.getByRole("button", { name: "Next question", exact: true }),
    ).toBeDisabled();
    release!();
    await expect(
      guest.getByRole("button", { name: "Next question", exact: true }),
    ).toBeEnabled();
    await guest
      .getByRole("button", { name: "Next question", exact: true })
      .click();
    await expect(
      guest.getByRole("button", { name: "Finish and submit", exact: true }),
    ).toBeDisabled();
    await guest
      .getByRole("textbox", { name: "Your answer", exact: true })
      .fill("Saved confidential procedure");
    await expect(guest.getByRole("status")).toContainText(
      "Answers saved automatically",
    );
    await guest.reload();
    await expect(guest.getByRole("radio", { name: /Yes/ })).toBeChecked();
    await guest
      .getByRole("button", { name: "Go to question 2", exact: true })
      .click();
    await expect(
      guest.getByRole("textbox", { name: "Your answer", exact: true }),
    ).toHaveValue("Saved confidential procedure");
    // New navigation settings must not change an attempt already underway.
    await page
      .getByRole("button", { name: "Edit " + title, exact: true })
      .click();
    await modal
      .getByRole("checkbox", {
        name: "Allow skipping",
        exact: true,
      })
      .check();
    await modal.getByRole("button", { name: "Save exam", exact: true }).click();
    await expect(modal).toHaveCount(0);
    const inProgress = await guest.evaluate(
      async (id) => (await fetch(`/api/attempts/${id}/`)).json(),
      attemptId,
    );
    expect(inProgress.allow_skip).toBe(false);
    await guest.setViewportSize({ width: 390, height: 844 });
    expect(
      await guest.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await guest.screenshot({
      path: "/tmp/training-policies-sequential-mobile.png",
      fullPage: true,
    });
    await guest
      .getByRole("button", { name: "Finish and submit", exact: true })
      .click();
    await guest
      .getByRole("button", { name: "Confirm submission", exact: true })
      .click();
    await expect(
      guest
        .getByRole("dialog", { name: "Confirm submission", exact: true })
        .getByText("Answer every question before submitting this exam.", {
          exact: true,
        }),
    ).toBeVisible();
    await guest
      .getByRole("button", { name: "Continue answering", exact: true })
      .click();
    await expect(
      guest.getByRole("textbox", { name: "Your answer", exact: true }),
    ).toBeEditable();
    await expect(
      guest.getByRole("textbox", { name: "Your answer", exact: true }),
    ).toHaveValue("Saved confidential procedure");
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
    await expect(guest.locator(".response-item")).toHaveCount(0);
    const hidden = await guest.evaluate(
      async (id) => (await fetch(`/api/attempts/${id}/`)).json(),
      attemptId,
    );
    expect(hidden.questions).toEqual([]);
    expect(hidden.answers).toEqual({});
    expect(hidden.manual_grades).toEqual({});
    await guest.locator(".language-picker select").selectOption("es");
    await expect(
      guest.getByText("Puede ver su nota, pero no sus respuestas.", {
        exact: false,
      }),
    ).toBeVisible();
    await guest.locator(".language-picker select").selectOption("zh-TW");
    await expect(
      guest.getByText("可查看分數，無法回顧答案。", { exact: false }),
    ).toBeVisible();
    await guest.locator(".language-picker select").selectOption("en");
    const review = await (
      await page.request.get(`/api/results/${attemptId}/review/`)
    ).json();
    expect(review.answers[String(review.questions[1].id)]).toBe(
      "Saved confidential procedure",
    );
    await post(page, `results/${attemptId}/review/`, {
      grades: {
        [review.questions[1].id]: {
          points: 9,
          feedback: "Reviewed confidential feedback",
        },
      },
    });
    await guest
      .getByRole("button", { name: "Refresh result", exact: true })
      .click();
    await expect(guest.locator(".result-score")).toContainText("95");
    await expect(
      guest.getByText("Reviewed confidential feedback", { exact: true }),
    ).toHaveCount(0);
    await guest.screenshot({
      path: "/tmp/training-policies-hidden-result-mobile.png",
      fullPage: true,
    });
    // Organizers can release completed responses without regrading or restarting.
    await page
      .getByRole("button", { name: "Edit " + title, exact: true })
      .click();
    await modal
      .getByRole("checkbox", {
        name: "Allow response review",
        exact: true,
      })
      .check();
    await modal.getByRole("button", { name: "Save exam", exact: true }).click();
    await expect(modal).toHaveCount(0);
    await guest
      .getByRole("button", { name: "Refresh result", exact: true })
      .click();
    await expect(
      guest.getByText("Reviewed confidential feedback", { exact: true }),
    ).toBeVisible();
    await expect(
      guest.getByText("Saved confidential procedure", { exact: true }),
    ).toBeVisible();
    await expect(guest.locator(".result-score")).toContainText("95");
  } finally {
    await context.close();
  }
});

test("guest email verification unlocks the invitation without consuming an attempt", async ({
  page,
  browser,
}) => {
  test.skip(
    !process.env.TEST_EMAIL_DIR,
    "Requires the test-only file email backend; enabled in CI.",
  );
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  await login(page);
  const exam = await post<{ id: number }>(page, "exams/", {
    title: "Verified invitation " + Date.now(),
    audience: "invitation",
    published: true,
    max_attempts: 1,
    questions: [
      {
        description: "Verified participant question",
        type: "single",
        options: ["Safe", "Unsafe"],
        solution: [0],
        points: 100,
      },
    ],
  });
  const recipient = "verified" + Date.now() + "@example.com";
  const invitation = await post<{ url: string; id: string }>(
    page,
    "invitations/issue/",
    {
      exam: exam.id,
      key: recipient,
      require_email_verification: true,
      max_attempts: 1,
      days: 1,
    },
  );
  const context = await browser.newContext({ locale: "es-ES" });
  const guest = await context.newPage();
  await guest.goto(invitation.url);
  await expect(
    guest.getByRole("heading", {
      name: "Verify your email to continue",
      exact: true,
    }),
  ).toBeVisible();
  await expect(guest.locator("html")).toHaveAttribute("lang", "en");
  await expect(guest.getByText(recipient, { exact: true })).toHaveCount(0);
  expect(new URL(guest.url()).hash).toBe("");
  await guest.reload();
  await expect(
    guest.getByRole("heading", {
      name: "Verify your email to continue",
      exact: true,
    }),
  ).toBeVisible();
  await guest
    .getByRole("button", { name: "Send verification code", exact: true })
    .click();
  await expect(guest.getByRole("status")).toContainText(
    "sent to the invited recipient",
  );
  let code = "";
  await expect
    .poll(async () => {
      for (const file of await fs.readdir(process.env.TEST_EMAIL_DIR!)) {
        const text = await fs.readFile(
          path.join(process.env.TEST_EMAIL_DIR!, file),
          "utf8",
        );
        if (text.includes("To: " + recipient))
          // Message-ID headers may also contain six-digit numbers.
          code = text.match(/^Your verification code: (\d{6})\s*$/m)?.[1] || "";
      }
      return code.length;
    })
    .toBe(6);
  await guest.getByLabel("Six-digit verification code").fill(code);
  await guest
    .getByRole("button", { name: "Verify and continue", exact: true })
    .click();
  await expect(
    guest.getByRole("heading", {
      name: "Welcome to your assessment",
      exact: true,
    }),
  ).toBeVisible();
  const before = await (
    await page.request.get(`/api/invitations/${invitation.id}/`)
  ).json();
  expect(before.used).toBe(0);
  await guest
    .getByRole("button", { name: "Start / resume exam", exact: true })
    .click();
  await expect(
    guest.getByRole("heading", {
      name: "Verified participant question",
      exact: true,
    }),
  ).toBeVisible();
  const after = await (
    await page.request.get(`/api/invitations/${invitation.id}/`)
  ).json();
  expect(after.used).toBe(1);
  await context.close();
});

test("assign required training, complete from worklist, and export evidence", async ({
  page, browser,
}) => {
  test.setTimeout(180000);
  await login(page);
  await emailWorkflow(page);
  const title = "Required learning " + Date.now();
  const course = await post<{ id: number }>(page, "courses/", {
    title,
    published: true,
    blocks: [{ type: "text", text: "Read and complete the assigned lesson." }],
  });
  await page.goto("/assignments");
  await page
    .getByRole("button", { name: "Assign training", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Assign training" });
  await expect(dialog.getByLabel("Email the people I assign")).toBeChecked();
  await dialog.getByLabel("Email the people I assign").uncheck();
  await dialog
    .getByLabel("Training", { exact: true })
    .selectOption(String(course.id));
  await dialog.getByLabel("Alex Morgan", { exact: false }).check();
  await dialog.getByText("Assignment options", { exact: true }).click();
  await dialog.getByLabel("Due date (optional)").fill("2020-01-01T09:00");
  await dialog
    .getByLabel("Instructions for participants")
    .fill("Required onboarding exercise.");
  await dialog
    .getByRole("button", { name: "Assign training", exact: true })
    .click();
  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row).toContainText("Overdue");
  await page.getByRole("button", { name: "My worklist", exact: true }).click();
  await row.getByRole("button", { name: "Open course" }).click();
  await expect(page.getByRole("dialog", { name: title })).toBeVisible();
  // A slow completion must keep the lesson open until its progress is saved.
  let releaseCompletion!: () => void;
  const completionGate = new Promise<void>((resolve) => { releaseCompletion = resolve; });
  await page.route(`**/api/courses/${course.id}/complete/`, async (route) => {
    await completionGate;
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Mark as completed", exact: true }).click();
    await expect(page.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: title })).toBeVisible();
  } finally { releaseCompletion(); }
  await learningViewport(page);
  await expect(page.getByRole("button", { name: "Learning completed", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page).toHaveURL(/\/assignments$/);
  await expect(row).toContainText("Completed");
  await expect(row).not.toContainText("Overdue");
  await page.getByRole("button", { name: "Completion report" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export CSV" }).click();
  expect((await download).suggestedFilename()).toBe("training-completion.csv");
  await row.getByRole("button", { name: "Cancel assignment" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel assignment", exact: true })
    .click();
  await expect(row).toContainText("Cancelled");
  await courseAssessmentsWorkflow(page, browser);
});

test("question bank, randomized exams and private instructor previews work end to end", async ({
  page,
}) => {
  test.setTimeout(120000);
  await login(page);
  const question = "Reusable security question " + Date.now();
  await navigateArea(page, 'Exams', 'Question bank');
  await page
    .getByRole("button", { name: "Create question", exact: true })
    .click();
  await page.getByLabel("Category", { exact: true }).fill("Security");
  await page.getByLabel("Question text", { exact: true }).fill(question);
  await page.getByLabel("Option 1", { exact: true }).fill("Report to IT");
  await page.getByLabel("Option 2", { exact: true }).fill("Share the password");
  await page
    .getByRole("button", { name: "Save question", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: question, exact: true }),
  ).toBeVisible();
  await navigateArea(page, 'Exams');
  await page.getByRole("button", { name: "New exam", exact: true }).click();
  const title = "Randomized bank exam " + Date.now();
  await page.getByLabel("Exam title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Add from question bank" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByLabel("Exam title", { exact: true })).toHaveValue(
    title,
  );
  expect(await page.evaluate(() => document.body.style.overflow)).toBe(
    "hidden",
  );
  await expect(
    page.getByRole("button", { name: "Add from question bank" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Add from question bank" }).click();
  await page.getByLabel("Search question bank").fill(question);
  await page.getByLabel("Search question bank").press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(2);
  await page.getByRole("checkbox", { name: new RegExp(question) }).check();
  await page.getByRole("button", { name: /Add selected questions/ }).click();
  await moreOptions(page);
  await page.getByLabel("Shuffle question order").check();
  await page.getByLabel("Shuffle answer options").check();
  await page.getByLabel("Questions per attempt").fill("1");
  await page.getByLabel("Publish exam", { exact: true }).check();
  await page.getByRole("button", { name: "Save exam", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  const exam = await page.evaluate(
    async (title) =>
      (await (await fetch("/api/exams/")).json()).find(
        (e: { title: string }) => e.title === title,
      ),
    title,
  );
  expect(exam.shuffle_questions).toBe(true);
  expect(exam.shuffle_options).toBe(true);
  expect(exam.questions_per_attempt).toBe(1);
  expect(exam.questions[0].description).toBe(question);
  const attempt = await post<{ id: string }>(
    page,
    `exams/${exam.id}/start/`,
    {},
  );
  await page.goto("/attempt/" + attempt.id);
  await page.getByRole("radio", { name: /Report to IT/ }).check();
  await page
    .getByRole("button", { name: "Finish and submit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm submission", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Congratulations, you passed" }),
  ).toBeVisible();
  await previewWorkflow(page);
});

test("numeric, ordering and text rules round-trip through authoring, resume, grading and reports", async ({
  page,
}) => {
  test.setTimeout(120000);
  await login(page);
  const suffix = Date.now();
  const bankTitle = `Calibration alternatives ${suffix}`;
  const textTitle = `Release phrase ${suffix}`;
  const examTitle = `Numeric and procedure assessment ${suffix}`;
  await page.goto("/question-bank");
  await page
    .getByRole("button", { name: "Create question", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Question text", { exact: true }).fill(bankTitle);
  await modal
    .getByRole("combobox", { name: "Question type", exact: true })
    .selectOption("numeric");
  await modal.getByLabel("Accepted number 1", { exact: true }).fill("12.5");
  await modal
    .getByLabel("Tolerance 1", { exact: true })
    .fill("0.05");
  await modal
    .getByRole("button", { name: "Add accepted answer", exact: true })
    .click();
  await modal.getByLabel("Accepted number 2", { exact: true }).fill("-12.5");
  await modal
    .getByLabel("Tolerance 2", { exact: true })
    .fill("0.01");
  await modal.locator(".language-picker select").selectOption("es");
  await expect(
    modal.getByLabel("Número aceptado 2", { exact: true }),
  ).toHaveValue("-12.5");
  await expect(
    modal.getByLabel("Tolerancia 2", { exact: true }),
  ).toHaveValue("0.01");
  await modal.locator(".language-picker select").selectOption("zh-TW");
  await expect(
    modal.getByLabel("容許誤差 1", { exact: true }),
  ).toHaveValue("0.05");
  await modal.locator(".language-picker select").selectOption("en");
  await modal
    .getByRole("button", { name: "Save question", exact: true })
    .click();
  const bankRow = page.getByRole("row").filter({ hasText: bankTitle });
  await bankRow.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    modal.getByLabel("Tolerance 2", { exact: true }),
  ).toHaveValue("0.01");
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();

  await page
    .getByRole("button", { name: "Create question", exact: true })
    .click();
  await modal.getByLabel("Question text", { exact: true }).fill(textTitle);
  await modal
    .getByRole("combobox", { name: "Question type", exact: true })
    .selectOption("short");
  await modal
    .getByRole("textbox", { name: "Accepted text 1", exact: true })
    .fill("Release  Ready\nChecked");
  await modal
    .getByRole("combobox", { name: "Matching rule 1", exact: true })
    .selectOption("exact");
  await modal
    .getByRole("button", { name: "Add accepted answer", exact: true })
    .click();
  await modal
    .getByRole("textbox", { name: "Accepted text 2", exact: true })
    .fill("Approved");
  await modal
    .getByRole("combobox", { name: "Matching rule 2", exact: true })
    .selectOption("lower");
  // Removing an alternative must remove its matching rule at the same index.
  await modal
    .getByRole("button", { name: "Add accepted answer", exact: true })
    .click();
  await modal
    .getByRole("button", { name: "Remove accepted answer 3", exact: true })
    .click();
  await modal.locator(".language-picker select").selectOption("es");
  await expect(
    modal.getByRole("combobox", {
      name: "Coincidencia 2",
      exact: true,
    }),
  ).toHaveValue("lower");
  await expect(
    modal.getByRole("textbox", { name: "Texto aceptado 1", exact: true }),
  ).toHaveValue("Release  Ready\nChecked");
  await modal.locator(".language-picker select").selectOption("zh-TW");
  await expect(
    modal.getByRole("combobox", { name: "比對規則 1", exact: true }),
  ).toHaveValue("exact");
  await modal.locator(".language-picker select").selectOption("en");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/training-text-authoring-mobile.png",
    fullPage: true,
  });
  await modal
    .getByRole("button", { name: "Save question", exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("row")
    .filter({ hasText: textTitle })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await expect(
    modal.getByRole("textbox", { name: "Accepted text 1", exact: true }),
  ).toHaveValue("Release  Ready\nChecked");
  await expect(
    modal.getByRole("combobox", {
      name: "Matching rule 2",
      exact: true,
    }),
  ).toHaveValue("lower");
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.goto("/exams");
  await page.getByRole("button", { name: "New exam", exact: true }).click();
  await modal.getByLabel("Exam title", { exact: true }).fill(examTitle);
  await modal.getByLabel("Question 1 type").selectOption("integer");
  await modal
    .getByLabel("Question 1 content")
    .fill("Enter the exact equipment count");
  await modal
    .getByLabel("Accepted number 1", { exact: true })
    .fill("9007199254740993");
  await modal.getByRole("button", { name: "Add from question bank" }).click();
  const picker = page.getByRole("dialog", {
    name: "Add from question bank",
    exact: true,
  });
  await picker.getByLabel("Search question bank").fill(bankTitle);
  await picker.getByRole("checkbox", { name: new RegExp(bankTitle) }).check();
  await picker.getByRole("button", { name: /Add selected questions/ }).click();
  await modal
    .getByRole("button", { name: "Add question", exact: true })
    .click();
  await modal.getByLabel("Question 3 type").selectOption("ordering");
  await modal
    .getByLabel("Question 3 content")
    .fill("Arrange the safety procedure");
  await modal
    .getByLabel("Correct order")
    .fill("Isolate\nVerify\nMaintain");
  await modal.getByRole("button", { name: "Add from question bank" }).click();
  await picker.getByLabel("Search question bank").fill(textTitle);
  await picker.getByRole("checkbox", { name: new RegExp(textTitle) }).check();
  await picker.getByRole("button", { name: /Add selected questions/ }).click();
  await modal
    .getByRole("button", { name: "Add question", exact: true })
    .click();
  await modal.getByLabel("Question 5 type").selectOption("short");
  await modal
    .getByLabel("Question 5 content")
    .fill("Enter CaseID with exact capitalization");
  const strict = modal.locator(".question-editor").last();
  await strict
    .getByRole("textbox", { name: "Accepted text 1", exact: true })
    .fill("CaseID");
  await strict
    .getByRole("combobox", { name: "Matching rule 1", exact: true })
    .selectOption("exact");
  await modal.getByLabel("Publish exam", { exact: true }).check();
  await modal.getByRole("button", { name: "Save exam", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: examTitle, exact: true }),
  ).toBeVisible();
  const exam = (await (await page.request.get("/api/exams/")).json()).find(
    (row: { title: string }) => row.title === examTitle,
  );
  expect(exam.questions.map((q: { type: string }) => q.type)).toEqual([
    "integer",
    "numeric",
    "ordering",
    "short",
    "short",
  ]);
  expect(exam.questions[1].answer_tolerances).toEqual(["0.05", "0.01"]);
  expect(exam.questions[3].answer_matching).toEqual(["exact", "lower"]);
  const attempt = await post<{
    id: string;
    questions: {
      solution?: unknown;
      answer_tolerances?: unknown;
      answer_matching?: unknown;
    }[];
  }>(page, `exams/${exam.id}/start/`, {});
  for (const question of attempt.questions) {
    expect(question.solution).toBeUndefined();
    expect(question.answer_tolerances).toBeUndefined();
    expect(question.answer_matching).toBeUndefined();
  }
  await page.goto(`/attempt/${attempt.id}`);
  await page
    .getByLabel("Your answer", { exact: true })
    .fill("9007199254740993");
  await page
    .getByRole("button", { name: "Next question", exact: true })
    .click();
  // The second allowed value has its own tolerance; this is its inclusive boundary.
  await page.getByLabel("Your answer", { exact: true }).fill("-12.51");
  await page
    .getByRole("button", { name: "Next question", exact: true })
    .click();
  const ordered = page.getByRole("group", { name: "Your ordered answer" });
  const targets = ["Isolate", "Verify", "Maintain"];
  for (let target = 0; target < targets.length; target++) {
    for (let moves = 0; moves < targets.length; moves++) {
      const current = await ordered.locator(".order-text").allTextContents();
      const position = current.indexOf(targets[target]);
      if (position === target) break;
      const button = ordered
        .getByRole("listitem")
        .nth(position)
        .getByRole("button", { name: / up$/ });
      await button.focus();
      await page.keyboard.press("Enter");
    }
  }
  const confirmOrder = ordered.getByRole("button", {
    name: "Use this order",
    exact: true,
  });
  if (await confirmOrder.isVisible()) await confirmOrder.click();
  await expect(ordered.locator(".order-text")).toHaveText(targets);
  await expect(page.getByRole("status")).toContainText(
    "Answers saved automatically",
  );
  await page
    .getByRole("button", { name: "Next question", exact: true })
    .click();
  await page.getByLabel("Your answer", { exact: true }).fill("APPROVED");
  await page
    .getByRole("button", { name: "Next question", exact: true })
    .click();
  await page.getByLabel("Your answer", { exact: true }).fill("caseid");
  await expect(page.getByRole("status")).toContainText(
    "Answers saved automatically",
  );
  await page.reload();
  await expect(page.getByLabel("Your answer", { exact: true })).toHaveValue(
    "9007199254740993",
  );
  await page
    .getByRole("button", { name: "Next question", exact: true })
    .click();
  await expect(page.getByLabel("Your answer", { exact: true })).toHaveValue(
    "-12.51",
  );
  await page
    .getByRole("button", { name: "Next question", exact: true })
    .click();
  await expect(ordered.locator(".order-text")).toHaveText(targets);
  await page.locator(".language-picker select").selectOption("es");
  await expect(
    page.getByRole("group", { name: "Tu respuesta ordenada" }),
  ).toBeVisible();
  await page.locator(".language-picker select").selectOption("zh-TW");
  await expect(page.getByRole("group", { name: "您的排序答案" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator(".language-picker select").selectOption("en");
  await page
    .getByRole("button", { name: "Next question", exact: true })
    .click();
  await expect(page.getByLabel("Your answer", { exact: true })).toHaveValue(
    "APPROVED",
  );
  await page
    .getByRole("button", { name: "Next question", exact: true })
    .click();
  await expect(page.getByLabel("Your answer", { exact: true })).toHaveValue(
    "caseid",
  );
  await page
    .getByRole("button", { name: "Finish and submit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm submission", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Congratulations, you passed" }),
  ).toBeVisible();
  await expect(page.locator(".result-score")).toContainText("80");
  await expect(page.locator(".response-item").nth(2)).toContainText(
    "1. Isolate\n2. Verify\n3. Maintain",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  const reviewed = await (
    await page.request.get(`/api/results/${attempt.id}/review/`)
  ).json();
  expect(reviewed.questions[1].answer_tolerances).toEqual(["0.05", "0.01"]);
  expect(reviewed.questions[3].answer_matching).toEqual(["exact", "lower"]);
  await page.goto("/results");
  await page.getByLabel("Filter by exam").selectOption(String(exam.id));
  await page
    .getByRole("row")
    .filter({ hasText: examTitle })
    .getByRole("button", { name: "View attempt", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: "Review attempt",
    exact: true,
  });
  await expect(review.locator(".accepted-answer")).toHaveText([
    "9007199254740993",
    "12.5 ± 0.05\n-12.5 ± 0.01",
    "1. Isolate\n2. Verify\n3. Maintain",
    "Match case and spacing:\nRelease  Ready\nChecked\nIgnore case; preserve spacing:\nApproved",
    "Match case and spacing:\nCaseID",
  ]);
  await review.locator(".accepted-answer").nth(3).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "/tmp/training-text-review.png",
    fullPage: true,
  });
  await review
    .getByRole("button", { name: "Close", exact: true })
    .last()
    .click();
  await page.goto("/insights");
  await page.getByLabel("Select assessment").selectOption(String(exam.id));
  const analysis = page.getByRole("row").filter({ hasText: bankTitle });
  await expect(analysis).toContainText("Numeric answer");
  await expect(analysis).toContainText("100%");
  await expect(
    page.getByRole("row").filter({ hasText: textTitle }),
  ).toContainText("100%");
  const strictAnalysis = page
    .getByRole("row")
    .filter({ hasText: "Enter CaseID with exact capitalization" });
  await expect(strictAnalysis).toContainText("Short answer");
  await expect(strictAnalysis.getByText("0%", { exact: true })).toBeVisible();
});

test("CSV preview imports learners, profile edits persist, and new pages translate", async ({
  page,
}) => {
  await login(page);
  const username = "csvuser" + Date.now();
  await page
    .getByRole("link", { name: "People", exact: true })
    .click();
  await page.getByRole("button", { name: "Import participants" }).click();
  await page
    .getByLabel("CSV content")
    .fill(
      `username,email,display_name,department,employment\n${username},${username}@example.com,CSV Participant,Operations,contractor\n`,
    );
  await expect(
    page.getByRole("button", { name: "Create learner accounts" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Validate preview" }).click();
  await expect(
    page.getByText("All 1 rows are valid. Ready to import."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create learner accounts" }).click();
  await expect(page.getByText("Created 1 learner accounts.")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .last()
    .click();
  const row = page.getByRole("row").filter({ hasText: username });
  await row.getByRole("button", { name: "Edit person" }).click();
  await page
    .getByLabel("Display name", { exact: true })
    .fill("Updated Participant");
  await page.getByLabel("Department", { exact: true }).fill("Quality");
  await page.getByRole("button", { name: "Save person" }).click();
  await expect(row).toContainText("Updated Participant");
  await expect(row).toContainText("Quality");
  await navigateArea(page, 'Training', 'Assignments');
  await page.locator(".language-picker select").first().selectOption("es");
  await expect(
    page.getByRole("heading", { name: "Formación asignada", exact: true }),
  ).toBeVisible();
  await page.locator(".language-picker select").first().selectOption("zh-TW");
  await expect(
    page.getByRole("heading", { name: "指派訓練", exact: true }),
  ).toBeVisible();
  await page.locator(".language-picker select").first().selectOption("en");
  await navigateArea(page, 'Settings', 'Settings');
  await page.getByText("Advanced maintenance", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Deployment readiness" }),
  ).toBeVisible();
  await expect(
    page.getByText("Verification needed", { exact: true }),
  ).toBeVisible();
  await peopleManagementWorkflow(page);
});

test("slow autosaves preserve newer edits and submission waits before showing instructor feedback", async ({
  page,
}) => {
  await login(page);
  const exam = await post<{ id: number }>(page, "exams/", {
    title: "Reliable written response " + Date.now(),
    published: true,
    questions: [
      {
        type: "essay",
        description: "Explain your safety procedure",
        points: 10,
        options: [],
        solution: [],
      },
    ],
  });
  const attempt = await post<{ id: string; questions: { id: number }[] }>(
    page,
    `exams/${exam.id}/start/`,
    {},
  );
  const endpoint = `**/api/attempts/${attempt.id}/`;
  let patches = 0,
    posts = 0,
    release: (() => void) | undefined;
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "POST") posts++;
    if (route.request().method() === "PATCH") {
      patches++;
      if (patches === 1 || patches === 3) {
        const response = await route.fetch();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        await route.fulfill({ response });
        return;
      }
    }
    await route.continue();
  });
  await page.goto("/attempt/" + attempt.id);
  const answer = page.getByRole("textbox", { name: "Your answer" });
  await answer.fill("Initial draft");
  await expect.poll(() => !!release).toBe(true);
  await answer.fill("Newer draft written during the save");
  release!();
  release = undefined;
  await expect(page.getByRole("status")).toHaveText(
    "Answers saved automatically",
  );
  expect(patches).toBe(2);
  await answer.fill("Draft before submission");
  await expect.poll(() => !!release).toBe(true);
  await answer.fill(
    "Final response: isolate the hazard and notify the supervisor.",
  );
  await page
    .getByRole("button", { name: "Finish and submit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm submission", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Submitting…", exact: true }),
  ).toBeDisabled();
  expect(posts).toBe(0);
  release!();
  await expect(
    page.getByRole("heading", {
      name: "Submitted, awaiting instructor review",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Final response: isolate the hazard and notify the supervisor.",
      { exact: true },
    ),
  ).toBeVisible();
  await post(page, `results/${attempt.id}/review/`, {
    grades: {
      [attempt.questions[0].id]: {
        points: 9,
        feedback: "Clear escalation steps. Include the incident record.",
      },
    },
  });
  await page.reload();
  await expect(
    page.getByText("Clear escalation steps. Include the incident record.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Instructor review · 9 / 10 points", { exact: true }),
  ).toBeVisible();
  const result = await (
    await page.request.get(`/api/attempts/${attempt.id}/`)
  ).json();
  expect(result.answer_revision).toBe(4);
  expect(result.questions[0]).not.toHaveProperty("solution");
});

test("conflicting tabs require recovery and a failed save retries without losing local answers", async ({
  page,
  context,
}) => {
  await login(page);
  const exam = await post<{ id: number }>(page, "exams/", {
    title: "Cross-window recovery " + Date.now(),
    published: true,
    questions: [
      {
        type: "essay",
        description: "Describe the handover",
        points: 10,
        options: [],
        solution: [],
      },
    ],
  });
  const attempt = await post<{ id: string }>(
    page,
    `exams/${exam.id}/start/`,
    {},
  );
  await page.goto("/attempt/" + attempt.id);
  const other = await context.newPage();
  await other.goto("/attempt/" + attempt.id);
  await expect(
    other.getByRole("textbox", { name: "Your answer" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Your answer" })
    .fill("Saved in the first window");
  await expect(page.getByRole("status")).toHaveText(
    "Answers saved automatically",
  );
  await other
    .getByRole("textbox", { name: "Your answer" })
    .fill("Conflicting local draft");
  await expect(
    other.getByText(
      "This attempt was updated in another window. Reload saved answers before continuing.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(other.getByRole("textbox", { name: "Your answer" })).toHaveValue(
    "Conflicting local draft",
  );
  await expect(
    other.getByRole("button", { name: "Submit", exact: true }),
  ).toBeDisabled();
  await other
    .getByRole("button", { name: "Reload saved answers", exact: true })
    .click();
  await expect(other.getByRole("textbox", { name: "Your answer" })).toHaveValue(
    "Saved in the first window",
  );
  let offline = true;
  await other.route(`**/api/attempts/${attempt.id}/`, async (route) => {
    if (offline && route.request().method() === "PATCH")
      await route.abort("connectionfailed");
    else await route.continue();
  });
  await other
    .getByRole("textbox", { name: "Your answer" })
    .fill("Recovered after a connection failure");
  await expect(other.getByRole("status")).toHaveText("Save failed");
  await expect(other.getByRole("textbox", { name: "Your answer" })).toHaveValue(
    "Recovered after a connection failure",
  );
  offline = false;
  // The automatic backoff should recover without needing another keystroke.
  await expect(other.getByRole("status")).toHaveText(
    "Answers saved automatically",
    { timeout: 10000 },
  );
  const saved = await (
    await other.request.get(`/api/attempts/${attempt.id}/`)
  ).json();
  expect(Object.values(saved.answers)).toEqual([
    "Recovered after a connection failure",
  ]);
  expect(saved.answer_revision).toBe(2);
  await other.close();
});

test("invitation batches validate aliases, translate, and recover committed links after a lost response", async ({
  page,
  browser,
}) => {
  await login(page);
  const title = "=Cohort recovery " + Date.now();
  const exam = await post<{ id: number }>(page, "exams/", {
    title,
    duration_minutes: 5,
    max_attempts: 1,
    pass_score: 70,
    published: true,
    questions: [
      {
        description: "Cohort assessment",
        type: "single",
        options: ["Report to IT", "Ignore"],
        solution: [0],
        points: 100,
      },
    ],
  });
  await navigateArea(page, 'Exams', 'Guest invitations');
  await page
    .getByRole("button", { name: "Create invitation batch", exact: true })
    .click();
  let modal = page.getByRole("dialog", {
    name: "Create invitation batch",
    exact: true,
  });
  await modal.getByLabel("Select exam").selectOption(String(exam.id));
  await expect(
    modal.getByLabel("Require recipient email verification"),
  ).toBeChecked();
  await modal
    .getByLabel("Recipient CSV")
    .fill("key\nadmin@example.com\nE0001\n");
  await modal
    .getByRole("button", { name: "Validate recipients", exact: true })
    .click();
  await expect(
    modal.getByText(
      "This participant appears more than once, possibly under another sign-in identifier.",
    ),
  ).toBeVisible();
  await expect(
    modal.getByRole("button", { name: "Create invitation links", exact: true }),
  ).toBeDisabled();
  const email = `cohort-${Date.now()}@example.com`;
  const csv = `key\n${email}\nsecond-${email}\n`;
  await modal.locator('input[type="file"]').setInputFiles({
    name: "cohort.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await expect(modal.getByLabel("Recipient CSV")).toHaveValue(csv);
  await modal
    .getByRole("combobox", { name: "Interface language" })
    .selectOption("es");
  modal = page.getByRole("dialog", {
    name: "Crear lote de invitaciones",
    exact: true,
  });
  await expect(modal.getByLabel("CSV de destinatarios")).toHaveValue(csv);
  await modal
    .getByRole("combobox", { name: "Idioma de la interfaz" })
    .selectOption("zh-TW");
  modal = page.getByRole("dialog", { name: "建立批次邀請", exact: true });
  await expect(modal.getByLabel("收件者 CSV")).toHaveValue(csv);
  await modal.locator(".language-picker select").selectOption("en");
  modal = page.getByRole("dialog", {
    name: "Create invitation batch",
    exact: true,
  });
  await modal.getByLabel("Require recipient email verification").uncheck();
  await modal
    .getByRole("button", { name: "Validate recipients", exact: true })
    .click();
  await expect(
    modal.getByText(
      "All 2 recipients are valid. No links have been created yet.",
    ),
  ).toBeVisible();
  const requests: { request_id: string }[] = [];
  await page.route("**/api/invitations/bulk/", async (route) => {
    const payload = route.request().postDataJSON();
    if (!payload.apply) return route.continue();
    requests.push(payload);
    const response = await route.fetch();
    if (requests.length === 1) {
      expect(response.status()).toBe(201);
      await route.abort("connectionfailed");
    } else {
      expect(response.status()).toBe(200);
      expect((await response.json()).replayed).toBe(true);
      await route.fulfill({ response });
    }
  });
  await modal
    .getByRole("button", { name: "Create invitation links", exact: true })
    .click();
  await expect(
    modal.getByRole("button", { name: "Retry batch request", exact: true }),
  ).toBeEnabled();
  await expect(modal.getByLabel("Recipient CSV")).toBeDisabled();
  await modal
    .getByRole("button", { name: "Retry batch request", exact: true })
    .click();
  modal = page.getByRole("dialog", {
    name: "Batch invitations created",
    exact: true,
  });
  await expect(
    modal.getByText("Created 2 personal invitation links."),
  ).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  const url = await modal
    .getByLabel(`Link for email:${email}`, { exact: true })
    .inputValue();
  await modal
    .getByRole("button", { name: "Close", exact: true })
    .last()
    .click();
  const confirm = page.getByRole("dialog", {
    name: "Close invitation batch?",
    exact: true,
  });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Keep open", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await modal
    .getByRole("button", { name: "Download invitation links CSV", exact: true })
    .click();
  const contents = await downloadText(await downloaded);
  expect(contents.split("\r\n").filter(Boolean)).toHaveLength(3);
  expect(contents).toContain(`"'${title}"`);
  expect(contents).toContain(url);
  await modal
    .getByRole("button", { name: "Close", exact: true })
    .last()
    .click();
  await page.getByLabel("Filter by exam").selectOption(String(exam.id));
  await expect(
    page.getByText("2 matching invitations", { exact: true }),
  ).toBeVisible();
  const history = await (
    await page.request.get(`/api/invitations/?page=1&exam=${exam.id}`)
  ).json();
  expect(
    new Set(history.results.map((row: { batch: string }) => row.batch)).size,
  ).toBe(1);
  expect(JSON.stringify(history)).not.toContain(url.split("#")[1]);
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await guest.goto(url);
    await guest
      .getByRole("button", { name: "Start / resume exam", exact: true })
      .click();
    await expect(
      guest.getByRole("heading", { name: "Cohort assessment" }),
    ).toBeVisible();
    await page
      .getByRole("row")
      .filter({ has: page.getByText(email, { exact: true }) })
      .getByRole("button", { name: "Disable", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Disable invitation?", exact: true })
      .getByRole("button", { name: "Disable invitation", exact: true })
      .click();
    await guest.reload();
    await expect(guest.getByRole("alert")).toContainText(/revoked|expired/i);
  } finally {
    await context.close();
  }
});

test("invitation history pages and filters a cohort and confirms revocation", async ({
  page,
  browser,
}) => {
  await login(page);
  await notificationCourseLinkWorkflow(page, browser);
  const title = "Cohort history " + Date.now();
  const exam = await post<{ id: number }>(page, "exams/", {
    title,
    duration_minutes: 5,
    max_attempts: 2,
    published: true,
    questions: [
      {
        description: "History assessment",
        type: "single",
        options: ["Safe", "Unsafe"],
        solution: [0],
        points: 100,
      },
    ],
  });
  await post(page, "invitations/bulk/", {
    exam: exam.id,
    csv:
      "key\n" +
      Array.from(
        { length: 28 },
        (_, i) => `history-${exam.id}-${i}@example.com`,
      ).join("\n"),
    apply: true,
    request_id: crypto.randomUUID(),
    max_attempts: 1,
    days: 7,
  });
  await navigateArea(page, 'Exams', 'Guest invitations');
  await page.getByLabel("Search invitations").fill(title);
  await expect(
    page.getByText("28 matching invitations", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(25);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByText("Page 2 of 2", { exact: true })).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(3);
  const row = page.locator("tbody tr").first();
  const participant = await row.locator("td").first().innerText();
  await row.getByRole("button", { name: "Disable", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Disable invitation?", exact: true })
    .getByRole("button", { name: "Keep invitation", exact: true })
    .click();
  await expect(
    row.getByRole("button", { name: "Disable", exact: true }),
  ).toBeEnabled();
  await row.getByRole("button", { name: "Disable", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Disable invitation?", exact: true })
    .getByRole("button", { name: "Disable invitation", exact: true })
    .click();
  await page.getByLabel("Invitation status").selectOption("revoked");
  await expect(
    page.getByText("1 matching invitations", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText(participant);
  await page.getByLabel("Invitation status").selectOption("active");
  await expect(
    page.getByText("27 matching invitations", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Search invitations")
    .fill("nonexistent-cohort-recipient");
  await expect(
    page.getByText("No matching invitations", { exact: true }),
  ).toBeVisible();
});
