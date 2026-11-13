import { readFileSync } from 'node:fs';
const brand = JSON.parse(readFileSync(new URL(`../../shared/brand/${process.env.BRAND || 'default'}/brand.json`, import.meta.url), 'utf8'));
import { navigateArea } from "./navigation";
import { courseAssessmentsWorkflow } from "./course-assessments";
import { uploadGuestFigure, expectFigureLoaded } from "./figures";
import { libraryWorkflow } from "./library";
import { roundsSessionsWorkflow } from "./rounds-sessions";
import { learningViewport } from "./learning";
import { contentWorkflow } from "./content";
import { managementWorkflow, peopleManagementWorkflow } from "./administration";
import { expect, test, type Page } from "@playwright/test";

const mount = process.env.E2E_SUBPATH || "";
test.skip(!mount, "Run against a build mounted at E2E_SUBPATH, e.g. /training.");
const url = (path: string) => mount + path;

async function login(page: Page) {
  await page.goto(url("/courses"));
  await page.getByLabel("Email, username or employee ID").fill("admin@example.com");
  await page.getByLabel("Password", { exact: true }).fill(process.env.DEMO_PASSWORD || "Demo-Training-2026!");
  await page.getByRole("button", { name: "Sign in to workspace", exact: true }).click();
  await expect(page.locator("header.topbar")).toBeVisible();
}

