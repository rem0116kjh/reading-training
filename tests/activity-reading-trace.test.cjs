const test = require('node:test');
const assert = require('node:assert/strict');
const ActivityEngine = require('../activity-engine.js');

const passage = id => ({ id, kind: 'read', mode: 'normal', readingTrace: true,
  paragraphs: [{ s: ['처음 문단.'] }, { s: ['중간 문단.'] }, { s: ['끝 문단.'] }] });
const catalog = { reading: { tasks: [passage('passage'),
  { id: 'question', kind: 'choice', options: ['가', '나'], answer: 0 }, passage('later')] } };
const engine = ActivityEngine.create(catalog);
const fresh = () => engine.newSession('reading', { id: 'trace-session', startedAt: '2026-10-08T00:00:00.000Z' });
const copy = value => JSON.parse(JSON.stringify(value));
const storage = () => {
  const items = new Map();
  return { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
};

test('paragraph timing and backwards transitions survive saving and reloading', () => {
  const session = fresh(), store = storage();
  assert.equal(engine.observeParagraph(session, 0), true);
  engine.tick(session, 800, { paragraphIndex: 0 });
  engine.observeParagraph(session, 2);
  engine.tick(session, 500, { paragraphIndex: 2 });
  engine.observeParagraph(session, 1);
  engine.observeParagraph(session, 1);
  engine.tick(session, 700, { paragraphIndex: 1 });
  assert.deepEqual(session.read['base-1'].trace, { paragraphMs: [800, 700, 500], regressions: 1, lastParagraph: 1 });
  assert.equal(engine.save(store, session).ok, true);
  const restored = engine.load(store).session;
  assert.deepEqual(restored.read['base-1'].trace, session.read['base-1'].trace);
  engine.observeParagraph(restored, 0);
  engine.tick(restored, 200, { paragraphIndex: 0 });
  assert.deepEqual(restored.read['base-1'].trace, { paragraphMs: [1000, 700, 500], regressions: 2, lastParagraph: 0 });
  assert.equal(session.read['base-1'].trace.paragraphMs[0], 800, 'restored samples have independent storage');
});

test('elapsed reading time does not fabricate paragraph dwell when no paragraph is observed', () => {
  const session = fresh();
  engine.observeParagraph(session, 1);
  engine.tick(session, 1000);
  engine.tick(session, 500, { paragraphIndex: null });
  for (const index of [-1, 3, 1.5, '1', undefined]) {
    assert.equal(engine.observeParagraph(session, index), false);
    engine.tick(session, 100, { paragraphIndex: index });
  }
  for (const duration of [0, -1, NaN, Infinity]) assert.equal(engine.tick(session, duration, { paragraphIndex: 1 }), false);
  assert.equal(session.read['base-1'].elapsedMs, 2000);
  assert.deepEqual(session.read['base-1'].trace, { paragraphMs: [0, 0, 0], regressions: 0, lastParagraph: 1 });
  assert.ok(engine.normalize(session));
});

test('finished, skipped, and revisited reading cannot collect additional paragraph samples', () => {
  for (const finish of ['finishRead', 'skipRead']) {
    const session = fresh();
    engine.observeParagraph(session, 1); engine.tick(session, 100, { paragraphIndex: 1 });
    engine[finish](session);
    const before = copy(session.read['base-1']);
    assert.equal(engine.observeParagraph(session, 0), false);
    engine.tick(session, 500, { paragraphIndex: 0 });
    assert.deepEqual(session.read['base-1'], before);
    engine.next(session);
    assert.equal(engine.observeParagraph(session, 0), false);
    engine.previous(session);
    assert.equal(engine.observeParagraph(session, 0), false);
    engine.tick(session, 500, { paragraphIndex: 0 });
    assert.deepEqual(session.read['base-1'], before);
    assert.ok(engine.normalize(session));
  }
});

test('older reading records retain missing traces until a new real observation occurs', () => {
  const older = fresh();
  delete older.read['base-1'].trace; delete older.read['base-3'].trace;
  engine.tick(older, 1500);
  const restored = engine.normalize(older);
  assert.equal(Object.hasOwn(restored.read['base-1'], 'trace'), false);
  engine.tick(restored, 500);
  assert.equal(Object.hasOwn(restored.read['base-1'], 'trace'), false);
  engine.observeParagraph(restored, 2);
  engine.tick(restored, 100, { paragraphIndex: 2 });
  assert.deepEqual(restored.read['base-1'].trace, { paragraphMs: [0, 0, 100], regressions: 0, lastParagraph: 2 });
  assert.equal(restored.read['base-1'].elapsedMs, 2100);
  assert.equal(Object.hasOwn(restored.read['base-3'], 'trace'), false);
});

test('normalization rejects invalid trace shape, impossible durations and premature samples', () => {
  const baseline = fresh(); engine.tick(baseline, 1000);
  const invalid = [null, {}, { paragraphMs: [0], regressions: 0, lastParagraph: null },
    { paragraphMs: [0, -1, 0], regressions: 0, lastParagraph: null },
    { paragraphMs: [0, 1002, 0], regressions: 0, lastParagraph: 1 },
    { paragraphMs: [0, 0, 0], regressions: -1, lastParagraph: 0 },
    { paragraphMs: [0, 0, 0], regressions: 0.5, lastParagraph: 0 },
    { paragraphMs: [0, 0, 0], regressions: 1, lastParagraph: null },
    { paragraphMs: [0, 0, 0], regressions: 0, lastParagraph: 3 }];
  for (const trace of invalid) {
    const malformed = copy(baseline); malformed.read['base-1'].trace = trace;
    assert.equal(engine.normalize(malformed), null);
  }
  const premature = copy(baseline); premature.read['base-3'].trace.lastParagraph = 0;
  assert.equal(engine.normalize(premature), null);
});

test('paragraph traces are restricted to explicitly enabled reading tasks', () => {
  const untrackedCatalog = { reading: { tasks: [{ ...passage('untracked'), readingTrace: false }] } };
  const untracked = ActivityEngine.create(untrackedCatalog), session = untracked.newSession('reading');
  assert.equal(untracked.observeParagraph(session, 0), false);
  untracked.tick(session, 100, { paragraphIndex: 0 });
  assert.equal(Object.hasOwn(session.read['base-1'], 'trace'), false);
  session.read['base-1'].trace = { paragraphMs: [0, 0, 0], regressions: 0, lastParagraph: null };
  assert.equal(untracked.normalize(session), null);
  assert.throws(() => ActivityEngine.create({ bad: { tasks: [{ kind: 'read', id: 'bad', readingTrace: true }] } }), /문단 목록/);
});
