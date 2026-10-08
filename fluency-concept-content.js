/* Two consecutive concept reads precede one cloze; older catalogs remain restorable. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FluencyConceptContent = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const CURRENT_AREAS = Object.freeze({ fluency: 'fluencyConceptV2', course: 'courseConceptV3' });
  const PASSAGE_ID = 'salt-concept-v1';
  function extend(catalog, pkg, currentCourse) {
    if (!catalog[currentCourse]?.integrated || !Array.isArray(pkg.concept?.parts) || pkg.concept.blanks.length !== 5) throw new TypeError('기존 개념 글과 빈칸 5개가 필요합니다.');
    const text = pkg.concept.parts.map(part => typeof part === 'number' ? pkg.concept.blanks[part].k : part).join('');
    const words = text.trim().split(/\s+/), phrases = [];
    for (let i = 0; i < words.length; i += 3) phrases.push(words.slice(i, i + 3).join(' '));
    const title = '중심 문장과 뒷받침 문장 · 소금이 만들어지는 과정';
    const tasks = [1, 3].flatMap(number => [
      {
        id: `salt-concept-v1-stage-${number}`, kind: 'read', mode: number === 1 ? 'tap' : 'continuous',
        stage: number, trainingArea: 'fluency', label: number === 1 ? '탭하여 개념 글 읽기' : '밑줄 따라 개념 글 읽기',
        phase: `Stage ${number} · 개념 이해`, title, passageId: PASSAGE_ID,
        units: (number === 1 ? words : phrases).slice(), displayInterval: number === 1 ? 0 : 1200,
        ...(number === 3 ? { display: 'masked-phrases', unitLabel: '구절' } : {}),
        afterReadAuto: true, source: text, sourceRef: 'concept',
        instruction: number === 1 ? '읽기 영역을 눌러 개념 글을 읽으세요. 마지막 어절을 읽으면 바로 빈칸 채우기로 넘어가요.' : '밑줄 위에 나타나는 구절을 따라 읽으세요. 읽기가 끝나면 바로 빈칸 채우기로 넘어가요.'
      },
      {
        id: `salt-concept-v1-cloze-${number}`, kind: 'cloze', trainingArea: 'fluency', quizStage: number,
        label: '빈칸 채우기', title, phase: `Stage ${number} · 빈칸 채우기`, quizType: 'recall',
        question: '기억을 떠올려 빈칸을 채우고, 각 빈칸이 얼마나 확실한지 표시하세요.',
        parts: pkg.concept.parts.slice(),
        blanks: pkg.concept.blanks.map(blank => ({ answer: blank.k, accepted: blank.ok.slice() })),
        answer: pkg.concept.blanks.flatMap(blank => [blank.k, 'sure']),
        source: text, sourceRef: 'concept', passageId: PASSAGE_ID
      }
    ]);
    const fluency = { label: '읽기 유창성', title, trainingArea: 'fluency', metrics: true, passageId: PASSAGE_ID, fluencyVersion: 'concept-v1', tasks };
    const oldCourse = catalog[currentCourse];
    const course = { ...oldCourse, fluencyVersion: fluency.fluencyVersion,
      tasks: [...oldCourse.tasks.filter(task => task.trainingArea === 'vocabulary'), ...tasks,
        ...oldCourse.tasks.filter(task => task.trainingArea === 'reading')] };
    const consecutiveTasks = [
      { ...tasks[0], id: 'salt-concept-v2-stage-1', instruction: '읽기 영역을 눌러 개념 글을 읽으세요. 마지막 어절을 읽으면 2단계 읽기로 넘어가요.' },
      { ...tasks[2], id: 'salt-concept-v2-stage-2', stage: 2, phase: 'Stage 2 · 개념 이해' },
      { ...tasks[3], id: 'salt-concept-v2-cloze-2', quizStage: 2, phase: 'Stage 2 · 빈칸 채우기' }
    ];
    const consecutiveFluency = { ...fluency, fluencyVersion: 'concept-v2', tasks: consecutiveTasks };
    const consecutiveCourse = { ...course, fluencyVersion: consecutiveFluency.fluencyVersion,
      tasks: [...course.tasks.filter(task => task.trainingArea === 'vocabulary'), ...consecutiveTasks,
        ...course.tasks.filter(task => task.trainingArea === 'reading')] };
    return { ...catalog, fluencyConceptV1: fluency, courseConceptV1: course, courseConceptV2: course,
      [CURRENT_AREAS.fluency]: consecutiveFluency, [CURRENT_AREAS.course]: consecutiveCourse };
  }
  return Object.freeze({ extend, CURRENT_AREAS, PASSAGE_ID });
});
