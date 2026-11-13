export type Access = {
  courses: 'none' | 'own' | 'all'; exams: 'none' | 'own' | 'all'; results: 'none' | 'own' | 'all';
  assign: boolean; invitations: boolean; system_admin: boolean; people: boolean;
  scorm_upload: boolean; scorm_source: boolean;
};
export type User = {
  id: number;
  username: string;
  display_name: string;
  email: string;
  role: "admin" | "training_admin" | "course_creator" | "exam_admin" | "training_scheduler" | "instructor" | "learner";
  access: Access;
  employment: string;
  department: string;
  employee_id: string | null;
  is_active?: boolean;
  is_staff?: boolean;
  entra_subject?: string | null;
  job_title?: string;
  directory_linked?: boolean;
  has_signed_in?: boolean;
  directory_disabled?: boolean;
};
export type Block = { type: "heading" | "text" | "callout"; text: string };
export type CourseSession = {
  id: number; title: string; revision: number; location: string; meeting_url?: string;
  registration_opens_at: string | null; registration_closes_at: string;
  starts_at: string; ends_at: string; capacity: number;
  reserved: number; remaining: number; cancelled: boolean;
  state: 'open' | 'upcoming' | 'closed' | 'full' | 'in_progress' | 'ended' | 'cancelled';
};
export type Enrollment = {
  attendance: "" | "present" | "absent";
  effective_attendance: "" | "present" | "absent";
  attended_at: string | null;
  attendance_marked_at: string | null;
  id: number;
  status: "pending" | "approved" | "rejected" | "removed" | "cancelled";
  session: Pick<CourseSession, 'id' | 'title' | 'starts_at' | 'ends_at' | 'cancelled' | 'location'> | null;
  revision: number;
  request_note: string;
  requested_at: string | null;
  review_note: string;
  reviewed_at: string | null;
  progress: number;
  progress_known?: boolean;
  completed_at: string | null;
};
export type Assessment = Pick<Exam, "audience" | "id" | "title" | "published" | "can_manage" | "available_to_me" | "starts_at" | "ends_at" | "active_attempt_id" | "last_result" | "attempts_remaining" | "next_attempt_at"> & {
  next_round_at?: string | null; round_awaiting_grading?: boolean; attempts_used?: number;
  retry_interval_minutes?: number; server_time?: string;
  question_count: number; other_courses: number; window_state: "open" | "upcoming" | "closed";
};
export type Course = {
  assessments: Assessment[];
  venue: "online" | "onsite";
  server_time: string;
  delivery_mode: 'self_paced' | 'scheduled';
  release_at: string | null;
  sessions: CourseSession[];
  requires_approval: boolean;
  can_learn: boolean;
  enrollment: Enrollment | null;
  can_manage: boolean;
  id: number;
  title: string;
  description: string;
  category: string;
  cover: string;
  duration_minutes: number;
  published: boolean;
  blocks: Block[];
  package: {
    id: string;
    version: string;
    title: string;
    has_source?: boolean;
  } | null;
  progress: number | null;
  progress_known?: boolean;
  enrolled_count: number;
  reminders?: boolean;
  created_at?: string;
};
export type Figure = { key: string; width: number; height: number; alt?: string; caption?: string };
export type Question = {
  grading_guide?: string;
  figure?: Figure | null;
  figure_alt?: string;
  figure_caption?: string;
  id?: number;
  description: string;
  type:
    | "single"
    | "multiple"
    | "short"
    | "essay"
    | "integer"
    | "numeric"
    | "ordering";
  options: string[];
  solution?: (number | string)[];
  answer_tolerances?: string[];
  answer_matching?: TextMatchingMode[];
  points: number;
  position?: number;
};
export type TextMatchingMode = "normalized" | "lower" | "exact";
export type Exam = {
  shuffle_questions: boolean;
  shuffle_options: boolean;
  questions_per_attempt: number | null;
  id: number;
  title: string;
  description: string;
  courses: number[];
  course_links: { id: number; title: string; can_remove: boolean }[];
  available_to_me: boolean;
  assignment_due_at: string | null;
  last_result: { id: string; status: string; score: number | null; passed: boolean | null } | null;
  duration_minutes: number;
  max_attempts: number;
  retry_interval_minutes: number;
  attempt_reset_minutes: number;
  next_round_at: string | null;
  round_number: number;
  round_attempts_used: number;
  round_awaiting_grading: boolean;
  allow_skip: boolean;
  allow_response_review: boolean;
  next_attempt_at: string | null;
  server_time: string;
  pass_score: number;
  published: boolean;
  starts_at: string | null;
  ends_at: string | null;
  questions?: Question[];
  question_count: number;
  attempts_used: number;
  effective_attempt_limit: number;
  attempts_remaining: number;
  active_attempt_id: string | null;
  audience:
    | "all"
    | "course"
    | "employees"
    | "contractors"
    | "departments"
    | "people"
    | "groups"
    | "invitation";
  allowed_departments?: string[];
  allowed_users?: number[];
  allowed_groups?: number[];
  can_manage: boolean;
  can_view_results: boolean;
};
export type Attempt = {
  allow_skip: boolean;
  review_available: boolean;
  question_count: number;
  answer_revision: number;
  grading_revision: number;
  id: string;
  exam_id: number;
  title: string;
  number: number;
  status: string;
  deadline: string | null;
  extra_time_minutes: number;
  preview_mode?: "learner" | "unrestricted";
  preview_expires_at?: string;
  server_time: string;
  answers: Record<string, string | number | number[]>;
  questions: Question[];
  score: number | null;
  passed: boolean | null;
  pass_score: number;
  manual_grades: Record<
    string,
    { points: number | null; feedback?: string; source?: string }
  >;
  person?: string;
};
export type Result = {
  can_view_results: boolean;
  id: string;
  exam: string;
  exam_id: number;
  person: string;
  department: string;
  number: number;
  status: string;
  score: number | null;
  passed: boolean | null;
  submitted_at: string | null;
};
export type Invitation = {
  state:
    "active" | "resume_only" | "exhausted" | "revoked" | "expired" | "blocked";
  remaining_new_attempts: number;
  can_resume: boolean;
  batch: string | null;
  id: string;
  exam: number;
  exam_title: string;
  identity_key: string;
  max_attempts: number;
  used: number;
  expires_at: string;
  revoked: boolean;
  url?: string;
  require_email_verification: boolean;
  verification_email: string;
};
export type Dashboard = {
  people: number;
  courses: number;
  completion: number;
  enrollments: number;
  completed: number;
  pass_rate: number;
  average_score: number;
  graded_count: number;
  pending: number;
  employee_count: number;
  contractor_count: number;
  days: number;
  trend: { day: string; count: number; average: number }[];
  departments: { user__department: string; total: number; completed: number }[];
  distribution: number[];
};
export type Guest = {
  attempt_reset_minutes: number;
  next_round_at: string | null;
  round_awaiting_grading: boolean;
  allow_skip: boolean;
  allow_response_review: boolean;
  verification_required?: false;
  exam_id: number;
  title: string;
  description: string;
  duration_minutes: number;
  retry_interval_minutes: number;
  next_attempt_at: string | null;
  server_time: string;
  active_attempt_id: string | null;
  remaining: number;
  recipient: string;
  expires_at: string;
};
export type GuestChallenge = {
  verification_required: true;
  email_hint: string;
  title: string;
};
export type ResultSummary = {
  total: number;
  graded: number;
  pending: number;
  in_progress: number;
  passed: number;
  average_score: number | null;
  pass_rate: number | null;
  participants: number;
};
export type ResultsPage = {
  results: Result[];
  count: number;
  page: number;
  pages: number;
  page_size: number;
  summary: ResultSummary;
};
export type ExamInsights = {
  exam: { id: number; title: string };
  summary: ResultSummary;
  distribution: { band: string; count: number }[];
  departments: {
    department: string | null;
    attempts: number;
    graded: number;
    passed: number;
    average: number | null;
  }[];
  questions: {
    variant: string;
    figure?: Figure | null;
    question_id: number;
    description: string;
    type: Question["type"];
    points: number;
    responses: number;
    answered: number;
    full_credit: number;
    average_points: number;
    full_credit_rate: number;
    answer_rate: number;
  }[];
};
