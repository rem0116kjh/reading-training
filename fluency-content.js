/* Versioned fixture adapter. CSV is not read or modified. Existing PKG is read-only. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FluencyContent = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PASSAGE_ID = 'salt-original-v1';
  const CURRENT_AREAS = Object.freeze({ fluency: 'fluencyIntegratedV1', course: 'courseIntegratedV1' });
  function extend(base, pkg) {
    const paragraphs = pkg.paragraphs.map(p => p.s.join(' '));
    const text = paragraphs.join(' ');
    const words = text.split(/\s+/);
    const stage = (number, mode, label, units, displayInterval) => ({
      id: `salt-fluency-v1-stage-${number}`, kind: 'read', mode, stage: number,
      trainingArea: 'fluency', label, phase: `Stage ${number} / 3`,
      title: '소금은 어디에서 올까', passageId: PASSAGE_ID,
      units: units.slice(), displayInterval, source: text,
      instruction: number === 1 ? '읽기 영역을 누를 때마다 다음 어절이 나타나요. 마지막 어절까지 차근차근 읽어보세요.'
        : number === 2 ? '한 어절씩 일정한 속도로 나타나요. 일시 정지한 뒤 같은 위치에서 이어 읽을 수 있어요.'
          : '화면에 자동으로 글이 나와요! 다 읽고 퀴즈를 풀어볼까요?'
    });
    const originalQuizzes = base.fluency.tasks.filter(t => t.kind !== 'read').map((t, i) => ({
      ...t, id: `salt-fluency-v1-quiz-${i + 1}`, trainingArea: 'fluency',
      phase: '읽기 후 퀴즈', quizType: i === 0 ? 'blank' : 'comprehension', passageId: PASSAGE_ID
    }));
    // A test-only ordering fixture, split from an unchanged sentence of PKG.
    // Production needs an editorially reviewed sequence item bank.
    const sentence = pkg.paragraphs[3].s[1];
    const tokens = sentence.split(/\s+/);
    const cuts = [0, 2, 4, 6, 8, tokens.length];
    const pieces = cuts.slice(0, -1).map((start, id) => ({ id, text: tokens.slice(start, cuts[id + 1]).join(' ') }));
    const sequence = {
      id: 'salt-fluency-v1-sequence', kind: 'order', trainingArea: 'fluency',
      label: '문장 순서 맞추기', phase: '읽기 후 퀴즈', title: '문장 순서 맞추기',
      question: '읽었던 문장이 되도록 조각을 순서대로 눌러 주세요.',
      paragraphs: [2, 0, 4, 1, 3].map(i => pieces[i]), answer: pieces.map(p => p.id),
      source: sentence, sourceRef: 'paragraphs.3.s.1', passageId: PASSAGE_ID,
      quizType: 'sequence', fixture: true,
      contentNote: '검증용 문항 · 기존 소금 지문의 문장을 나눈 순서 맞추기예요.'
    };
    const fluencyStages = {
      label: '읽기 유창성', trainingArea: 'fluency', metrics: true, passageId: PASSAGE_ID, legacyFlow: true,
      tasks: [stage(1, 'tap', '탭하여 글 읽기', words, 0), stage(2, 'paced', '자동 글 읽기', words, 700),
        stage(3, 'continuous', '연속 읽기', paragraphs, 12000), ...originalQuizzes, sequence]
    };
    const course = {
      label: '맞춤형 훈련', trainingArea: 'reading', metrics: true, passageId: PASSAGE_ID, integrated: true, legacyFlow: true,
      tasks: [
        ...base.vocabulary.tasks.map(t => ({ ...t, trainingArea: 'vocabulary' })),
        ...fluencyStages.tasks,
        ...base.reading.tasks.map(t => ({ ...t, trainingArea: 'reading' }))
      ]
    };
    // Keep the earlier ordering immutable so saved answers and results still restore.
    // New rounds place a quiz immediately after each reading stage.
    const phrases = pkg.paragraphs.flatMap(p => p.s.flatMap(sentence => {
      const parts = sentence.split(/\s+/), chunks = [];
      for (let i = 0; i < parts.length; i += 3) chunks.push(parts.slice(i, i + 3).join(' '));
      return chunks;
    }));
    const roundQuiz = (task, number) => ({ ...task, quizStage: number, phase: `Stage ${number} / 3 · 읽기 퀴즈` });
    const fluencyRounds = {
      label: '읽기 유창성', trainingArea: 'fluency', metrics: true, passageId: PASSAGE_ID,
      tasks: [
        fluencyStages.tasks[0], roundQuiz(originalQuizzes[0], 1),
        fluencyStages.tasks[1], roundQuiz(originalQuizzes[1], 2), roundQuiz(sequence, 2),
        { ...stage(3, 'continuous', '밑줄 따라 읽기', phrases, 2100), id: 'salt-fluency-v2-stage-3',
          display: 'masked-phrases', unitLabel: '구절',
          instruction: '밑줄 위에 나타나는 구절을 따라 읽어보세요. 마지막 구절을 읽으면 객관식 문제가 나와요.' },
        roundQuiz(originalQuizzes[2], 3)
      ]
    };
    const courseRounds = { ...course, legacyFlow: false,
      tasks: [...course.tasks.slice(0, 32), ...fluencyRounds.tasks, ...course.tasks.slice(39)] };
    // Version the pace as well as the order: saved reading times remain valid.
    const fluencyRounds2s = { ...fluencyRounds, tasks: fluencyRounds.tasks.map(task =>
      task.stage && task.mode !== 'tap' ? { ...task, displayInterval: 2000 } : task) };
    const courseRounds2s = { ...courseRounds,
      tasks: [...course.tasks.slice(0, 32), ...fluencyRounds2s.tasks, ...course.tasks.slice(39)] };
    const processChoice = roundQuiz({
      id: 'salt-fluency-v3-process-choice', kind: 'choice', trainingArea: 'fluency',
      label: '소금 얻는 과정 확인하기', title: '소금 얻는 과정 확인하기',
      question: '글에서 설명한 소금을 얻는 과정으로 알맞은 것은 무엇인가요?',
      options: [
        '물기 없애기 → 소금이 있는 재료 모으기 → 남은 소금 거두기',
        '소금이 있는 재료 모으기 → 물기 없애기 → 남은 소금 거두기',
        '남은 소금 거두기 → 물기 없애기 → 소금이 있는 재료 모으기',
        '소금이 있는 재료 모으기 → 남은 소금 거두기 → 물기 없애기'
      ], answer: 1, source: sentence, sourceRef: 'paragraphs.3.s.1', passageId: PASSAGE_ID,
      quizType: 'process', fixture: true,
      contentNote: '검증용 문항 · 기존 소금 지문의 내용을 확인하는 문제예요.'
    }, 2);
    const fluencyChoiceV1 = { ...fluencyRounds2s, tasks: fluencyRounds2s.tasks.map(task =>
      task.quizType === 'sequence' ? processChoice :
        task.stage && task.mode !== 'tap' ? { ...task, displayInterval: 1200 } : task) };
    const courseChoiceV1 = { ...courseRounds2s,
      tasks: [...course.tasks.slice(0, 32), ...fluencyChoiceV1.tasks, ...course.tasks.slice(39)] };
    const sentences = pkg.paragraphs.flatMap(p => p.s);
    const stageThreeQuestion = (id, original, label, quizType, sourceRef, evidence) => roundQuiz({
      id, kind: 'choice', trainingArea: 'fluency', label, title: label, quizType,
      question: original.q, options: original.o.slice(), answer: original.a,
      source: (original.ev || evidence).map(index => sentences[index]).join(' '),
      sourceRef, passageId: PASSAGE_ID
    }, 3);
    const fluencyIntegratedV1 = { ...fluencyChoiceV1, tasks: [
      ...fluencyChoiceV1.tasks.slice(0, 6),
      stageThreeQuestion('salt-fluency-v4-role-blank', pkg.vquiz[2], '소금의 역할 빈칸 맞추기', 'blank', 'vquiz.2', [15]),
      stageThreeQuestion('salt-fluency-v4-sunlight-inference', pkg.questions[5], '햇볕과 소금의 관계 확인하기', 'comprehension', 'questions.5'),
      fluencyChoiceV1.tasks[6]
    ] };
    const courseIntegratedV1 = { ...courseChoiceV1,
      tasks: [...course.tasks.slice(0, 32), ...fluencyIntegratedV1.tasks, ...course.tasks.slice(39)] };
    fluencyRounds.legacyTiming = true;
    courseRounds.legacyTiming = true;
    fluencyRounds2s.legacyTiming = true;
    courseRounds2s.legacyTiming = true;
    fluencyChoiceV1.legacyContent = true;
    courseChoiceV1.legacyContent = true;
    return { ...base, fluencyStages, course, fluencyRounds, courseRounds, fluencyRounds2s, courseRounds2s, fluencyChoiceV1, courseChoiceV1, fluencyIntegratedV1, courseIntegratedV1 };
  }
  return Object.freeze({ extend, PASSAGE_ID, CURRENT_AREAS });
});
