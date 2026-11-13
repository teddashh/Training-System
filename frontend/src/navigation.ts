import type { Access } from './types';

type Tab = {label: string; path: string; capability?: keyof Access; personalResults?: boolean};
export type Area = {id: 'home' | 'learning' | 'training' | 'exams' | 'reports' | 'people' | 'settings'; label: string; tabs: Tab[]};
const has = (access: Access, key?: keyof Access) => !key || access[key] === true || access[key] === 'own' || access[key] === 'all';
/** Anyone who manages something may open the overview; only people with results get it as a Reports tab. */
export const managesSomething = (access: Access) => (['courses', 'exams', 'results', 'assign', 'people', 'invitations', 'system_admin'] as const).some(key => has(access, key));
// Navigation membership and deep-link ownership live here; visibility never revokes a route.
const areas: Area[] = [
  {id: 'home', label: 'Home', tabs: [{label: 'Home', path: '/'}]},
  {id: 'learning', label: 'My training', tabs: [
    {label: 'Training', path: '/my-training'}, {label: 'Exams', path: '/my-exams'},
    {label: 'Results', path: '/results', personalResults: true}, {label: 'Catalog', path: '/courses'}]},
  {id: 'training', label: 'Training', tabs: [{label: 'Trainings', path: '/authoring', capability: 'courses'}, {label: 'Assignments', path: '/assignments', capability: 'assign'}]},
  {id: 'exams', label: 'Exams', tabs: [{label: 'Exams', path: '/exams', capability: 'exams'}, {label: 'Question bank', path: '/question-bank', capability: 'exams'}, {label: 'Guest invitations', path: '/invitations', capability: 'invitations'}]},
  {id: 'reports', label: 'Reports', tabs: [{label: 'Overview', path: '/reports', capability: 'results'}, {label: 'Results', path: '/results', capability: 'results'}, {label: 'Insights', path: '/insights', capability: 'results'}]},
  {id: 'people', label: 'People', tabs: [{label: 'People', path: '/people', capability: 'system_admin'}]},
  {id: 'settings', label: 'Settings', tabs: [{label: 'Administration', path: '/manage', capability: 'system_admin'}, {label: 'Settings', path: '/settings', capability: 'system_admin'}, {label: 'Email', path: '/email', capability: 'system_admin'}]},
];
const deepLinks = [
  {matches: (_a: Access, p: string) => p.startsWith('/attempt/'), area: 'learning', tab: '/my-exams'},
  {matches: (_a: Access, p: string) => p.startsWith('/preview/'), area: 'exams', tab: '/exams'},
  {matches: (a: Access, p: string, q: URLSearchParams) => p === '/exams' && (!has(a, 'exams') || q.get('action') === 'start'), area: 'learning', tab: '/my-exams'},
  {matches: (a: Access, p: string) => p === '/assignments' && !a.assign, area: 'learning', tab: '/my-training'},
  {matches: (a: Access, p: string) => p === '/reports' && !has(a, 'results'), area: 'home', tab: '/'},
] as const;
export function navigationAreas(access: Access): Area[] {
  return areas.map(area => ({...area, tabs: area.tabs.filter(tab => has(access, tab.capability) && (!tab.personalResults || !has(access, 'results')))})).filter(area => area.tabs.length);
}
export function activeArea(access: Access, path: string, search = '') {
  const visible = navigationAreas(access);
  const deep = deepLinks.find(row => row.matches(access, path, new URLSearchParams(search)));
  const area = deep ? visible.find(area => area.id === deep.area) : visible.find(area => area.tabs.some(tab => tab.path === path));
  return area ? {...area, activePath: deep?.tab || path} : undefined;
}
export function canOpenRoute(access: Access, path: string) {
  if (['/assignments', '/exams', '/results'].includes(path)) return true;
  if (path === '/reports') return managesSomething(access);
  return areas.some(area => area.tabs.some(tab => tab.path === path && has(access, tab.capability)));
}
