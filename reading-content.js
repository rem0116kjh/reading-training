/* Extend only the reading segment; saved catalogs keep their original queues and scores. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReadingContent = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const CURRENT_AREAS = Object.freeze({ reading: 'readingReadinV2', course: 'courseReadingReadinV2' });

  function extend(catalog, pkg, currentCourse) {
    if (!catalog.reading || !catalog[currentCourse]?.integrated) throw new TypeError('기존 독해력과 전체 과정이 필요합니다.');
    const paragraphs = pkg.paragraphs.map((paragraph, index) => ({
      id: index, role: paragraph.role, text: paragraph.s.join(' ')
    }));
    const summaries = [
      '소금은 어디에서 오는지 질문해요.',
      '염전에서 바닷물을 말려 천일염을 얻는 방법을 설명해요.',
      '암염 광산에서 땅속의 소금을 캐내는 방법을 설명해요.',
      '소금 생산의 공통 과정과 소금의 쓰임을 정리해요.'
    ];
    const options = summaries.slice();
    const relations = {
      id: 'reading-relations', kind: 'relations', trainingArea: 'reading',
      label: '문단 연관성 연결', title: '문단 연관성 연결', phase: '지문의 구조와 연결',
      question: '문단을 탭하여 구조에 맞게 나열하세요.',
      paragraphs,
      layout: 'branch-merge', uniqueChoices: true, choiceOrder: [2, 0, 3, 1],
      links: ['도입', '왼쪽 전개', '오른쪽 전개', '정리'].map(label => ({ label, options: options.slice() })),
      answer: [0, 1, 2, 3], sourceRef: 'paragraphs',
      source: '도입의 질문에 바다와 땅속이라는 두 생산 방법이 답해요. 두 방법은 나란히 제시되고 마지막 문단에서 공통 과정과 쓰임을 정리해요.'
    };
    const tasks = catalog.reading.tasks.flatMap(task => {
      if (task.id === 'reading-structure') return [task, relations];
      if (task.id === 'reading-order') return [{ ...task, paragraphs: task.paragraphs.map(p => ({ ...p, summary: summaries[p.id] })) }];
      return [task];
    });
    const reading = { ...catalog.reading, trainingArea: 'reading', readingVersion: 'readin-v1', tasks };
    const course = { ...catalog[currentCourse], readingVersion: reading.readingVersion,
      tasks: [...catalog[currentCourse].tasks.filter(task => task.trainingArea !== 'reading'),
        ...tasks.map(task => ({ ...task, trainingArea: 'reading' }))]
    };
    // Keep V1 intact for unfinished sessions and historical reports.
    const retained = { ...catalog, readingReadinV1: reading, courseReadingReadinV1: course };
    const sentences = pkg.paragraphs.flatMap(p => p.s);
    const concept = pkg.concept.parts.slice(0, 5).map(part => typeof part === 'number' ? pkg.concept.blanks[part].k : part).join('').split('「')[0].trim();
    let offset = 0;
    const groups = pkg.paragraphs.map((p, index) => {
      const ids = p.s.map((_, i) => offset + i); offset += p.s.length;
      return { label: '문단 ' + (index + 1), ids, capacity: 1, correct: [pkg.key[index]] };
    });
    const recallQuestions = [pkg.concept.parts[0] + '____ 을 찾아요.', '중심 문장을' + pkg.concept.parts[2].split('중심 문장을')[1] + '____ 이라고 해요.'];
    const extras = [
      { id: 'reading-concept', kind: 'read', mode: 'normal', trainingArea: 'reading',
        label: '중요한 내용 간추리기', title: '중심 문장과 뒷받침 문장', phase: '내용 간추리기 개념',
        paragraphs: [{ s: [concept] }], source: concept, sourceRef: 'concept.parts.0-4' },
      ...pkg.concept.blanks.slice(0, 2).map((blank, index) => ({
        id: 'reading-recall-' + index, kind: 'recall', trainingArea: 'reading',
        label: '독해 개념 인출·확신도', title: '독해 개념 인출', phase: '독해 개념 인출',
        question: recallQuestions[index],
        answer: blank.k, accepted: blank.ok.slice(), source: concept, sourceRef: 'concept.blanks.' + index
      })),
      { id: 'reading-key', kind: 'selection', selectionType: 'key', trainingArea: 'reading',
        label: '핵심 문장 찾기', title: '핵심 문장 찾기', phase: '핵심 내용 파악',
        question: '각 문단에서 중심 문장을 하나씩 골라 누르세요. (4개)',
        groups, sentences, answer: pkg.key.slice(), sourceRef: 'key',
        source: pkg.key.map(id => sentences[id]).join('\n') },
      { id: 'reading-outline', kind: 'selection', selectionType: 'outline', trainingArea: 'reading',
        label: '처음·중간·끝 뼈대', title: '문장 뼈대 구성', phase: '핵심 내용 구조화',
        question: '문장을 고른 다음, 들어갈 자리를 누르세요. 각 자리에 중심 문장만 넣습니다.',
        groups: pkg.outline.slots.map(slot => ({ label: slot.label, hint: slot.hint, capacity: slot.s.length, correct: slot.s.slice(), ids: sentences.map((_, i) => i) })),
        sentences, answer: pkg.outline.slots.flatMap(slot => slot.s), sourceRef: 'outline.slots',
        source: pkg.outline.slots.map(slot => slot.label + ': ' + slot.s.map(id => sentences[id]).join(' ')).join('\n') },
      { id: 'reading-summary', kind: 'summary', trainingArea: 'reading',
        label: '간추려 쓰기', title: '간추려 쓰기', phase: '내용 간추리기',
        question: '뼈대를 보면서 150자 안팎으로 간추려 쓰세요.',
        groups: pkg.outline.slots.map(slot => ({ label: slot.label, text: slot.s.map(id => sentences[id]).join(' ') })),
        keywords: [...pkg.vocab.map(v => v.word), ...pkg.concept.blanks.map(b => b.k)],
        sourceRef: 'outline', source: pkg.outline.ref }
    ];
    const expanded = { ...reading, readingVersion: 'readin-v2', tasks: [...reading.tasks, ...extras] };
    const expandedCourse = { ...course, readingVersion: expanded.readingVersion,
      tasks: [...course.tasks.filter(t => t.trainingArea !== 'reading'), ...expanded.tasks.map(t => ({ ...t, trainingArea: 'reading' }))] };
    return { ...retained, [CURRENT_AREAS.reading]: expanded, [CURRENT_AREAS.course]: expandedCourse };
  }
  return Object.freeze({ extend, CURRENT_AREAS });
});
