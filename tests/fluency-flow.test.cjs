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
  let blockedKeys = new Set();
  window.Storage.prototype.setItem = function (key, value) {
    if (blockedKeys.has(key)) throw new window.DOMException('No storage space', 'QuotaExceededError');
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
    snapshot: () => Object.fromEntries(Array.from({ length: window.localStorage.length }, (_, i) => { const key = window.localStorage.key(i); return [key, window.localStorage.getItem(key)]; })),
    input(selector, value) {
      const node = get(selector); assert.equal(node.disabled, false); assert.equal(node.closest('[hidden]'), null);
      node.value = value; node.dispatchEvent(new window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    },
    advance(ms) {
      const end = clock + ms;
      while (clock < end) {
        clock = Math.min(end, clock + 100);
        for (const timer of [...intervals.values()]) if (clock - timer.last >= timer.delay) { timer.last = clock; timer.callback(); }
      }
    }
  };
}

function question(app, wrong = false) {
  if (app.document.querySelector('.vocabulary-study')) app.main();
  const {task,entry}=app.current();
  assert.notEqual(task.kind,'read');
  app.advance(300);
  if(task.kind==='order') (wrong ? task.answer.slice().reverse() : task.answer).forEach(id=>app.click(`#activity-paragraph-${id}`));
  else if (task.kind==='relations') task.answer.forEach((value,index)=>{app.click(`#activity-structure-slot-${index}`); app.click(`#activity-structure-choice-${wrong ? (value+1)%task.links[index].options.length : value}`);});
  else if (task.kind === 'recall') { app.input('#reading-recall-answer', task.answer); app.input('#reading-recall-confidence', 'sure'); }
  else if (task.kind === 'cloze') task.blanks.forEach((blank, i) => { app.input('#fluency-cloze-answer-' + i, wrong && i === 0 ? '틀린 답' : blank.answer); app.input('#fluency-cloze-confidence-' + i, 'sure'); });
  else if (task.kind === 'selection') {
    if (task.display === 'sentence-roles') {
      let offset = 0;
      task.groups.forEach((group, groupIndex) => { for (let i = 0; i < group.capacity; i++) { app.click('#reading-role-sentence-' + task.answer[offset++]); app.click('#reading-role-' + groupIndex); } });
    } else if (task.selectionType === 'key') task.answer.forEach(id => app.click('#reading-key-' + id));
    else { let offset = 0; task.groups.forEach(group => { const start = offset; for (let i = 0; i < group.capacity; i++) { app.click('#reading-outline-sentence-' + task.answer[offset++]); app.click('#reading-outline-slot-' + start); } }); }
  }
  else app.click(`#activity-option-${wrong ? (task.answer+1)%task.options.length : task.answer}`);
  app.main();
  assert.equal(app.session().submitted[entry.key].correct,!wrong);
  app.main();
}

function readConceptStage(app) {
  const { task } = app.current(); app.main();
  if (task.mode === 'tap') task.units.forEach(() => { app.advance(100); app.click('#fluency-tap'); });
  else app.advance(task.units.length * task.displayInterval);
  if (task.stage === 1 && app.session().area === 'fluencyConceptV2') {
    assert.equal(app.current().task.kind, 'read'); assert.equal(app.current().task.stage, 2);
    assert.equal(app.document.querySelectorAll('.fluency-cloze-field').length, 0);
  } else {
    assert.equal(app.current().task.kind, 'cloze'); assert.equal(app.current().task.quizStage, task.stage);
  }
  assert.equal(app.document.querySelectorAll('#activity-panel .activity-option input[type="radio"]').length, 0);
}

