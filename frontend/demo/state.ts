import { createData, type DemoData } from './data.ts';
export const storageKey = 'training-demo-state';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function createState(storage?: Storage, now = Date.now()) {
  let data = createData(now);
  try {
    const saved = JSON.parse(storage?.getItem(storageKey) || 'null') as DemoData | null;
    if (saved?.version === data.version && Array.isArray(saved.users) && Array.isArray(saved.attempts)
      && new Date(saved.createdAt).toDateString() === new Date(now).toDateString()) {
      data = saved;
    } else if (saved) {
      storage?.removeItem(storageKey);
    }
  } catch { /* Storage may be unavailable or contain an old demo version. */ }
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  const save = () => { try { storage?.setItem(storageKey, JSON.stringify(data)); } catch { /* Keep in-memory state. */ } listeners.forEach(listener => listener()); };
  return { subscribe, get data() { return data; }, save, reset() { data = createData(); save(); }, switchView(view: 'admin' | 'learner') { data.view = view; data.userId = view === 'admin' ? 1 : 3; save(); } };
}
export type DemoState = ReturnType<typeof createState>;
