/* Modernized from the API surface of David Hodges / OutermostLMSV5.js.
 * MIT attribution: vendor/scorm-reference/LICENSE.txt.
 * The synchronous SCORM API writes to an in-memory buffer; durable commits
 * are acknowledged asynchronously by the authenticated parent application.
 */
(() => {
  const cmi = { 'cmi.core.lesson_status': 'not attempted', 'cmi.completion_status': 'unknown', ...CONFIG.cmi };
  let initialized = false, terminated = false, error = '0', sequence = 0;
  const errors = { '0': 'No error', '101': 'General exception', '201': 'Invalid argument', '301': 'Not initialized', '401': 'Not implemented', '403': 'Read only', '405': 'Incorrect data type' };
  const readOnly = new Set(['cmi.core.student_id', 'cmi.learner_id', 'cmi.core.entry', 'cmi.entry', 'cmi.core.student_name', 'cmi.learner_name']);
  function fail(code) { error = code; return 'false'; }
  let explicitProgress = false;
  function samplePackageProgress() {
    if (explicitProgress) return;
    try {
      const content = document.getElementById('sco')?.contentWindow;
      // Rise exports its own course percentage; do not infer it from quiz scores.
      if (content?.RiseLMSInterface?.isReady()) {
        const progress = content.RiseLMSInterface.getProgress();
        const percent = progress?.percentComplete ?? progress?.p;
        if (typeof percent === 'number' && Number.isFinite(percent) && percent >= 0 && percent <= 100)
          cmi['cmi.progress_measure'] = String(percent / 100);
      }
      // Adapt tracks required components, independently of assessment scores.
      if (content?.require?.defined?.('core/js/adapt')) {
        const adapt = content.require('core/js/adapt');
        const required = adapt.components?.models?.filter(m => m.get('_isAvailable') !== false && !m.get('_isOptional'));
        if (required?.length) cmi['cmi.progress_measure'] = String(required.filter(m => m.get('_isComplete')).length / required.length);
      }
    } catch { /* Other packages keep their standard SCORM reporting. */ }
  }
  function flush(closeRequest) {
    samplePackageProgress();
    parent.postMessage({ type: 'scorm.commit', nonce: CONFIG.nonce, sequence: ++sequence, close_request: closeRequest, cmi: { ...cmi } }, CONFIG.origin);
  }
  const api = {
    LMSInitialize(value) {
      if (value !== '') return fail('201');
      if (initialized || terminated) return fail('101');
      initialized = true; error = '0'; return 'true';
    },
    LMSGetValue(key) {
      if (!initialized || terminated) { fail('301'); return ''; }
      error = '0';
      if (typeof key !== 'string') { fail('201'); return ''; }
      if (key.endsWith('._count')) {
        const prefix = key.slice(0, -6);
        return String(new Set(Object.keys(cmi).filter(k => k.startsWith(prefix + '.')).map(k => k.slice(prefix.length + 1).split('.')[0]).filter(k => /^\d+$/.test(k))).size);
      }
      return cmi[key] || '';
    },
    LMSSetValue(key, value) {
      if (!initialized || terminated) return fail('301');
      if (typeof key !== 'string') return fail('201');
      if (readOnly.has(key)) return fail('403');
      if (!key.startsWith('cmi.') || String(value).length > 64000) return fail('201');
      if (key.endsWith('score.raw') && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100)) return fail('405');
      if (key === 'cmi.progress_measure') {
        if (String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1) return fail('405');
        explicitProgress = true;
      }
      cmi[key] = String(value); error = '0'; return 'true';
    },
    LMSCommit(value) {
      if (value !== '') return fail('201');
      if (!initialized || terminated) return fail('301');
      flush(); error = '0'; return 'true';
    },
    LMSFinish(value) {
      if (value !== '') return fail('201');
      if (!initialized || terminated) return fail('301');
      flush(); terminated = true; error = '0'; return 'true';
    },
    LMSGetLastError() { return error; },
    LMSGetErrorString(code) { return errors[code] || 'Unknown error'; },
    LMSGetDiagnostic() { return errors[error] || 'Unknown error'; }
  };
  window.API = api;
  window.API_1484_11 = Object.fromEntries(Object.entries(api).map(([k, v]) => [k === 'LMSFinish' ? 'Terminate' : k.replace(/^LMS/, ''), v]));
  addEventListener('message', event => {
    if (event.source !== parent || event.origin !== CONFIG.origin || event.data?.nonce !== CONFIG.nonce) return;
    if (event.data.type === 'scorm.flush' && typeof event.data.close_request === 'string') {
      // A close flush includes buffered values even after LMSFinish. The parent
      // only removes this frame after the matching durable save succeeds.
      if (initialized) flush(event.data.close_request);
      else parent.postMessage({ type: 'scorm.flushed', nonce: CONFIG.nonce, close_request: event.data.close_request }, CONFIG.origin);
    }
    if (event.data.type === 'scorm.ack' && !event.data.ok) error = '101';
  });
  setInterval(() => { if (initialized && !terminated) flush(); }, 15000);
  addEventListener('pagehide', () => { if (initialized && !terminated) flush(); });
})();