test('home passage one runs stage 1 -> stage 2 -> five final blanks without intermediate questions', t => {
  const app = openApp(t); app.startArea('fluency');
  assert.equal(app.session().area, 'fluencyConceptV2');
  assert.match(app.current().task.source, /중심 문장을 자세히 설명하거나 예를 드는 문장은 뒷받침 문장/);
  readConceptStage(app);
  assert.equal(app.current().task.stage, 2);
  assert.equal(app.current().task.display, 'masked-phrases');
  assert.equal(app.document.querySelectorAll('.fluency-cloze-field').length, 0);
  readConceptStage(app); question(app);
  assert.equal(app.session().status, 'completed'); assert.equal(app.results().totalQuestions, 5);
  assert.equal(app.results().accuracy, 100); assert.deepEqual(app.results().fluency.completedStages, [1, 2]);
  assert.match(app.get('#fluency-result').textContent, /읽기 2 \/ 2단계 완료/);
  assert.match(app.get('#fluency-result').textContent, /Stage 2 ·/);
  assert.doesNotMatch(app.get('#fluency-result').textContent, /Stage 3 ·/);
});

test('concept blank text and confidence survive reload, cannot submit early and produce per-blank feedback before continuing', t => {
  let app = openApp(t); app.startArea('fluency'); app.click('#activity-skip-read');
  assert.equal(app.current().task.stage, 2); app.click('#activity-skip-read');
  assert.equal(app.current().task.kind, 'cloze');
  app.input('#fluency-cloze-answer-0', '중심문장'); app.input('#fluency-cloze-confidence-0', 'sure');
  app.input('#fluency-cloze-answer-1', '다른 문장');
  assert.equal(app.get('#activity-main').disabled, true);
  app = openApp(t, app.snapshot()); app.click('#home-continue');
  assert.equal(app.get('#fluency-cloze-answer-0').value, '중심문장');
  assert.equal(app.get('#fluency-cloze-confidence-0').value, 'sure');
  assert.equal(app.get('#fluency-cloze-answer-1').value, '다른 문장');
  assert.equal(app.get('#fluency-cloze-confidence-1').value, 'maybe');
  app.current().task.blanks.slice(2).forEach((blank, i) => app.input('#fluency-cloze-answer-' + (i + 2), blank.answer));
  app.main(); assert.match(app.get('.fluency-cloze-feedback').textContent, /빈칸 2: 다른 문장 · 정답: 뒷받침 문장/);
  assert.equal(app.get('#fluency-cloze-answer-0').disabled, true);
  app.main();
  assert.equal(app.results().correct, 4); assert.equal(app.results().accuracy, 80);
  assert.match(app.get('#fluency-result').textContent, /건너뜀 2단계/);
  assert.doesNotMatch(app.get('#fluency-result').textContent, /분당/);
});

test('new full course keeps vocabulary and passage three while its fluency contains only concept reading and blanks', t => {
  const app = openApp(t); app.click('#home-full-start');
  assert.equal(app.session().area, 'courseDiagnosticV3');
  finishCourse(app, true);
  assert.equal(app.results().totalQuestions, 19); assert.equal(app.results().wrong, 0);
  assert.equal(app.results().fluency.total, 5); assert.equal(app.results().areas.vocabulary.total, 5); assert.equal(app.results().areas.reading.total, 9);
  assert.equal(Object.values(app.session().read).filter(read => read.skipped).length, 3);
  assert.equal(app.records().length, 1);
  const restored = openApp(t, app.snapshot()); assert.deepEqual(restored.records(), app.records());
});

