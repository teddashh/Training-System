import { navigateArea } from "./navigation";
import { readFileSync } from 'node:fs';
import { expect, type Browser, type Page, type Route } from '@playwright/test';
const url = (path: string) => (process.env.E2E_SUBPATH || '') + path;
async function write(page: Page, path: string, data: unknown, method = 'POST') {
  const csrf = (await page.context().cookies()).find(c => /^(?:__Host-)?training_csrf$/.test(c.name))!.value;
  const response = await page.request.fetch(url('/api/' + path), {method, headers: {'X-CSRFToken': csrf}, data});
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function signIn(page: Page, username: string, password: string) {
  await page.goto(url('/'));
  await expect(page.getByLabel('Email, username or employee ID')).toBeVisible();
  await page.getByLabel('Email, username or employee ID').fill(username);
  await page.getByLabel('Password', {exact: true}).fill(password);
  await page.getByRole('button', {name: 'Sign in to workspace', exact: true}).click();
  await expect(page.getByRole('navigation', {name: 'Main navigation', exact: true})).toBeVisible();
}
async function noSideScroll(page: Page) {
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({width, height: 900});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no sideways scroll at ${width}px`).toBe(true);
  }
  await page.setViewportSize({width: 1440, height: 900});
}
/** A local calendar day, as typed into the date field. */
const day = (offset: number) => {
  const d = new Date(Date.now() + offset * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export async function simpleTrainingWorkflow(page: Page, browser: Browser) {
  const stamp = Date.now(), origin = new URL(page.url()).origin;
  const password = 'Local-simple-training-2026!';
  const scheduler = `scheduler-${stamp}`, alex = `alex-${stamp}`, sam = `sam-${stamp}`, employeeId = String(stamp).slice(-8);
  const alexName = `Alex Rivera ${stamp}`, samName = `Sam Lee ${stamp}`;
  await write(page, 'users/', {username: scheduler, email: `${scheduler}@example.test`, password, display_name: `Robin Scheduler ${stamp}`, role: 'training_scheduler'});
  await write(page, 'users/', {username: alex, email: `${alex}@example.test`, password, display_name: alexName, role: 'learner', department: 'Practice'});
  // Sam has never signed in and is known only by an employee ID.
  await write(page, 'users/', {username: sam, email: `${sam}@example.test`, employee_id: employeeId, password, display_name: samName, role: 'learner', department: 'Operations'});
  const unknown = `nobody-${stamp}@example.test`;

  const context = await browser.newContext({baseURL: origin});
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {origin});
  const s = await context.newPage();
  const errors: string[] = [];
  s.on('pageerror', error => errors.push(error.message));
  let link = '', course = 0;
  const title = `Forklift refresher ${stamp}`, quizTitle = `Forklift quiz ${stamp}`;
  try {
    await s.setViewportSize({width: 1440, height: 900});
    await signIn(s, scheduler, password);
    // The scheduler's own draft quiz; linking publishes it to the participants.
    const quiz = await write(s, 'exams/', {title: quizTitle, published: false, questions: [{type: 'single', description: 'Which zone is for pedestrians?', options: ['Marked walkway', 'Loading dock'], solution: [0], points: 100, position: 0}]});

    await navigateArea(s, 'Training');
    await expect(s.getByRole('heading', {name: 'Training', exact: true})).toBeVisible();
    await expect(s.getByRole('button', {name: 'Library', exact: true})).toHaveCount(0);
    await s.getByRole('link', {name: 'New training', exact: true}).click();
    await expect(s).toHaveURL(new RegExp(url('/authoring/new') + '$'));
    await s.reload();
    await expect(s.getByRole('heading', {name: 'New training', exact: true})).toBeVisible();

    // Problems are named next to their field and focus moves to the first one.
    await s.getByRole('button', {name: 'Create', exact: true}).click();
    await expect(s.getByLabel('Title', {exact: true})).toBeFocused();
    await expect(s.getByText('Enter a title.', {exact: true})).toBeVisible();
    await expect(s.getByText('Choose a date.', {exact: true})).toBeVisible();
    await s.getByLabel('Title', {exact: true}).fill(title);

    const first = s.getByRole('group', {name: 'Session 1', exact: true}), second = s.getByRole('group', {name: 'Session 2', exact: true});
    const templateDownload = s.waitForEvent('download');
    await first.getByRole('button', {name: 'Download template', exact: true}).click();
    const template = await templateDownload;
    expect(template.suggestedFilename()).toBe('people-template.xlsx');
    expect(readFileSync((await template.path())!).subarray(0, 2).toString('latin1')).toBe('PK');
    await expect(second.getByLabel('People', {exact: true})).toBeEnabled();
    await first.getByLabel('Date', {exact: true}).fill(day(1));
    await first.getByLabel('Start', {exact: true}).fill('09:00');
    await first.getByLabel('End', {exact: true}).fill('08:30');
    await first.getByLabel('Place', {exact: true}).fill('Building C, Room 12');
    await expect(first.getByLabel('Seats', {exact: true})).toHaveValue('30');
    await expect(second.getByLabel('Place', {exact: true})).toHaveValue('Building C, Room 12');
    await s.getByRole('button', {name: 'Create', exact: true}).click();
    await expect(first.getByLabel('End', {exact: true})).toBeFocused();
    await expect(first.getByText('End after the start.', {exact: true})).toBeVisible();
    await first.getByLabel('End', {exact: true}).fill('10:30');
    await second.getByLabel('Date', {exact: true}).fill(day(2));
    await second.getByLabel('Start', {exact: true}).fill('13:00');
    await second.getByLabel('End', {exact: true}).fill('14:30');

    // One known e-mail, one known employee ID and one unknown line.
    await first.getByLabel('People', {exact: true}).fill([`${alex}@example.test`, employeeId, unknown].join('\n'));
    await expect(s.getByRole('button', {name: 'Create and notify', exact: true})).toBeVisible();
    await first.getByLabel('Seats', {exact: true}).focus();
    const check = first.locator('.people-check');
    await expect(check).toContainText('2 people · 1 not found');
    await check.getByRole('button', {name: 'Show', exact: true}).click();
    await expect(check.locator('.people-skipped li')).toHaveCount(1);
    await expect(check.locator('.people-skipped')).toContainText(unknown);
    await expect(check.locator('.people-skipped')).toContainText('Not found');

    await s.getByLabel('Quiz', {exact: true}).selectOption(String(quiz.id));
    await expect(s.getByLabel('Quiz', {exact: true}).locator(`option[value="${quiz.id}"]`)).toHaveText(`${quizTitle} · Draft`);
    await expect(s.getByText('Opens for each person when their session ends.', {exact: true})).toBeVisible();
    await noSideScroll(s);

    // A lost response followed by a retry replays the first receipt instead of creating a second training.
    const trainings = '**' + url('/api/trainings/');
    let lost = 0;
    const loseFirstResponse = async (route: Route) => {
      if (route.request().method() !== 'POST' || lost) return route.continue();
      lost += 1;
      await route.fetch();
      await route.abort('connectionreset');
    };
    await s.route(trainings, loseFirstResponse);
    await s.getByRole('button', {name: 'Create and notify', exact: true}).click();
    await expect(s.getByRole('alert')).toBeVisible();
    await expect(s.getByLabel('Title', {exact: true})).toHaveValue(title);
    await s.unroute(trainings, loseFirstResponse);
    expect(lost).toBe(1);
    const replay = s.waitForResponse(response => new URL(response.url()).pathname === url('/api/trainings/') && response.request().method() === 'POST');
    await s.getByRole('button', {name: 'Create and notify', exact: true}).click();
    const response = await replay;
    expect(response.status()).toBe(200);
    const receipt = await response.json();
    course = receipt.course;
    expect(receipt.sessions).toHaveLength(2);
    const own = await (await s.request.get(url('/api/courses/'))).json();
    expect(own.filter((course: {title: string}) => course.title === title)).toHaveLength(1);

    // The training page: one confirmation line and the skipped line.
    await expect(s).toHaveURL(new RegExp(url(`/authoring/${receipt.course}`) + '$'));
    await expect(s.getByRole('heading', {name: title, exact: true})).toBeVisible();
    const created = s.locator('.training-created');
    await expect(created).toContainText('Training created. 2 people notified.');
    await expect(created).toContainText(unknown);
    await expect(created.getByRole('button', {name: 'Add people', exact: true})).toBeVisible();
    const cards = s.locator('.session-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText('2 of 30 registered');
    await expect(cards.nth(1)).toContainText('0 of 30 registered');
    await expect(s.getByText(quizTitle, {exact: true})).toBeVisible();
    await expect(s.getByText('Opens after each session', {exact: true})).toBeVisible();
    await expect(s.getByText('Draft: participants cannot take it', {exact: true})).toHaveCount(0);
    await expect(s.getByRole('switch', {name: 'E-mail reminders', exact: true})).toBeChecked();

    await s.getByRole('button', {name: 'Copy link', exact: true}).click();
    await expect(s.getByRole('button', {name: 'Copied', exact: true})).toBeVisible();
    link = await s.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(new RegExp('^' + new URL(url('/register'), origin).href.replace(/[.?*+^$()[\]{}|\\/]/g, '\\$&') + '#[A-Za-z0-9_-]{43}$'));

    // The sign-in sheet as a PDF, and the spreadsheet as an option.
    const pdfResponse = s.waitForResponse(r => new URL(r.url()).pathname === url(`/api/courses/${receipt.course}/sessions/${receipt.sessions[0]}/export/`) && new URL(r.url()).searchParams.get('kind') === 'sign-in-pdf');
    const pdfDownload = s.waitForEvent('download');
    const signInSheet = cards.first().getByRole('group', {name: 'Sign-in sheet', exact: true});
    await expect(signInSheet.getByText('Sign-in sheet:', {exact: true})).toBeVisible();
    await expect(signInSheet.getByRole('button', {name: 'Sign-in sheet PDF', exact: true})).toHaveText('PDF');
    await signInSheet.getByRole('button', {name: 'Sign-in sheet PDF', exact: true}).click();
    expect((await pdfResponse).headers()['content-type']).toContain('application/pdf');
    const pdf = await pdfDownload;
    // The file is named after the training and the session, as the server suggests.
    expect(pdf.suggestedFilename()).toBe(`${title} - Session 1 - sign-in.pdf`);
    expect(readFileSync((await pdf.path())!).subarray(0, 4).toString('latin1')).toBe('%PDF');
    const sheetResponse = s.waitForResponse(r => new URL(r.url()).pathname === url(`/api/courses/${receipt.course}/sessions/${receipt.sessions[0]}/export/`) && new URL(r.url()).searchParams.get('kind') === 'sign-in');
    const sheetDownload = s.waitForEvent('download');
    await expect(signInSheet.getByRole('button', {name: 'Sign-in sheet Excel', exact: true})).toHaveText('Excel');
    await signInSheet.getByRole('button', {name: 'Sign-in sheet Excel', exact: true}).click();
    expect((await sheetResponse).headers()['content-type']).toContain('spreadsheetml');
    const sheet = await sheetDownload;
    expect(sheet.suggestedFilename()).toBe(`${title} - Session 1 - sign-in.xlsx`);
    expect(readFileSync((await sheet.path())!).subarray(0, 2).toString('latin1')).toBe('PK');
    await noSideScroll(s);

    // Attendance: one line per person in the session's dialog; nothing can be marked before the session starts.
    await cards.first().getByRole('button', {name: 'Attendance', exact: true}).click();
    const attendance = s.getByRole('dialog', {name: 'Attendance · Session 1', exact: true});
    await expect(attendance.getByText('Attendance opens when the session starts.', {exact: true})).toBeVisible();
    await expect(attendance.getByRole('button', {name: 'Mark all present', exact: true})).toBeDisabled();
    const samMarks = attendance.getByRole('group', {name: samName, exact: true});
    await expect(samMarks.getByRole('button', {name: 'Present', exact: true})).toBeDisabled();
    await expect(samMarks.getByRole('button', {name: 'Absent', exact: true})).toBeDisabled();
    await noSideScroll(s);
    await attendance.getByRole('button', {name: 'Done', exact: true}).click();
    await expect(attendance).toHaveCount(0);

    // People: counters that filter, and moving one person with the row menu.
    await s.locator('.training-tabs').getByRole('link', {name: 'People', exact: true}).click();
    await expect(s).toHaveURL(/[?&]tab=people$/);
    await s.reload();
    await expect(s.locator('.training-tabs').getByRole('link', {name: 'People', exact: true})).toHaveAttribute('aria-current', 'page');
    await expect(s.getByRole('link', {name: 'Assign training', exact: true})).toHaveCount(0);
    const counters = s.getByRole('group', {name: 'Status', exact: true});
    await expect(counters.getByRole('button', {name: 'All 2', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await expect(counters.getByRole('button', {name: 'Registered 2', exact: true})).toBeVisible();
    await expect(counters.getByRole('button', {name: /^Pending/})).toHaveCount(0);
    await expect(counters.getByRole('button', {name: /^Absent/})).toHaveCount(0);
    const rows = s.locator('.training-table tbody tr');
    await expect(rows).toHaveCount(2);
    const samRow = rows.filter({hasText: samName});
    await expect(samRow).toContainText('Session 1');
    await expect(samRow).toContainText('Operations');
    await expect(samRow.getByText('Not started', {exact: true})).toBeVisible();
    await samRow.getByLabel(`More actions for ${samName}`, {exact: true}).click();
    await expect(samRow.getByRole('button', {name: 'Move to Session 1', exact: true})).toHaveCount(0);
    await samRow.getByRole('button', {name: 'Move to Session 2', exact: true}).click();
    await expect(s.getByRole('status').filter({hasText: `${samName} moved to Session 2.`})).toBeVisible();
    await expect(samRow).toContainText('Session 2');
    await counters.getByRole('button', {name: 'Registered 2', exact: true}).click();
    await expect(rows).toHaveCount(2);
    await noSideScroll(s);

    // The same People box also offers the template when adding to an existing training.
    await s.getByRole('button', {name: 'Add people', exact: true}).click();
    const addTemplateDownload = s.waitForEvent('download');
    await s.locator('.training-add').getByRole('button', {name: 'Download template', exact: true}).click();
    const addTemplate = await addTemplateDownload;
    expect(addTemplate.suggestedFilename()).toBe('people-template.xlsx');
    expect(readFileSync((await addTemplate.path())!).subarray(0, 2).toString('latin1')).toBe('PK');

    // The list shows the training with its next session and registrations.
    await navigateArea(s, 'Training');
    const row = s.locator('.training-row').filter({hasText: title});
    await expect(row).toContainText('2 registered');
    await expect(row.getByText('Draft', {exact: true})).toHaveCount(0);
    await row.getByRole('link', {name: title, exact: true}).click();
    await expect(s).toHaveURL(new RegExp(url(`/authoring/${receipt.course}`) + '$'));
    await expect(s.locator('.training-created')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await context.close(); }

  // The participant: registered already, switches with one click and waits for the quiz.
  const participantContext = await browser.newContext({baseURL: origin});
  const participant = await participantContext.newPage();
  try {
    await signIn(participant, alex, password);
    await participant.goto(link);
    await expect(participant.getByRole('status').filter({hasText: "You're registered"})).toBeVisible();
    const later = participant.locator('.session-card').filter({hasText: 'Session 2'});
    await later.getByRole('button', {name: 'Switch to this session', exact: true}).click();
    await expect(later).toHaveClass(/is-reserved/);
    await expect(participant.locator('.session-card').filter({hasText: 'Session 1'}).getByRole('button', {name: 'Switch to this session', exact: true})).toBeVisible();
    // The quiz waits for the end of the session: a date, not a start link.
    await participant.goto(url(`/courses?course=${course}&action=register`));
    const quizRow = participant.getByRole('dialog').locator('.assessment-summary').filter({hasText: quizTitle});
    await expect(quizRow).toContainText('Opens ');
    await expect(quizRow.getByRole('link')).toHaveCount(0);
  } finally { await participantContext.close(); }
}
