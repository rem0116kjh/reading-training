const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const Store = require('../training-store.js');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const SCRIPTS = ['training-store.js', 'feedback.js', 'app.js', 'session-ui.js', 'interface.js'];
const NOW = Date.parse('2026-10-08T00:30:00.000Z'); // 09:30 in Asia/Seoul.
const ESSAY = '소금은 음식의 맛을 내고 오래 보관하는 역할을 해요. 염전에서는 바닷물을 햇볕에 말려 물을 증발시켜 소금을 얻어요. 오래전 바다였던 땅속에서는 굳은 소금을 캐내요. 이렇게 여러 방법으로 소금을 생산해요.';

function openApp(t, stored = {}) {
  const dom = new JSDOM(HTML, { url: 'https://training.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const errors = [];
  window.addEventListener('error', event => { errors.push(event.error || event.message); event.preventDefault(); });
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.setInterval = () => 0;
  let clock = 0;
  Object.defineProperty(window.performance, 'now', { value: () => clock });
  for (const [key, value] of Object.entries(stored)) window.localStorage.setItem(key, value);
  const context = dom.getInternalVMContext();
  vm.runInContext(`globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
    { const NativeDate = Date; globalThis.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [${NOW}])); }
      static now() { return ${NOW}; }
    }; }`, context);
  for (const file of SCRIPTS) vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  t.after(() => { dom.window.close(); assert.deepEqual(errors, [], 'adapter UI must not throw'); });
  const document = window.document;
  const get = selector => { const node = document.querySelector(selector); assert.ok(node, `missing ${selector}`); return node; };
  const click = selector => { const node = get(selector); assert.equal(node.disabled, false, `${selector} must be enabled`); assert.equal(node.closest('[hidden]'), null, `${selector} must be visible`); node.click(); };
  const input = (selector, value) => { const node = get(selector); assert.equal(node.disabled, false); assert.equal(node.closest('[hidden]'), null); node.value = value; node.dispatchEvent(new window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
  return {
    window, document, get, click, input,
    startLegacyArea: steps => vm.runInContext(`replaceSession({ mode: 'area', requiredSteps: ${JSON.stringify(steps)} });`, context),
    main: () => click('#btn-main'),
    textButton(text, root = '#report') {
      const button = [...get(root).querySelectorAll('button')].find(node => node.textContent.trim() === text);
      assert.ok(button, `missing button ${text}`); assert.equal(button.disabled, false); button.click();
    },
    session: () => JSON.parse(window.localStorage.getItem('trainingSession')),
    history: () => JSON.parse(window.localStorage.getItem('trainingHistory') || '[]'),
    snapshot: () => Object.fromEntries(Array.from({ length: window.localStorage.length }, (_, i) => { const key = window.localStorage.key(i); return [key, window.localStorage.getItem(key)]; })),
    active: () => vm.runInContext('isLearningActive()', context),
    advance(ms) { clock += ms; vm.runInContext('tick(); persist();', context); },
  };
}

function visible(app, selector) { assert.equal(app.get(selector).closest('[hidden]'), null, `${selector} must be visible`); }
function view(app, expected) { assert.equal(app.get('.app').dataset.view, expected); }
function quiz(app, prefix, answers) { answers.forEach((answer, index) => app.click(`#${prefix}${index}_${answer}`)); }
function vocabulary(app) {
  app.input('#comp0', '소금이 굳었어요.'); app.input('#comp1', '소금은 중요한 역할을 해요.');
  quiz(app, 'vq', [1, 2, 3, 0, 1]); app.main();
}
function finishFull(app) {
  vocabulary(app); app.main(); app.main();
  ['중심 문장', '뒷받침 문장', '바닷물', '염전', '증발'].forEach((answer, i) => { app.input(`#bl${i}`, answer); app.input(`#cf${i}`, 'sure'); });
  app.main(); app.main(); app.main();
  [0, 3, 9, 13].forEach(index => app.click(`#key-${index}`)); app.main();
  quiz(app, 'rq', [1, 2, 1, 2, 1, 1, 1]); app.main(); app.main();
  [[0], [3, 9], [13, 15]].forEach((indices, slot) => indices.forEach(index => { app.click(`#schips .schip[data-k="${index}"]`); app.get('#slots').children[slot].click(); }));
  app.main(); app.input('#essay', ESSAY); app.main(); app.main();
}

function completedRecord(id, steps, completedAt, totalTime = 60000, mode = 'area') {
  const session = Store.createSession({ id, mode, requiredSteps: steps, startedAt: '2026-10-01T00:00:00.000Z' });
  session.draft = {
    vocab: [1, 2, 3, 0, 1], compose: ['소금이 굳었어요.', '소금의 역할을 알아요.'],
    blanks: ['중심 문장', '뒷받침 문장', '바닷물', '염전', '증발'], confidence: Array(5).fill('sure'),
    key: [0, 3, 9, 13], readingAnswers: [1, 2, 1, 2, 1, 1, 1], slots: [[0], [3, 9], [13, 15]], selectedSentence: null, essay: ESSAY,
  };
  session.submitted = { vocab: steps.includes(1), concept: steps.includes(2), reading: steps.includes(3), outline: steps.includes(4), writing: steps.includes(4) };
  if (steps.includes(2)) session.phase.concept = 'fill';
  if (steps.includes(3)) session.phase.reading = 'quiz';
  if (mode === 'mistakes') { session.mistakes = [{ type: 'vocab', index: 0 }]; session.mistakeAnswers = { 'vocab-0': 1 }; session.mistakeSubmitted = true; }
  session.status = 'completed'; session.currentStep = 5; session.completedAt = completedAt;
  session.elapsedMs = totalTime; session.results = { fixture: 'completed lesson answers' };
  const normalized = Store.normalizeSession(session);
  assert.equal(normalized.status, 'completed', 'record fixture must satisfy current schema');
  return { version: 1, id, packageId: session.packageId, title: session.title, mode, reviewOf: null, completedAt, totalTime, results: session.results, session: normalized };
}

test('fresh adapter opens home with zero real stats and starts the existing full pipeline', t => {
  const app = openApp(t);
  view(app, 'home'); visible(app, '#home-panel');
  assert.equal(app.get('#learning-shell').hidden, true);
  assert.equal(app.get('.actionbar').hidden, true);
  assert.equal(app.get('#resume-dialog').open, false);
  assert.equal(app.get('#home-resume').hidden, true);
  assert.equal(app.get('#home-time').textContent, '0분 0초');
  assert.equal(app.get('#today-progress').value, 0);
  assert.match(app.get('#recent-list').textContent, /아직 완료한 학습이 없어요/);
  assert.equal(app.history().length, 0);
  app.click('#home-full-start'); view(app, 'learning'); visible(app, '#s1');
  assert.equal(app.session().mode, 'full'); assert.deepEqual(app.session().requiredSteps, [1, 2, 3, 4]);
  assert.equal(app.get('#btn-main').textContent, '채점하기');
});

test('home has one training entry and lists the three stages in sequence', t => {
  const app = openApp(t);
  assert.equal(app.document.querySelectorAll('.course-start-card').length, 1);
  assert.equal(app.document.querySelectorAll('.training-card, #start-fluency, #start-vocabulary, #start-reading, #home-first-start').length, 0);
  assert.deepEqual([...app.document.querySelectorAll('.course-stage-list h3')].map(node => node.textContent), ['어휘력', '지문 1', '지문 2']);
  assert.equal(app.get('#home-full-start').textContent.trim(), '맞춤형 훈련 시작 →');
  app.click('#home-full-start');
  assert.equal(app.session().mode, 'full');
  assert.deepEqual(app.session().requiredSteps, [1, 2, 3, 4]);
  assert.equal(app.history().length, 0);
});

test('home back and reload preserve draft; unified course entry resumes the same session', t => {
  const app = openApp(t); app.click('#home-full-start');
  app.input('#comp0', '소금이 굳은 채로 남아 있어요.'); app.click('#vq2_3'); const id = app.session().id;
  app.click('#learning-home'); view(app, 'home'); visible(app, '#home-resume');
  assert.match(app.get('#home-full-start').textContent, /이어하기/);
  app.click('#home-full-start'); assert.equal(app.session().id, id);
  assert.equal(app.get('#vq2_3').checked, true);
  app.click('#learning-home');
  const restored = openApp(t, app.snapshot()); view(restored, 'home'); visible(restored, '#home-resume');
  assert.equal(restored.get('#resume-dialog').open, false);
  restored.click('#home-full-start'); view(restored, 'learning');
  assert.equal(restored.session().id, id);
  assert.equal(restored.get('#comp0').value, '소금이 굳은 채로 남아 있어요.');
  assert.equal(restored.get('#vq2_3').checked, true);
  assert.equal(restored.document.activeElement.id, 'vq2_3');
  assert.match(restored.get('#question-label').textContent, /현재 문제 3 \/ 5/);
});

test('home and open drawer pause learning time while actual learning continues counting', t => {
  const app = openApp(t);
  assert.equal(app.active(), false); app.advance(4000); assert.equal(app.session().elapsedMs, 0);
  app.startLegacyArea([3]); assert.equal(app.active(), true); app.advance(3000);
  assert.equal(app.session().elapsedMs, 3000); assert.equal(app.session().metrics.readingMs, 3000);
  app.click('#menu-button'); assert.equal(app.active(), false); app.advance(4000);
  assert.equal(app.session().elapsedMs, 3000);
  app.click('#menu-close'); assert.equal(app.active(), true); app.advance(2000);
  assert.equal(app.session().elapsedMs, 5000);
  app.click('#learning-home'); assert.equal(app.active(), false); app.advance(4000);
  assert.equal(app.session().elapsedMs, 5000); assert.equal(app.session().metrics.readingMs, 5000);
});

test('starting the full course from an unfinished legacy area confirms replacement and cancellation retains the original answers', t => {
  const app = openApp(t); app.startLegacyArea([1]); app.input('#comp0', '소금이 굳었어요.');
  const original = app.session(); app.click('#learning-home'); app.click('#home-full-start');
  assert.equal(app.get('#confirm-dialog').open, true); assert.equal(app.session().id, original.id);
  app.click('#confirm-no'); view(app, 'home'); assert.deepEqual(app.session().draft, original.draft);
  app.click('#home-continue'); assert.equal(app.get('#comp0').value, '소금이 굳었어요.');
  app.click('#learning-home'); app.click('#home-full-start'); app.click('#confirm-yes');
  view(app, 'learning'); visible(app, '#s1');
  assert.notEqual(app.session().id, original.id); assert.deepEqual(app.session().requiredSteps, [1, 2, 3, 4]);
  assert.equal(app.history().length, 0);
});

test('today completion uses Seoul date, actual mapped stages and excludes wrong-answer-only reviews', t => {
  const todayEarly = '2026-10-07T15:10:00.000Z'; // Oct 8 in Seoul, Oct 7 in UTC.
  const yesterdayLate = '2026-10-07T14:59:00.000Z';
  const vocab = completedRecord('today-vocab', [1], todayEarly);
  const fluency = completedRecord('today-fluency', [3], todayEarly);
  const oldReading = completedRecord('yesterday-reading', [2, 3, 4], yesterdayLate);
  const wrongOnly = completedRecord('today-mistakes', [], todayEarly, 60000, 'mistakes');
  const app = openApp(t, { trainingHistory: JSON.stringify([vocab, fluency, oldReading, wrongOnly]) });
  assert.equal(app.get('#today-progress').value, 2);
  assert.equal(app.get('#today-checklist [data-area="reading"] small').textContent, '진행 전');
  const concept = completedRecord('today-concept', [2], todayEarly);
  const missingWriting = openApp(t, { trainingHistory: JSON.stringify([vocab, fluency, concept, wrongOnly]) });
  assert.equal(missingWriting.get('#today-progress').value, 2);
  const writing = completedRecord('today-writing', [4], todayEarly);
  const complete = openApp(t, { trainingHistory: JSON.stringify([vocab, fluency, concept, writing, wrongOnly]) });
  assert.equal(complete.get('#today-progress').value, 3);
  assert.match(complete.get('#today-checklist [data-area="reading"] small').textContent, /완료/);
  assert.match(complete.get('#today-message').textContent, /세 단계를 모두 완료/);
  const onlyMistakes = openApp(t, { trainingHistory: JSON.stringify([wrongOnly]) });
  assert.equal(onlyMistakes.get('#today-progress').value, 0);
});

test('home time deduplicates completed current session and recent list shows only three with all-history access', t => {
  const records = [0, 1, 2, 3].map(index => completedRecord(`record-${index}`, [1], `2026-10-07T${String(16 + index).padStart(2, '0')}:00:00.000Z`, (index + 1) * 60000));
  const app = openApp(t, { trainingSession: JSON.stringify(records[3].session), trainingHistory: JSON.stringify([...records, records[3]]) });
  assert.equal(app.get('#home-time').textContent, '10분 0초');
  assert.equal(app.document.querySelectorAll('#recent-list .record-card').length, 3);
  const before = app.session().id;
  app.click('#home-history-all'); view(app, 'history'); visible(app, '#history-panel');
  assert.equal(app.document.querySelectorAll('#history-list .record-card').length, 4);
  assert.equal(app.session().id, before);
  assert.equal(app.active(), false);
});

test('home historical report hides active stage and never overwrites a current unfinished lesson', t => {
  const record = completedRecord('past-record', [1, 2, 3, 4], '2026-10-07T16:00:00.000Z', 60000, 'full');
  const app = openApp(t, { trainingHistory: JSON.stringify([record]) });
  app.startLegacyArea([1]); app.input('#comp0', '현재 회차의 굳은 소금 문장'); const current = app.session();
  app.click('#learning-home'); app.click('#recent-list .record-card button');
  view(app, 'report'); visible(app, '#s5'); assert.equal(app.get('#s1').hidden, true);
  assert.equal(app.get('#mistake-panel').hidden, true);
  assert.equal(app.session().id, current.id); assert.deepEqual(app.session().draft, current.draft);
  assert.equal(app.active(), false);
  assert.match(app.get('#status').textContent, /읽기 전용/);
  app.main(); view(app, 'learning'); visible(app, '#s1');
  assert.equal(app.get('#comp0').value, '현재 회차의 굳은 소금 문장');
  assert.equal(app.session().id, current.id);
  assert.equal(app.history().length, 1);
});

test('drawer continue from historical report restores active timing and persists subsequent edits', t => {
  const record = completedRecord('history-return', [1], '2026-10-07T16:00:00.000Z');
  const app = openApp(t, { trainingHistory: JSON.stringify([record]) });
  app.startLegacyArea([1]); app.input('#comp0', '과거 결과를 보기 전의 굳은 소금 문장');
  app.advance(1000); const current = app.session();
  app.click('#learning-home'); app.click('#recent-list .record-card button');
  view(app, 'report'); assert.equal(app.active(), false);
  app.click('#menu-button'); app.click('#menu-continue');
  view(app, 'learning'); visible(app, '#s1');
  assert.equal(app.get('#menu-drawer').open, false);
  assert.equal(app.active(), true, 'historical read-only flags must be cleared when continuing');
  assert.equal(app.session().id, current.id);
  app.input('#comp0', '이어서 새로 수정한 굳은 소금 문장'); app.click('#vq0_1');
  assert.equal(app.session().draft.compose[0], '이어서 새로 수정한 굳은 소금 문장');
  assert.equal(app.session().draft.vocab[0], 1);
  app.advance(2000); assert.equal(app.session().elapsedMs, current.elapsedMs + 2000);
  assert.equal(app.history().length, 1); assert.deepEqual(app.history()[0], record);
});

test('drawer cancel event from Escape restores focus and menu navigation closes drawer state', t => {
  const app = openApp(t); app.get('#menu-button').focus(); app.click('#menu-button');
  assert.equal(app.get('#menu-drawer').open, true);
  assert.equal(app.get('#menu-button').getAttribute('aria-expanded'), 'true');
  assert.equal(app.document.body.classList.contains('menu-open'), true);
  app.get('#menu-close').focus();
  // jsdom has no native dialog keyboard default; Escape's cancel event is the browser contract.
  const cancel = new app.window.Event('cancel', { cancelable: true }); app.get('#menu-drawer').dispatchEvent(cancel);
  assert.equal(cancel.defaultPrevented, true);
  assert.equal(app.get('#menu-drawer').open, false);
  assert.equal(app.get('#menu-button').getAttribute('aria-expanded'), 'false');
  assert.equal(app.document.body.classList.contains('menu-open'), false);
  assert.equal(app.document.activeElement.id, 'menu-button');
  app.click('#menu-button'); app.click('[data-menu="history"]');
  view(app, 'history'); assert.equal(app.get('#menu-drawer').open, false);
  app.click('#menu-button'); app.click('[data-menu="home"]'); view(app, 'home');
});

test('drawer keyboard focus wraps over visible controls and current-page state follows navigation', t => {
  const record = completedRecord('menu-accessibility', [1], '2026-10-07T16:00:00.000Z');
  const app = openApp(t, { trainingHistory: JSON.stringify([record]) });
  app.click('#menu-button');
  assert.equal(app.get('[data-menu="home"]').getAttribute('aria-current'), 'page');
  assert.equal(app.get('#menu-continue').hidden, true);
  const controls = [...app.get('#menu-drawer').querySelectorAll('button')].filter(button => !button.hidden && !button.disabled);
  const last = controls.at(-1); assert.equal(last.id, 'menu-report'); last.focus();
  const forward = new app.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }); last.dispatchEvent(forward);
  assert.equal(forward.defaultPrevented, true); assert.equal(app.document.activeElement.id, 'menu-close');
  const backward = new app.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }); app.get('#menu-close').dispatchEvent(backward);
  assert.equal(backward.defaultPrevented, true); assert.equal(app.document.activeElement, last);
  app.click('[data-menu="history"]'); app.click('#menu-button');
  assert.equal(app.get('[data-menu="history"]').getAttribute('aria-current'), 'page');
  assert.equal(app.get('[data-menu="home"]').hasAttribute('aria-current'), false);
  assert.equal(app.document.querySelectorAll('[data-menu][aria-current="page"]').length, 1);
  app.click('[data-menu="home"]'); app.startLegacyArea([1]); app.input('#comp0', '굳은 소금'); app.click('#menu-button');
  assert.equal(app.get('#menu-continue').getAttribute('aria-current'), 'page');
  assert.equal(app.document.querySelectorAll('[data-menu][aria-current="page"]').length, 1);
  assert.equal(app.get('#rail button[data-s="1"]').getAttribute('aria-current'), 'step');
});

