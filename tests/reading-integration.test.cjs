const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createCatalog } = require('../activity-content.js');
const Fluency = require('../fluency-content.js');
const Vocabulary = require('../vocabulary-content.js');
const Reading = require('../reading-content.js');
const { create } = require('../activity-engine.js');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const pkg = JSON.parse(vm.runInNewContext(source.slice(0, source.indexOf('const SENT =')) + '\nJSON.stringify(PKG)'));
const before = Vocabulary.extend(Fluency.extend(createCatalog(pkg), pkg), pkg, Fluency.CURRENT_AREAS.course);
const catalog = Reading.extend(before, pkg, Vocabulary.CURRENT_AREAS.course);
const engine = create(catalog);
const copy = value => JSON.parse(JSON.stringify(value));

test('reading extension preserves every old catalog and all vocabulary and fluency tasks', () => {
  for (const key of Object.keys(before)) assert.equal(catalog[key], before[key], key);
  const course = catalog[Reading.CURRENT_AREAS.course];
  const retained = before[Vocabulary.CURRENT_AREAS.course].tasks.filter(t => t.trainingArea !== 'reading');
  retained.forEach((task, index) => assert.equal(course.tasks[index], task));
  const reading = catalog[Reading.CURRENT_AREAS.reading];
  assert.equal(reading.tasks.length, 14);
  assert.equal(reading.tasks.find(t => t.id === 'reading-structure'), before.reading.tasks.find(t => t.id === 'reading-structure'));
  assert.deepEqual(reading.tasks.filter(t => t.id.startsWith('reading-content-')), before.reading.tasks.filter(t => t.id.startsWith('reading-content-')));
  assert.deepEqual(pkg, require('../docs/vocabulary-audit/public-artifact.json').package);
});

function atMap() {
  const s = engine.newSession(Reading.CURRENT_AREAS.reading);
  while (engine.current(s).task.id !== 'reading-relations') {
    const { task } = engine.current(s);
    if (task.kind === 'read') engine.finishRead(s);
    else { engine.answer(s, task.answer); engine.submit(s); }
    engine.next(s);
  }
  return s;
}

test('structure map rejects incomplete, duplicated, out of range and forged submitted placements', () => {
  const s = atMap(), key = engine.current(s).entry.key;
  assert.equal(engine.answer(s, [0, null, null, null]), true);
  assert.equal(engine.canSubmit(s), false); assert.equal(engine.next(s), false);
  for (const invalid of [[0, 0, null, null], [4, null, null, null], [0], [0, undefined, null, null], ['0', null, null, null]]) assert.equal(engine.answer(s, invalid), false);
  const raw = copy(s); raw.submitted[key] = { answer: [0, null, null, null], correct: true };
  assert.equal(engine.normalize(raw), null);
  assert.equal(engine.answer(s, [1, 0, 2, 3]), true); assert.equal(engine.submit(s).correct, false);
  const forged = copy(s); forged.submitted[key].correct = true;
  assert.equal(engine.normalize(forged).submitted[key].correct, false);
});

test('all previous reading and full course sessions keep their queues and scores after loading the new catalog', () => {
  const oldCatalog = Object.fromEntries(Object.entries(catalog).filter(([area]) => !Object.values(Reading.CURRENT_AREAS).includes(area)));
  const oldEngine = create(oldCatalog);
  for (const area of ['reading', Vocabulary.CURRENT_AREAS.course, 'readingReadinV1', 'courseReadingReadinV1']) {
    const s = oldEngine.newSession(area);
    let guard = 0;
    while (s.status === 'active' && guard++ < 100) {
      const { task } = oldEngine.current(s);
      assert.deepEqual(engine.normalize(copy(s)), s);
      if (task.kind === 'read') {
        if (task.stage) {
          oldEngine.startRead(s);
          if (task.mode === 'tap') for (const unit of task.units) oldEngine.tapRead(s);
          else oldEngine.tick(s, task.units.length * task.displayInterval);
        }
        oldEngine.finishRead(s);
      } else { oldEngine.answer(s, task.kind === 'practice' ? task.prompts.map(() => '저장한 문장') : task.answer); oldEngine.submit(s); }
      oldEngine.next(s);
    }
    assert.equal(s.status, 'completed');
    assert.deepEqual(engine.results(engine.normalize(copy(s))), oldEngine.results(s));
  }
});

