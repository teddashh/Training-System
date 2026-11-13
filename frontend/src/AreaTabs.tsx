import type { Area } from './navigation';
import { appPath } from './paths';
import { t } from './i18n';
export default function AreaTabs({area, go}: {area: Area & {activePath: string}; go: (path: string) => void}) {
  if (area.tabs.length < 2) return null;

  return <nav className="area-tabs" aria-label={t('{area} navigation', {area: t(area.label)})}>
    {area.tabs.map(tab => <a key={tab.path} href={appPath(tab.path)} aria-current={area.activePath === tab.path ? 'page' : undefined}
      onClick={event => {event.preventDefault(); go(tab.path);}}>{t(tab.label)}</a>)}
  </nav>;
}
