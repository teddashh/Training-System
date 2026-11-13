import { brand } from "./brand";
import { CalendarPlus } from 'lucide-react';
import type { Course } from './types';
import { useCurrentUser } from './access';
import { appPath } from './paths';
import { t } from './i18n';
import { buildSessionCalendar, downloadCalendar } from './calendar';

export default function AddToCalendar({course}: {course: Course}) {
  const user = useCurrentUser();
  const session = course.sessions.find(s => s.id === course.enrollment?.session?.id);
  if (!user || !['approved', 'pending'].includes(course.enrollment?.status || '') || !session || session.cancelled || session.state === 'cancelled' || session.state === 'ended' || Date.parse(session.ends_at) <= Date.now()) return null;
  return <button type="button" className="btn" onClick={() => downloadCalendar(buildSessionCalendar(course, session, user.id, {
    organization: brand.organization, host: window.location.host, url: window.location.origin + appPath(`/courses?course=${course.id}&action=register`), joinMeeting: t('Join meeting'), trainingDetails: t('Training details'),
  }))}><CalendarPlus size={16} aria-hidden="true"/>{t('Add to calendar')}</button>;
}
