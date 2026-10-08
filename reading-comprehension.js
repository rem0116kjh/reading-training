/* Replace only the current comprehension block, keeping saved catalogs intact. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReadingComprehension = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const CURRENT_AREAS = Object.freeze({ reading: 'readingComprehensionV1', course: 'courseComprehensionV1' });
  function extend(catalog, pkg, areas = { reading: 'reading' }) {
    if (!catalog[areas.reading] || pkg.questions.length !== 7 ||
        pkg.questions.filter(q => q.t === '사실적').length !== 5 ||
        pkg.questions.filter(q => q.t === '추론적').length !== 2) throw new TypeError('이해도 확인은 사실적 이해 5문제와 추론적 이해 2문제여야 합니다.');
    const sentences = pkg.paragraphs.flatMap(p => p.s);
    const questions = pkg.questions.map((q, index) => ({
      id: 'reading-content-' + (index + 1), kind: 'choice', trainingArea: 'reading',
      label: '이해도 확인', title: '이해도 확인', phase: '이해도 확인',
      question: q.q, options: q.o.slice(), answer: q.a, questionNumber: index + 1,
      comprehensionType: q.t === '사실적' ? 'fact' : 'inference', typeLabel: q.t + ' 이해',
      evidenceSentences: q.ev.map(id => id + 1),
      sourceRef: 'questions.' + index, source: q.ev.map(id => sentences[id]).join(' ')
    }));
    function replace(definition) {
      const original = definition.tasks.filter(t => t.id.startsWith('reading-content-'));
      if (original.length !== 4 || original[0].id !== 'reading-content-1') throw new TypeError('교체할 기존 독해 객관식 4문제를 확인해주세요.');
      return { ...definition, trainingArea: definition.integrated ? definition.trainingArea : 'reading', comprehensionVersion: 1,
        tasks: definition.tasks.flatMap(t => t.id === 'reading-content-1' ? questions : t.id.startsWith('reading-content-') ? [] : [t]) };
    }
    const updated = { ...catalog, [CURRENT_AREAS.reading]: replace(catalog[areas.reading]) };
    const currentAreas = { ...areas, reading: CURRENT_AREAS.reading };
    if (catalog[areas.course]?.integrated) { updated[CURRENT_AREAS.course] = replace(catalog[areas.course]); currentAreas.course = CURRENT_AREAS.course; }
    return { catalog: updated, currentAreas };
  }
  function results(definition, session) {
    const questions = session.queue.filter(q => !q.retryOf && definition.tasks.find(t => t.id === q.taskId)?.comprehensionType);
    if (!questions.length) return null;
    const counts = entries => ({ correct: entries.filter(q => session.submitted[q.key]?.correct).length,
      total: entries.length, answered: entries.filter(q => session.submitted[q.key]).length });
    return { ...counts(questions),
      fact: counts(questions.filter(q => definition.tasks.find(t => t.id === q.taskId).comprehensionType === 'fact')),
      inference: counts(questions.filter(q => definition.tasks.find(t => t.id === q.taskId).comprehensionType === 'inference')) };
  }
  return Object.freeze({ extend, results, CURRENT_AREAS });
});
