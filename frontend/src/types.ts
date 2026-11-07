export type User = {
  id: number;
  username: string;
  display_name: string;
  email: string;
  role: "admin" | "instructor" | "learner";
  employment: string;
  department: string;
  employee_id: string | null;
  is_active?: boolean;
};
export type Block = { type: "heading" | "text" | "callout"; text: string };
export type Course = {
  can_manage: boolean;
  id: number;
  title: string;
  description: string;
  category: string;
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
  enrolled_count: number;
};
export type Question = {
  id?: number;
  description: string;
  type: "single" | "multiple" | "short" | "essay";
  options: string[];
  solution?: (number | string)[];
  points: number;
  position?: number;
};
export type Exam = {
  shuffle_questions: boolean;
  shuffle_options: boolean;
  questions_per_attempt: number | null;
  id: number;
  title: string;
  description: string;
  course: number | null;
  duration_minutes: number;
  max_attempts: number;
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
    | "employees"
    | "contractors"
    | "departments"
    | "people"
    | "invitation";
  allowed_departments?: string[];
  allowed_users?: number[];
  can_manage: boolean;
};
export type Attempt = {
  answer_revision: number;
  id: string;
  exam_id: number;
  title: string;
  number: number;
  status: string;
  deadline: string;
  server_time: string;
  answers: Record<string, string | number | number[]>;
  questions: Question[];
  score: number | null;
  passed: boolean | null;
  pass_score: number;
  manual_grades: Record<string, { points: number; feedback?: string }>;
  person?: string;
};
export type Result = {
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
  verification_required?: false;
  exam_id: number;
  title: string;
  description: string;
  duration_minutes: number;
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
