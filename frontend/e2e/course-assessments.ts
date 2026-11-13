import { navigateArea, moreOptions } from "./navigation";
import { expect, type Browser, type Page, type Route } from '@playwright/test';
const url = (path: string) => (process.env.E2E_SUBPATH || '') + path;
async function write(page: Page, path: string, data: unknown, method = 'POST') {
  const csrf = (await page.context().cookies()).find(c => /^(?:__Host-)?training_csrf$/.test(c.name))!.value;
  const response = await page.request.fetch(url('/api/' + path), {method, headers: {'X-CSRFToken': csrf}, data});
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

export async function courseAssessmentsWorkflow(page: Page, browser: Browser) {
  await page.setViewportSize({width: 1440, height: 900});
  const stamp = Date.now();
  const online = await write(page, 'courses/', {title: `Shared online ${stamp}`, published: true, blocks: [{type: 'text', text: 'Synthetic lesson.'}]});
  const onsite = await write(page, 'courses/', {title: `Shared on-site ${stamp}`, published: true, delivery_mode: 'scheduled', venue: 'onsite', duration_minutes: 45, category: 'Synthetic practice', description: 'Synthetic enrollment introduction.\n'.repeat(8)});
  const session = await write(page, `courses/${onsite.id}/sessions/`, {title: 'Synthetic session', location: 'Synthetic room', starts_at: new Date(Date.now() + 86400000).toISOString(), ends_at: new Date(Date.now() + 90000000).toISOString(), capacity: 10});
  await page.goto(url(`/authoring?course=${online.id}&action=edit`));
  const sourceEditor = page.getByRole('dialog', {name: 'Course settings', exact: true});
  await sourceEditor.getByRole('button', {name: 'Create quiz', exact: true}).click();
  const newQuiz = page.getByRole('dialog', {name: 'Create exam', exact: true});
  await moreOptions(page);
  await expect(newQuiz.getByLabel('Audience', {exact: true})).toHaveValue('course');
  await expect(newQuiz.getByRole('option', {name: 'Linked course participants only', exact: true})).toBeAttached();
  await expect(newQuiz.getByLabel('Publish exam', {exact: true})).not.toBeChecked();
  const quizTitle = `Cohort check ${stamp}`;
  await newQuiz.getByLabel('Exam title', {exact: true}).fill(quizTitle);
  await newQuiz.getByLabel('Question 1 content', {exact: true}).fill('Choose the synthetic answer.');
  await newQuiz.getByLabel('Question 1 option 1', {exact: true}).fill('Yes');
  await newQuiz.getByLabel('Question 1 option 2', {exact: true}).fill('No');
  // Exercise the safer publish choice for an existing Everyone draft.
  await newQuiz.getByLabel('Audience', {exact: true}).selectOption('all');
  await newQuiz.getByRole('button', {name: 'Save exam', exact: true}).click();
  await expect(newQuiz).toHaveCount(0);
  const courseQuiz = sourceEditor.locator('.assessment-link').filter({hasText: quizTitle});
  await expect(courseQuiz.getByText('Draft', {exact: true})).toBeVisible();
  await courseQuiz.getByRole('button', {name: 'Publish quiz', exact: true}).click();
  const publishDialog = page.getByRole('dialog', {name: 'Publish quiz', exact: true});
  await expect(publishDialog.locator('form')).toHaveCount(0);
  await expect(publishDialog.getByRole('radio', {name: 'Only participants of the linked course', exact: true})).toBeChecked();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({width, height: 900});
    const typography = await publishDialog.locator('.publish-option').first().evaluate(option => {
      const label = option.querySelector('label')!, hint = option.querySelector('p')!, input = option.querySelector('input')!;
      return {label: parseFloat(getComputedStyle(label).fontSize), hint: parseFloat(getComputedStyle(hint).fontSize), height: label.getBoundingClientRect().height,
        indent: hint.getBoundingClientRect().left - input.getBoundingClientRect().right};
    });
    expect(typography.label).toBeGreaterThan(typography.hint);
    expect(typography.indent).toBeGreaterThanOrEqual(7);
    if (width <= 600) expect(typography.height).toBeGreaterThanOrEqual(44);
  }
  await publishDialog.getByRole('button', {name: 'Cancel', exact: true}).click();
  await expect(courseQuiz.getByRole('button', {name: 'Publish quiz', exact: true})).toBeFocused();
  await courseQuiz.getByRole('button', {name: 'Publish quiz', exact: true}).click();
  await publishDialog.getByRole('button', {name: 'Publish quiz', exact: true}).click();
  await expect(publishDialog).toHaveCount(0);
  await expect(sourceEditor).toBeVisible();
  await expect(courseQuiz.getByText('Published', {exact: true})).toBeVisible();
  const sourceOptions = await (await page.request.get(url(`/api/courses/${online.id}/assessments/`))).json();
  const exam = sourceOptions.linked.find((row: {title: string}) => row.title === quizTitle);
  expect(exam.audience).toBe('course');
  await sourceEditor.getByRole('button', {name: 'Close', exact: true}).click();
  const upcoming = await write(page, 'exams/', {title: `Upcoming quiz ${stamp}`, published: true, audience: 'departments', allowed_departments: ['Synthetic restricted department'], courses: [onsite.id], starts_at: new Date(Date.now() + 172800000).toISOString(), questions: [{type: 'single', description: 'Synthetic future question.', options: ['Yes', 'No'], solution: [0], points: 100, position: 0}]});
  const invitation = await write(page, 'exams/', {title: `Interview quiz ${stamp}`, published: true, audience: 'invitation', questions: [{type: 'single', description: 'Synthetic interview question.', options: ['Yes', 'No'], solution: [0], points: 100, position: 0}]});
  const draftInvitation = await write(page, 'exams/', {title: `Pending interview ${stamp}`, published: false, audience: 'invitation', courses: [onsite.id]});
  await page.goto(url(`/authoring?course=${onsite.id}&action=edit`));
  const editor = page.getByRole('dialog', {name: 'Course settings', exact: true});
  const draftInvitationRow = editor.locator('.assessment-link').filter({hasText: draftInvitation.title});
  await expect(draftInvitationRow.getByText('Draft', {exact: true})).toBeVisible();
  await expect(draftInvitationRow).toContainText("This quiz requires an invitation.");
  await expect(draftInvitationRow.getByText('Participants can take it after it is published.', {exact: true})).toHaveCount(0);
  await expect(draftInvitationRow.getByText('Ask the exam owner to publish.', {exact: true})).toHaveCount(0);
  await expect(editor.getByText("Approved learners can take published quizzes unless invitation-only.", {exact: true})).toBeVisible();
  await expect(editor.getByLabel('Existing quiz', {exact: true}).locator(`option[value="${exam.id}"]`)).toContainText('Also used by 1 courses');
  await editor.getByLabel('Existing quiz', {exact: true}).selectOption(String(exam.id));
  await editor.getByRole('button', {name: 'Attach quiz', exact: true}).click();
  await expect(editor.locator('.assessment-link').filter({hasText: exam.title})).toBeVisible();
  await editor.locator('.assessment-link').filter({hasText: exam.title}).locator('summary').click();
  await editor.locator('.assessment-link').filter({hasText: exam.title}).getByRole('button', {name: 'Edit quiz', exact: true}).click();
  const quizEditor = page.getByRole('dialog', {name: 'Edit exam', exact: true});
  const participantHint = quizEditor.getByText('Approved participants of linked courses can take this exam.', {exact: true});
  await expect(participantHint).toBeVisible();
  await quizEditor.getByLabel('Audience', {exact: true}).selectOption('all');
  await expect(participantHint).toHaveCount(0);
  await expect(quizEditor.getByText('Everyone with an account can take this exam once it is published, not only course participants.', {exact: true})).toBeVisible();
  await quizEditor.getByLabel('Audience', {exact: true}).selectOption('invitation');
  await expect(participantHint).toHaveCount(0);
  await expect(quizEditor.getByText("Invitation only: participants of linked courses can't take this exam.", {exact: true})).toBeVisible();
  await quizEditor.getByRole('button', {name: 'Close', exact: true}).click();
  await expect(editor.getByLabel('Existing quiz', {exact: true}).locator(`option[value="${invitation.id}"]`)).toContainText(' · Invitation only');
  await editor.getByLabel('Existing quiz', {exact: true}).selectOption(String(invitation.id));
  await editor.getByRole('button', {name: 'Attach quiz', exact: true}).click();
  const invitationRow = editor.locator('.assessment-link').filter({hasText: invitation.title});
  await expect(invitationRow.getByText('Invitation only', {exact: true})).toBeVisible();
  await expect(invitationRow).toContainText("This quiz requires an invitation.");
  await expect(invitationRow).toContainText('Change the audience to allow course participants.');
  await expect(invitationRow.getByRole('button', {name: 'Copy participant link', exact: true})).toHaveCount(0);
  await editor.locator('.assessment-link').filter({hasText: exam.title}).locator('summary').click();
  const copy = editor.locator('.assessment-link').filter({hasText: exam.title}).getByRole('button', {name: 'Copy participant link', exact: true});
  // Clipboard denial must not claim success; use only this synthetic URL.
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {
    writeText: () => Promise.reject(new Error('Synthetic clipboard denial')),
  }}));
  await copy.click();
  await expect(copy).toBeVisible();
  const participantLink = editor.locator('.assessment-link').filter({hasText: exam.title}).getByRole('textbox', {name: 'Participant link', exact: true});
  await expect(participantLink).toHaveValue(new URL(url(`/exams?exam=${exam.id}`), page.url()).href);
  await expect(participantLink).toHaveAttribute('readonly', '');
  await expect(editor.getByRole('button', {name: 'Link copied', exact: true})).toHaveCount(0);
  await participantLink.focus();
  expect(await participantLink.evaluate((input: HTMLInputElement) => input.selectionStart === 0 && input.selectionEnd === input.value.length)).toBeTruthy();
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.setViewportSize({width: 1440, height: 900});
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {
    writeText: (text: string) => { sessionStorage.setItem('synthetic-participant-copy', text); return Promise.resolve(); },
  }}));
  await copy.click();
  await expect(editor.locator('.assessment-link').filter({hasText: exam.title}).getByRole('button', {name: 'Link copied', exact: true})).toBeVisible();
  await expect(participantLink).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('synthetic-participant-copy'))).toBe(new URL(url(`/exams?exam=${exam.id}`), page.url()).href);
  await editor.getByRole('button', {name: 'Close', exact: true}).click();
  await page.getByRole('button', {name: 'Add session', exact: true}).click();
  const sessionEditor = page.getByRole('dialog', {name: 'Add session', exact: true});
  await expect(sessionEditor.locator('.course-assessment-block')).toHaveCount(0);
  await sessionEditor.getByRole('button', {name: 'Close', exact: true}).click();
  const linked = await (await page.request.get(url(`/api/exams/${exam.id}/`))).json();
  expect(linked.courses).toEqual([online.id, onsite.id]);
  const username = `shared-assessment-${stamp}`, password = 'Synthetic-assessment-2026!';
  const participant = await write(page, 'users/', {username, password, role: 'learner'});
  const context = await browser.newContext({baseURL: new URL(page.url()).origin});
  const learner = await context.newPage();
  try {
    await learner.goto(url(`/courses?course=${onsite.id}&action=register`));
    await learner.getByLabel('Email, username or employee ID', {exact: true}).fill(username);
    await learner.getByLabel('Password', {exact: true}).fill(password);
    await learner.getByRole('button', {name: 'Sign in to workspace', exact: true}).click();
    let dialog = learner.getByRole('dialog');
    await expect(dialog.getByRole('link', {name: 'Take assessment', exact: true})).toHaveCount(0);
    await expect(dialog.locator('.course-intro .course-cover').getByRole('heading', {name: onsite.title, exact: true, level: 3})).toBeVisible();
    await expect(dialog.locator('.course-intro-summary')).toContainText('On-site · 45 minutes');
    await expect(dialog.locator('.course-intro-summary')).toBeVisible();
    await expect(dialog.getByRole('button', {name: 'Show more', exact: true})).toBeVisible();
    await dialog.getByRole('button', {name: 'Show more', exact: true}).click();
    await expect(dialog.getByRole('button', {name: 'Show less', exact: true})).toHaveAttribute('aria-expanded', 'true');
    await dialog.getByRole('button', {name: 'Close', exact: true}).first().click();
    await learner.goto(url('/'));
    const emptyNext = learner.locator('.next-steps');
    await expect(emptyNext).toHaveCount(0);
    await expect(learner.locator(".personal-progress")).toHaveText("You're all caught up.");
    await expect(emptyNext.locator('.empty')).toHaveCount(0);
    await expect(learner.locator('.stat-card')).toHaveCount(0);
    await expect(learner.locator('.personal-progress progress')).toHaveCount(0);
    await expect(emptyNext.locator('.heading-actions button')).toHaveCount(0);
    // Answer every catalogue request while it is checked: the development build mounts effects twice.
    const fullSessions = async (route: Route) => {
      const response = await route.fetch();
      const courses = await response.json();
      await route.fulfill({json: courses.map((c: {id: number; sessions: object[]}) => c.id === onsite.id ? {...c, sessions: c.sessions.map(s => ({...s, remaining: 0, state: 'full'}))} : c)});
    };
    await learner.route('**/api/courses/', fullSessions);
    await learner.goto(url('/courses'));
    const fullCard = learner.locator('.course-card').filter({has: learner.getByRole('heading', {name: onsite.title, exact: true})});
    await expect(fullCard).toContainText('No sessions are open for registration right now.');
    await expect(fullCard).not.toContainText('No upcoming sessions');
    await learner.unroute('**/api/courses/', fullSessions);
    await learner.goto(url('/my-exams'));
    await expect(learner.getByText(exam.title, {exact: true})).toHaveCount(0);
    await learner.goto(url(`/courses?course=${onsite.id}&action=register`));
    await dialog.getByRole('button', {name: 'Register', exact: true}).click();
    await expect(dialog.locator('.session-row').getByText('Your session', {exact: true})).toBeVisible();
    await expect(dialog).toContainText("You're registered");
    for (const width of [390, 768, 1440]) {
      await learner.setViewportSize({width, height: 900});
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBeTruthy();
    }
    await expect(dialog.getByRole('link', {name: 'Take assessment', exact: true})).toHaveAttribute('href', url(`/exams?exam=${exam.id}&action=start`));
    await expect(dialog.getByText(invitation.title, {exact: true})).toHaveCount(0);
    const futureSessionRow = dialog.locator('.assessment-summary').filter({hasText: upcoming.title});
    await expect(futureSessionRow).toContainText('Opens ');
    await expect(futureSessionRow.getByRole('link')).toHaveCount(0);
    const enrollment = await (await learner.request.get(url(`/api/courses/${onsite.id}/`))).json();
    expect(enrollment.enrollment.status).toBe('approved');
    expect(enrollment.enrollment.session.id).toBe(session.id);
    await dialog.getByRole('button', {name: 'Close', exact: true}).first().click();
    // The development build mounts effects twice, so the overdue assignment must answer every request until it is checked.
    const overdueAssignment = (route: Route) => route.fulfill({json: [{user_id: participant.id, kind: 'exam', target_id: exam.id, title: exam.title,
      available: true, status: 'not_started', due_at: new Date(Date.now() - 86400000).toISOString()}]});
    await learner.route('**/api/assignments/', overdueAssignment);
    await navigateArea(learner, 'Home');
    const nextPanel = learner.locator('.next-steps');
    await expect(nextPanel.getByRole('list').getByRole('listitem').first()).toContainText(exam.title);
    await expect(nextPanel.getByRole('listitem').first()).toContainText('Assigned to you');
    await expect(nextPanel.getByRole('listitem').first().locator('.btn.primary')).toHaveText('Take assessment');
    await expect(learner.getByText('Training audience', {exact: true})).toHaveCount(0);
    await learner.unroute('**/api/assignments/', overdueAssignment);
    const nextSession = learner.locator('.next-step').filter({hasText: onsite.title});
    await expect(nextSession.getByRole('button', {name: 'View session', exact: true})).toBeVisible();
    const downloadPromise = learner.waitForEvent('download');
    await nextSession.getByRole('button', {name: 'Add to calendar', exact: true}).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('training-session.ics');
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const calendar = Buffer.concat(chunks).toString('utf8');
    expect(calendar.startsWith('BEGIN:VCALENDAR\r\n')).toBeTruthy();
    expect(calendar.replaceAll('\r\n ', '')).toContain('DESCRIPTION:Training details: ' + new URL(url(`/courses?course=${onsite.id}&action=register`), learner.url()).href);
    expect(calendar).toContain('DTSTART:' + new Date(session.starts_at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'));
    for (const width of [390, 768, 1440]) {
      await learner.setViewportSize({width, height: 900});
      expect(await learner.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      const inset = await nextPanel.evaluate(panel => {
        const heading = panel.querySelector('h2')!.getBoundingClientRect();
        const row = panel.querySelector('.next-step')!.getBoundingClientRect();
        const footer = panel.querySelector('.next-steps-content > .heading-actions')!.getBoundingClientRect();
        return {row: row.left - heading.left, footer: footer.left - heading.left, right: panel.getBoundingClientRect().right - row.right};
      });
      expect(Math.abs(inset.row)).toBeLessThanOrEqual(1);
      expect(Math.abs(inset.footer)).toBeLessThanOrEqual(1);
      expect(inset.right).toBeGreaterThan(10);
    }
    await navigateArea(learner, 'My training', 'Exams');
    await expect(learner.getByRole('navigation', {name: 'Main navigation'}).getByRole('link', {name: 'Exams', exact: true})).toHaveCount(0);
    await expect(learner.getByText(invitation.title, {exact: true})).toHaveCount(0);
    const card = learner.locator('.exam-card').filter({hasText: exam.title});
    await expect(card).toContainText('1 question · 30 minutes · Passing score: 70');
    await expect(card).not.toContainText('Total questions:');
    await expect(card).not.toContainText('Time allowed:');
    await expect(card).toContainText(online.title);
    await expect(card).toContainText(onsite.title);
    await expect(card.getByRole('link', {name: 'Start', exact: true})).toHaveAttribute('href', url(`/exams?exam=${exam.id}&action=start`));
    const futureExamRow = learner.locator('.exam-card').filter({hasText: upcoming.title});
    await expect(futureExamRow).toContainText('Opens ');
    await expect(futureExamRow.getByRole('link')).toHaveCount(0);
    for (const width of [1440, 390]) {
      await learner.setViewportSize({width, height: 900});
      expect(await learner.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    }
    await learner.goto(url('/my-training'));
    await expect(learner.locator('.course-card').filter({hasText: onsite.title})).toBeVisible();
    expect(await learner.locator('.personal-section-caption').evaluate(caption => caption.nextElementSibling!.getBoundingClientRect().top - caption.getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(16);
    await expect(learner.getByText(invitation.title, {exact: true})).toHaveCount(0);
    const futureTrainingRow = learner.locator('.assessment-summary').filter({hasText: upcoming.title});
    await expect(futureTrainingRow).toContainText('Opens ');
    await expect(futureTrainingRow.getByRole('link')).toHaveCount(0);
    await expect(learner.getByRole('link', {name: 'Preview exam', exact: true})).toHaveCount(0);
    await learner.getByRole('button', {name: 'View sessions', exact: true}).click();
    dialog = learner.getByRole('dialog');
    await expect(dialog).toContainText('Synthetic room');
    await dialog.getByRole('link', {name: 'Take assessment', exact: true}).click();
    const preflight = learner.getByRole('dialog', {name: 'Ready to start?', exact: true});
    await expect(preflight).toContainText(exam.title);
    await preflight.getByRole('button', {name: 'Start / resume attempt', exact: true}).click();
    await expect(learner).toHaveURL(new RegExp(url('/attempt/') + '[a-f0-9-]+'));
    await expect(learner.getByText('Choose the synthetic answer.', {exact: true})).toBeVisible();
    const attemptId = new URL(learner.url()).pathname.split('/').pop()!;
    await learner.locator('.answer-options input[type="radio"]').nth(1).check();
    await learner.getByRole('button', {name: 'Finish and submit', exact: true}).click();
    await learner.getByRole('button', {name: 'Confirm submission', exact: true}).click();
    await expect(learner.getByRole('heading', {name: 'Assessment completed', exact: true})).toBeVisible();
    await learner.goto(url('/my-exams'));
    await expect(card.getByRole('link', {name: 'Retake', exact: true})).toHaveAttribute('href', url(`/exams?exam=${exam.id}&action=start`));
    await expect(card.getByRole('link', {name: 'View results', exact: true})).toHaveAttribute('href', url(`/attempt/${attemptId}`));
    await expect(learner.locator('.personal-section').filter({has: learner.getByRole('heading', {name: 'To do', exact: true})})).toContainText(exam.title);
    await learner.goto(url('/my-training'));
    const failedTrainingRow = learner.locator('.assessment-summary').filter({hasText: exam.title});
    await expect(failedTrainingRow.getByRole('link', {name: 'Retake', exact: true})).toHaveAttribute('href', url(`/exams?exam=${exam.id}&action=start`));
    await expect(failedTrainingRow.getByRole('link', {name: 'View results', exact: true})).toHaveAttribute('href', url(`/attempt/${attemptId}`));
    await write(page, `exams/${exam.id}/`, {ends_at: new Date(Date.now() - 60000).toISOString()}, 'PATCH');
    await learner.goto(url('/my-exams'));
    await expect(learner.locator('.personal-section').filter({has: learner.getByRole('heading', {name: 'Closed', exact: true})})).toContainText(exam.title);
    await expect(card).toContainText('Assessment closed');
    await expect(card.getByRole('link', {name: 'Retake', exact: true})).toHaveCount(0);
    await expect(card.getByRole('link', {name: 'View results', exact: true})).toHaveAttribute('href', url(`/attempt/${attemptId}`));
    await learner.goto(url('/my-training'));
    await expect(failedTrainingRow).toContainText('Assessment closed');
    await expect(failedTrainingRow.getByRole('link', {name: 'Retake', exact: true})).toHaveCount(0);
    await write(page, `exams/${exam.id}/`, {ends_at: null}, 'PATCH');
    await learner.route('**/api/courses/mine/', async route => {
      const response = await route.fetch();
      const courses = await response.json();
      await route.fulfill({json: courses.map((c: {id: number; sessions: object[]; enrollment: {session: object}}) => c.id === onsite.id
        ? {...c, sessions: c.sessions.map(s => ({...s, cancelled: true})), enrollment: {...c.enrollment, session: {...c.enrollment.session, cancelled: true}}} : c)});
    });
    await learner.goto(url('/my-training'));
    const cancelledCard = learner.locator('.course-card').filter({has: learner.getByRole('heading', {name: onsite.title, exact: true})});
    await expect(cancelledCard.getByText('Session cancelled', {exact: true})).toHaveClass(/amber/);
    await expect(cancelledCard.getByRole('button', {name: 'Choose another session', exact: true})).toHaveClass(/primary/);
    await expect(cancelledCard.getByRole('button', {name: 'View sessions', exact: true})).toHaveCount(0);
    await expect(cancelledCard.getByRole('button', {name: 'Add to calendar', exact: true})).toHaveCount(0);
  } finally { await context.close(); }
  // Personal training stays learner-only even when the signed-in user manages the exam.
  await write(page, `courses/${online.id}/enroll/`, {});
  await page.goto(url('/my-training'));
  const personalCard = page.locator('.course-card').filter({hasText: online.title});
  await expect(personalCard.getByText('Not started', {exact: true})).toBeVisible();
  await expect(personalCard.getByRole('link', {name: 'Take assessment', exact: true})).toBeVisible();
  await expect(personalCard.getByRole('link', {name: 'Preview exam', exact: true})).toHaveCount(0);
  await expect(personalCard.getByRole('link', {name: 'Edit quiz', exact: true})).toHaveCount(0);
  await expect(personalCard.getByRole('button', {name: 'Manage quizzes', exact: true})).toHaveCount(0);
  await write(page, `exams/${exam.id}/`, {published: false}, 'PATCH');
  await page.goto(url('/courses'));
  const catalogCard = page.locator('.course-card').filter({has: page.getByRole('heading', {name: online.title, exact: true})});
  await expect(catalogCard.getByText('Not published yet', {exact: true})).toBeVisible();
  await expect(catalogCard.getByText('Published', {exact: true})).toHaveCount(1);
  await expect(catalogCard.getByText('Draft', {exact: true})).toHaveCount(0);
  await expect(catalogCard.getByRole('button', {name: 'Manage quizzes', exact: true})).toBeVisible();
  await write(page, `exams/${exam.id}/`, {published: true}, 'PATCH');
}