test('one home entry runs all three stages in order and resumes the same course after reloading each stage', t => {
  let app = openApp(t); app.click('#home-full-start');
  const id = app.session().id, stages = [];
  const labels = ['1단계 · 어휘력', '2단계 · 지문 1', '3단계 · 지문 2'];
  for (let guard = 0; guard < 80 && app.session().status === 'active'; guard++) {
    const area = app.window.AreaTraining.currentArea();
    if (stages.at(-1) !== area) {
      stages.push(area);
      assert.equal(app.get('.course-steps [aria-current="step"]').textContent, labels[stages.length - 1]);
      app.click('#activity-home');
      assert.match(app.get('#home-full-start').textContent, /맞춤형 훈련 이어하기/);
      assert.equal(app.get('#course-status').textContent, `${stages.length}단계 진행 중`);
      const saved = app.session();
      app = openApp(t, app.snapshot()); app.click('#home-full-start');
      assert.equal(app.get('#confirm-dialog').open, false);
      assert.deepEqual(app.session(), saved, 'unified resume preserves answers, cursor and reading progress');
    }
    assert.equal(app.session().id, id);
    const { task } = app.current();
    if (task.kind === 'read') app.click('#activity-skip-read');
    else if (task.kind === 'practice') {
      app.input('#vocabulary-compose-0', '소금이 단단하게 굳었어요.');
      app.input('#vocabulary-compose-1', '소금은 중요한 역할을 해요.');
      app.main(); app.main();
    } else if (task.kind === 'summary') {
      app.input('#reading-summary-answer', task.source); app.main(); app.main();
    } else question(app);
  }
  assert.deepEqual(stages, ['vocabulary', 'fluency', 'reading']);
  assert.equal(app.session().status, 'completed');
  assert.equal(app.results().totalQuestions, 19);
  assert.equal(app.results().accuracy, 100);
  assert.equal(app.records().length, 1);
  const record = app.records()[0];
  app.click('#activity-home'); assert.equal(app.get('#today-progress').value, 3);
  assert.match(app.get('#home-full-start').textContent, /맞춤형 훈련 시작/);
  app.click('#home-full-start');
  assert.notEqual(app.session().id, id);
  assert.equal(app.window.AreaTraining.currentArea(), 'vocabulary');
  assert.deepEqual(app.records(), [record], 'new course keeps the completed record');
});

test('switching an older fluency session to the new home entry asks before replacement and cancellation preserves its answers', t => {
  const app = openApp(t); app.window.AreaTraining.start('fluencyIntegratedV1');
  app.click('#activity-skip-read'); app.click('#activity-option-2');
  const original = app.session(); app.click('#activity-home'); app.click('#home-full-start');
  assert.equal(app.get('#confirm-dialog').open, true); app.click('#confirm-no');
  assert.deepEqual(app.session(), original);
  app.click('#home-full-start'); app.click('#confirm-yes');
  assert.equal(app.session().area, 'courseDiagnosticV3'); assert.equal(app.window.AreaTraining.currentArea(), 'vocabulary');
});

test('previous concept session reloads its cloze and the unified course confirms replacement', t => {
  let app = openApp(t); app.window.AreaTraining.start('fluencyConceptV1');
  app.click('#activity-skip-read'); app.input('#fluency-cloze-answer-0', '중심 문장');
  const original = app.session(); app = openApp(t, app.snapshot()); app.click('#home-continue');
  assert.deepEqual(app.session(), original); assert.equal(app.current().task.quizStage, 1);
  assert.equal(app.get('#fluency-cloze-answer-0').value, '중심 문장');
  app.click('#activity-home'); app.click('#home-full-start');
  assert.equal(app.get('#confirm-dialog').open, true); app.click('#confirm-no');
  assert.deepEqual(app.session(), original);
  app.click('#home-full-start'); app.click('#confirm-yes');
  assert.equal(app.session().area, 'courseDiagnosticV3'); assert.equal(app.window.AreaTraining.currentArea(), 'vocabulary');
});
function readStage(app) {
  const {task,entry}=app.current();
  assert.ok(task.stage);
  app.main();
  if(task.mode==='tap') {
    for(let i=0;i<task.units.length;i++) { app.advance(100); app.click('#fluency-tap'); }
    assert.equal(app.get('#fluency-tap').disabled,true);
    assert.equal(app.get('#fluency-stage-progress').value,task.units.length);
    app.main();
  } else {
    app.advance(task.units.length*task.displayInterval);
    assert.equal(app.session().read[entry.key].done,true);
    assert.notEqual(app.current().entry.key,entry.key,'automatic stages immediately enter their quiz');
  }
}
function finishCourse(app, skipReads = false) {
  let guard=0;
  while(app.session().status==='active' && guard++<80) {
    const {task}=app.current();
    if(skipReads && task.kind==='read') app.click('#activity-skip-read');
    else if(task.stage) readStage(app);
    else if(task.kind==='read') app.main();
    else if(task.kind==='practice') {
      app.input('#vocabulary-compose-0', '말랑한 반죽이 시간이 지나 단단하게 굳었어요.');
      app.input('#vocabulary-compose-1', '소금은 음식의 맛을 내는 역할을 해요.');
      app.main(); app.main();
    }
    else if (task.kind === 'summary') { app.input('#reading-summary-answer', task.source); app.main(); app.main(); }
    else question(app, task.id==='salt-fluency-v1-quiz-1' || task.quizType==='process');
  }
  assert.equal(app.session().status,'completed');
}

