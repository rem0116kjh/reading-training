const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
// Exercise exactly the deployed entry point, including new area modules.
const SCRIPTS = [...SOURCE.matchAll(/<script\s+src="([^\"]+)"\s*><\/script>/g)].map(match => match[1].split('?')[0]);
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
  let writes = [];
  let blockedKeys = new Set();
  window.Storage.prototype.setItem = function (key, value) {
    if (blockedKeys.has(key)) throw new window.DOMException('No storage space', 'QuotaExceededError');
    writes.push(key);
    return nativeSetItem.call(this, key, value);
  };
  assert.ok(window.AreaTraining, 'real entry point loads AreaTraining');
  return {
    window, document, get, click,
    // Isolated area fixtures exercise the retained engine APIs; home starts the full course.
    startArea: area => window.AreaTraining[{ vocabulary: 'startVocabulary', fluency: 'startFluency', reading: 'startReading' }[area]](),
    main: () => click('#activity-main'),
    session: () => json(window.AreaTraining.getSession()),
    records: () => json(window.AreaTraining.records()),
    results: () => json(window.AreaTraining.results(window.AreaTraining.getSession())),
    legacy: () => JSON.parse(window.localStorage.getItem('trainingSession')),
    catalog: () => json(vm.runInContext('ActivityContent.createCatalog(PKG)', context)),
    current: () => json(window.AreaTraining.getCurrent()),
    evaluate: source => vm.runInContext(source, context),
    blockWrites: keys => { blockedKeys = new Set(keys); },
    takeWrites: () => { const result = writes; writes = []; return result; },
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

test('idle home, pre-start reading, paused menus and hidden tabs avoid timer writes while active time remains durable', t => {
  const app = openApp(t);
  app.advance(30000); assert.deepEqual(app.takeWrites(), []);
  app.startArea('fluency'); app.takeWrites();
  const observer = new app.window.MutationObserver(() => {});
  observer.observe(app.get('#activity-panel'), { subtree: true, childList: true, attributes: true });
  app.advance(30000);
  assert.equal(app.session().elapsedMs, 0); assert.deepEqual(app.takeWrites(), []);
  assert.equal(observer.takeRecords().length, 0);
  app.main(); observer.takeRecords(); app.takeWrites();
  const tokens = new app.window.MutationObserver(() => {});
  tokens.observe(app.get('#fluency-tap'), { subtree: true, childList: true, attributes: true });
  app.advance(10000);
  assert.equal(app.session().elapsedMs, 10000);
  assert.equal(tokens.takeRecords().length, 0, 'unchanged tokens are not rebuilt by the timer');
  assert.deepEqual(app.takeWrites(), Array(10).fill('areaTrainingSession.v1'));
  assert.equal(JSON.parse(app.window.localStorage.getItem('areaTrainingSession.v1')).elapsedMs, 10000);
  app.click('#menu-button'); app.takeWrites(); app.advance(10000);
  assert.deepEqual(app.takeWrites(), []); assert.equal(app.session().elapsedMs, 10000);
  app.click('#menu-close');
  Object.defineProperty(app.document, 'hidden', { configurable: true, value: true });
  app.document.dispatchEvent(new app.window.Event('visibilitychange')); app.takeWrites();
  app.advance(10000); assert.deepEqual(app.takeWrites(), []); assert.equal(app.session().elapsedMs, 10000);
  Object.defineProperty(app.document, 'hidden', { configurable: true, value: false });
  app.document.dispatchEvent(new app.window.Event('visibilitychange')); app.takeWrites();
  app.advance(1000); assert.equal(app.session().elapsedMs, 11000);
  tokens.disconnect(); observer.disconnect();
});

function submitCurrent(app, wrong = false) {
  const before = app.current();
  assert.notEqual(before.task.kind, 'read', 'answer helper only submits actual questions');
  if (before.task.kind === 'order') {
    const order = wrong ? before.task.answer.slice().reverse() : before.task.answer;
    order.forEach(id => app.click(`#activity-panel button[data-paragraph="${id}"]`));
  } else if (before.task.kind === 'relations') {
    before.task.answer.forEach((value, index) => { app.click(`#activity-structure-slot-${index}`); app.click(`#activity-structure-choice-${wrong ? (value + 1) % before.task.links[index].options.length : value}`); });
  } else if (before.task.kind === 'recall') {
    app.input('#reading-recall-answer', wrong ? '다른 개념' : before.task.answer);
    app.input('#reading-recall-confidence', 'sure');
  } else if (before.task.kind === 'selection') {
    if (before.task.display === 'sentence-roles') {
      let offset = 0;
      const values = wrong ? before.task.answer.slice().reverse() : before.task.answer;
      before.task.groups.forEach((group, groupIndex) => { for (let i = 0; i < group.capacity; i++) { app.click('#reading-role-sentence-' + values[offset++]); app.click('#reading-role-' + groupIndex); } });
    } else if (before.task.selectionType === 'key') before.task.groups.forEach(group => app.click('#reading-key-' + (wrong ? group.ids.find(id => !group.correct.includes(id)) : group.correct[0])));
    else {
      let offset = 0;
      const values = wrong ? before.task.answer.slice().reverse() : before.task.answer;
      before.task.groups.forEach(group => { const start = offset; for (let i = 0; i < group.capacity; i++) { app.click('#reading-outline-sentence-' + values[offset++]); app.click('#reading-outline-slot-' + start); } });
    }
  } else if (before.task.kind === 'summary') app.input('#reading-summary-answer', before.task.source);
  else app.click(`#activity-option-${wrong ? (before.task.answer + 1) % before.task.options.length : before.task.answer}`);
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

test('isolated area APIs preserve the three existing activities and legacy drafts', t => {
  for (const [area, kind, firstTask] of [
    ['fluency', 'read', 'salt-concept-v2-stage-1'],
    ['vocabulary', 'choice', 'salt-vocabulary-original-1'],
    ['reading', 'read', 'reading-passage']
  ]) {
    const app = openApp(t); visible(app, '#home-panel');
    const old = app.legacy(); app.startArea(area);
    visible(app, '#activity-panel'); hidden(app, '#home-panel'); hidden(app, '#learning-shell');
    assert.equal(app.session().area, area === 'fluency' ? 'fluencyConceptV2' : area === 'vocabulary' ? 'vocabularyReadinV1' : 'readingDiagnosticV3');
    assert.equal(app.current().task.id, firstTask); assert.equal(app.current().task.kind, kind);
    assert.deepEqual(app.legacy().draft, old.draft, 'new areas do not replace legacy answers');
    assert.equal(app.records().length, 0);
  }
});

test('word cards reveal the original meaning and example, count unique views, and preserve quiz state', t => {
  const app = openApp(t); app.startArea('vocabulary');
  assert.equal(app.get('#activity-title').textContent, '오늘의 단어');
  assert.equal(app.document.querySelectorAll('.vocabulary-card').length, 10);
  const original = app.session();
  const words = app.catalog().vocabulary.words;
  for (let index = 0; index < words.length; index++) {
    app.click('#vocabulary-card-' + index);
    assert.equal(app.get('#vocabulary-word-dialog').open, true);
    assert.equal(app.get('#vocabulary-word-title').textContent, words[index].word);
    assert.equal(app.get('#vocabulary-word-meaning').textContent, words[index].meaning);
    assert.equal(app.get('.vocabulary-word-example p').textContent, words[index].example);
    app.click('#vocabulary-word-done');
    assert.equal(app.get('#vocabulary-word-dialog').open, false);
    assert.equal(app.document.activeElement.id, 'vocabulary-card-' + index);
  }
  app.click('#vocabulary-card-0'); app.click('#vocabulary-word-close');
  assert.match(app.get('#vocabulary-viewed-count').textContent, /^10 \/ 10/);
  assert.equal(app.document.querySelectorAll('.vocabulary-card.is-viewed').length, 10);
  assert.deepEqual(app.session(), original, 'viewing meanings must not submit answers or advance questions');
  app.main();
  app.click('#activity-option-2'); const selected = app.session();
  app.click('#activity-show-words');
  assert.equal(app.get('#activity-main').textContent, '문제로 돌아가기');
  app.main();
  assert.deepEqual(app.session(), selected);
  assert.equal(app.get('#activity-option-2').checked, true);
});

test('word preview resumes before answering and never charges card time as question response time', t => {
  const app = openApp(t); app.click('#home-full-start');
  assert.equal(app.get('#activity-title').textContent, '오늘의 단어');
  app.advance(3000);
  assert.equal(app.session().elapsedMs, 3000);
  assert.equal(app.session().metrics.areaMs.vocabulary, 3000);
  assert.deepEqual(app.session().metrics.responseMs, {});
  app.click('#activity-home');
  const restored = openApp(t, app.snapshot()); restored.click('#home-continue');
  assert.equal(restored.get('#activity-title').textContent, '오늘의 단어');
  restored.main(); restored.advance(2000);
  assert.equal(restored.session().metrics.responseMs[restored.current().entry.key], 2000);
  restored.click('#activity-show-words'); restored.advance(4000); restored.main();
  assert.equal(restored.session().metrics.responseMs[restored.current().entry.key], 2000);
  assert.equal(restored.session().elapsedMs, 9000);
});

test('vocabulary finishes exactly five quizzes before unchanged saved writing and optional review', t => {
  let app = openApp(t); app.startArea('vocabulary'); app.main();
  const seen = [];
  for (let guard=0; app.current().task.kind !== 'practice' && guard<10; guard++) {
    const item=app.current(); seen.push(item.task.id);
    submitCurrent(app,item.task.id==='salt-vocabulary-original-5' && !item.entry.retryOf);
  }
  assert.deepEqual(seen, [1,2,3,4,5].map(n => 'salt-vocabulary-original-' + n));
  assert.equal(app.current().task.kind,'practice');
  assert.equal(app.session().cursor,app.session().queue.length-1,'writing is the final activity');
  assert.equal(app.get('#activity-main').disabled,true);
  app.input('#vocabulary-compose-0','ㄱ'); app.input('#vocabulary-compose-1','ㅇ');
  assert.equal(app.get('#activity-main').disabled,false,'any nonempty text is accepted');
  app.click('#activity-home'); app=openApp(t,app.snapshot()); app.click('#home-continue');
  assert.equal(app.get('#vocabulary-compose-0').value,'ㄱ');
  assert.equal(app.get('#vocabulary-compose-1').value,'ㅇ'); app.main();
  assert.match(app.get('#activity-feedback').textContent,/저장/); app.main();
  assert.equal(app.results().totalQuestions,5); assert.equal(app.results().accuracy,80);
  assert.match(app.get('#vocabulary-result').textContent,/점수 없는 연습/);
  assert.equal(app.document.querySelectorAll('#activity-review details').length,5);
  const source=app.records()[0];
  app.click('#activity-retry-wrong'); assert.deepEqual(app.session().taskIds,['salt-vocabulary-original-5']);
  submitCurrent(app); assert.equal(app.results().accuracy,100);
  assert.deepEqual(app.records().find(r=>r.id===source.id),source);
  assert.equal(app.records().length,2);
});

test('five wrong vocabulary choices survive reload and open the original writing form without extra questions', t => {
  let app=openApp(t); app.startArea('vocabulary'); app.main();
  for (let i=0;i<5;i++) {
    assert.equal(app.current().task.id,'salt-vocabulary-original-'+(i+1));
    assert.match(app.get('.activity-header .muted').textContent,new RegExp(`활용 문제 · ${i+1} / 5문항`));
    app.click('#activity-option-'+((app.current().task.answer+1)%5)); app.main();
    assert.doesNotMatch(app.get('#activity-feedback').textContent,/다음 두 문항/);
    app.main();
    if (i===2) { app.click('#activity-home'); app=openApp(t,app.snapshot()); app.click('#home-continue'); }
  }
  assert.equal(app.current().task.id,'salt-vocabulary-compose');
  assert.equal(app.session().queue.length,6);
  assert.deepEqual(app.current().task.prompts.map(p=>p.word),['굳다','역할']);
  assert.equal(app.get('#activity-title').textContent,'낱말로 문장 만들기');
  app.input('#vocabulary-compose-0','ㄱ'); app.input('#vocabulary-compose-1','ㅇ');
  app.main(); app.main();
  assert.equal(app.results().totalQuestions,5);
  assert.equal(app.results().accuracy,0);
  assert.equal(app.results().reviewAttempts,0);
});

test('unsubmitted vocabulary choice survives home and reload, with next navigation gated', t => {
  const app = openApp(t); app.startArea('vocabulary'); app.main(); // Today's word cards precede the existing questions.
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

test('legacy vocabulary sessions retain 16 meaning and 16 sentence questions and retry behavior', t => {
  const app = openApp(t); app.window.AreaTraining.start('vocabulary'); app.main();
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

test('legacy fluency remains restorable and completes each of normal, speed, and automatic reading once and then its preserved quiz', t => {
  const app = openApp(t); app.evaluate("AreaTraining.start('fluency')");
  const seen = finishArea(app);
  assert.deepEqual(seen.filter(item => item.kind === 'read').map(item => item.mode), ['normal', 'speed', 'auto']);
  assert.equal(seen.filter(item => item.kind === 'choice').length, 3);
  assert.equal(app.results().totalQuestions, 3); assert.equal(app.results().accuracy, 100);
  assert.equal(app.records().length, 1);
});

test('speed reading closes at 60 seconds and automatic reading resumes its sentence without silently running', t => {
  const app = openApp(t); app.evaluate("AreaTraining.start('fluency')"); app.main(); submitCurrent(app);
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

test('reading omits paragraph ordering, structure and relation maps while keeping seven comprehension questions', t => {
  const app = openApp(t); app.startArea('reading');
  const seen = finishArea(app);
  assert.equal(seen.filter(item => item.kind === 'read').length, 1);
  assert.equal(seen.filter(item => item.taskId === 'reading-order').length, 0);
  assert.equal(seen.filter(item => item.taskId === 'reading-structure').length, 0);
  assert.equal(seen.filter(item => item.taskId === 'reading-relations').length, 0);
  assert.equal(seen.filter(item => item.taskId.startsWith('reading-content-')).length, 7);
  assert.equal(app.results().totalQuestions, 9); assert.equal(app.results().accuracy, 100);
  assert.equal(app.records().length, 1);
});

test('passage two skips reading straight to diagnostic and restores the pending question', t => {
  const app = openApp(t); app.startArea('reading'); app.advance(2000);
  const entry = app.current().entry;
  app.click('#activity-skip-read');
  assert.equal(app.current().task.id, 'reading-key');
  assert.equal(app.session().read[entry.key].skipped, true);
  assert.equal(app.session().read[entry.key].done, false);
  assert.equal(app.session().read[entry.key].elapsedMs, 2000);
  assert.equal(app.document.querySelector('#activity-skip-read'), null);
  app.click('#activity-home');
  const restored = openApp(t, app.snapshot()); restored.click('#home-continue');
  assert.equal(restored.current().task.id, 'reading-key');
  assert.equal(restored.get('#activity-main').disabled, true, 'questions still require an answer');
  assert.equal(restored.session().read[entry.key].skipped, true);
});

test('an unfinished prior relation map resumes at comprehension and preserves reading time', t => {
  const app = openApp(t); app.window.AreaTraining.start('readingComprehensionV1NoOrderV1');
  app.advance(1700); app.main(); submitCurrent(app);
  assert.equal(app.current().task.id, 'reading-relations');
  app.click('#activity-structure-slot-2'); app.click('#activity-structure-choice-2');
  const old = app.session();
  const restored = openApp(t, app.snapshot()); restored.click('#home-continue');
  assert.equal(restored.current().task.id, 'reading-content-1');
  assert.equal(restored.session().id, old.id);
  assert.equal(restored.session().elapsedMs, old.elapsedMs);
  assert.deepEqual(Object.values(restored.session().read), Object.values(old.read));
  assert.equal(restored.document.querySelector('.reading-structure-slot'), null);
  assert.equal(restored.document.querySelector('.reading-map-lines'), null);
  const again = openApp(t, restored.snapshot()); again.click('#home-continue');
  assert.deepEqual(again.session(), restored.session());
});

test('each of the seven comprehension quizzes exposes the whole passage and restores choices with the panel folded', t => {
  const app = openApp(t); app.startArea('reading'); app.main();
  while (!app.current().task.id.startsWith('reading-content-')) submitCurrent(app);
  const paragraphs = app.catalog().reading.tasks[0].paragraphs.map(p => p.s.join(' '));
  for (let index = 1; index <= 7; index++) {
    assert.equal(app.current().task.id, 'reading-content-' + index);
    assert.equal(app.get('#reading-reference').open, true);
    assert.deepEqual([...app.document.querySelectorAll('.reading-reference-text .reading-role-paragraph')].map(p => {
      const copy = p.cloneNode(true);
      copy.querySelectorAll('.reading-paragraph-label, .reading-role-badge').forEach(label => label.remove());
      return copy.textContent.trim();
    }), paragraphs);
    assert.match(app.get('.reading-reference-text .reading-key-guide').textContent, /핵심 문장 4\/4 정답/);
    assert.ok(app.get('.reading-reference-text .reading-record'));
    assert.ok(app.get('.reading-question-column').contains(app.get('#activity-main')));
    app.get('#reading-reference').open = false;
    app.click('#activity-option-' + app.current().task.answer);
    if (index === 1) {
      const restored = openApp(t, app.snapshot()); restored.click('#home-continue');
      assert.equal(restored.get('#activity-option-' + restored.current().task.answer).checked, true);
      assert.equal(restored.get('#reading-reference').open, true);
    }
    app.main();
    assert.ok(app.get('.reading-question-evidence').textContent.startsWith('근거: 문장 ' + app.current().task.evidenceSentences.join(', ') + ' — '));
    app.main();
  }
  assert.equal(app.current().task.id, 'reading-outline');
  assert.match(app.get('#activity-title').textContent, /구조화·글쓰기/);
  finishArea(app);
  assert.equal(app.session().status, 'completed');
});

test('comprehension keeps the same passage and its scroll and mobile fold state while moving between questions', t => {
  const app = openApp(t); app.startArea('reading'); app.main();
  while (!app.current().task.comprehensionType) submitCurrent(app);
  app.window.innerWidth = 375;
  const reference = app.get('#reading-reference'), passage = app.get('.reading-reference-text');
  passage.scrollTop = 123; reference.open = false;
  submitCurrent(app);
  assert.equal(app.get('#reading-reference'), reference);
  assert.equal(app.get('.reading-reference-text'), passage);
  assert.equal(passage.scrollTop, 123);
  assert.equal(reference.open, false);
  assert.match(app.get('.reading-question-type').textContent, /사실적 이해/);
  assert.match(app.get('.reading-comprehension-counts').textContent, /사실적 이해 5 · 추론적 이해 2/);
  app.window.innerWidth = 1440; app.window.dispatchEvent(new app.window.Event('resize'));
  assert.equal(reference.open, true);
});

test('seven-question comprehension restores question five and reports fact and inference scores with wrong-only review', t => {
  let app = openApp(t); app.startArea('reading'); app.main();
  while (!app.current().task.comprehensionType) submitCurrent(app);
  for (let i = 0; i < 4; i++) submitCurrent(app);
  const saved = app.session(); app.click('#activity-home');
  app = openApp(t, app.snapshot()); app.click('#home-continue');
  assert.equal(app.current().task.id, 'reading-content-5');
  assert.equal(app.session().id, saved.id);
  assert.deepEqual(app.session().answers, saved.answers);
  assert.match(app.get('.activity-header').textContent, /5 \/ 7문항/);
  assert.equal(app.get('#reading-comprehension-progress').max, 7);
  assert.equal(app.get('#reading-comprehension-progress').value, 4);
  submitCurrent(app); submitCurrent(app, true);
  assert.match(app.get('.reading-question-type').textContent, /추론적 이해/);
  submitCurrent(app); finishArea(app);
  const original = app.records()[0];
  assert.deepEqual(app.results().comprehension, { correct: 6, total: 7, answered: 7,
    fact: { correct: 5, total: 5, answered: 5 }, inference: { correct: 1, total: 2, answered: 2 } });
  assert.deepEqual([...app.get('#reading-comprehension-result').querySelectorAll('td')].map(td => td.textContent), ['6 / 7', '5 / 5', '1 / 2']);
  app.click('#activity-retry-wrong');
  assert.deepEqual(app.session().taskIds, ['reading-content-6']);
  assert.ok(app.get('#reading-reference'));
  app.click('#activity-option-1');
  const retry = openApp(t, app.snapshot()); retry.click('#home-continue');
  assert.equal(retry.get('#activity-option-1').checked, true);
  retry.main(); retry.main();
  assert.equal(retry.results().comprehension.correct, 1);
  assert.equal(retry.records().length, 2);
  assert.deepEqual(retry.records().find(record => record.id === original.id), original);
});

test('completed old structure results stay readable and removed questions are excluded from review', t => {
  const app = openApp(t); app.window.AreaTraining.start('readingComprehensionV1NoOrderV1');
  finishArea(app, 'reading-relations');
  const original = app.records()[0]; assert.equal(app.results().wrong, 1);
  assert.equal(app.document.querySelector('#activity-retry-wrong'), null);
  assert.equal(app.results().totalQuestions, 13);
  const restored = openApp(t, app.snapshot());
  assert.deepEqual(restored.records()[0], original);
  restored.window.AreaTraining.showReport(original.session);
  assert.equal(restored.document.querySelector('#activity-retry-wrong'), null);
  restored.click('#activity-retry-area');
  assert.equal(restored.session().area, 'readingDiagnosticV3');
  assert.deepEqual(restored.records()[0], original);
});

test('old reading sessions skip removed structure activities and completed records remain readable', t => {
  const old = openApp(t); old.window.AreaTraining.start('reading'); old.main();
  old.click('#activity-paragraph-0'); const draft = old.session();
  const restored = openApp(t, old.snapshot()); restored.click('#home-continue');
  assert.equal(restored.session().id, draft.id); assert.equal(restored.session().area, 'readingNoStructureV2');
  assert.equal(restored.current().task.id, 'reading-content-1');
  assert.equal(restored.session().taskIds.length, 5);
  assert.deepEqual(restored.session().answers, {});
  finishArea(restored); assert.equal(restored.results().totalQuestions, 4);
  const completed = restored.records()[0]; restored.click('#activity-retry-area');
  assert.equal(restored.session().area, 'readingDiagnosticV3');
  assert.deepEqual(restored.records()[0], completed);
});

test('passage two follows read -> diagnostic -> seven questions -> structure and writing with locked previous answers', t => {
  const app = openApp(t); app.startArea('reading'); app.advance(2000);
  assert.equal(app.get('#activity-main').textContent, '다 읽었어요 · 정밀검사'); app.main();
  assert.equal(app.current().task.id, 'reading-key');
  assert.equal(app.get('#activity-title').textContent, '정밀검사');
  assert.match(app.get('#reading-diagnostic-record').textContent, /읽은 시간 0분 2초/);
  assert.equal(app.document.querySelector('.reading-order-slots'), null);
  assert.equal(app.document.querySelector('.reading-structure-slot'), null);
  submitCurrent(app); assert.equal(app.current().task.id, 'reading-content-1');
  const question = submitCurrent(app);
  assert.equal(app.current().task.id, 'reading-content-2');
  app.click('#activity-prev'); assert.equal(app.current().task.id, question.task.id);
  assert.equal(app.get('#activity-option-' + question.task.answer).disabled, true);
  app.main(); assert.equal(app.current().task.id, 'reading-content-2');
  while (app.current().task.comprehensionType) submitCurrent(app);
  assert.equal(app.current().task.id, 'reading-outline');
  submitCurrent(app); assert.equal(app.current().task.id, 'reading-summary');
  finishArea(app);
  assert.ok(app.session().queue.every(entry => !['reading-order', 'reading-structure', 'reading-relations', 'reading-concept', 'reading-recall-0', 'reading-recall-1'].includes(entry.taskId)));
  assert.deepEqual(app.results().diagnostic, { readingMs: 2000, skipped: false, answered: true, correct: 4, total: 4 });
  assert.match(app.get('#reading-diagnostic-result').textContent, /핵심 문장 4\/4개 정답/);
});

test('an unfinished previous seven-question order screen resumes at comprehension after reload without resetting reading', t => {
  const app = openApp(t); app.window.AreaTraining.start('readingReadinV3'); app.advance(1700); app.main();
  assert.equal(app.current().task.id, 'reading-order');
  app.click('#activity-paragraph-2'); const old = app.session();
  const restored = openApp(t, app.snapshot()); restored.click('#home-continue');
  assert.equal(restored.current().task.id, 'reading-content-1');
  assert.equal(restored.session().id, old.id);
  assert.equal(restored.session().elapsedMs, old.elapsedMs);
  assert.deepEqual(Object.values(restored.session().read), Object.values(old.read));
  assert.ok(restored.session().taskIds.every(id => !['reading-order', 'reading-structure', 'reading-relations'].includes(id)));
  assert.equal(restored.document.querySelector('.reading-order-slots'), null);
  assert.doesNotMatch(restored.get('.course-stage-list [data-area="reading"]').textContent, /문단 탭 순서|구조 파악|관계 연결/);
});

test('new area clock pauses on home and menu, and never charges time to the saved legacy lesson', t => {
  const app = openApp(t); const original = app.legacy();
  app.startArea('vocabulary'); if (app.document.querySelector('.vocabulary-study')) app.main(); app.advance(3000);
  const beforeMenu = app.session().elapsedMs; assert.equal(beforeMenu, 3000);
  app.click('#menu-button'); app.advance(5000); assert.equal(app.session().elapsedMs, beforeMenu);
  app.click('#menu-close'); app.advance(2000); assert.equal(app.session().elapsedMs, beforeMenu + 2000);
  app.click('#activity-home'); app.advance(4000); assert.equal(app.session().elapsedMs, beforeMenu + 2000);
  assert.equal(app.legacy().elapsedMs, original.elapsedMs, 'legacy interval must remain paused during area study');
  app.click('#menu-button'); app.click('#menu-continue'); visible(app, '#activity-panel');
  app.advance(2000); assert.equal(app.session().elapsedMs, beforeMenu + 4000);
});

test('full course draft and new area draft coexist across home navigation and reload', t => {
  const app = openApp(t); app.click('#menu-button'); app.click('#menu-legacy');
  app.input('#comp0', '기존 학습에서 소금이 굳었어요.'); app.click('#vq2_3');
  const legacy = app.legacy(); app.click('#learning-home');
  app.startArea('vocabulary'); app.main(); app.click('#activity-option-0'); const area = app.session();
  assert.deepEqual(app.legacy().draft, legacy.draft);
  app.click('#activity-home');
  const restored = openApp(t, app.snapshot()); restored.click('#menu-button'); restored.click('#menu-legacy');
  visible(restored, '#s1'); hidden(restored, '#activity-panel');
  assert.equal(restored.legacy().id, legacy.id); assert.equal(restored.get('#comp0').value, legacy.draft.compose[0]);
  assert.equal(restored.get('#vq2_3').checked, true);
  restored.click('#learning-home'); restored.startArea('vocabulary');
  assert.equal(restored.session().id, area.id); assert.deepEqual(restored.session().answers, area.answers);
  assert.equal(restored.get('#activity-option-0').checked, true);
});

test('historical area result and unified history leave an unfinished area untouched and menu continue restores it', t => {
  const app = openApp(t); app.startArea('reading'); finishArea(app);
  const recordId = app.session().id;
  app.click('#activity-home'); app.startArea('vocabulary'); app.main(); app.click('#activity-option-2');
  app.advance(3000); app.click('#activity-home'); const current = app.session();
  app.click('#recent-list .record-card button'); visible(app, '#activity-result');
  assert.equal(app.document.querySelectorAll('#activity-review details').length, 9);
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
  const app = openApp(t); app.startArea('reading'); finishArea(app, 'reading-content-1');
  const source = app.records()[0]; assert.equal(app.results().wrong, 1);
  app.click('#activity-retry-wrong');
  assert.equal(app.session().reviewOf, source.id);
  assert.deepEqual(app.session().taskIds, ['reading-content-1']);
  const seen = finishArea(app); assert.equal(seen.length, 1);
  assert.equal(app.results().totalQuestions, 1); assert.equal(app.results().accuracy, 100);
  assert.equal(app.records().length, 2);
  assert.deepEqual(app.records().find(record => record.id === source.id), source);
  app.click('#activity-retry-area');
  assert.equal(app.session().reviewOf, null); assert.equal(app.current().task.id, 'reading-passage');
  assert.equal(app.session().taskIds.length, 11); assert.equal(app.records().length, 2);
});

test('switching unfinished areas can be cancelled without losing answers and confirmed replacement keeps records', t => {
  const app = openApp(t); app.startArea('vocabulary'); app.main(); app.click('#activity-option-3');
  app.click('#activity-home'); const original = app.session(); app.startArea('reading');
  assert.equal(app.get('#confirm-dialog').open, true); assert.equal(app.session().id, original.id);
  app.click('#confirm-no'); assert.deepEqual(app.session(), original);
  app.startArea('reading'); app.click('#confirm-yes');
  assert.equal(app.session().area, 'readingDiagnosticV3'); assert.notEqual(app.session().id, original.id);
  assert.equal(app.records().length, 0); visible(app, '#activity-panel');
});

test('failed completion persistence retains the result and prevents retry replacement until saving works', t => {
  const app = openApp(t); app.startArea('reading');
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

test('reading recall keeps partial drafts and explicit confidence, locks submissions and reports prediction separately', t => {
  const app = openApp(t); app.window.AreaTraining.start('readingComprehensionV1NoStructureV2'); app.main();
  while (app.current().task.id !== 'reading-concept') submitCurrent(app);
  app.main(); assert.equal(app.current().task.id, 'reading-recall-0');
  app.input('#reading-recall-answer', '중심문장'); assert.equal(app.get('#activity-main').disabled, true);
  const restored = openApp(t, app.snapshot()); restored.click('#home-continue');
  assert.equal(restored.get('#reading-recall-answer').value, '중심문장');
  restored.input('#reading-recall-confidence', 'unknown'); restored.main();
  assert.equal(restored.get('#reading-recall-answer').disabled, true);
  assert.match(restored.get('#activity-feedback').textContent, /모름 → 정답/); restored.main();
  restored.input('#reading-recall-answer', '중심 문장'); restored.input('#reading-recall-confidence', 'sure');
  restored.main(); restored.main(); finishArea(restored);
  assert.match(restored.get('#reading-detail-result').textContent, /개념 인출 1\/2 · 확신도 점검 0% · 착각 1 · 과소평가 1/);
  const source = restored.records()[0]; restored.click('#activity-retry-wrong');
  assert.deepEqual(restored.session().taskIds, ['reading-recall-1']); finishArea(restored);
  assert.equal(restored.results().accuracy, 100);
  assert.deepEqual(restored.records().find(r => r.id === source.id), source);
});

test('diagnostic selects a core sentence per paragraph and the later outline classifies roles in one passage', t => {
  let app = openApp(t); app.startArea('reading'); app.main();
  assert.equal(app.current().task.id, 'reading-key');
  assert.equal(app.document.querySelectorAll('.reading-key-passage').length, 1);
  assert.equal(app.document.querySelectorAll('.reading-role-sentence').length, 17);
  assert.equal(app.document.querySelector('.reading-sentence-group'), null);
  assert.equal(app.document.querySelector('.reading-role-picker'), null);
  app.click('#reading-key-0'); assert.equal(app.get('#reading-key-0').getAttribute('aria-pressed'), 'true');
  app.click('#reading-key-1');
  assert.equal(app.get('#reading-key-0').getAttribute('aria-pressed'), 'false');
  assert.equal(app.get('#reading-key-1').getAttribute('aria-pressed'), 'true');
  const saved = app.session(); app = openApp(t, app.snapshot()); app.click('#home-continue');
  assert.deepEqual(app.session().answers, saved.answers);
  app.click('#reading-key-1'); assert.equal(app.get('#reading-key-1').getAttribute('aria-pressed'), 'false');
  submitCurrent(app);
  while (app.current().task.comprehensionType) submitCurrent(app);
  assert.equal(app.current().task.id, 'reading-outline');
  assert.equal(app.document.querySelectorAll('.reading-role-passage').length, 1);
  assert.equal(app.get('#reading-role-0').disabled, true);
  app.click('#reading-role-sentence-0'); app.click('#reading-role-0');
  app.click('#reading-role-sentence-1'); assert.equal(app.get('#reading-role-0').disabled, true);
  assert.equal(app.document.querySelector('.reading-role-groups .reading-role-item p').textContent, '우리가 먹는 음식에는 대부분 소금이 들어 있어요.');
  app.click('#reading-role-remove-0'); assert.equal(app.document.querySelector('#reading-role-sentence-0 .reading-role-badge'), null);
  app.click('#reading-role-sentence-0'); app.click('#reading-role-0');
  const again = openApp(t, app.snapshot()); again.click('#home-continue');
  assert.equal(again.get('#reading-role-sentence-0 .reading-role-badge').textContent, '처음');
  again.click('#reading-selection-reset'); submitCurrent(again, true);
  again.click('#activity-prev');
  assert.equal(again.get('#reading-role-sentence-0').disabled, true); again.main();
  finishArea(again);
  assert.equal(again.results().wrong, 1); assert.match(again.get('#reading-detail-result').textContent, /1\/5/);
  again.click('#activity-retry-wrong'); assert.deepEqual(again.session().taskIds, ['reading-outline']); finishArea(again);
  assert.equal(again.results().accuracy, 100);
});

test('diagnostic marks unselected answers blue, correct selections green and incorrect selections red', t => {
  const app = openApp(t); app.startArea('reading'); app.main();
  [1, 3, 10, 14].forEach(id => app.click('#reading-key-' + id)); app.main();
  assert.match(app.get('.reading-key-guide').textContent, /핵심 문장 1\/4 정답/);
  assert.equal(app.get('#reading-key-0').classList.contains('key-answer'), true);
  assert.equal(app.get('#reading-key-1').classList.contains('key-incorrect'), true);
  assert.equal(app.get('#reading-key-3').classList.contains('key-correct'), true);
  assert.match(app.get('.reading-key-legend').textContent, /파랑 = 정답.*초록 = 맞게 고름.*빨강 = 잘못 고름/);
  assert.equal(app.get('#reading-key-1').disabled, true);
  assert.equal(app.document.querySelector('.reading-role-picker'), null);
  assert.equal(app.get('#activity-main').textContent, '이해도 테스트 시작');
  app.main(); assert.equal(app.current().task.id, 'reading-content-1');
});

test('summary preserves escaped writing and the reference passage, enforces original 40-character minimum and stays ungraded', t => {
  const app = openApp(t); app.startArea('reading'); app.main();
  while (app.current().task.kind !== 'summary') { if (app.current().task.kind === 'read') app.main(); else submitCurrent(app); }
  app.input('#reading-summary-answer', '짧은 요약'); assert.equal(app.get('#activity-main').disabled, true);
  const text = '<img src=x onerror=alert(1)> 우리가 먹는 소금은 바다와 땅속에서 얻으며, 소금은 맛을 내고 음식을 보관하는 데 사용한다.';
  app.input('#reading-summary-answer', text);
  const restored = openApp(t, app.snapshot()); restored.click('#home-continue');
  assert.equal(restored.get('#reading-summary-answer').value, text); assert.equal(restored.get('#reading-reference').open, true);
  restored.main(); assert.equal(restored.get('#reading-summary-answer').disabled, true);
  assert.match(restored.get('#activity-feedback').textContent, /의미·문법·글의 완성도를 평가하지 않습니다/);
  restored.main(); assert.equal(restored.results().totalQuestions, 9); assert.equal(restored.results().accuracy, 100);
  assert.equal(restored.get('.reading-saved-summary').textContent, text);
  assert.equal(restored.document.querySelector('.reading-saved-summary img'), null);
  assert.equal(restored.document.querySelector('#activity-retry-wrong'), null);
});


test('an existing diagnostic draft reloads in the unified passage without resetting answers or reading time', t => {
  const old = openApp(t); old.window.AreaTraining.start('readingDiagnosticV1'); old.advance(1200); old.main();
  old.click('#reading-key-0'); const original = old.session();
  const restored = openApp(t, old.snapshot()); restored.click('#home-continue');
  assert.equal(restored.session().area, 'readingDiagnosticV3');
  assert.equal(restored.session().id, original.id); assert.deepEqual(restored.session().answers, original.answers);
  assert.equal(restored.session().elapsedMs, original.elapsedMs);
  assert.equal(restored.get('#reading-key-0').getAttribute('aria-pressed'), 'true');
  assert.equal(restored.document.querySelectorAll('.reading-key-passage').length, 1);
  assert.equal(restored.session().read['base-1'].trace, undefined);
  assert.match(restored.get('.reading-record').textContent, /기록 없음/);
});

test('reading trace follows observed paragraphs and backward movement, survives reload and excludes idle pointer time', t => {
  let app = openApp(t); app.startArea('reading');
  const paragraphEvent = (index, type) => app.get(`p[data-reading-paragraph="${index}"]`).dispatchEvent(new app.window.Event(type));
  app.advance(1000);
  paragraphEvent(0, 'pointermove'); app.advance(1000);
  paragraphEvent(1, 'pointerdown'); app.advance(1000);
  paragraphEvent(0, 'pointermove'); app.advance(1000);
  paragraphEvent(0, 'pointerleave'); app.advance(1000);
  assert.deepEqual(app.session().read['base-1'].trace, { paragraphMs: [2000, 1000, 0, 0], regressions: 1, lastParagraph: 0 });
  const saved = app.session(); app = openApp(t, app.snapshot()); app.click('#home-continue');
  assert.deepEqual(app.session().read['base-1'].trace, saved.read['base-1'].trace);
  app.advance(1000);
  assert.equal(app.session().read['base-1'].elapsedMs, 6000);
  assert.deepEqual(app.session().read['base-1'].trace, saved.read['base-1'].trace, 'reload does not invent pointer dwell');
  app.main();
  assert.deepEqual([...app.get('.reading-record-metrics').querySelectorAll('dt')].map(node => node.textContent), ['읽은 시간', '읽기 속도', '역행', '체류 포착률']);
  const values = [...app.get('.reading-record-metrics').querySelectorAll('dd')].map(node => node.textContent);
  assert.equal(values[0], '0분 6초'); assert.match(values[1], /글자\/분/);
  assert.equal(values[2], '1회'); assert.equal(values[3], '50%');
  assert.deepEqual([...app.get('.reading-record-dwell').querySelectorAll('dd')].map(node => node.textContent), ['2.0초', '1.0초', '0.0초', '0.0초']);
  assert.match(app.get('.reading-record').textContent, /포인터·터치 기준의 데모 대체 지표/);
  assert.match(app.get('.reading-record').textContent, /글자 수 대비 가장 오래 머문 문단: 도입/);
});
