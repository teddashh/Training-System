import { test, expect, type Page } from "@playwright/test";

async function downloadText(download: import("@playwright/test").Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Download stream is unavailable");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/^\uFEFF/, "");
}

async function login(page: Page) {
  // This suite creates many independent browser sessions behind one IP.
  // Honor the application's Retry-After response instead of disabling limits.
  for (let retry = 0; retry < 3; retry++) {
    const session = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/auth/session/",
    );
    await page.goto("/");
    const response = await session;
    if (response.status() !== 429) {
      expect(response.status()).toBe(200);
      break;
    }
    const seconds = Number(response.headers()["retry-after"]);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(60);
    expect(
      retry,
      "Session remained throttled after bounded retries",
    ).toBeLessThan(2);
    const delay = (seconds + 1) * 1000;
    test.setTimeout(test.info().timeout + delay);
    await page.waitForTimeout(delay);
  }
  await page
    .getByLabel("Email, username or employee ID")
    .fill("admin@evitina.example");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.DEMO_PASSWORD || "Demo-Training-2026!");
  await page
    .getByRole("button", { name: "Sign in to workspace", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Learning & development overview" }),
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
}) => {
  test.setTimeout(90000);
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
});

test("individual attempt limit is visible and a final active attempt can resume", async ({
  page,
}) => {
  await login(page);
  const title = "Individual budget " + Date.now();
  const exam = await post<{ id: number }>(page, "exams/", {
    title,
    published: true,
    max_attempts: 3,
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
    key: "admin@evitina.example",
    limit: 1,
  });
  await page.goto("/exams");
  const card = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(card).toContainText("Your limit 1 attempts");
  await card
    .getByRole("button", { name: "Start / resume", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Ready to start?",
    exact: true,
  });
  await expect(dialog).toContainText("1 new attempts remaining");
  await dialog
    .getByRole("button", { name: "Start / resume attempt", exact: true })
    .click();
  await expect(page).toHaveURL(/\/attempt\//);
  const attemptUrl = page.url();
  await page.goto("/exams");
  await card
    .getByRole("button", { name: "Start / resume", exact: true })
    .click();
  await expect(dialog).toContainText("0 new attempts remaining");
  await expect(dialog).toContainText(
    "Resuming it does not use another attempt.",
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
  await page.goto("/exams");
  await expect(
    card.getByRole("button", { name: "Start / resume", exact: true }),
  ).toBeDisabled();
  await expect(card).toContainText("Used 1 attempts");
});

test("dashboard, responsive navigation, library and persisted course editor", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await expect(
    page.getByText("Training participants", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Learning courses", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create course", exact: true })
    .click();
  const title = "Browser test course " + Date.now();
  await page.getByLabel("Course title", { exact: true }).fill(title);
  await page
    .getByLabel("Block 2 content")
    .fill("A lesson paragraph used to verify saving and reloading.");
  await page.getByLabel("Publish this course so learners can start").check();
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
  await page
    .getByRole("link", { name: "Overview Dashboard", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Learning & development overview" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});

test("guest invitation allows a bounded standalone exam and rejects a second attempt", async ({
  page,
  browser,
}) => {
  await login(page);
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
  await expect(
    guest.getByRole("heading", { name: "Welcome to your assessment" }),
  ).toBeVisible();
  await guest
    .getByRole("button", { name: "Start / resume exam", exact: true })
    .click();
  await expect(
    guest.getByRole("heading", { name: "Choose the safe action" }),
  ).toBeVisible();
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
    `<!doctype html><html><body><h1>SCORM test lesson</h1><p id="resume"></p><button id="finish">Complete lesson</button><script>const api=parent.API;api.LMSInitialize('');document.getElementById('resume').textContent=api.LMSGetValue('cmi.suspend_data');document.getElementById('finish').onclick=()=>{api.LMSSetValue('cmi.suspend_data','bookmark-saved');api.LMSSetValue('cmi.core.lesson_status','completed');api.LMSCommit('')};</script></body></html>`,
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
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await card.getByRole("button", { name: "Learn again", exact: true }).click();
  await expect(sco.getByText("bookmark-saved", { exact: true })).toBeVisible();
});

test("Scormly publishes a real package and editable backup to the LMS", async ({
  page,
}) => {
  await login(page);
  const course = await post<{ id: number }>(page, "courses/", {
    title: "Scormly publish test " + Date.now(),
    published: true,
    blocks: [],
  });
  await page.goto("/studio/#/app");
  await page.getByRole("button", { name: /Explore the demo course/ }).click();
  await expect(
    page
      .getByRole("button", { name: "Publish to LMS", exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Publish to LMS", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page.getByLabel("Select a company course")).toBeVisible();
  await page
    .getByLabel("Select a company course")
    .selectOption(String(course.id));
  await page
    .getByRole("button", { name: "Publish to LMS", exact: true })
    .filter({ visible: true })
    .last()
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Published. The package" }),
  ).toBeVisible({ timeout: 20000 });
  const response = await page.request.get(`/api/courses/${course.id}/source/`);
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["content-type"]).toBe("application/zip");
});

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
}) => {
  await login(page);
  await page
    .getByRole("link", { name: "Learning courses", exact: true })
    .click();
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
    modal.getByRole("button", { name: "Guardar curso", exact: true }),
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
    page.getByRole("heading", { name: "學習課程", exact: true }),
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
    page.getByRole("button", { name: /探索示範課程/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /探索示範課程/ }).click();
  await expect(
    page
      .getByRole("button", { name: "發布至 LMS", exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "介面語言", exact: true })
    .filter({ visible: true })
    .click();
  await page.getByRole("button", { name: "Español", exact: true }).click();
  await expect(
    page
      .getByRole("button", { name: "Publicar en LMS", exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Resumen de formación y desarrollo",
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

test("exam editor persists selected people across language switches and reloads", async ({
  page,
}) => {
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
        points: 100,
      },
    ],
  });
  const audience = await (
    await page.request.get("/api/exams/audience-options/")
  ).json();
  const person = audience.people.find(
    (p: { username: string }) => p.username === "demo.learner1",
  );
  await page.goto("/exams");
  await page
    .getByRole("button", { name: "Edit " + title, exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal
    .getByLabel("Who can take this exam?", { exact: true })
    .selectOption("people");
  const label =
    person.display_name + (person.department ? " · " + person.department : "");
  await modal.getByRole("checkbox", { name: label, exact: true }).check();
  await modal.locator(".language-picker select").selectOption("es");
  await expect(
    modal.getByRole("checkbox", { name: label, exact: true }),
  ).toBeChecked();
  await modal.locator(".language-picker select").selectOption("en");
  await modal.getByRole("button", { name: "Save exam", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("button", { name: "Edit " + title, exact: true })
    .click();
  await expect(
    modal.getByLabel("Who can take this exam?", { exact: true }),
  ).toHaveValue("people");
  await expect(
    modal.getByRole("checkbox", { name: label, exact: true }),
  ).toBeChecked();
  const stored = await (
    await page.request.get(`/api/exams/${exam.id}/`)
  ).json();
  expect(stored.allowed_users).toEqual([person.id]);
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
  page,
}) => {
  await login(page);
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
  await dialog
    .getByLabel("Training", { exact: true })
    .selectOption(String(course.id));
  await dialog.getByLabel("Alex Morgan", { exact: false }).check();
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
  await page
    .getByRole("button", { name: "Mark as completed", exact: true })
    .click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("link", { name: "Assigned training", exact: true })
    .click();
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
});

test("question bank creates reusable questions and randomized exam settings persist", async ({
  page,
}) => {
  await login(page);
  const question = "Reusable security question " + Date.now();
  await page.getByRole("link", { name: "Question bank", exact: true }).click();
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
  await page
    .getByRole("link", { name: "Exams & assessments", exact: true })
    .click();
  await page.getByRole("button", { name: "Create exam", exact: true }).click();
  const title = "Randomized bank exam " + Date.now();
  await page.getByLabel("Exam title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Add from question bank" }).click();
  await page.getByLabel("Search question bank").fill(question);
  await page.getByRole("checkbox", { name: new RegExp(question) }).check();
  await page.getByRole("button", { name: /Add selected questions/ }).click();
  await page.getByLabel("Shuffle question order").check();
  await page.getByLabel("Shuffle answer options").check();
  await page.getByLabel("Questions per attempt (blank uses all)").fill("1");
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
});

test("CSV preview imports learners, profile edits persist, and new pages translate", async ({
  page,
}) => {
  await login(page);
  const username = "csvuser" + Date.now();
  await page
    .getByRole("link", { name: "People & permissions", exact: true })
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
  await page
    .getByRole("link", { name: "Assigned training", exact: true })
    .click();
  await page.locator(".language-picker select").first().selectOption("es");
  await expect(
    page.getByRole("heading", { name: "Formación asignada", exact: true }),
  ).toBeVisible();
  await page.locator(".language-picker select").first().selectOption("zh-TW");
  await expect(
    page.getByRole("heading", { name: "指派訓練", exact: true }),
  ).toBeVisible();
  await page.locator(".language-picker select").first().selectOption("en");
  await page
    .getByRole("link", { name: "Settings & audit", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Deployment readiness" }),
  ).toBeVisible();
  await expect(
    page.getByText("Connect on Peach1", { exact: true }),
  ).toBeVisible();
});
