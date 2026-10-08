const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const SCRIPTS = ['training-store.js', 'feedback.js', 'app.js', 'session-ui.js'];
const ESSAY = '소금은 음식의 맛을 내고 오래 보관하는 역할을 해요. 염전에서는 바닷물을 햇볕에 말려 물을 증발시켜 소금을 얻어요. 오래전 바다였던 땅속에서는 굳은 소금을 캐내요. 이렇게 여러 방법으로 소금을 생산해요.';
const ANSWERS = {
  vocab: [1, 2, 3, 0, 1],
  blanks: ['중심 문장', '뒷받침 문장', '바닷물', '염전', '증발'],
  key: [0, 3, 9, 13],
  reading: [1, 2, 1, 2, 1, 1, 1],
  slots: [[0], [3, 9], [13, 15]],
};

function openApp(t, stored = {}) {
  // Deliberately no resources option: no HTTP, font or script resource is fetched.
  const dom = new JSDOM(HTML, { url: 'https://training.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const errors = [];
  window.addEventListener('error', event => { errors.push(event.error || event.message); event.preventDefault(); });
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.setInterval = () => 0;
  for (const [key, value] of Object.entries(stored)) window.localStorage.setItem(key, value);
  const context = dom.getInternalVMContext();
  // Preserve the browser realm's Object.prototype for storage schema validation.
  vm.runInContext('globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));', context);
  for (const file of SCRIPTS) vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  t.after(() => { dom.window.close(); assert.deepEqual(errors, [], 'UI handlers must not throw'); });
  const document = window.document;
  const get = selector => { const node = document.querySelector(selector); assert.ok(node, `missing ${selector}`); return node; };
  const click = selector => { const node = get(selector); assert.equal(node.disabled, false, `${selector} must be enabled`); node.click(); };
  const input = (selector, value) => { const node = get(selector); assert.equal(node.disabled, false, `${selector} must be editable`); node.value = value; node.dispatchEvent(new window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
  const textButton = (text, parent = '#report') => {
    const node = [...get(parent).querySelectorAll('button')].find(button => button.textContent.trim() === text);
    assert.ok(node, `missing button: ${text}`); assert.equal(node.disabled, false, `${text} must be enabled`); node.click();
  };
  return {
    window, document, get, click, input, textButton,
    main: () => click('#btn-main'),
    session: () => JSON.parse(window.localStorage.getItem('trainingSession')),
    history: () => JSON.parse(window.localStorage.getItem('trainingHistory') || '[]'),
    snapshot: () => Object.fromEntries(Array.from({ length: window.localStorage.length }, (_, i) => { const key = window.localStorage.key(i); return [key, window.localStorage.getItem(key)]; })),
  };
}

function visible(app, selector) { assert.equal(app.get(selector).closest('[hidden]'), null, `${selector} must be visible`); }
function stage(app, n, button) { visible(app, `#s${n}`); assert.equal(app.get('#btn-main').textContent, button); }
function selectQuiz(app, prefix, answers) { answers.forEach((answer, index) => app.click(`#${prefix}${index}_${answer}`)); }
function doVocab(app, answers = ANSWERS.vocab) {
  app.input('#comp0', '물이 마르고 소금이 굳었어요.');
  app.input('#comp1', '소금은 음식의 맛을 내는 역할을 해요.');
  selectQuiz(app, 'vq', answers); app.main();
}
function doConcept(app, blanks = ANSWERS.blanks) {
  stage(app, 2, '다 읽었어요 → 빈칸 채우기'); app.main();
  blanks.forEach((answer, i) => { app.input(`#bl${i}`, answer); app.input(`#cf${i}`, 'sure'); });
  app.main();
}
function doReading(app, key = ANSWERS.key, answers = ANSWERS.reading) {
  stage(app, 3, '다 읽었어요 → 핵심 문장 찾기'); app.main();
  key.forEach(index => app.get(`#passage .sent[data-k="${index}"]`).click());
  app.main(); selectQuiz(app, 'rq', answers); app.main();
}
function doOutline(app, slots = ANSWERS.slots) {
  slots.forEach((indices, slot) => indices.forEach(index => {
    app.click(`#schips .schip[data-k="${index}"]`);
    app.get('#slots').children[slot].click();
  }));
  app.main();
}
function finishLesson(app, wrong = false) {
  doVocab(app, wrong ? [0, 0, 3, 0, 1] : ANSWERS.vocab); app.main();
  doConcept(app, wrong ? ['틀린 답', ...ANSWERS.blanks.slice(1)] : ANSWERS.blanks); app.main();
  doReading(app, wrong ? [1, 3, 9, 13] : ANSWERS.key, wrong ? [1, 2, 1, 2, 1, 0, 1] : ANSWERS.reading); app.main();
  doOutline(app, wrong ? [[0], [3, 13], [9, 15]] : ANSWERS.slots);
  app.input('#essay', ESSAY); app.main(); app.main();
  stage(app, 5, '학습 완료');
}

test('full lesson preserves original activities and calculates a mixed-answer report and one history record', t => {
  const app = openApp(t);
  assert.equal(app.get('#vgrid').children.length, 10);
  app.main(); assert.match(app.get('#status').textContent, /완료하지 않은 문제/);
  assert.equal(app.get('#rail button[data-s="2"]').disabled, true);
  finishLesson(app, true);
  // Independently derived: vocab 3 + recall 4 + reading 6 + keys 3 + outline 3 = 19/26.
  assert.match(app.get('#report').textContent, /19\/26/);
  assert.match(app.get('#report').textContent, /73%/);
  assert.equal(app.get('#overall-progress').value, 100);
  assert.equal(app.session().status, 'completed');
  const history = app.history();
  assert.equal(history.length, 1);
  assert.equal(history[0].results.totalCorrect, 19);
  assert.equal(history[0].results.totalQuestions, 26);
  assert.equal(history[0].results.totalScore, 73);
  assert.equal(history[0].results.c.illusion, 1);
  assert.equal(history[0].results.r.fact, 100);
  assert.equal(history[0].results.r.infer, 50);
  assert.equal(history[0].results.o.hit, 3);
  assert.equal(history[0].session.draft.essay, ESSAY);
  assert.match(app.get('#report').textContent, /규칙 기반/);
  assert.match(app.get('#report').textContent, /외부 AI 미연결/);
});

test('unsubmitted vocabulary answers survive neighboring questions, reload and continue', t => {
  const app = openApp(t);
  app.input('#comp0', '아직 제출하지 않은 굳은 소금 문장');
  app.click('#vq0_1'); app.click('#vq1_2'); app.click('#vq2_3');
  assert.equal(app.get('#vq0_1').checked, true);
  const restored = openApp(t, app.snapshot());
  assert.equal(restored.get('#resume-dialog').open, true);
  assert.match(restored.get('#resume-title').textContent, /진행 중/);
  restored.click('#resume-continue');
  stage(restored, 1, '채점하기');
  assert.equal(restored.get('#comp0').value, '아직 제출하지 않은 굳은 소금 문장');
  assert.equal(restored.get('#vq0_1').checked, true);
  assert.equal(restored.get('#vq1_2').checked, true);
  assert.equal(restored.get('#vq2_3').checked, true);
  assert.equal(restored.get('#vq0_1').disabled, false);
  assert.equal(restored.session().submitted.vocab, false);
  assert.equal(restored.document.activeElement.id, 'vq2_3');
});

test('concept phase, text and confidence resume, missing responses block progress, and footer follows revisits', t => {
  const app = openApp(t); doVocab(app); app.main(); app.main();
  app.input('#bl0', '중심문장'); app.input('#cf0', 'unknown'); app.input('#bl1', '뒷받침 문장');
  app.main(); assert.match(app.get('#status').textContent, /빈칸과 확신도/);
  assert.equal(app.get('#rail button[data-s="3"]').disabled, true);
  const restored = openApp(t, app.snapshot()); restored.click('#resume-continue');
  stage(restored, 2, '제출'); visible(restored, '#c-fill');
  assert.equal(restored.get('#c-read').hidden, true);
  assert.equal(restored.get('#bl0').value, '중심문장');
  assert.equal(restored.get('#cf0').value, 'unknown');
  restored.click('#btn-prev'); stage(restored, 1, '다음: 개념·인출');
  assert.equal(restored.get('#comp0').disabled, true);
  restored.main(); stage(restored, 2, '제출');
  assert.equal(restored.get('#bl0').value, '중심문장');
  ANSWERS.blanks.forEach((answer, i) => { restored.input(`#bl${i}`, answer); restored.input(`#cf${i}`, 'sure'); });
  restored.main(); stage(restored, 2, '다음: 읽기·진단');
  assert.equal(restored.get('#bl0').disabled, true);
  assert.equal(restored.get('#cf0').disabled, true);
  restored.main(); stage(restored, 3, '다 읽었어요 → 핵심 문장 찾기');
  restored.click('#btn-prev'); stage(restored, 2, '다음: 읽기·진단');
});

test('core sentence and reading quiz phases restore and evidence is not duplicated on revisits', t => {
  const app = openApp(t); doVocab(app); app.main(); doConcept(app); app.main(); app.main();
  app.get('#passage .sent[data-k="0"]').click();
  app.get('#passage .sent[data-k="3"]').click();
  app.main(); assert.match(app.get('#status').textContent, /각 문단/);
  const keyResume = openApp(t, app.snapshot()); keyResume.click('#resume-continue');
  stage(keyResume, 3, '선택 완료 → 문제 풀기');
  assert.equal(keyResume.get('#passage .sent[data-k="0"]').getAttribute('aria-pressed'), 'true');
  keyResume.get('#passage .sent[data-k="9"]').click(); keyResume.get('#passage .sent[data-k="13"]').click(); keyResume.main();
  keyResume.click('#rq0_1');
  const quizResume = openApp(t, keyResume.snapshot()); quizResume.click('#resume-continue');
  stage(quizResume, 3, '제출'); visible(quizResume, '#rquiz');
  assert.equal(quizResume.get('#rq0_1').checked, true);
  selectQuiz(quizResume, 'rq', ANSWERS.reading); quizResume.main();
  assert.equal(quizResume.document.querySelectorAll('#rquiz .ev').length, 7);
  quizResume.click('#btn-prev'); quizResume.main();
  assert.equal(quizResume.document.querySelectorAll('#rquiz .ev').length, 7);
  assert.equal(quizResume.get('#rq0_1').disabled, true);
  quizResume.get('#rq0_0').closest('label').click();
  assert.equal(quizResume.get('#rq0_1').checked, true);
  assert.equal(quizResume.get('#rq0_1').closest('label').classList.contains('sel'), true);
  assert.equal(quizResume.get('#rq0_0').closest('label').classList.contains('sel'), false);
});

test('key sentences are native buttons and restore their selected state and current-question focus', t => {
  const app = openApp(t); doVocab(app); app.main(); doConcept(app); app.main(); app.main();
  const sentence = app.get('#key-9');
  assert.equal(sentence.tagName, 'BUTTON');
  assert.equal(sentence.disabled, false);
  assert.equal(sentence.onkeydown, null, 'native button activation must not also trigger a custom key handler');
  app.click('#key-9');
  assert.equal(app.get('#key-9').getAttribute('aria-pressed'), 'true');
  assert.equal(app.session().currentQuestion, 'key-9');
  const restored = openApp(t, app.snapshot()); restored.click('#resume-continue');
  stage(restored, 3, '선택 완료 → 문제 풀기');
  assert.equal(restored.get('#key-9').tagName, 'BUTTON');
  assert.equal(restored.get('#key-9').getAttribute('aria-pressed'), 'true');
  assert.equal(restored.get('#key-9').classList.contains('picked'), true);
  assert.equal(restored.document.activeElement.id, restored.session().currentQuestion);
  restored.click('#key-9');
  assert.equal(restored.get('#key-9').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(restored.session().draft.key, []);
});

test('outline add/remove and unfinished essay restore, minimum length blocks, submitted writing locks', t => {
  const app = openApp(t); doVocab(app); app.main(); doConcept(app); app.main(); doReading(app); app.main();
  app.click('#schips .schip[data-k="0"]'); app.get('#slots').children[0].click();
  app.get('#slots .item button').click();
  assert.equal(app.get('#slots .slot').querySelectorAll('.item').length, 0);
  assert.equal(app.get('#schips .schip[data-k="0"]').classList.contains('used'), false);
  app.main(); assert.match(app.get('#status').textContent, /뼈대/);
  doOutline(app); app.input('#essay', '소금에 관한 작성 중인 초안');
  const restored = openApp(t, app.snapshot()); restored.click('#resume-continue');
  stage(restored, 4, '첨삭 받기'); visible(restored, '#o-write');
  assert.equal(restored.get('#essay').value, '소금에 관한 작성 중인 초안');
  assert.equal(restored.document.querySelectorAll('#slots .item').length, 5);
  assert.equal(restored.document.querySelectorAll('#slots .item button').length, 0);
  restored.input('#essay', '가'.repeat(39)); restored.main();
  assert.match(restored.get('#status').textContent, /40자/);
  assert.equal(restored.get('#rail button[data-s="5"]').disabled, true);
  restored.input('#essay', '가'.repeat(40)); restored.main();
  stage(restored, 4, '리포트 보기'); assert.equal(restored.get('#essay').disabled, true);
  restored.click('#btn-prev'); restored.main();
  assert.equal(restored.get('#essay').value, '가'.repeat(40));
  assert.equal(restored.get('#essay').disabled, true);
});

test('repeated finish clicks, report reload and new lesson keep history immutable and deduplicated', t => {
  const app = openApp(t); finishLesson(app);
  const record = app.history()[0];
  app.main(); visible(app, '#history-panel'); app.main();
  app.main(); app.main();
  assert.equal(app.history().length, 1);
  assert.deepEqual(app.history()[0], record);
  const restored = openApp(t, app.snapshot());
  assert.equal(restored.get('#resume-continue').textContent, '결과 보기'); restored.click('#resume-continue');
  stage(restored, 5, '학습 완료'); assert.deepEqual(restored.history()[0], record);
  restored.main(); restored.click('#history-new');
  stage(restored, 1, '채점하기');
  assert.notEqual(restored.session().id, record.id);
  assert.deepEqual(restored.history(), [record]);
  finishLesson(restored);
  assert.equal(restored.history().length, 2);
  assert.ok(restored.history().find(item => item.id === record.id));
});

test('history quota failure preserves the only completed result until a later retry saves it', t => {
  const app = openApp(t);
  const storagePrototype = app.window.Storage.prototype;
  const originalSetItem = storagePrototype.setItem;
  let historyBlocked = true;
  storagePrototype.setItem = function (key, value) {
    if (key === 'trainingHistory' && historyBlocked) {
      throw new app.window.DOMException('History quota exhausted', 'QuotaExceededError');
    }
    return originalSetItem.call(this, key, value);
  };

  finishLesson(app);
  const completed = app.session();
  assert.equal(completed.status, 'completed');
  assert.equal(app.history().length, 0);
  visible(app, '#storage-warning');
  assert.match(app.get('#storage-warning').textContent, /저장/);

  // Repeating must not replace the sole persisted copy of the completed answers.
  app.textButton('전체 다시 학습');
  assert.equal(app.session().id, completed.id);
  assert.equal(app.session().status, 'completed');
  assert.deepEqual(app.session().draft, completed.draft);
  assert.equal(app.session().results.totalScore, completed.results.totalScore);
  assert.equal(app.history().length, 0);
  visible(app, '#s5');
  visible(app, '#storage-warning');

  // When storage becomes available, the same action can safely save then restart.
  historyBlocked = false;
  app.textButton('전체 다시 학습');
  stage(app, 1, '채점하기');
  assert.notEqual(app.session().id, completed.id);
  const saved = app.history().filter(record => record.id === completed.id);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].session.draft, completed.draft);
  assert.equal(saved[0].results.totalScore, completed.results.totalScore);
});

test('area recommendation starts an editable new session and preserves the completed full lesson', t => {
  const app = openApp(t); finishLesson(app, true);
  const original = app.history()[0];
  app.textButton('어휘 다시 학습');
  stage(app, 1, '채점하기');
  assert.notEqual(app.session().id, original.id);
  assert.equal(app.session().reviewOf, original.id);
  assert.equal(app.session().mode, 'area');
  assert.deepEqual(app.session().requiredSteps, [1]);
  assert.equal(app.get('#comp0').disabled, false);
  assert.equal(app.get('#comp0').value, '');
  assert.equal(app.get('#vq0_1').disabled, false);
  doVocab(app); stage(app, 1, '리포트 보기'); app.main();
  assert.equal(app.history().length, 2);
  assert.deepEqual(app.history().find(item => item.id === original.id), original);
  assert.match(app.get('#report').textContent, /5\/5/);
  assert.match(app.get('#report').textContent, /이번 회차 미수행/);
});

test('wrong-answer retry contains only mistakes, restores drafts and records corrected result separately', t => {
  const app = openApp(t); finishLesson(app, true); const original = app.history()[0];
  app.textButton('틀린 문제 다시 풀기'); visible(app, '#mistake-panel');
  assert.equal(app.session().mistakes.length, 7);
  app.main(); assert.match(app.get('#status').textContent, /모두 풀어/);
  app.click('#mq0_1'); app.click('#mq1_2'); app.input('#mistake-concept-0', '중심 문장');
  const restored = openApp(t, app.snapshot()); restored.click('#resume-continue');
  visible(restored, '#mistake-panel');
  assert.equal(restored.get('#mq0_1').checked, true);
  assert.equal(restored.get('#mistake-concept-0').value, '중심 문장');
  // Order: vocab 0, vocab 1, concept 0, reading 5, paragraph 0, sentence 9, sentence 13.
  restored.click('#mq3_1'); restored.click('#mq4_0'); restored.click('#mq5_1'); restored.click('#mq6_2');
  restored.main(); stage(restored, 5, '학습 완료');
  assert.match(restored.get('#report').textContent, /7\/7/);
  assert.equal(restored.get('#overall-progress').value, 100);
  assert.equal(restored.history().length, 2);
  assert.deepEqual(restored.history().find(item => item.id === original.id), original);
  const retry = restored.history().find(item => item.id !== original.id);
  assert.equal(retry.results.totalScore, 100);
  assert.equal(retry.reviewOf, original.id);
  assert.equal([...restored.get('#report').querySelectorAll('button')].find(b => b.textContent === '틀린 문제 다시 풀기').disabled, true);
});

test('restart confirmation cancel preserves draft and confirm creates a clean session', t => {
  const app = openApp(t); app.input('#comp0', '보존할 굳은 소금 문장');
  const id = app.session().id;
  app.click('#btn-reset'); assert.equal(app.get('#confirm-dialog').open, true);
  app.click('#confirm-no'); assert.equal(app.session().id, id);
  assert.equal(app.get('#comp0').value, '보존할 굳은 소금 문장');
  app.click('#btn-reset'); app.click('#confirm-yes');
  assert.notEqual(app.session().id, id); assert.equal(app.get('#comp0').value, '');
  stage(app, 1, '채점하기');
});

test('history read-only review cannot overwrite a separate unfinished session', t => {
  const app = openApp(t); finishLesson(app); const record = app.history()[0];
  app.main(); app.click('#history-new');
  app.input('#comp0', '별도 회차에서 굳은 소금을 공부하고 있어요.'); app.click('#vq0_1');
  const draftId = app.session().id;
  app.click('#history-button'); app.textButton('결과 보기', '#history-list');
  visible(app, '#s5'); assert.match(app.get('#status').textContent, /읽기 전용/);
  assert.equal(app.session().id, draftId);
  app.main(); stage(app, 1, '채점하기');
  assert.equal(app.get('#comp0').value, '별도 회차에서 굳은 소금을 공부하고 있어요.');
  assert.equal(app.get('#vq0_1').checked, true);
  assert.equal(app.session().id, draftId);
  assert.deepEqual(app.history(), [record]);
});

test('uncertain confidence responses do not display a fabricated percentage', t => {
  const app = openApp(t); doVocab(app); app.main(); app.main();
  ANSWERS.blanks.forEach((answer, i) => { app.input(`#bl${i}`, answer); app.input(`#cf${i}`, 'maybe'); });
  app.main(); visible(app, '#s2result');
  assert.doesNotMatch(app.get('#s2result').textContent, /null%|NaN%|undefined%/);
  assert.match(app.get('#s2result').textContent, /비교 응답 없음|—/);
});

test('missing/corrupt storage recovers to usable UI and malformed partial state cannot unlock completion', t => {
  const empty = openApp(t); stage(empty, 1, '채점하기');
  assert.equal(empty.get('#resume-dialog').open, false);
  const corrupt = openApp(t, { trainingSession: '{bad json', trainingHistory: '[broken' });
  stage(corrupt, 1, '채점하기'); visible(corrupt, '#storage-warning');
  corrupt.click('#history-button'); visible(corrupt, '#history-panel');
  assert.match(corrupt.get('#history-list').textContent, /저장된 학습 기록이 없습니다/);
  const partial = empty.session();
  partial.currentStep = 5; partial.status = 'completed'; partial.completedAt = partial.startedAt;
  partial.results = { totalScore: 100 };
  partial.submitted = { vocab: true, concept: true, reading: true, outline: true, writing: true };
  partial.draft = { compose: ['복구 가능한 초안', ''], vocab: [1, -3, 999], slots: [[0], [0, 3], [3]] };
  const restored = openApp(t, { trainingSession: JSON.stringify(partial) });
  visible(restored, '#storage-warning'); restored.click('#resume-continue');
  stage(restored, 1, '채점하기');
  assert.equal(restored.get('#comp0').value, '복구 가능한 초안');
  assert.equal(restored.get('#vq0_1').checked, true);
  assert.equal(restored.get('#rail button[data-s="5"]').disabled, true);
  assert.equal(restored.session().status, 'active');
  assert.equal(restored.session().submitted.vocab, false);
  assert.equal(restored.session().results?.totalScore ?? null, null);
});

test('empty or corrupt mistake sessions cannot complete or create history', t => {
  const seed = openApp(t).session();
  const cases = [
    { mistakes: [], mistakeAnswers: {} },
    { mistakes: [{ type: 'vocab', index: 999 }, { type: 'unknown', index: 0 }], mistakeAnswers: { 'vocab-999': 1 } },
    // Sentence 16 is outside paragraph 0, so a claimed submitted answer must be rejected.
    { mistakes: [{ type: 'key', index: 0 }], mistakeAnswers: { 'key-0': 16 } },
  ];
  for (const data of cases) {
    const corrupt = {
      ...seed, mode: 'mistakes', requiredSteps: [], currentStep: 5,
      status: 'completed', completedAt: seed.startedAt,
      mistakeSubmitted: true, results: { totalScore: 100 }, ...data,
    };
    const app = openApp(t, { trainingSession: JSON.stringify(corrupt) }); app.click('#resume-continue');
    visible(app, '#mistake-panel');
    assert.equal(app.get('#s5').hidden, true);
    assert.equal(app.session().status, 'active');
    assert.equal(app.session().mistakeSubmitted, false);
    assert.equal(app.get('#overall-progress').value, 0);
    assert.deepEqual(app.history(), []);
    app.main();
    if (app.session().mistakes.length === 0) {
      assert.equal(app.get('#btn-main').textContent, '전체 학습 시작');
      assert.equal(app.get('#confirm-dialog').open, true);
      app.click('#confirm-no');
      assert.equal(app.session().status, 'active');
      app.main(); app.click('#confirm-yes'); stage(app, 1, '채점하기');
    } else {
      assert.match(app.get('#status').textContent, /모두 풀어/);
      assert.equal(app.session().mistakeSubmitted, false);
    }
    assert.deepEqual(app.history(), []);
  }
});
