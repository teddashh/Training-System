import { useEffect, useId, useState } from 'react';
import { api } from './api';
import { appPath } from './paths';
import { t } from './i18n';
import { ErrorBox } from './ui';
import { gated, type QuizOption } from './simpleTraining';
export default function TrainingQuiz({ value, onChange, disabled = false }: { value: number | null; onChange: (id: number | null) => void; disabled?: boolean }) {
  const [options, setOptions] = useState<QuizOption[]>([]), [error, setError] = useState('');
  // An explicit label: one that wraps the list would read the option texts as part of its name.
  const id = useId();
  useEffect(() => {
    let active = true, generation = 0;
    const load = () => { const request = ++generation; void api<QuizOption[]>('exams/link-options/?quizzes=1').then(data => { if (active && generation === request) { setOptions(data); setError(''); } }).catch(e => { if (active && generation === request) setError(e.message); }); };
    load(); window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('focus', load); };
  }, []);
  return <div className="training-quiz"><div className="training-inline"><div className="training-quiz-field"><label htmlFor={id}>{t('Quiz')}</label><select id={id} disabled={disabled} value={value || ''} onChange={e => onChange(Number(e.target.value) || null)}><option value="">{t('No quiz')}</option>{options.map(option => <option key={option.id} value={option.id}>{option.title}{!option.published ? ` · ${t('Draft')}` : !gated(option) ? ` · ${t('Open now')}` : ''}</option>)}</select></div><a className="text-btn" target="_blank" rel="noopener" href={appPath('/exams?action=create')}>{t('New quiz')}</a></div>
    {value && <p className="muted">{t(gated(options.find(option => option.id === value)) ? 'Opens for each person when their session ends.' : 'Open now. People are told after their session.')}</p>}<ErrorBox message={error} />
  </div>;
}