test('saved legacy full course completes vocabulary -> fluency stages -> quiz -> reading -> integrated report, history and review', t=>{
  const app=openApp(t); app.window.AreaTraining.start('courseReadingReadinV2');
  assert.equal(app.session().area,'courseReadingReadinV2'); assert.equal(app.current().task.trainingArea,'vocabulary');
  finishCourse(app);
  assert.equal(app.document.title,'맞춤형 훈련 결과 · 읽는 힘');
  assert.equal(app.results().totalQuestions,22); assert.equal(app.results().wrong,2);
  assert.equal(app.document.querySelectorAll('.course-results .report-stat').length,3);
  assert.match(app.get('#fluency-result').textContent,/완료 Stage 3 \/ 3/);
  assert.match(app.get('#fluency-result').textContent,/빈칸 맞추기/);
  assert.match(app.get('#fluency-result').textContent,/소금 얻는 과정 확인하기/);
  assert.match(app.get('#activity-recommendation').textContent,/읽기 유창성/);
  assert.equal(app.records().length,1);
  const id=app.session().id; app.click('#activity-home');
  assert.equal(app.get('#today-progress').value,3);
  assert.match(app.get('#recent-list').textContent,/맞춤형 훈련/);
  const restored=openApp(t,app.snapshot());
  assert.equal(restored.records().length,1); assert.equal(restored.records()[0].id,id);
  restored.click('#recent-list .record-card button'); restored.click('#activity-retry-wrong');
  assert.deepEqual(restored.session().taskIds,['salt-fluency-v1-quiz-1','salt-fluency-v3-process-choice']);
  assert.match(restored.get('.activity-header').textContent,/Stage 1 \/ 3 · 읽기 퀴즈 · 1 \/ 1문항/);
  question(restored);
  assert.match(restored.get('.activity-header').textContent,/Stage 2 \/ 3 · 읽기 퀴즈 · 1 \/ 1문항/);
  question(restored);
  assert.equal(restored.session().status,'completed'); assert.equal(restored.results().accuracy,100);
  assert.equal(restored.records().length,2); assert.equal(restored.records().find(r=>r.id===id).session.status,'completed');
  assert.match(restored.get('#fluency-result').textContent,/오답 문항만 복습/);
  assert.doesNotMatch(restored.get('#fluency-result').textContent,/Stage 0/);
});

test('tap stage starts hidden, restores exact token and tap metrics, and card continue retains full course', t=>{
  const app=openApp(t); app.window.AreaTraining.start('fluencyIntegratedV1');
  assert.equal(app.session().area,'fluencyIntegratedV1');
  assert.equal(app.document.querySelector('#fluency-tap'),null);
  const before=app.session().elapsedMs; app.advance(3000); assert.equal(app.session().elapsedMs,before);
  app.main(); app.advance(400); app.click('#fluency-tap'); app.advance(600); app.click('#fluency-tap');
  assert.equal(app.get('#fluency-stage-progress').value,2);
  app.click('#activity-home'); const s=app.session();
  const restored=openApp(t,app.snapshot()); restored.window.AreaTraining.start('fluencyIntegratedV1');
  assert.equal(restored.session().id,s.id); assert.equal(restored.get('#fluency-stage-progress').value,2);
  assert.deepEqual(restored.session().read['base-1'].tapIntervals,[400,600]);
  assert.equal(restored.document.querySelectorAll('.fluency-token.is-read').length,2);
  restored.click('#fluency-tap'); assert.equal(restored.get('#fluency-stage-progress').value,3);
});

