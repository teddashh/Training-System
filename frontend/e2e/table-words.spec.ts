import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

const url = (path: string) => (process.env.E2E_SUBPATH || '') + path;
// Window widths around every switch between cards, compact and full table, at the sidebar's two sizes.
const widths = [801, 840, 900, 960, 1040, 1060, 1100, 1130, 1180, 1250, 1280, 1370, 1440, 800, 768, 390];

async function signIn(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url('/'));
  await page.getByRole('textbox', { name: 'Email, username or employee ID', exact: true }).fill('admin@example.com');
  const password = process.env.DEMO_PASSWORD;
  if (!password) throw new Error('Set DEMO_PASSWORD for the throwaway test stack');
  // Password inputs have no implicit textbox role.
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in to workspace', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).toBeVisible();
}

async function post<T>(page: Page, path: string, data: unknown): Promise<T> {
  const csrf = (await page.context().cookies()).find(cookie => /^(?:__Host-)?training_csrf$/.test(cookie.name));
  expect(csrf, 'The test session must have a CSRF cookie').toBeDefined();
  const response = await page.request.post(url('/api/' + path), {
    headers: { 'X-CSRFToken': csrf!.value },
    data,
  });
  // Do not print response bodies: a training receipt contains a registration link.
  expect(response.ok(), `POST ${path}: HTTP ${response.status()}`).toBe(true);
  return response.json() as Promise<T>;
}

const kinds = [
  ['assignment', 'Training assignment'], ['registered', 'Registered'],
  ['request_received', 'Request received'], ['registration_cancelled', 'Registration cancelled'],
  ['enrollment_approved', 'Enrollment approved'], ['enrollment_rejected', 'Enrollment rejected'],
  ['enrollment_removed', 'Enrollment removed'], ['session_changed', 'Session changed'],
  ['session_rescheduled', 'Session changed'], ['session_cancelled', 'Session cancelled'],
  ['session_tomorrow', 'Session reminder'], ['quiz_ready', 'Quiz ready'],
  ['quiz_reminder', 'Quiz reminder'], ['sign_in_code', 'Sign-in code'],
  ['guest_verification', 'Guest verification'], ['test', 'Test email'],
  ['synthetic_unknown', 'Other'], ['assignment', 'Training assignment'],
  ['registered', 'Registered'], ['enrollment_approved', 'Enrollment approved'],
] as const;
const mailStatuses = [
  'queued', 'sending', 'sent', 'failed', 'failed', 'failed', 'failed', 'failed', 'failed', 'failed',
  'cancelled', 'cancelled', 'cancelled', 'cancelled', 'cancelled', 'cancelled', 'sent', 'sent', 'sent', 'failed',
] as const;
const mailStatusLabels: Record<string, string> = {
  queued: 'Queued', sending: 'Sending', sent: 'Accepted', failed: 'Failed', cancelled: 'Cancelled',
};
const mailErrors = [
  'Could not be checked; it will be tried again.', '', '',
  'Graph mail request failed (HTTP 429).', 'delivery result unknown (HTTP 503).',
  'Graph mail authentication failed.', 'Message sender differs from the configured Graph mailbox.',
  'Graph mail transport failed.', 'Graph mail was not accepted.', 'Email configuration is incomplete.',
  'Reminder no longer applies.', 'Expired before delivery.', 'Recipient account no longer exists.',
  'Recipient account is inactive.', 'Message cannot be queued.', 'Notice no longer applies.', '', '', '', 'delivery result unknown',
];
const subjects = [
  'Registration confirmation for the comprehensive operations workshop and scheduled maintenance orientation team',
  'Enrollment confirmation for the transit equipment safety workshop and technical preparation',
  'Participant notification for the manufacturing procedures and workplace orientation training',
  'Registration reminder for the comprehensive electrical equipment and maintenance workshop',
];
const retryableKinds = new Set([
  'assignment', 'enrollment_approved', 'enrollment_rejected', 'enrollment_removed',
  'session_rescheduled', 'session_cancelled',
]);
const emailRows = kinds.map(([kind], index) => ({
  id: index + 1,
  kind,
  to_email: index % 2 ? 'maximilian.example@example.org' : 'alexandria.training@example.org',
  subject: subjects[index % subjects.length],
  status: mailStatuses[index],
  attempts: index % 3 + 1,
  last_error: mailErrors[index],
  created_at: new Date(Date.UTC(2026, 10, 14, 14, 30 - index * 16)).toISOString(),
  sent_at: mailStatuses[index] === 'sent' ? new Date(Date.UTC(2026, 10, 14, 14, 31 - index * 16)).toISOString() : null,
  can_retry: mailStatuses[index] === 'failed' && retryableKinds.has(kind),
}));
const emailLog = {
  off: false, sender: 'notifications@example.org', configured: true, enabled: true,
  queued: 1, failed: emailRows.filter(row => row.status === 'failed').length,
  count: emailRows.length, page: 1, page_size: 20, results: emailRows,
  paused_until: null, pause_reason: '', sent_last_24_hours: 42, daily_limit: 1000, daily_limit_reached: false,
};

