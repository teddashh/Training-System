import { createContext, useContext } from "react";
import { t } from "./i18n";
import type { Access, User } from "./types";

const denied: Access = { courses: "none", exams: "none", results: "none", assign: false, invitations: false, system_admin: false, people: false, scorm_upload: false, scorm_source: false };
export const CurrentUserContext = createContext<User | null>(null);
export const useCurrentUser = () => useContext(CurrentUserContext);
export const AccessContext = createContext<Access>(denied);
export const useAccess = () => useContext(AccessContext);
// Display metadata only. Permission policy comes exclusively from the API.
export const roleInfo = {
  learner: { label: "Learner", help: "Learners access available training, complete assignments and see their own results.", legacy: false },
  course_creator: { label: "Course creator", help: "Course creators manage and schedule their own courses, link existing exams and assign their courses.", legacy: false },
  exam_admin: { label: "Exam administrator", help: "Exam administrators manage all exams, exam results, exam assignments and guest invitations.", legacy: false },
  training_scheduler: { label: "Training scheduler", help: "Training schedulers create and schedule their own courses and exams, without participant results or assignments.", legacy: false },
  training_admin: { label: "Training administrator", help: "Training administrators manage all courses, exams, results, assignments and guest invitations.", legacy: false },
  admin: { label: "Super administrator", help: "Super administrators manage all training, people, permissions and system settings.", legacy: false },
  instructor: { label: "Instructor", help: "Instructors create and manage their own courses and exams, and review their participants.", legacy: true },
};
export const roleLabel = (role: User["role"]) => t(roleInfo[role]?.label || "Learner");
export const rolesFor = (current?: User["role"]) => (Object.keys(roleInfo) as User["role"][]).filter(key => !roleInfo[key].legacy || key === current);
export function routeAllowed(access: Access, capability?: keyof Access) {
  if (!capability) return true;
  const value = access?.[capability];
  return value === true || value === "all" || value === "own";
}

// Use the same capability test as navigation, without depending on role names.
export function hasManagementAccess(access: Access) {
  return (['courses', 'exams', 'results', 'assign', 'people', 'invitations', 'system_admin'] as const)
    .some(capability => routeAllowed(access, capability));
}