test('auto stage resumes paused at the same word and the main action cannot advance or count time in home/menu/hidden tab', t=>{
  const app=openApp(t); app.window.AreaTraining.start('fluencyIntegratedV1'); readStage(app); question(app);
  assert.equal(app.current().task.stage,2); app.main(); app.advance(3600);
  assert.equal(app.get('#fluency-stage-progress').value,3);
  app.click('#fluency-play'); const paused=app.session().elapsedMs; const word=app.get('#fluency-text').textContent;
  app.advance(5000); assert.equal(app.session().elapsedMs,paused); assert.equal(app.get('#activity-main').disabled,true);
  const restored=openApp(t,app.snapshot()); restored.click('#home-continue');
  assert.equal(restored.get('#fluency-text').textContent,word); assert.equal(restored.get('#fluency-stage-progress').value,3);
  restored.advance(4000); assert.equal(restored.session().elapsedMs,paused);
  restored.click('#fluency-play'); restored.advance(1200); assert.equal(restored.get('#fluency-stage-progress').value,4);
  restored.click('#menu-button'); const atMenu=restored.session().elapsedMs; restored.advance(4000); restored.click('#menu-close');
  restored.advance(3000); assert.equal(restored.session().elapsedMs,atMenu,'closing menu does not silently restart auto reading');
  restored.click('#fluency-play'); restored.advance(1200);
  Object.defineProperty(restored.document,'hidden',{configurable:true,value:true});
  restored.document.dispatchEvent(new restored.window.Event('visibilitychange'));
  const atHidden=restored.session().elapsedMs; restored.advance(9000);
  Object.defineProperty(restored.document,'hidden',{configurable:true,value:false});
  restored.document.dispatchEvent(new restored.window.Event('visibilitychange')); restored.advance(2000);
  assert.equal(restored.session().elapsedMs,atHidden);
});

test('read skip works before starting and during automatic stages, restores quizzes and reports skipped readings separately', t => {
  let app = openApp(t); app.window.AreaTraining.start('fluencyIntegratedV1');
  app.click('#activity-skip-read');
  assert.equal(app.current().task.quizStage, 1);
  assert.equal(app.session().read['base-1'].skipped, true);
  assert.equal(app.session().read['base-1'].started, false);
  assert.equal(app.document.querySelector('#activity-skip-read'), null);
  app = openApp(t, app.snapshot()); app.click('#home-continue');
  assert.equal(app.current().task.quizStage, 1); question(app);
  for (const stage of [2, 3]) {
    assert.equal(app.current().task.stage, stage);
    app.main(); app.advance(2400);
    const { entry } = app.current(), partial = app.session().read[entry.key];
    app.click('#activity-skip-read');
    assert.equal(app.current().task.quizStage, stage);
    assert.deepEqual(app.session().read[entry.key], { ...partial, skipped: true });
    app.advance(5000);
    assert.equal(app.current().task.quizStage, stage, 'the old automatic timer cannot advance a quiz');
    assert.equal(app.session().read[entry.key].elapsedMs, partial.elapsedMs);
    while (app.session().status === 'active' && app.current().task.quizStage === stage) question(app);
  }
  assert.equal(app.session().status, 'completed'); assert.equal(app.results().totalQuestions, 6);
  assert.deepEqual(app.results().fluency.completedStages, []);
  assert.match(app.get('#fluency-result').textContent, /완료 Stage 0 \/ 3 · 건너뛴 Stage 3/);
  assert.doesNotMatch(app.get('#fluency-result').textContent, /분당/);
  const saved = app.records()[0]; app.click('#activity-home');
  const restored = openApp(t, app.snapshot()); restored.click('#recent-list .record-card button');
  assert.equal(restored.records()[0].id, saved.id);
  assert.match(restored.get('#fluency-result').textContent, /Stage 3 · 건너뜀/);
});

