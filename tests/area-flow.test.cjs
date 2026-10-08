const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
// Exercise exactly the deployed entry point, including new area modules.
const SCRIPTS = [...SOURCE.matchAll(/<script\s+src="([^\"]+)"\s*><\/script>/g)].map(match => match[1]);
const HTML = SOURCE.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const NOW = Date.parse('2026-10-08T03:00:00.000Z');

function openApp(t, stored = {}) {
  const dom = new JSDOM(HTML, { url: 'https://training.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const errors = [], intervals = new Map();
  let clock = 0, nextTimer = 1;
  window.addEventListener('error', event => { errors.push(event.error || event.message); event.preventDefault(); });
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.setInterval = (callback, delay) => { const id = nextTimer++; intervals.set(id, { callback, delay, last: clock }); return id; };
  window.clearInterval = id => intervals.delete(id);
  Object.defineProperty(window.performance, 'now', { value: () => clock });
  for (const [key, value] of Object.entries(stored)) window.localStorage.setItem(key, value);
  const context = dom.getInternalVMContext();
  vm.runInContext(`globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
    { const NativeDate = Date; globalThis.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [${NOW}])); }
      static now() { return ${NOW}; }
    }; }`, context);
  for (const file of SCRIPTS) {
    assert.ok(!file.includes('://'), 'integration test must not fetch remote code');
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  }
  t.after(() => { dom.window.close(); assert.deepEqual(errors, [], 'full entry point must not throw'); });
  const document = window.document;
  const get = selector => { const node = document.querySelector(selector); assert.ok(node, `missing ${selector}`); return node; };
  const click = selector => {
    const node = get(selector);
    assert.equal(node.disabled, false, `${selector} must be enabled`);
    assert.equal(node.closest('[hidden]'), null, `${selector} must be visible`);
    node.click();
  };
  const json = value => JSON.parse(JSON.stringify(value));
  const nativeSetItem = window.Storage.prototype.setItem;
  let blockedKeys = new Set();
  window.Storage.prototype.setItem = function (key, value) {
    if (blockedKeys.has(key)) throw new window.DOMException('No storage space', 'QuotaExceededError');
    return nativeSetItem.call(this, key, value);
  };
  assert.ok(window.AreaTraining, 'real entry point loads AreaTraining');
  return {
    window, document, get, click,
    main: () => click('#activity-main'),
    session: () => json(window.AreaTraining.getSession()),
    records: () => json(window.AreaTraining.records()),
    results: () => json(window.AreaTraining.results(window.AreaTraining.getSession())),
    legacy: () => JSON.parse(window.localStorage.getItem('trainingSession')),
    catalog: () => json(vm.runInContext('ActivityContent.createCatalog(PKG)', context)),
    current: () => json(vm.runInContext('ActivityEngine.create(ActivityContent.createCatalog(PKG)).current(AreaTraining.getSession())', context)),
    evaluate: source => vm.runInContext(source, context),
    blockWrites: keys => { blockedKeys = new Set(keys); },
    snapshot: () => Object.fromEntries(Array.from({ length: window.localStorage.length }, (_, i) => { const key = window.localStorage.key(i); return [key, window.localStorage.getItem(key)]; })),
    input(selector, value) {
      const node = get(selector); assert.equal(node.disabled, false); assert.equal(node.closest('[hidden]'), null);
      node.value = value; node.dispatchEvent(new window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    },
    advance(ms) {
      const end = clock + ms;
      while (clock < end) {
        clock = Math.min(end, clock + 1000);
        for (const timer of [...intervals.values()]) if (clock - timer.last >= timer.delay) { timer.last = clock; timer.callback(); }
      }
    }
  };
}

function visible(app, selector) { assert.equal(app.get(selector).closest('[hidden]'), null, `${selector} must be visible`); }
function hidden(app, selector) { assert.ok(app.get(selector).closest('[hidden]'), `${selector} must be hidden`); }

function submitCurrent(app, wrong = false) {
  const before = app.current();
  assert.notEqual(before.task.kind, 'read', 'answer helper only submits actual questions');
  if (before.task.kind === 'order') {
    const order = wrong ? before.task.answer.slice().reverse() : before.task.answer;
    order.forEach(id => app.click(`#activity-panel button[data-paragraph="${id}"]`));
  } else app.click(`#activity-option-${wrong ? (before.task.answer + 1) % before.task.options.length : before.task.answer}`);
  app.main();
  assert.ok(app.session().submitted[before.entry.key], 'checking the answer persists submission');
  if (app.session().status === 'active' && app.current().entry.key === before.entry.key) app.main();
  return before;
}

function finishArea(app, wrongTask = null) {
  const seen = [];
  for (let guard = 0; guard < 100 && app.session().status === 'active'; guard++) {
    const { entry, task } = app.current(); seen.push({ taskId: task.id, retryOf: entry.retryOf, kind: task.kind, mode: task.mode });
    if (task.kind === 'read') {
      if (task.mode === 'auto') {
        app.click('#activity-play'); app.advance(task.sentences.length * 4000);
        assert.notEqual(app.current().entry.key, entry.key, 'automatic reading opens its quiz after the final sentence');
      } else app.main();
    } else submitCurrent(app, task.id === wrongTask && !entry.retryOf);
  }
  assert.equal(app.session().status, 'completed', 'area must reach completion through UI');
  visible(app, '#activity-result');
  return seen;
}

test('real entry point keeps home and starts all three distinct area activities', t => {
  for (const [area, kind, firstTask] of [
    ['fluency', 'read', 'fluency-normal-read'],
    ['vocabulary', 'choice', 'vocabulary-meaning-1'],
    ['reading', 'read', 'reading-passage']
  ]) {
    const app = openApp(t); visible(app, '#home-panel');
    const old = app.legacy(); app.click(`#start-${area}`);
    visible(app, '#activity-panel'); hidden(app, '#home-panel'); hidden(app, '#learning-shell');
    assert.equal(app.session().area, area);
    assert.equal(app.current().task.id, firstTask); assert.equal(app.current().task.kind, kind);
    assert.deepEqual(app.legacy().draft, old.draft, 'new areas do not replace legacy answers');
    assert.equal(app.records().length, 0);
  }
});

test('unsubmitted vocabulary choice survives home and reload, with next navigation gated', t => {
  const app = openApp(t); app.click('#start-vocabulary');
  assert.equal(app.get('#activity-main').disabled, true, 'must answer before checking');
  const answer = app.current().task.answer;
  app.click(`#activity-option-${answer}`);
  const selected = app.session();
  assert.equal(Object.keys(selected.submitted).length, 0);
  app.click('#activity-home'); visible(app, '#home-panel');
  const restored = openApp(t, app.snapshot()); restored.click('#home-continue');
  visible(restored, '#activity-panel');
  assert.equal(restored.session().id, selected.id);
  assert.deepEqual(restored.session().answers, selected.answers);
  assert.equal(restored.get(`#activity-option-${answer}`).checked, true);
  restored.main(); assert.ok(restored.session().submitted[restored.current().entry.key]);
});

test('vocabulary presents 16 meaning and 16 sentence questions, with wrong answer returning within two questions', t => {
  const app = openApp(t); app.click('#start-vocabulary');
  const seen = finishArea(app, 'vocabulary-meaning-1');
  const base = seen.filter(entry => !entry.retryOf), retry = seen.filter(entry => entry.retryOf);
  assert.equal(base.filter(entry => entry.taskId.startsWith('vocabulary-meaning-')).length, 16);
  assert.equal(base.filter(entry => entry.taskId.startsWith('vocabulary-sentence-')).length, 16);
  assert.equal(retry.length, 1, 'correct retry is not queued forever');
  assert.ok(seen.findIndex(entry => entry.retryOf) <= 2, 'one incorrect question returns within the next two questions');
  const result = app.results();
  assert.equal(result.totalQuestions, 32); assert.equal(result.answered, 32);
  assert.equal(result.wrong, 1); assert.equal(result.reviewAttempts, 1); assert.equal(result.reviewCorrect, 1);
  assert.equal(app.records().length, 1);
  app.click('#activity-home'); assert.equal(app.get('#today-progress').value, 1);
  assert.match(app.get('#recent-list').textContent, /어휘력/);
  const restored = openApp(t, app.snapshot());
  assert.equal(restored.records().length, 1); assert.equal(restored.get('#today-progress').value, 1);
});

test('fluency completes each of normal, speed, and automatic reading once and then its preserved quiz', t => {
  const app = openApp(t); app.click('#start-fluency');
  const seen = finishArea(app);
  assert.deepEqual(seen.filter(item => item.kind === 'read').map(item => item.mode), ['normal', 'speed', 'auto']);
  assert.equal(seen.filter(item => item.kind === 'choice').length, 3);
  assert.equal(app.results().totalQuestions, 3); assert.equal(app.results().accuracy, 100);
  assert.equal(app.records().length, 1);
});

test('speed reading closes at 60 seconds and automatic reading resumes its sentence without silently running', t => {
  const app = openApp(t); app.click('#start-fluency'); app.main(); submitCurrent(app);
  assert.equal(app.current().task.mode, 'speed');
  app.advance(59000); assert.equal(app.current().task.mode, 'speed');
  app.advance(1000); assert.equal(app.current().task.id, 'fluency-speed-quiz');
  submitCurrent(app); assert.equal(app.current().task.mode, 'auto');
  assert.equal(app.get('#activity-main').disabled, true, 'automatic reading cannot be skipped');
  const beforePlay = app.session().elapsedMs; app.advance(4000);
  assert.equal(app.session().elapsedMs, beforePlay, 'automatic reading waits for play');
  app.click('#activity-play'); app.advance(8000);
  const position = app.get('#activity-auto-count').textContent;
  const sentence = app.get('#activity-auto-text').textContent;
  assert.match(position, /^3 \/ 17/);
  app.click('#activity-play'); const paused = app.session().elapsedMs; app.advance(4000);
  assert.equal(app.session().elapsedMs, paused); assert.equal(app.get('#activity-auto-text').textContent, sentence);
  app.click('#activity-home');
  const restored = openApp(t, app.snapshot()); restored.click('#home-continue');
  assert.equal(restored.get('#activity-auto-text').textContent, sentence);
  assert.equal(restored.get('#activity-auto-count').textContent, position);
  restored.advance(4000); assert.equal(restored.session().elapsedMs, paused);
  restored.click('#activity-play'); restored.advance(4000);
  assert.notEqual(restored.get('#activity-auto-text').textContent, sentence);
});

test('reading has one passage, one order, one structure, and four content questions', t => {
  const app = openApp(t); app.click('#start-reading');
  const seen = finishArea(app);
  assert.equal(seen.filter(item => item.kind === 'read').length, 1);
  assert.equal(seen.filter(item => item.taskId === 'reading-order').length, 1);
  assert.equal(seen.filter(item => item.taskId === 'reading-structure').length, 1);
  assert.equal(seen.filter(item => item.taskId.startsWith('reading-content-')).length, 4);
  assert.equal(app.results().totalQuestions, 6); assert.equal(app.results().accuracy, 100);
  assert.equal(app.records().length, 1);
});

test('paragraph order requires all four choices, supports reset, and preserves checked questions when going back', t => {
  const app = openApp(t); app.click('#start-reading'); app.main();
  assert.equal(app.current().task.kind, 'order'); assert.equal(app.get('#activity-main').disabled, true);
  app.click('#activity-paragraph-2'); app.click('#activity-paragraph-0');
  assert.equal(app.get('#activity-main').disabled, true);
  app.click('#activity-order-reset'); assert.deepEqual(app.session().answers[app.current().entry.key], []);
  const order = submitCurrent(app);
  assert.equal(app.current().task.id, 'reading-structure');
  const progress = app.get('#activity-progress').value; app.advance(6000);
  assert.equal(app.get('#activity-progress').value, progress, 'legacy interval cannot overwrite area progress');
  app.click('#activity-prev'); assert.equal(app.current().task.id, order.task.id);
  assert.equal(app.get('#activity-paragraph-0').disabled, true, 'submitted answers are read-only');
  assert.equal(app.get('#activity-main').textContent, '다음 문제'); app.main();
  assert.equal(app.current().task.id, 'reading-structure', 'reading passage is never replayed by previous');
});

test('new area clock pauses on home and menu, and never charges time to the saved legacy lesson', t => {
  const app = openApp(t); const original = app.legacy();
  app.click('#start-vocabulary'); app.advance(3000);
  const beforeMenu = app.session().elapsedMs; assert.equal(beforeMenu, 3000);
  app.click('#menu-button'); app.advance(5000); assert.equal(app.session().elapsedMs, beforeMenu);
  app.click('#menu-close'); app.advance(2000); assert.equal(app.session().elapsedMs, beforeMenu + 2000);
  app.click('#activity-home'); app.advance(4000); assert.equal(app.session().elapsedMs, beforeMenu + 2000);
  assert.equal(app.legacy().elapsedMs, original.elapsedMs, 'legacy interval must remain paused during area study');
  app.click('#menu-button'); app.click('#menu-continue'); visible(app, '#activity-panel');
  app.advance(2000); assert.equal(app.session().elapsedMs, beforeMenu + 4000);
});

test('full course draft and new area draft coexist across home navigation and reload', t => {
  const app = openApp(t); app.click('#home-full-start');
  app.input('#comp0', '기존 학습에서 소금이 굳었어요.'); app.click('#vq2_3');
  const legacy = app.legacy(); app.click('#learning-home');
  app.click('#start-vocabulary'); app.click('#activity-option-0'); const area = app.session();
  assert.deepEqual(app.legacy().draft, legacy.draft);
  app.click('#activity-home');
  const restored = openApp(t, app.snapshot()); restored.click('#home-full-start');
  visible(restored, '#s1'); hidden(restored, '#activity-panel');
  assert.equal(restored.legacy().id, legacy.id); assert.equal(restored.get('#comp0').value, legacy.draft.compose[0]);
  assert.equal(restored.get('#vq2_3').checked, true);
  restored.click('#learning-home'); restored.click('#start-vocabulary');
  assert.equal(restored.session().id, area.id); assert.deepEqual(restored.session().answers, area.answers);
  assert.equal(restored.get('#activity-option-0').checked, true);
});

test('historical area result and unified history leave an unfinished area untouched and menu continue restores it', t => {
  const app = openApp(t); app.click('#start-reading'); finishArea(app);
  const recordId = app.session().id;
  app.click('#activity-home'); app.click('#start-vocabulary'); app.click('#activity-option-2');
  app.advance(3000); app.click('#activity-home'); const current = app.session();
  app.click('#recent-list .record-card button'); visible(app, '#activity-result');
  assert.equal(app.document.querySelectorAll('#activity-review details').length, 6);
  app.advance(5000); assert.deepEqual(app.session(), current, 'viewing old results does not modify active answers or time');
  app.click('#activity-history'); visible(app, '#history-panel'); hidden(app, '#activity-panel');
  assert.match(app.get('#history-list').textContent, /독해력/);
  assert.equal(app.records()[0].id, recordId);
  app.click('#menu-button'); app.click('#menu-continue'); visible(app, '#activity-panel');
  assert.equal(app.session().id, current.id); assert.equal(app.get('#activity-option-2').checked, true);
  app.advance(2000); assert.equal(app.session().elapsedMs, current.elapsedMs + 2000);
  assert.equal(app.records().length, 1);
});

test('wrong-only retry and repeat area create distinct results without altering the completed source record', t => {
  const app = openApp(t); app.click('#start-reading'); finishArea(app, 'reading-order');
  const source = app.records()[0]; assert.equal(app.results().wrong, 1);
  app.click('#activity-retry-wrong');
  assert.equal(app.session().reviewOf, source.id);
  assert.deepEqual(app.session().taskIds, ['reading-order']);
  const seen = finishArea(app); assert.equal(seen.length, 1);
  assert.equal(app.results().totalQuestions, 1); assert.equal(app.results().accuracy, 100);
  assert.equal(app.records().length, 2);
  assert.deepEqual(app.records().find(record => record.id === source.id), source);
  app.click('#activity-retry-area');
  assert.equal(app.session().reviewOf, null); assert.equal(app.current().task.id, 'reading-passage');
  assert.equal(app.session().taskIds.length, 7); assert.equal(app.records().length, 2);
});

test('switching unfinished areas can be cancelled without losing answers and confirmed replacement keeps records', t => {
  const app = openApp(t); app.click('#start-vocabulary'); app.click('#activity-option-3');
  app.click('#activity-home'); const original = app.session(); app.click('#start-reading');
  assert.equal(app.get('#confirm-dialog').open, true); assert.equal(app.session().id, original.id);
  app.click('#confirm-no'); assert.deepEqual(app.session(), original);
  app.click('#start-reading'); app.click('#confirm-yes');
  assert.equal(app.session().area, 'reading'); assert.notEqual(app.session().id, original.id);
  assert.equal(app.records().length, 0); visible(app, '#activity-panel');
});

test('failed completion persistence retains the result and prevents retry replacement until saving works', t => {
  const app = openApp(t); app.click('#start-reading');
  app.blockWrites(['areaTrainingSession.v1', 'areaTrainingHistory.v1']);
  finishArea(app); const completed = app.session();
  assert.equal(app.records().length, 0); visible(app, '#activity-storage-warning');
  assert.match(app.get('#activity-storage-warning').textContent, /저장/);
  app.click('#activity-retry-area');
  assert.equal(app.session().id, completed.id); assert.equal(app.session().status, 'completed');
  visible(app, '#activity-result');
  app.blockWrites([]); app.click('#activity-retry-area');
  assert.notEqual(app.session().id, completed.id); assert.equal(app.session().status, 'active');
  assert.equal(app.records().length, 1); assert.equal(app.records()[0].id, completed.id);
});