const names = [
  'Alexandria Montgomery', 'Maximilian Vandenburg', 'Christopher Abernathy', 'Theodora Weatherstone',
  'Sebastian Wilderbrook', 'Valentina Northbridge', 'Jonathan Blackthorne', 'Evangelina Whitfield',
  'Penelope Fairweather', 'Gabriella Hollingsworth', 'Zachary Silverstone', 'Cassandra Underwood',
];
const departments = [
  'Instrumentation Calibration Operations', 'Electromechanics Engineering Operations',
  'Manufacturing Equipment Administration', 'Environmental Maintenance Operations',
];
const sessionTitles = [
  'Comprehensive Safety Orientation Program', 'Manufacturing Equipment Orientation Plan',
  'Electrical Maintenance Workshop', 'Transportation Procedures Workshop',
];
const personStates = [
  { status: 'approved', attendance: '', quiz: 'passed', label: 'Registered', quizLabel: 'Passed' },
  { status: 'approved', attendance: 'present', quiz: 'not_passed', label: 'Present', quizLabel: 'Not passed' },
  { status: 'approved', attendance: 'absent', quiz: 'not_started', label: 'Absent', quizLabel: 'Not started' },
  { status: 'pending', attendance: '', quiz: null, label: 'Pending', quizLabel: '—' },
  { status: 'cancelled', attendance: '', quiz: 'passed', label: 'Cancelled', quizLabel: 'Passed' },
  { status: 'rejected', attendance: '', quiz: 'not_passed', label: 'Enrollment rejected', quizLabel: 'Not passed' },
  { status: 'removed', attendance: '', quiz: 'not_started', label: 'Enrollment removed', quizLabel: 'Not started' },
  // Exercise enrollmentLabel's defensive fallback as well as every API status.
  { status: 'synthetic_unknown', attendance: '', quiz: null, label: 'Approval required', quizLabel: '—' },
  { status: 'approved', attendance: '', quiz: 'not_started', label: 'Registered', quizLabel: 'Not started' },
  { status: 'pending', attendance: '', quiz: 'passed', label: 'Pending', quizLabel: 'Passed' },
  { status: 'approved', attendance: 'present', quiz: 'not_passed', label: 'Present', quizLabel: 'Not passed' },
  { status: 'approved', attendance: 'absent', quiz: null, label: 'Absent', quizLabel: '—' },
] as const;