test('full course can skip each reading while retaining vocabulary, all quizzes, score and saved history', t => {
  const app = openApp(t); app.window.AreaTraining.start('courseReadingReadinV2'); finishCourse(app, true);
  assert.equal(app.results().totalQuestions, 22); assert.equal(app.results().wrong, 2);
  assert.equal(Object.values(app.session().read).filter(read => read.skipped).length, 5);
  assert.ok(Object.values(app.session().read).every(read => !read.done && read.elapsedMs === 0));
  assert.equal(app.records().length, 1);
  assert.equal(app.document.querySelector('#activity-skip-read'), null);
  assert.match(app.get('.activity-read-results').textContent, /건너뜀/);
  const restored = openApp(t, app.snapshot());
  assert.deepEqual(restored.records()[0], app.records()[0]);
});

test('blank and multiple-choice drafts restore; corrected review creates one immutable record without replaying stages', t=>{
  const app=openApp(t); app.window.AreaTraining.start('fluencyIntegratedV1'); readStage(app);
  assert.equal(app.current().task.quizType,'blank'); app.click('#activity-option-0');
  let restored=openApp(t,app.snapshot()); restored.click('#home-continue'); assert.equal(restored.get('#activity-option-0').checked,true);
  question(restored,true); readStage(restored); question(restored);
  assert.equal(restored.current().task.quizType,'process');
  assert.equal(restored.current().task.kind,'choice');
  assert.equal(restored.get('#activity-main').disabled,true);
  assert.equal(restored.document.querySelector('.activity-paragraph'),null);
  restored.click('#activity-option-2');
  const snapshot=restored.snapshot(); restored=openApp(t,snapshot); restored.click('#home-continue');
  assert.equal(restored.session().answers[restored.current().entry.key],2);
  assert.equal(restored.get('#activity-option-2').checked,true);
  question(restored,true); readStage(restored); question(restored); question(restored); question(restored); assert.equal(restored.results().fluency.accuracy,67);
  assert.equal(restored.records().length,1);
  const source=restored.records()[0]; restored.click('#activity-retry-wrong'); question(restored); question(restored);
  assert.equal(restored.results().accuracy,100); assert.equal(restored.records().length,2);
  assert.deepEqual(restored.records().find(r=>r.id===source.id),source);
});

test('full course card resume and legacy draft coexist without replacement; failed new result persistence stays recoverable', t=>{
  const app=openApp(t); app.click('#menu-button'); app.click('#menu-legacy');
  app.input('#comp0','소금이 단단하게 굳어요.'); const legacy=app.legacy(); app.click('#learning-home');
  app.window.AreaTraining.start('courseReadingReadinV2'); app.main(); app.click('#activity-option-1'); const course=app.session(); app.click('#activity-home'); app.click('#home-full-start');
  assert.equal(app.session().id,course.id); assert.deepEqual(app.legacy().draft,legacy.draft);
  app.click('#activity-home'); app.click('#menu-button'); app.click('#menu-legacy'); assert.equal(app.get('#comp0').value,legacy.draft.compose[0]);
  app.click('#learning-home'); app.window.AreaTraining.start('courseReadingReadinV2');
  assert.equal(app.session().id,course.id);
  // Fail the first completion write; an already-saved identical record needs no write.
  app.blockWrites(['areaTrainingHistory.v1']); finishCourse(app); const done=app.session();
  app.click('#activity-retry-area'); assert.equal(app.session().id,done.id);
  app.blockWrites([]); app.click('#activity-retry-area'); assert.notEqual(app.session().id,done.id); assert.equal(app.records().length,1);
});