test('native outline placement buttons survive rerenders and completed outline collapses before writing', t => {
  const pending = Store.createSession({ id: 'native-outline', mode: 'area', requiredSteps: [4], startedAt: '2026-10-08T00:00:00.000Z' });
  pending.elapsedMs = 1000;
  const app = openApp(t, { trainingSession: JSON.stringify(pending) }); app.click('#home-continue');
  const assertPlacementButtons = () => {
    const slots = [...app.get('#slots').children]; assert.equal(slots.length, 3);
    slots.forEach((slot, index) => {
      assert.equal(slot.hasAttribute('role'), false); assert.equal(slot.hasAttribute('tabindex'), false); assert.equal(slot.onkeydown, null);
      const buttons = slot.querySelectorAll('.slot-add'); assert.equal(buttons.length, 1);
      assert.equal(buttons[0].tagName, 'BUTTON'); assert.equal(buttons[0].type, 'button');
      assert.equal(buttons[0].getAttribute('aria-label'), ['처음', '중간', '끝'][index] + '에 문장 넣기');
    });
  };
  assertPlacementButtons();
  app.click('#schips .schip[data-k="0"]'); app.click('#slots .slot:nth-child(1) .slot-add');
  assert.deepEqual(app.session().draft.slots, [[0], [], []]); assertPlacementButtons();
  app.click('#learning-home'); app.click('#home-continue'); assertPlacementButtons();
  app.click('#slots .item button'); assertPlacementButtons();
  [[0], [3, 9], [13, 15]].forEach((indices, slot) => indices.forEach(index => {
    app.click(`#schips .schip[data-k="${index}"]`); app.click(`#slots .slot:nth-child(${slot + 1}) .slot-add`); assertPlacementButtons();
  }));
  app.main();
  assert.equal(app.get('#outline-review').tagName, 'DETAILS');
  assert.equal(app.get('#outline-review').open, false);
  assert.equal(app.get('#o-build').parentElement.id, 'outline-review');
  assert.equal(app.document.querySelectorAll('#o-build').length, 1);
  assert.equal(app.document.querySelectorAll('#slots .slot-add').length, 0);
  assert.equal(app.session().results.o.hit, 5);
  visible(app, '#o-write'); assert.equal(app.get('#btn-main').textContent, '첨삭 받기');
  app.input('#essay', ESSAY); assert.equal(app.session().draft.essay, ESSAY); app.main(); app.main();
  view(app, 'report'); assert.equal(app.history().length, 1);
  assert.equal(app.history()[0].results.o.hit, 5);
});

test('adapter full lesson reaches decorated report, history, home completion and a new review', t => {
  const app = openApp(t); app.click('#home-full-start'); finishFull(app);
  view(app, 'report'); visible(app, '#s5');
  assert.equal(app.session().status, 'completed'); assert.equal(app.history().length, 1);
  assert.match(app.get('.report-hero').textContent, /26\/26/);
  assert.equal(app.document.querySelectorAll('.report-stat').length, 4);
  assert.match(app.get('.report-feedback').textContent, /잘한 점/);
  const id = app.session().id;
  app.main(); view(app, 'history'); assert.equal(app.get('#history-list').children.length, 1);
  app.click('#view-home'); view(app, 'home'); assert.equal(app.get('#today-progress').value, 3);
  app.click('#recent-list .record-card button'); view(app, 'report');
  app.textButton('전체 다시 학습'); view(app, 'learning'); visible(app, '#s1');
  assert.notEqual(app.session().id, id); assert.equal(app.session().reviewOf, id);
  assert.equal(app.get('#comp0').disabled, false); assert.equal(app.get('#comp0').value, '');
  assert.equal(app.history().length, 1);
});