/** Measure actual rendered text, including rows below the viewport, at each window width. */
async function checkWidths(
  page: Page,
  panel: Locator,
  requiredColumns: string[],
  skipRecipient = false,
  skipCellEmail = false,
) {
  const failures: string[] = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    // Let fonts and a layout pass settle at the new width before measuring.
    await page.evaluate(() => document.fonts.ready.then(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))));
    const result = await panel.evaluate((element, { skipAddressColumn, skipEmailLine }) => {
      const table = element.querySelector('table');
      if (!table || !table.tHead) throw new Error('The table and its headings must be present');
      const headings = Array.from(table.tHead.querySelectorAll('th'), th => th.textContent?.trim() || 'Actions');
      const recipientIndex = skipAddressColumn ? headings.indexOf('Recipient') : -1;
      if (skipAddressColumn && recipientIndex < 0) throw new Error('The recipient column must be present');
      const headHidden = getComputedStyle(table.tHead).position === 'absolute';
      const checked: Record<string, number> = {};
      const broken: Record<string, number> = {};

      for (const cell of table.querySelectorAll<HTMLTableCellElement>('th, td')) {
        if (headHidden && cell.closest('thead')) continue;
        if (cell.cellIndex === recipientIndex) continue;
        const column = cell.dataset.label || headings[cell.cellIndex] || 'Actions';
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        const parts: { node: Text; start: number; end: number }[] = [];
        let content = '';
        let previousBlock: Element | null = null;
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          const parent = node.parentElement;
          if (!parent || parent.closest('.sr-only, [hidden], [aria-hidden="true"]')) continue;
          if (skipEmailLine && parent.closest('.cell-person small:first-of-type')) continue;
          if (getComputedStyle(parent).visibility === 'hidden') continue;
          const whole = document.createRange();
          whole.selectNodeContents(node);
          if (node.data.trim() && !Array.from(whole.getClientRects()).some(rect => rect.width > 0 && rect.height > 0)) continue;
          // Text in adjacent controls or block elements is separate even if there is no whitespace in the DOM.
          const block = parent.closest('button, summary, [role="button"], strong, small, .avatar');
          if (parts.length && block !== previousBlock && (block || previousBlock)) content += ' ';
          const start = content.length;
          content += node.data;
          parts.push({ node, start, end: content.length });
          previousBlock = block;
        }

        // Match complete letter runs so a suffix of a longer word cannot be counted.
        for (const match of content.matchAll(/[A-Za-z]+/g)) {
          const start = match.index;
          const end = start + match[0].length;
          if (match[0].length < 3 || match[0].length > 14) continue;
          if (start && /[A-Za-z0-9_@.\-]/.test(content[start - 1])) continue;
          const rectangles: DOMRect[] = [];
          for (const part of parts) {
            const from = Math.max(start, part.start), to = Math.min(end, part.end);
            if (from >= to) continue;
            const range = document.createRange();
            range.setStart(part.node, from - part.start);
            range.setEnd(part.node, to - part.start);
            rectangles.push(...Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0));
          }
          if (!rectangles.length) continue;
          checked[column] = (checked[column] || 0) + 1;
          const first = rectangles[0];
          if (rectangles.some(rect => rect.top >= first.bottom - 0.5 || rect.bottom <= first.top + 0.5)) {
            broken[column] = (broken[column] || 0) + 1;
          }
        }
      }
      const scroller = element.querySelector('.table-scroll');
      const panelOverflow = element.scrollWidth - element.clientWidth;
      const scrollerOverflow = scroller ? scroller.scrollWidth - scroller.clientWidth : -1;
      const scrollTarget = scroller && scrollerOverflow > panelOverflow
        ? { label: 'table-scroll', scroll: scroller.scrollWidth, client: scroller.clientWidth }
        : { label: 'panel', scroll: element.scrollWidth, client: element.clientWidth };
      return {
        checked, broken, headHidden,
        scrollLabel: scrollTarget.label, scrollWidth: scrollTarget.scroll, clientWidth: scrollTarget.client,
        scrollerOverflowX: scroller ? getComputedStyle(scroller).overflowX : null,
        panelWidth: element.getBoundingClientRect().width, tableWidth: table.getBoundingClientRect().width,
        pageScroll: document.documentElement.scrollWidth, pageClient: document.documentElement.clientWidth,
      };
    }, { skipAddressColumn: skipRecipient, skipEmailLine: skipCellEmail });

    for (const column of requiredColumns) {
      if (!result.checked[column]) failures.push(`${width}px, ${column}: 0 eligible words measured`);
    }
    for (const [column, count] of Object.entries(result.broken)) {
      failures.push(`${width}px, ${column}: ${count} split words`);
    }
    if (result.headHidden && result.scrollerOverflowX && result.scrollerOverflowX !== 'visible') {
      failures.push(`${width}px, table-scroll: overflow-x ${result.scrollerOverflowX} in card mode`);
    }
    if (result.scrollWidth > result.clientWidth + 1) {
      failures.push(`${width}px, ${result.scrollLabel}: scroll width ${result.scrollWidth}, client width ${result.clientWidth}`);
    }
    if (result.tableWidth > result.panelWidth) {
      failures.push(`${width}px, table: width ${result.tableWidth}, panel width ${result.panelWidth}`);
    }
    if (result.pageScroll > result.pageClient) {
      failures.push(`${width}px, page: scroll width ${result.pageScroll}, client width ${result.pageClient}`);
    }
  }
  expect(failures.length, failures.join('\n')).toBe(0);
}

