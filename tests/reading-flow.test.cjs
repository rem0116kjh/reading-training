const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Content = require('../activity-content.js');
const Fluency = require('../fluency-content.js');
const Vocabulary = require('../vocabulary-content.js');
const Reading = require('../reading-content.js');
const Concept = require('../fluency-concept-content.js');
const Comprehension = require('../reading-comprehension.js');
const Flow = require('../reading-flow.js');
const { create, SESSION_KEY, HISTORY_KEY } = require('../activity-engine.js');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const pkg = JSON.parse(vm.runInNewContext(source.slice(0, source.indexOf('const SENT =')) + '\nJSON.stringify(PKG)'));
const base = Reading.extend(Vocabulary.extend(Fluency.extend(Content.createCatalog(pkg), pkg), pkg, Fluency.CURRENT_AREAS.course), pkg, Vocabulary.CURRENT_AREAS.course);
const previous = Comprehension.extend(Concept.extend(base, pkg, Reading.CURRENT_AREAS.course), pkg, { reading: Reading.CURRENT_AREAS.reading, course: Concept.CURRENT_AREAS.course });
const { catalog, currentAreas } = Flow.extend(previous.catalog, previous.currentAreas);
const engine = create(catalog);
const removed = id => ['reading-order', 'reading-structure', 'reading-relations'].includes(id);
const copy = value => JSON.parse(JSON.stringify(value));
const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };
function finishTask(session) {
  const { task } = engine.current(session);
  if (task.kind === 'read') {
    if (task.stage) {
      engine.startRead(session);
      if (task.mode === 'tap') task.units.forEach(() => engine.tapRead(session));
      else engine.tick(session, task.units.length * task.displayInterval);
    }
    engine.finishRead(session);
  } else {
    const answer = task.kind === 'practice' ? ['ㄱ', 'ㅇ'] : task.kind === 'recall' ? [task.answer, 'sure'] : task.kind === 'summary' ? task.source : task.answer;
    engine.answer(session, answer); assert.equal(engine.submit(session).ok, true);
  }
  assert.equal(engine.next(session), true);
}
test('current reading and full courses remove all three structure activities and preserve all other task objects', () => {
  for (const key of Object.keys(previous.catalog)) assert.equal(catalog[key], previous.catalog[key]);
  for (const kind of ['reading', 'course']) {
    const before = previous.catalog[previous.currentAreas[kind]];
    const after = catalog[currentAreas[kind]];
    assert.deepEqual(after.tasks, before.tasks.filter(task => !removed(task.id)));
    assert.equal(after.tasks.filter(task => task.comprehensionType).length, 7);
    assert.equal(after.tasks.filter(task => task.id === 'reading-summary').length, 1);
  }
  const s = engine.newSession(currentAreas.reading);
  finishTask(s); assert.equal(engine.current(s).task.id, 'reading-content-1');
  while (s.status === 'active') finishTask(s);
  assert.equal(engine.results(s).totalQuestions, 11);
});
test('pending order in the previous seven-question reading path migrates without changing identity, read time or source state', () => {
  const s = engine.newSession('readingReadinV3'); engine.tick(s, 1700); finishTask(s);
  engine.answer(s, [2, 0]); const original = copy(s);
  const next = Flow.migrate(s, catalog, engine);
  assert.equal(engine.current(next).task.id, 'reading-content-1');
  assert.equal(next.id, s.id); assert.equal(next.startedAt, s.startedAt); assert.equal(next.elapsedMs, s.elapsedMs);
  assert.deepEqual(Object.values(next.read), Object.values(s.read)); assert.equal(next.taskIds.length, 14);
  assert.deepEqual(s, original); assert.deepEqual(engine.normalize(next), next);
  const store = storage(); assert.equal(engine.save(store, next).ok, true);
  assert.deepEqual(engine.load(store).session, next);
  assert.equal(JSON.parse(store.getItem(SESSION_KEY)).area, next.area);
});
test('later drafts and metrics are rekeyed when a submitted order task is removed from a full course', () => {
  const s = engine.newSession(previous.currentAreas.course);
  while (engine.current(s).task.id !== 'reading-order') finishTask(s);
  engine.tick(s, 900); finishTask(s); finishTask(s); finishTask(s);
  const current = engine.current(s); engine.answer(s, current.task.answer); engine.tick(s, 300);
  const oldAnswer = s.answers[current.entry.key], original = copy(s);
  const next = Flow.migrate(s, catalog, engine), item = engine.current(next);
  assert.equal(item.task.id, 'reading-content-1');
  assert.deepEqual(next.answers[item.entry.key], oldAnswer);
  assert.equal(next.metrics.responseMs[item.entry.key], 300);
  assert.equal(next.elapsedMs, s.elapsedMs); assert.deepEqual(next.metrics.areaMs, s.metrics.areaMs);
  assert.equal(Object.keys(next.submitted).length, Object.keys(s.submitted).length - 3);
  assert.deepEqual(s, original);
  assert.deepEqual(engine.normalize(next), next);
});
test('completed seven-question records keep their original queues, scores and stored bytes', () => {
  const s = engine.newSession('readingReadinV3');
  while (s.status === 'active') finishTask(s);
  const original = copy(s), score = engine.results(s), store = storage();
  assert.equal(engine.saveCompleted(store, s).ok, true);
  const bytes = store.getItem(HISTORY_KEY);
  assert.equal(Flow.migrate(s, catalog, engine), s);
  assert.deepEqual(engine.loadHistory(store).records, [original]);
  assert.deepEqual(engine.results(engine.loadHistory(store).records[0]), score);
  assert.equal(store.getItem(HISTORY_KEY), bytes);
  assert.equal(score.totalQuestions, 14);
});

test('active no-order sessions remove structure and maps while preserving later comprehension drafts', () => {
  const s = engine.newSession('readingComprehensionV1NoOrderV1');
  finishTask(s); engine.tick(s, 100); finishTask(s); engine.tick(s, 200); finishTask(s);
  const current = engine.current(s); engine.answer(s, 2); engine.tick(s, 700);
  const next = Flow.migrate(s, catalog, engine), item = engine.current(next);
  assert.equal(next.area, currentAreas.reading); assert.equal(item.task.id, 'reading-content-1');
  assert.equal(next.answers[item.entry.key], 2);
  assert.equal(next.elapsedMs, s.elapsedMs); assert.deepEqual(Object.values(next.read), Object.values(s.read));
  assert.ok(next.taskIds.every(id => !removed(id)));
  assert.equal(Flow.migrate(next, catalog, engine), next);
});
test('a saved review containing only a removed map continues at passage comprehension', () => {
  const s = engine.newSession('readingComprehensionV1NoOrderV1', { reviewOf: 'old-result', taskIds: ['reading-relations'] });
  engine.answer(s, [null, 1, null, null]); engine.tick(s, 800);
  const next = Flow.migrate(s, catalog, engine);
  assert.equal(next.id, s.id); assert.equal(next.reviewOf, s.reviewOf); assert.equal(next.elapsedMs, s.elapsedMs);
  assert.equal(next.taskIds.length, 7); assert.equal(engine.current(next).task.id, 'reading-content-1');
  assert.deepEqual(engine.normalize(next), next);
});
test('completed no-order records keep their thirteen-question score', () => {
  const s = engine.newSession('readingComprehensionV1NoOrderV1');
  while (s.status === 'active') finishTask(s);
  assert.equal(Flow.migrate(s, catalog, engine), s);
  assert.equal(engine.results(s).totalQuestions, 13);
  assert.deepEqual(engine.normalize(s), s);
});
