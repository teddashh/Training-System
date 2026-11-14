import type { Access, Attempt, Course, CourseSession, Exam, Question, User } from '../src/types.ts';
import type { EnrollmentRow } from '../src/simpleTraining.ts';
export const day = 86400000;
export const relative = (now: number, days: number) => new Date(now + days * day).toISOString();
// Calendar arithmetic keeps local wall-clock times stable across daylight-saving changes.
const localTime = (now: number, days: number, hours: number, minutes = 0) => {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
};
const access = (manage: boolean): Access => ({
  courses: manage ? 'all' : 'none', exams: manage ? 'all' : 'none', results: manage ? 'all' : 'none', assign: manage, invitations: manage, system_admin: manage, people: manage, scorm_upload: manage, scorm_source: manage
});
export type DemoEnrollment = Omit<EnrollmentRow, 'quiz'> & {
  course: number;
};
export type DemoAttempt = Attempt & {
  user_id: number;
  submitted_at: string | null;
  started_at: string;
};
export type DemoData = ReturnType<typeof createData>;
/** Canonical English catalogue keys are localized at the API boundary, including after reload. */
export function createData(now = Date.now()) {
  const names = [
    'Alex Morgan', 'Jamie Chen', 'Taylor Lin', 'Sofia Huang', 'Jordan Chang', 'Emma Lee', 'Lucas Wang', 'Olivia Wu', 'Noah Liu', 'Mia Tsai', 'Ethan Yang', 'Ava Hsu'
  ];
  const departments = ['Product & Engineering', 'Sales & Marketing', 'Operations'];
  const users: User[] = names.map((display_name, i) => ({
    id: i + 1, display_name, username: i === 0 ? 'demo.admin' : `demo.learner${i}`, email: i === 0 ? 'admin@example.com' : `learner${i}@example.com`, role: i === 0 ? 'admin' : i === 1 ? 'training_scheduler' : 'learner', access: i === 1 ? { ...access(false), courses: 'all', assign: true, people: true } : access(i === 0), employment: i > 2 && i % 4 === 0 ? 'contractor' : 'employee', department: departments[i % 3], employee_id: `E${String(i + 1).padStart(4, '0')}`, is_active: true, is_staff: i === 0, directory_linked: false, has_signed_in: true, job_title: ''
  }));
  const session = (id: number, days: number, title: string, location: string, hour: number, minute = 0, durationHours = 2): CourseSession => ({
    id, title, revision: 1, location, meeting_url: '', starts_at: localTime(now, days, hour, minute), ends_at: localTime(now, days, hour + durationHours, minute), registration_opens_at: localTime(now, -14, 9), registration_closes_at: localTime(now, days - 1, 17), capacity: 16, reserved: 0, remaining: 16, cancelled: false, state: days > 0 ? 'open' : 'ended'
  });
  const titles = [
    'Information security & data privacy', 'Welcome to the team', 'Communication & cross-team collaboration', 'Microsoft 365 in practice', 'Workplace ethics & compliance', 'Customer experience & service design', 'Forklift safety workshop', 'Team leadership'
  ];
  const descriptions = [
    'Build practical security awareness and protect company and personal information in your daily work.', 'Explore our team culture, workflows and collaboration tools as you start your new role.', 'Practice clear communication and active listening to help every collaboration run smoothly.', 'Use Teams, SharePoint and shared documents to organize your digital workspace.', 'Build sound workplace judgment around confidentiality, conflicts of interest and reporting concerns.', 'Consider the customer perspective and apply practical service methods to improve their experience.', 'Practice equipment checks and safe movement with your instructor.', 'Prepare a clear plan and support your team.'
  ];
  const courses: Course[] = titles.map((title, i) => ({
    id: i + 1, title, description: descriptions[i], category: i === 1 ? 'Onboarding' : 'Core training', cover: [
      'scene-tech-badge-access', 'scene-people-onboarding', 'scene-people-handshake', 'scene-office-video-call', 'ethics-and-conduct', 'scene-office-reception', 'scene-safety-forklift', 'scene-learning-mentoring'
    ][i], duration_minutes: [45, 30, 60, 40, 35, 50, 120, 45][i], published: i !== 7, blocks: [
      { type: 'heading', text: 'Before you begin' }, { type: 'text', text: descriptions[i] }, { type: 'heading', text: 'Put it into practice' }, { type: 'text', text: 'Pause, check the situation and ask your team lead when you are unsure.' }, { type: 'callout', text: 'Choose one action to apply in your next working day.' }
    ], package: i === 3 ? { id: 'demo-digital-tools', version: '1', title, has_source: true } : null, progress: null, progress_known: true, enrolled_count: 0, assessments: [], venue: i === 6 ? 'onsite' : 'online', delivery_mode: [2, 6].includes(i) ? 'scheduled' : 'self_paced', server_time: relative(now, 0), release_at: null, requires_approval: i === 6, enrollment: null, can_learn: i !== 6, can_manage: true, reminders: i === 6, created_at: relative(now, -30 + i), sessions: i === 6 ? [
      session(71, 7, 'Morning workshop', 'Training room A', 9), session(72, 14, 'Afternoon workshop', 'Training room A', 13, 30), session(73, -7, 'Previous workshop', 'Training room A', 9)
    ] : i === 2 ? [session(31, 3, 'Team collaboration session', 'Online', 10, 0, 1), session(32, 10, 'Practice session', 'Online', 14, 0, 1)] : []
  }));
  const questions: Question[] = [
    {
      id: 1, type: 'single', description: 'What should you do if an unexpected email asks for your company password?', options: ['Reply to the email', 'Report it to IT through the approved process', 'Forward it to everyone', 'Click the link to investigate'], solution: [1], points: 20
    },
    {
      id: 2, type: 'multiple', description: 'Which actions support secure collaboration? Select all that apply.', options: ['Use approved shared workspaces', 'Grant access only to the people who need it', 'Write passwords in public documents', 'Review access permissions regularly'], solution: [0, 1, 3], points: 20
    },
    { id: 3, type: 'short', description: 'Enter the word safety.', options: [], solution: ['safety'], answer_matching: ['normalized'], points: 10 },
    { id: 4, type: 'integer', description: 'How many wheels are on a four-wheel vehicle?', options: [], solution: ['4'], points: 10 },
    { id: 5, type: 'numeric', description: 'Enter one half as a decimal.', options: [], solution: ['0.5'], answer_tolerances: ['0.01'], points: 10 },
    { id: 6, type: 'ordering', description: 'Put the work steps in order.', options: ['Plan', 'Check', 'Act'], solution: [0, 1, 2], points: 10 },
    {
      id: 7, type: 'essay', description: 'Describe one practical way you would improve team communication.', options: [], solution: [], grading_guide: 'Look for a specific action and a clear benefit for the team.', points: 20
    },
  ];
  const exams: Exam[] = ['Security & collaboration assessment', 'Forklift safety quiz', 'Workplace skills assessment'].map((title, i) => ({
    id: i + 1, title, description: 'Check your understanding and review your results.', courses: [i === 1 ? 7 : i + 1], course_links: [{ id: i === 1 ? 7 : i + 1, title: titles[i === 1 ? 6 : i], can_remove: true }], available_to_me: true, assignment_due_at: null, last_result: null, duration_minutes: 30, max_attempts: 5, retry_interval_minutes: 0, attempt_reset_minutes: 0, next_round_at: null, round_number: 1, round_attempts_used: 0, round_awaiting_grading: false, allow_skip: true, allow_response_review: true, next_attempt_at: null, server_time: relative(now, 0), pass_score: 70, published: true, starts_at: relative(now, -30), ends_at: relative(now, 90), questions: structuredClone(i === 0 ? questions.slice(0, 3) : i === 1 ? questions.slice(3, 6) : questions), question_count: i === 2 ? 7 : 3, attempts_used: 0, effective_attempt_limit: 5, attempts_remaining: 5, active_attempt_id: null, audience: i === 1 ? 'course' : 'all', allowed_departments: [], allowed_users: [], allowed_groups: [], can_manage: true, can_view_results: true, shuffle_questions: false, shuffle_options: false, questions_per_attempt: null
  }));
  const enrollments: DemoEnrollment[] = users.map<DemoEnrollment>((u, i) => ({
    id: i + 1, course: 7, user_id: u.id, person: u.display_name, username: u.username, department: u.department, active: true, status: i === 2 || i === 4 ? 'pending' : 'approved', revision: 1, session: courses[6].sessions[i > 8 ? 2 : i > 5 ? 1 : 0], request_note: '', requested_at: relative(now, -10), review_note: '', reviewed_at: relative(now, -9), progress: i > 8 ? 100 : 0, progress_known: true, completed_at: i > 8 ? relative(now, -7) : null, attendance: i > 8 ? 'present' : '', effective_attendance: i > 8 ? 'present' : '', attended_at: null, attendance_marked_at: i > 8 ? relative(now, -7) : null
  })).filter(row => row.user_id !== 2);
  enrollments.push(...[1, 2].map((course, i): DemoEnrollment => ({
    ...structuredClone(enrollments.find(row => row.user_id === 3)!), id: 13 + i, course, session: null, status: 'approved', progress: i === 0 ? 40 : 100, completed_at: i === 0 ? null : relative(now, -2)
  })));
  const attempts: DemoAttempt[] = users.slice(2).map((u, i): DemoAttempt => {
    const exam_id = i >= 7 ? 2 : i % 2 === 0 ? 1 : 3;
    const failed = i < 7 && i % 3 === 0;
    const score = i >= 7 ? 100 - (i - 7) * 10 : failed ? 60 : exam_id === 1 ? 100 : 90;
    const manual_grades: Attempt['manual_grades'] = exam_id === 2 ? (i === 7 ? {} : { '6': { points: i === 8 ? 7 : 4 } }) : { '7': { points: failed ? 0 : 10 } };
    return {
      id: `demo-result-${i + 1}`, exam_id, user_id: u.id, title: exams[exam_id - 1].title, person: u.display_name, number: 1, status: 'graded', deadline: relative(now, -i - 1), started_at: relative(now, -i - 1), submitted_at: relative(now, -i - 1 + 1 / 48), extra_time_minutes: 0, server_time: relative(now, 0), answers: {
        '1': failed ? 0 : 1, '2': [0, 1, 3], '3': 'safety', '4': '4', '5': '0.5', '6': [0, 1, 2], '7': 'Agree on shared goals, then document meeting decisions and responsibilities.'
      }, questions: structuredClone(exams[exam_id - 1].questions!), score, passed: !failed, pass_score: 70, manual_grades, allow_skip: true, review_available: true, question_count: exams[exam_id - 1].question_count, answer_revision: 1, grading_revision: 1
    };
  });
  const assignments = [1, 2].map((id) => ({
    id, user_id: id === 1 ? 1 : 3, person: users[id === 1 ? 0 : 2].display_name, username: users[id === 1 ? 0 : 2].username, department: users[id === 1 ? 0 : 2].department, kind: id === 1 ? 'course' : 'exam', target_id: 1, title: id === 1 ? courses[0].title : exams[0].title, available: true, due_at: localTime(now, id * 7, 17), notes: 'Complete this required training and discuss any questions with your team lead.', status: 'not_started', overdue: false, progress: 0, progress_known: true, score: null as number | null, completed_at: null as string | null
  }));
  const groups = departments.map((name, i) => ({
    id: i + 1, name, description: 'Training group', member_count: 4, active_member_count: 4, entra_group_id: null, entra_display_name: null, entra_last_synced_at: null, entra_sync_result: null, members: users.filter(u => u.department === name).map(u => u.id)
  }));
  return {
    version: 2, createdAt: now, userId: 1 as number | null, view: 'admin' as 'admin' | 'learner', users, courses, exams, enrollments, attempts, assignments, groups, departments
  };
}