async function post(page: Page, path: string, body: unknown) {
  const csrf = (await page.context().cookies()).find(c => /^(?:__Host-)?training_csrf$/.test(c.name))!.value;
  const response = await page.request.post(url("/api/" + path), {
    headers: { "X-CSRFToken": csrf }, data: body,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test("mounted navigation, refresh, exports, admin and guest links stay under the prefix", async ({ page, browser }) => {
  test.setTimeout(300000);
  const escaped: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (/^\/(api|assets|studio|admin|static)\//.test(path)) escaped.push(path);
  });
  await login(page);
  await expect(page).toHaveTitle(`${brand.organization} · Enterprise learning platform`);
  await expect(page.getByAltText(brand.logo_alt)).toBeVisible();
  expect(await page.getByAltText(brand.logo_alt).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await navigateArea(page, "My training");
  const courses = page.locator(".area-tabs").getByRole("link", { name: "Catalog", exact: true });
  await expect(courses).toHaveAttribute("href", url("/courses"));
  await courses.click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Courses", exact: true })).toBeVisible();
  await page.goto(url("/settings"));
  await page.getByText("Advanced maintenance", { exact: true }).click();
  await expect(page.locator(`a[href="${url("/admin/data/")}"]`)).toBeVisible();
  const entry = await page.request.get(url("/admin/"), { maxRedirects: 0 });
  expect(entry.headers().location).toBe(url("/manage"));
  const admin = await page.request.get(url("/admin/data/"));
  expect(admin.ok()).toBeTruthy();
  expect(await admin.text()).toContain(url("/static/admin/css/base.css"));
  expect(await admin.text()).toContain(url("/static/brand/logo-horizontal.svg"));
  for (const asset of ["brand/logo-horizontal.svg", "brand/tokens.css", "training/admin-brand.css"]) {
    expect((await page.request.get(url("/static/" + asset))).ok()).toBeTruthy();
  }
  const stylesheet = await page.request.get(url("/static/admin/css/base.css"));
  expect(stylesheet.headers()["content-type"]).toContain("text/css");
  const csv = await page.request.get(url("/api/results/export/"));
  expect(csv.ok()).toBeTruthy();
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const figure = await uploadGuestFigure(page, mount);
  const exam = await post(page, "exams/", {
    title: `Mounted figure assessment ${Date.now()}`, published: true,
    questions: [{ description: "Which synthetic route is available?", type: "single",
      options: ["Route A", "Route B"], solution: [0], points: 10,
      figure, figure_alt: "Two synthetic network nodes" }],
  });
  const invitation = await post(page, "invitations/issue/", {
    exam: exam.id, key: `mount-${Date.now()}@example.test`, require_email_verification: false,
  });
  expect(new URL(invitation.url).pathname).toBe(url("/invite"));
  const guest = await browser.newContext();
  try {
    const tab = await guest.newPage();
    const exchanged = tab.waitForResponse(r => new URL(r.url()).pathname === url("/api/guest/exchange/"));
    await tab.goto(invitation.url);
    expect((await exchanged).status()).toBe(200);
    await expect(tab).not.toHaveURL(/#/);
    await tab.getByRole("button", { name: "Start / resume exam", exact: true }).click();
    await expectFigureLoaded(tab, "Two synthetic network nodes");
    await expect(tab.getByRole("img", { name: "Two synthetic network nodes" }))
      .toHaveAttribute("src", url(`/api/question-figures/${figure}/`));
  } finally { await guest.close(); }
  await managementWorkflow(page, browser);
  await contentWorkflow(page, browser);
  await libraryWorkflow(page);
  await roundsSessionsWorkflow(page, browser);
  await peopleManagementWorkflow(page);
  await courseAssessmentsWorkflow(page, browser);
  expect(escaped).toEqual([]);
});

test("mounted Training Content Studio publication and isolated SCORM resume use the prefixed API", async ({ page }) => {
  test.setTimeout(180000);
  await login(page);
  const title = `Mounted SCORM ${Date.now()}`;
  const course = await post(page, "courses/", { title, published: true, blocks: [] });
  await page.goto(url("/studio/#/app"));
  await page.getByRole("button", { name: /Try sample content/ }).click();
  await page.getByRole("button", { name: "Publish to course", exact: true }).filter({ visible: true }).click();
  await page.getByLabel("Course", { exact: true }).selectOption(String(course.id));
  const published = page.waitForResponse(r => new URL(r.url()).pathname === url(`/api/courses/${course.id}/upload/`) && r.request().method() === "POST");
  await page.getByRole("button", { name: "Publish to course", exact: true }).filter({ visible: true }).last().click();
  const upload = await published;
  expect(upload.status()).toBe(201);
  const packageInfo = await upload.json();
  const source = await page.request.get(url(`/api/courses/${course.id}/source/`));
  expect(source.headers()["content-type"]).toBe("application/zip");
  await page.goto(url("/courses"));
  const card = page.locator("article").filter({ hasText: title });
  const contentRequests: { path: string; query: string; method: string }[] = [];
  page.on("request", request => {
    const target = new URL(request.url());
    if (target.pathname.endsWith("/content/launch")) contentRequests.push({ path: target.pathname, query: target.search, method: request.method() });
  });
  const launching = page.waitForResponse(r => new URL(r.url()).pathname === url(`/api/scorm/${packageInfo.id}/launch/`));
  await card.getByRole("button", { name: "Start learning", exact: true }).click();
  const launch = await (await launching).json();
  const player = page.frameLocator('iframe[title="SCORM course player"]').frameLocator("#sco");
  await player.getByRole("button", { name: /^Start course/ }).click();
  await expect(player.locator(".lesson-title")).toBeVisible();
  await learningViewport(page);
  const committed = page.waitForResponse(r => new URL(r.url()).pathname === url(`/api/scorm/${packageInfo.id}/commit/`) && r.request().method() === "POST");
  await page.getByRole("button", { name: "Save and close", exact: true }).click();
  expect((await committed).status()).toBe(200);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto(url(`/courses?course=${course.id}&from=assignments`));
  await expect(player.locator(".lesson-title")).toBeVisible();
  await page.getByRole("button", { name: "Save and close", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(mount + "/assignments$"));
  if (launch.ticket) {
    expect(launch.url).toBe(new URL(url("/content/launch"), page.url()).href);
    expect(launch.origin).toBe(new URL(page.url()).origin);
    expect(contentRequests).toHaveLength(2);
    expect(contentRequests.every(request => request.path === url("/content/launch") && !request.query && request.method === "POST")).toBe(true);
  }
});