test('only unique source activities are added; duplicated fact and inference tasks are absent', () => {
  const tasks = catalog[Reading.CURRENT_AREAS.reading].tasks;
  assert.deepEqual(tasks.slice(8).map(t => t.id), ['reading-concept', 'reading-recall-0', 'reading-recall-1', 'reading-key', 'reading-outline', 'reading-summary']);
  assert.equal(tasks.filter(t => t.id.startsWith('reading-content-')).length, 4);
  assert.deepEqual(tasks.filter(t => t.kind === 'recall').map(t => t.answer), pkg.concept.blanks.slice(0, 2).map(b => b.k));
  assert.deepEqual(tasks.find(t => t.id === 'reading-key').answer, pkg.key);
  assert.deepEqual(tasks.find(t => t.id === 'reading-outline').answer, pkg.outline.slots.flatMap(s => s.s));
  assert.equal(tasks.find(t => t.id === 'reading-summary').source, pkg.outline.ref);
  assert.equal(tasks.some(t => ['questions.4', 'questions.5', 'questions.6', 'concept.blanks.2', 'concept.blanks.3', 'concept.blanks.4'].includes(t.sourceRef)), false);
});

function atTask(id) {
  const s = engine.newSession(Reading.CURRENT_AREAS.reading);
  while (engine.current(s).task.id !== id) {
    const { task } = engine.current(s);
    if (task.kind === 'read') engine.finishRead(s);
    else { engine.answer(s, task.kind === 'recall' ? [task.answer, 'sure'] : task.answer); engine.submit(s); }
    engine.next(s);
  }
  return s;
}

test('new drafts reject invalid confidence, duplicated and cross-paragraph sentences, and forged short summary completion', () => {
  const recall = atTask('reading-recall-0');
  for (const answer of [['중심 문장', 'invalid'], ['중심 문장'], [false, 'sure']]) assert.equal(engine.answer(recall, answer), false);
  engine.answer(recall, ['중심문장', '']); assert.equal(engine.submit(recall).ok, false);
  engine.answer(recall, ['중심문장', 'maybe']); assert.equal(engine.submit(recall).correct, true);
  const key = atTask('reading-key');
  for (const answer of [[0, 0, null, null], [9, null, null, null], [0, 3, 9, 17], ['0', null, null, null]]) assert.equal(engine.answer(key, answer), false);
  engine.answer(key, [0, null, null, null]); assert.equal(engine.submit(key).ok, false);
  const raw = copy(key), entry = engine.current(key).entry;
  raw.submitted[entry.key] = { correct: true, answer: raw.answers[entry.key] };
  assert.equal(engine.normalize(raw), null);
  const summary = atTask('reading-summary'); engine.answer(summary, '짧은 내용'); assert.equal(engine.submit(summary).ok, false);
  const short = copy(summary), q = engine.current(summary).entry; short.submitted[q.key] = { correct: true, answer: short.answers[q.key] };
  assert.equal(engine.normalize(short), null);
});

test('outline accepts either order within a role, corrects forged correctness, and summary never adds a score or retry', () => {
  const s = atTask('reading-outline');
  engine.answer(s, [0, 9, 3, 15, 13]); assert.equal(engine.submit(s).correct, true);
  assert.equal(engine.normalize(copy(s)).submitted[engine.current(s).entry.key].correct, true);
  engine.next(s); engine.answer(s, pkg.outline.ref); assert.equal(engine.submit(s).correct, null); engine.next(s);
  const result = engine.results(s); assert.equal(result.totalQuestions, 11); assert.equal(result.wrong, 0);
  assert.deepEqual(engine.results(engine.normalize(copy(s))), result);
  const summary = engine.current(s).entry; const forged = copy(s); forged.submitted[summary.key].correct = false;
  assert.equal(engine.normalize(forged).submitted[summary.key].correct, null);
});