test('every reading stage is followed by its own quiz and stage 3 reveals one fixed-position phrase at a time', t=>{
  const app=openApp(t); app.window.AreaTraining.start('fluencyIntegratedV1');
  readStage(app); assert.equal(app.current().task.quizStage,1); assert.equal(app.current().task.kind,'choice');
  question(app); assert.equal(app.current().task.stage,2);
  readStage(app); assert.equal(app.current().task.quizStage,2); assert.equal(app.current().task.kind,'choice');
  question(app); assert.equal(app.current().task.quizType,'process'); question(app);
  const {task,entry}=app.current(); assert.equal(task.stage,3); assert.equal(task.display,'masked-phrases');
  app.main();
  const lines=app.get('#fluency-line-reader');
  assert.equal(lines.children.length,task.units.length);
  assert.equal(lines.querySelectorAll('.is-current').length,1);
  assert.equal(lines.textContent,task.units[0]);
  app.advance(task.displayInterval);
  assert.equal(lines.textContent,task.units[1]);
  assert.equal(lines.children[0].textContent,'');
  assert.equal(lines.children[0].classList.contains('is-read'),true);
  app.click('#fluency-play'); const elapsed=app.session().elapsedMs; app.advance(10000);
  assert.equal(app.session().elapsedMs,elapsed);
  const restored=openApp(t,app.snapshot()); restored.click('#home-continue');
  assert.equal(restored.get('#fluency-line-reader').textContent,task.units[1]);
  assert.equal(restored.get('#fluency-play').textContent,'이어서 읽기');
  restored.click('#fluency-play'); restored.advance((task.units.length-1)*task.displayInterval);
  assert.equal(restored.session().read[entry.key].done,true);
  assert.equal(restored.current().task.quizStage,3); assert.equal(restored.current().task.kind,'choice');
  assert.equal(restored.document.querySelector('#fluency-line-reader'),null);
  for(let i=1;i<=3;i++) { assert.match(restored.get('.activity-header').textContent,new RegExp(i+' / 3문항')); question(restored); }
  assert.equal(restored.results().accuracy,100); assert.equal(restored.records().length,1);
});

test('previous staged sessions and results stay readable while a new round uses the corrected flow', t=>{
  const old=openApp(t); old.evaluate("AreaTraining.start('fluencyStages')"); old.main(); old.click('#fluency-tap');
  old.click('#activity-home'); const snapshot=old.snapshot();
  const app=openApp(t,snapshot); app.click('#home-continue');
  assert.equal(app.session().area,'fluencyStages'); assert.equal(app.get('#fluency-stage-progress').value,1);
  assert.match(app.get('.activity-header').textContent,/이전에 시작한 회차/);
  app.click('#activity-home'); app.window.AreaTraining.start('fluencyIntegratedV1');
  assert.equal(app.get('#confirm-dialog').open,true);
  app.click('#confirm-no'); assert.equal(app.session().area,'fluencyStages');
  app.window.AreaTraining.start('fluencyIntegratedV1'); app.click('#confirm-yes'); assert.equal(app.session().area,'fluencyIntegratedV1');
  readStage(app); assert.equal(app.current().task.quizStage,1);
});

test('returning to an earlier quiz labels the actual next question without replaying completed reading', t=>{
  const app=openApp(t); app.window.AreaTraining.start('fluencyIntegratedV1'); readStage(app); question(app); readStage(app);
  const {task}=app.current(); app.click('#activity-option-'+task.answer); app.main();
  app.click('#activity-prev');
  assert.equal(app.current().task.quizStage,1);
  assert.equal(app.get('#activity-main').textContent,'다음 문제');
  app.main(); assert.equal(app.current().task.quizStage,2);
  assert.equal(app.current().task.kind,'choice');
  assert.equal(app.document.querySelector('#fluency-play'),null);
});