// One test and one sign-in: the suite's other files already use most of the account's sign-in allowance
// (AUTH_ACCOUNT_LIMIT per ten minutes), and the invitation tests that run later must not be throttled.
test('E-mail log, training roster and people directory keep short words whole', async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page);
  await test.step('e-mail log', async () => { await checkEmailLog(page); });
  await test.step('training roster', async () => { await checkRoster(page); });
  await test.step('people directory', async () => { await checkPeopleDirectory(page); });
});

async function checkEmailLog(page: Page) {
  const emailListUrl = (requestUrl: URL) => requestUrl.pathname === url('/api/email/');
  const emailListHandler = (route: Route) => route.request().method() === 'GET'
    ? route.fulfill({ json: emailLog }) : route.continue();
  await page.route(emailListUrl, emailListHandler);
  try {
    await page.goto(url('/email'));
    const panel = page.locator('.email-log');
    await expect(panel.locator('tbody tr')).toHaveCount(20);
    await expect(panel.locator('tbody td[data-label="Type"]')).toHaveText(kinds.map(([, label]) => label));
    await expect(panel.locator('tbody td[data-label="Status"]')).toHaveText(mailStatuses.map(status => mailStatusLabels[status]));
    await expect(panel.locator('tbody td[data-label="Error"]')).toHaveText(mailErrors.map(error => error || '—'));
    await expect(panel.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(emailRows.filter(row => row.can_retry).length);
    await expect(panel.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(1);
    await checkWidths(page, panel, ['Time', 'Type', 'Subject', 'Status', 'Error', 'Actions'], true);
  } finally {
    await page.unroute(emailListUrl, emailListHandler);
  }
}

async function checkRoster(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const exam = await post<{ id: number }>(page, 'exams/', {
    title: `Synthetic roster quiz ${Date.now()}`, published: false,
    questions: [{ type: 'single', description: 'Choose the safe path.', options: ['Walkway', 'Loading dock'], solution: [0], points: 100, position: 0 }],
  });
  const sessions = sessionTitles.map((title, index) => {
    const start = Date.now() + (index + 2) * 86_400_000;
    return { title, starts_at: new Date(start).toISOString(), ends_at: new Date(start + 5_400_000).toISOString(), location: 'Practice room', capacity: 30 };
  });
  const training = await post<{ course: number; sessions: number[] }>(page, 'trainings/', {
    request_id: randomUUID(), title: `Synthetic roster workshop ${Date.now()}`,
    sessions, rosters: [], exam: exam.id, notify: false,
  });
  const rows = names.map((person, index) => {
    const state = personStates[index];
    const sessionIndex = index % sessions.length;
    return {
      id: index + 1, user_id: index + 1, person, username: `synthetic-person-${index + 1}`,
      department: departments[index % departments.length], active: index % 4 !== 0,
      status: state.status, attendance: state.attendance, effective_attendance: state.attendance,
      attended_at: null, attendance_marked_at: null, revision: 1,
      request_note: '', requested_at: null, review_note: '', reviewed_at: null,
      progress: 0, progress_known: false, completed_at: null, reviewer: '', quiz: state.quiz,
      session: {
        id: training.sessions[sessionIndex], title: sessions[sessionIndex].title,
        starts_at: sessions[sessionIndex].starts_at, ends_at: sessions[sessionIndex].ends_at,
        cancelled: false, location: sessions[sessionIndex].location,
      },
    };
  });
  const enrollmentPage = {
    count: rows.length, page: 1, page_size: 20, results: rows,
    counts: { all: 12, registered: 6, pending: 2, attended: 2, absent: 2, cancelled: 1, passed: 3 },
  };
  const enrollmentListUrl = (requestUrl: URL) => requestUrl.pathname === url(`/api/courses/${training.course}/enrollments/`);
  const enrollmentListHandler = (route: Route) => route.request().method() === 'GET'
    ? route.fulfill({ json: enrollmentPage }) : route.continue();
  await page.route(enrollmentListUrl, enrollmentListHandler);
  try {
    await page.goto(url(`/authoring/${training.course}?tab=people`));
    const panel = page.locator('.training-table');
    await expect(panel.locator('tbody tr')).toHaveCount(12);
    await expect(panel.locator('thead th').nth(4)).toHaveText('Quiz');
    await expect(panel.locator('tbody td[data-label="Status"]')).toHaveText(personStates.map(state => state.label));
    await expect(panel.locator('tbody td[data-label="Quiz"]')).toHaveText(personStates.map(state => state.quizLabel));
    await checkWidths(page, panel, ['Name', 'Department', 'Session', 'Status', 'Quiz']);
  } finally {
    await page.unroute(enrollmentListUrl, enrollmentListHandler);
  }
}

const directoryFirstNames = [
  'Alexandria', 'Maximilian', 'Christopher', 'Theodora', 'Sebastian',
  'Valentina', 'Jonathan', 'Evangelina', 'Penelope', 'Gabriella',
] as const;
const directorySurnames = [
  'Montgomery Whitfield', 'Vandenburg-Hollingsworth', 'Abernathy Silverstone', 'Weatherstone-Fairweather',
  'Wilderbrook Northbridge', 'Blackthorne-Underwood', 'Featherstone Cunningham', 'Winterbottom-Pendleton',
  'Throckmorton Ravenscroft', 'Merriweather-Hawthorne',
] as const;
const directoryJobTitles = [
  'Senior Occupational Safety Representative',
  'Principal Facilities Operations Supervisor',
  'Manufacturing Equipment Reliability Planner',
  'Environmental Compliance Documentation Lead',
  'Transportation Logistics Training Coordinator',
  'Industrial Controls Calibration Specialist',
] as const;
const directoryDepartments = [
  'Microinstrumentation Quality Division',
  'Electrocommunication Safety Services',
  'Instrumentation-Ops Controls Division',
  // 23 characters without a break opportunity, as in live department names.
  'Maintenance&Reliability Operations',
  'Environmental Maintenance Operations',
] as const;
const directoryRoles = [
  { key: 'learner', label: 'Learner' },
  { key: 'course_creator', label: 'Course creator' },
  { key: 'exam_admin', label: 'Exam administrator' },
  { key: 'training_scheduler', label: 'Training scheduler' },
  { key: 'training_admin', label: 'Training administrator' },
  { key: 'admin', label: 'Super administrator' },
  { key: 'instructor', label: 'Instructor' },
] as const;
const defaultAccess = {
  courses: 'none', exams: 'none', results: 'none', assign: false, invitations: false,
  system_admin: false, people: false, scorm_upload: false, scorm_source: false,
};

async function checkPeopleDirectory(page: Page) {
  const people = Array.from({ length: 50 }, (_, index) => {
    const first = directoryFirstNames[index % directoryFirstNames.length];
    const surname = directorySurnames[(index + Math.floor(index / 10) * 3) % directorySurnames.length];
    const displayName = `${first} ${surname}`;
    const tag = String(index + 1).padStart(2, '0');
    const roleEntry = directoryRoles[index % directoryRoles.length];
    const directoryDisabled = index % 5 === 4;
    const isActive = index % 5 !== 3 && !directoryDisabled;
    const directoryLinked = index % 2 === 0;
    const employment = index % 3 === 0 ? 'contractor' : 'employee';
    return {
      id: 1001 + index,
      username: `synthetic.person.${tag}`,
      email: `${first.toLowerCase()}.${tag}@training-ops.org`,
      display_name: displayName,
      employee_id: `EMP-${10001 + index}`,
      department: directoryDepartments[index % directoryDepartments.length],
      employment,
      role: roleEntry.key,
      roleLabel: roleEntry.label,
      access: defaultAccess,
      is_active: isActive,
      entra_subject: directoryLinked ? `synthetic-entra-${1001 + index}` : null,
      job_title: directoryJobTitles[index % directoryJobTitles.length],
      directory_linked: directoryLinked,
      has_signed_in: index % 4 !== 0,
      directory_disabled: directoryDisabled,
      directory_seen_at: directoryLinked ? '2026-11-14T12:00:00Z' : null,
      directory_disabled_at: directoryDisabled ? '2026-11-14T12:00:00Z' : null,
    };
  });
  const usersPage = {
    total: people.length,
    page: 1,
    page_size: 50,
    results: people.map(({ roleLabel: _roleLabel, ...user }) => user),
    departments: [...new Set(people.map(person => person.department))].sort(),
  };
  const usersListUrl = (requestUrl: URL) => requestUrl.pathname === url('/api/users/');
  const usersListHandler = (route: Route) => route.request().method() === 'GET'
    ? route.fulfill({ json: usersPage }) : route.continue();
  await page.route(usersListUrl, usersListHandler);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url('/people'));
    const panel = page.locator('.people-directory');
    await expect(panel.locator('tbody tr')).toHaveCount(50);
    await expect(panel.locator('tbody td[data-label="Employment type"]')).toHaveText(
      people.map(person => person.employment === 'employee' ? 'Employee' : 'Contractor'),
    );
    await expect(panel.locator('tbody td[data-label="Role"]')).toHaveText(people.map(person => person.roleLabel));
    await expect(panel.locator('tbody td[data-label="Status"]')).toHaveText(
      people.map(person => person.is_active ? 'Active' : person.directory_disabled ? 'Disabled by directory sync' : 'Disabled'),
    );
    await expect(panel.getByRole('button', { name: 'Edit person', exact: true })).toHaveCount(50);
    await expect(panel.getByRole('button', { name: 'Disable', exact: true })).toHaveCount(people.filter(person => person.is_active).length);
    await expect(panel.getByRole('button', { name: 'Enable', exact: true })).toHaveCount(people.filter(person => !person.is_active).length);

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const firstCheckbox = panel.getByRole('checkbox', { name: `Select ${people[0].display_name}`, exact: true });
      await firstCheckbox.check();
      await expect(page.getByText('1 person selected', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add to group', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
      await expect(page.getByText('0 people selected', { exact: true })).toBeVisible();
      await expect(panel.locator('tbody tr').first().getByRole('button', { name: 'Edit person', exact: true })).toBeVisible();
    }

    await checkWidths(page, panel, ['Person', 'Employee ID', 'Department', 'Employment type', 'Role', 'Status', 'Actions'], false, true);
  } finally {
    await page.unroute(usersListUrl, usersListHandler);
  }
}
