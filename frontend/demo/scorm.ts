import './catalogue';
import { t } from '../src/i18n';
import '../src/style.css';
import './demo.css';
const lessons = [
  [t('Microsoft 365 in practice'), t('Use Teams, SharePoint and shared documents to organize your digital workspace.')],
  [t('Put it into practice'), t('Use approved shared workspaces'), t('Grant access only to the people who need it'), t('Review access permissions regularly')],
  [t('Before you finish'), t('Choose one action to apply in your next working day.')],
];
let index = 0, sequence = 0;
function render() {
  const root = document.getElementById('lesson')!;
  root.replaceChildren();
  const heading = document.createElement('h1'); heading.textContent = lessons[index][0]; root.append(heading);
  for (const text of lessons[index].slice(1)) { const p = document.createElement('p'); p.textContent = text; root.append(p); }
  const nav = document.createElement('nav');
  for (const [label, delta] of [[t('Previous'), -1], [t('Next'), 1]] as const) {
    const button = document.createElement('button'); button.className = delta === 1 ? 'btn primary' : 'btn'; button.textContent = label;
    button.disabled = index + delta < 0 || index + delta >= lessons.length;
    button.onclick = () => { index += delta; render(); }; nav.append(button);
  }
  root.append(nav);
  parent.postMessage({
    type: 'scorm.commit',
    nonce: 'demo-course-preview',
    sequence: ++sequence,
    cmi: {
      'cmi.core.lesson_status': index === lessons.length - 1 ? 'completed' : 'incomplete',
      'cmi.progress_measure': String((index + 1) / lessons.length),
    },
  }, location.origin);
}
window.addEventListener('message', event => {
  if (event.source === parent && event.origin === location.origin && event.data?.type === 'scorm.flush') parent.postMessage({ type: 'scorm.flushed', nonce: 'demo-course-preview', close_request: event.data.close_request }, location.origin);
});
render();
