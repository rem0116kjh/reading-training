/* Passage two uses the original passage, diagnostic, seven questions and writing. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReadingDiagnostic = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const CURRENT_AREAS = Object.freeze({ reading: 'readingDiagnosticV3', course: 'courseDiagnosticV3' });
  function extend(catalog, areas) {
    const reading = catalog[areas.reading];
    const find = id => reading.tasks.find(task => task.id === id);
    const questions = reading.tasks.filter(task => task.comprehensionType);
    if (questions.length !== 7 || ['reading-passage', 'reading-key', 'reading-outline', 'reading-summary'].some(id => !find(id))) throw new TypeError('지문 읽기·핵심 문장·이해도 7문제·구조화·글쓰기가 필요합니다.');
    const tasks = [
      { ...find('reading-passage'), label: '지문 2 읽기', phase: '지문 읽기', nextLabel: '다 읽었어요 · 정밀검사' },
      { ...find('reading-key'), label: '정밀검사', title: '정밀검사 · 핵심 문장 찾기', phase: '정밀검사', diagnostic: true },
      ...questions,
      { ...find('reading-outline'), label: '구조화·글쓰기', phase: '구조화·글쓰기' },
      find('reading-summary')
    ];
    const next = { ...catalog, readingDiagnosticV1: { ...reading, readingDiagnosticVersion: 1, tasks } };
    const key = find('reading-key');
    const ids = key.sentences.map((_, index) => index);
    const diagnostic = { ...tasks[1], display: 'sentence-roles', selectionType: 'roles',
      question: '중요한 문장을 터치한 뒤 처음·중간·끝으로 분류하세요.',
      paragraphs: find('reading-passage').paragraphs,
      groups: [
        { label: '처음', capacity: 1, ids, correct: [key.answer[0]] },
        { label: '중간', capacity: 2, ids, correct: key.answer.slice(1, 3) },
        { label: '끝', capacity: 1, ids, correct: [key.answer[3]] }
      ] };
    const roleTasks = tasks.map(task => task.diagnostic ? diagnostic : task.id === 'reading-outline'
      ? { ...task, display: 'sentence-roles', paragraphs: find('reading-passage').paragraphs,
        question: '지문에서 중요한 문장을 터치해 처음·중간·끝의 뼈대를 만드세요.' } : task);
    next.readingDiagnosticV2 = { ...reading, readingDiagnosticVersion: 2, tasks: roleTasks };
    const paragraphs = find('reading-passage').paragraphs;
    const currentTasks = roleTasks.map(task => task.id === 'reading-passage' ? { ...task, readingTrace: true }
      : task.diagnostic ? { ...tasks[1], display: 'key-passage', selectionType: 'key', paragraphs,
        question: '지문을 읽고 각 문단에서 핵심 문장을 하나씩 터치하세요. (4개)',
        groups: key.groups.map((group, index) => ({ ...group, label: paragraphs[index].role })) } : task);
    next[CURRENT_AREAS.reading] = { ...reading, readingDiagnosticVersion: 3, tasks: currentTasks };
    const currentAreas = { ...areas, reading: CURRENT_AREAS.reading };
    if (catalog[areas.course]?.integrated) {
      next.courseDiagnosticV1 = { ...catalog[areas.course], readingDiagnosticVersion: 1,
        tasks: [...catalog[areas.course].tasks.filter(task => task.trainingArea !== 'reading'),
          ...tasks.map(task => ({ ...task, trainingArea: 'reading' }))] };
      next.courseDiagnosticV2 = { ...next.courseDiagnosticV1, readingDiagnosticVersion: 2,
        tasks: [...catalog[areas.course].tasks.filter(task => task.trainingArea !== 'reading'),
          ...roleTasks.map(task => ({ ...task, trainingArea: 'reading' }))] };
      next[CURRENT_AREAS.course] = { ...next.courseDiagnosticV1, readingDiagnosticVersion: 3,
        tasks: [...catalog[areas.course].tasks.filter(task => task.trainingArea !== 'reading'),
          ...currentTasks.map(task => ({ ...task, trainingArea: 'reading' }))] };
      currentAreas.course = CURRENT_AREAS.course;
    }
    return { catalog: next, currentAreas };
  }
  function results(definition, session) {
    if (!definition.readingDiagnosticVersion) return null;
    const key = session.queue.find(entry => entry.taskId === 'reading-key');
    if (!key) return null;
    const task = definition.tasks.find(task => task.id === key.taskId);
    const submitted = session.submitted[key.key];
    const readEntry = session.queue.find(entry => entry.taskId === 'reading-passage');
    const read = readEntry && session.read[readEntry.key];
    let offset = 0;
    const correct = submitted ? task.groups.reduce((count, group) => count + submitted.answer.slice(offset, offset += group.capacity).filter(id => group.correct.includes(id)).length, 0) : 0;
    return { readingMs: read?.elapsedMs ?? null, skipped: !!read?.skipped,
      answered: !!submitted, correct,
      total: task.answer.length };
  }
  function migrate(session, catalog, engine) {
    if (!session || session.status !== 'active') return session;
    const area = { readingDiagnosticV1: CURRENT_AREAS.reading, courseDiagnosticV1: CURRENT_AREAS.course,
      readingDiagnosticV2: CURRENT_AREAS.reading, courseDiagnosticV2: CURRENT_AREAS.course }[session.area];
    if (!area || !catalog[area]) return session;
    let answers = session.answers;
    if (catalog[session.area]?.readingDiagnosticVersion === 2) {
      const entry = session.queue.find(item => item.taskId === 'reading-key');
      // Submitted role answers retain their original scoring and report.
      if (entry && session.submitted[entry.key]) return session;
      if (entry && Array.isArray(answers[entry.key])) {
        const groups = catalog[area].tasks.find(task => task.id === entry.taskId).groups;
        const mapped = groups.map(() => null);
        answers[entry.key].forEach(id => {
          const group = groups.findIndex(item => item.ids.includes(id));
          if (group >= 0 && mapped[group] === null) mapped[group] = id;
        });
        answers = { ...answers, [entry.key]: mapped };
      }
    }
    return engine.normalize({ ...session, area, answers }) || session;
  }
  return Object.freeze({ extend, results, migrate, CURRENT_AREAS });
});
