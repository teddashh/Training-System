import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("E-mail、帳號或員工編號").fill("admin@evitina.example");
  await page
    .getByLabel("密碼", { exact: true })
    .fill(process.env.DEMO_PASSWORD || "Demo-Training-2026!");
  await page.getByRole("button", { name: "登入工作空間", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "人才發展總覽" }),
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

test("dashboard, responsive navigation, library and persisted course editor", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await expect(page.getByText("培訓人員", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "學習課程", exact: true }).click();
  await page.getByRole("button", { name: "建立課程", exact: true }).click();
  const title = "瀏覽器測試課程 " + Date.now();
  await page.getByLabel("課程名稱", { exact: true }).fill(title);
  await page
    .getByLabel("區塊 2 內容")
    .fill("這是一個驗證儲存與重載的教材段落。");
  await page.getByLabel("發布課程，讓學員可以開始學習").check();
  await page.getByRole("button", { name: "儲存課程", exact: true }).click();
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
  await card.getByRole("button", { name: "開始學習", exact: true }).click();
  await expect(
    page.getByText("這是一個驗證儲存與重載的教材段落。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "標記為已完成", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "已完成學習", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "關閉", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "開啟導覽", exact: true }).click();
  await page.getByRole("link", { name: "總覽 Dashboard", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "人才發展總覽" }),
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
    title: "訪客額度測試 " + Date.now(),
    description: "一個獨立測驗",
    duration_minutes: 5,
    max_attempts: 1,
    pass_score: 70,
    published: true,
    questions: [
      {
        description: "請選擇安全的做法",
        type: "single",
        options: ["回報資訊窗口", "公開分享密碼"],
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
    guest.getByRole("heading", { name: "歡迎參與評量" }),
  ).toBeVisible();
  await guest
    .getByRole("button", { name: "開始／繼續考試", exact: true })
    .click();
  await expect(
    guest.getByRole("heading", { name: "請選擇安全的做法" }),
  ).toBeVisible();
  await guest.getByLabel("A回報資訊窗口").check();
  await guest.getByRole("button", { name: "完成交卷", exact: true }).click();
  await guest.getByRole("button", { name: "確認交卷", exact: true }).click();
  await expect(
    guest.getByRole("heading", { name: "恭喜，通過本次評量" }),
  ).toBeVisible();
  await guest.getByRole("button", { name: "返回邀請頁" }).click();
  await guest
    .getByRole("button", { name: "開始／繼續考試", exact: true })
    .click();
  await expect(guest.getByRole("alert")).toContainText("次數上限");
  await context.close();
});

test("SCORM upload, isolated execution, commit and resume persist end to end", async ({
  page,
}) => {
  await login(page);
  const course = await post<{ id: number }>(page, "courses/", {
    title: "SCORM 瀏覽器整合 " + Date.now(),
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
    `<!doctype html><html><body><h1>SCORM 測試教材</h1><p id="resume"></p><button id="finish">完成教材</button><script>const api=parent.API;api.LMSInitialize('');document.getElementById('resume').textContent=api.LMSGetValue('cmi.suspend_data');document.getElementById('finish').onclick=()=>{api.LMSSetValue('cmi.suspend_data','bookmark-saved');api.LMSSetValue('cmi.core.lesson_status','completed');api.LMSCommit('')};</script></body></html>`,
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
    .filter({ hasText: "SCORM 瀏覽器整合" })
    .first();
  await card.getByRole("button", { name: "開始學習", exact: true }).click();
  const sco = page
    .frameLocator('iframe[title="SCORM 課程播放器"]')
    .frameLocator("#sco");
  await expect(
    sco.getByRole("heading", { name: "SCORM 測試教材" }),
  ).toBeVisible();
  await sco.getByRole("button", { name: "完成教材" }).click();
  await expect(
    page.getByText("課程已完成，紀錄已儲存", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "關閉", exact: true }).click();
  await card.getByRole("button", { name: "再次學習", exact: true }).click();
  await expect(sco.getByText("bookmark-saved", { exact: true })).toBeVisible();
});

test("Scormly publishes a real package and editable backup to the LMS", async ({
  page,
}) => {
  await login(page);
  const course = await post<{ id: number }>(page, "courses/", {
    title: "Scormly 發布測試 " + Date.now(),
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
