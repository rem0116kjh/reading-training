const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ActivityEngine = require('../activity-engine.js');

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

test('unchanged saves avoid writes, observe external changes, and retry genuine quota failures', () => {
  const storage = new MemoryStorage(), writes = [];
  let blocked = false;
  storage.setItem = (key, value) => {
    if (blocked) throw new Error('QuotaExceededError');
    writes.push(key); storage.values.set(key, String(value));
  };
  const session = fresh();
  assert.equal(engine.save(storage, session).ok, true);
  assert.equal(engine.save(storage, session).ok, true);
  assert.deepEqual(writes, [ActivityEngine.SESSION_KEY]);
  engine.tick(session, 1000); blocked = true;
  assert.equal(engine.save(storage, session).ok, false);
  blocked = false; assert.equal(engine.save(storage, session).ok, true);
  storage.values.delete(ActivityEngine.SESSION_KEY);
  assert.equal(engine.save(storage, session).ok, true);
  const completed = finish(session);
  assert.equal(engine.saveCompleted(storage, completed).ok, true);
  const saved = storage.getItem(ActivityEngine.HISTORY_KEY), count = writes.length;
  blocked = true;
  assert.equal(engine.saveCompleted(storage, completed).ok, true, 'a durable identical record needs no new write');
  assert.equal(writes.length, count);
  storage.values.set(ActivityEngine.HISTORY_KEY, 'broken');
  assert.equal(engine.saveCompleted(storage, completed).ok, false, 'external corruption cannot be hidden by a cache');
  assert.equal(storage.getItem(ActivityEngine.HISTORY_KEY), 'broken');
  storage.values.set(ActivityEngine.HISTORY_KEY, saved); blocked = false;
  const other = finish(fresh('reading', { id: 'another-session' }));
  assert.equal(engine.saveCompleted(storage, other).ok, true);
  assert.equal(engine.loadHistory(storage).records.length, 2);
});

const choice = (id, phase = '뜻 맞추기') => ({ id, kind: 'choice', phase, title: id, options: ['가', '나', '다'], answer: 1 });
const read = (id, mode = 'normal') => ({ id, kind: 'read', mode, sentences: ['소금을 읽어요.', '내용을 확인해요.'] });
const catalog = {
  fluency: { label: '읽기 유창성', tasks: [read('normal'), choice('blank'), read('speed', 'speed'), choice('speed-q'), read('auto', 'auto'), choice('auto-q')] },
  vocabulary: { label: '어휘력', tasks: Array.from({ length: 32 }, (_, i) => choice('v-' + i, i < 16 ? '뜻 맞추기' : '문장 맞추기')) },
  reading: { label: '독해력', tasks: [read('passage'), { id: 'order', kind: 'order', answer: [0, 1, 2, 3] }, choice('structure'), ...Array.from({ length: 4 }, (_, i) => choice('content-' + i))] }
};
const engine = ActivityEngine.create(catalog);
const copy = value => JSON.parse(JSON.stringify(value));
const fresh = (area = 'vocabulary', options = {}) => engine.newSession(area, { id: 'session-1', startedAt: '2026-10-08T00:00:00.000Z', ...options });
function finish(session) {
  let guard = 0;
  while (session.status === 'active' && guard++ < 100) {
    const { task } = engine.current(session);
    engine.tick(session, 1234);
    if (task.kind === 'read') engine.finishRead(session);
    else { engine.answer(session, task.answer); assert.equal(engine.submit(session).ok, true); }
    assert.equal(engine.next(session), true);
  }
  assert.equal(session.status, 'completed');
  return session;
}

test('plain browser loading exposes a factory without a module loader', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../activity-engine.js'), 'utf8'), context);
  assert.equal(typeof context.ActivityEngine.create, 'function');
  assert.equal(context.ActivityEngine.SESSION_KEY, 'areaTrainingSession.v1');
});

test('area sessions have distinct actual flows: three quizzes, 16 + 16, and six comprehension questions', () => {
  assert.equal(engine.results(fresh('fluency')).totalQuestions, 3);
  const vocab = fresh();
  assert.equal(vocab.queue.length, 32);
  assert.equal(vocab.queue.filter(entry => catalog.vocabulary.tasks.find(task => task.id === entry.taskId).phase === '뜻 맞추기').length, 16);
  assert.equal(vocab.queue.filter(entry => catalog.vocabulary.tasks.find(task => task.id === entry.taskId).phase === '문장 맞추기').length, 16);
  const reading = fresh('reading');
  assert.equal(reading.queue.length, 7);
  assert.equal(engine.results(reading).totalQuestions, 6);
  assert.equal(catalog.reading.tasks.filter(task => task.kind === 'read').length, 1);
});

test('new sessions are independent; storage uses its own keys and restores selected answers', () => {
  const storage = new MemoryStorage();
  storage.setItem('trainingSession', 'legacy session');
  storage.setItem('trainingHistory', 'legacy history');
  const first = fresh();
  engine.answer(first, 2);
  engine.tick(first, 900);
  assert.deepEqual(engine.save(storage, first), { ok: true, warning: null });
  assert.deepEqual(engine.load(storage), { session: first, warning: null });
  assert.deepEqual(fresh().answers, {});
  assert.equal(storage.getItem('trainingSession'), 'legacy session');
  assert.equal(storage.getItem('trainingHistory'), 'legacy history');
});

test('wrong vocabulary answer is retried within the next two questions, and submit/reload cannot duplicate it', () => {
  const storage = new MemoryStorage();
  let session = fresh();
  const original = engine.current(session).entry;
  engine.answer(session, 0);
  assert.deepEqual(engine.submit(session), { ok: true, correct: false });
  assert.equal(session.queue.length, 33);
  assert.deepEqual(session.queue[2], { key: 'retry-1', taskId: original.taskId, retryOf: original.key });
  engine.submit(session);
  assert.equal(session.queue.length, 33);
  assert.equal(engine.save(storage, session).ok, true);
  session = engine.load(storage).session;
  assert.ok(session);
  engine.submit(session);
  assert.equal(session.queue.length, 33);
  engine.next(session);
  engine.answer(session, 1);
  engine.submit(session);
  engine.next(session);
  assert.equal(engine.current(session).entry.taskId, original.taskId);
  assert.equal(engine.current(session).entry.retryOf, original.key);
});

test('a wrong retry is queued again, but first-attempt accuracy never improves through retries', () => {
  const session = fresh();
  engine.answer(session, 0); engine.submit(session); engine.next(session);
  engine.answer(session, 1); engine.submit(session); engine.next(session);
  engine.answer(session, 0); engine.submit(session);
  const retryIndex = session.queue.findIndex(entry => entry.retryOf === 'retry-1');
  assert.ok(retryIndex - session.cursor <= 2);
  assert.equal(engine.results(session).reviewAttempts, 1);
  assert.equal(engine.results(session).reviewCorrect, 0);
  finish(session);
  const results = engine.results(session);
  assert.equal(results.correct, 31);
  assert.equal(results.wrong, 1);
  assert.equal(results.totalQuestions, 32);
  assert.equal(results.reviewAttempts, 2);
  assert.equal(results.reviewCorrect, 1);
  assert.deepEqual(results.mistakes, ['v-0']);
  assert.equal(engine.normalize(session).status, 'completed');
});

test('multiple consecutive wrong answers retain the two-question retry bound and valid restored queue', () => {
  let session = fresh();
  for (let i = 0; i < 10; i++) {
    const key = engine.current(session).entry.key;
    engine.answer(session, 0); engine.submit(session);
    const childIndex = session.queue.findIndex(entry => entry.retryOf === key);
    assert.ok(childIndex - session.cursor > 0 && childIndex - session.cursor <= 2);
    const restored = engine.normalize(copy(session));
    assert.ok(restored);
    assert.deepEqual(restored, session);
    session = restored;
    engine.next(session);
  }
  finish(session);
  assert.ok(engine.results(session).reviewAttempts >= 10);
});

test('last vocabulary question retries immediately, and pending retry prevents completion', () => {
  const session = fresh('vocabulary', { taskIds: ['v-31'], reviewOf: 'old-session' });
  engine.answer(session, 0); engine.submit(session);
  assert.equal(session.queue.length, 2);
  engine.next(session);
  assert.equal(session.status, 'active');
  assert.equal(engine.next(session), false);
  assert.equal(engine.saveCompleted(new MemoryStorage(), session).ok, false);
  engine.answer(session, 1); engine.submit(session); engine.next(session);
  assert.equal(session.status, 'completed');
});

test('reading passage must be completed once, and partial ordering answer survives reload', () => {
  const storage = new MemoryStorage();
  let session = fresh('reading');
  assert.equal(engine.next(session), false);
  assert.equal(engine.submit(session).ok, false);
  engine.tick(session, 12000);
  assert.equal(session.read['base-1'].elapsedMs, 12000);
  engine.finishRead(session); engine.next(session);
  assert.equal(engine.answer(session, [3, 0]), true);
  assert.equal(engine.submit(session).ok, false);
  assert.equal(engine.answer(session, [3, 3]), false);
  assert.equal(engine.answer(session, [9]), false);
  assert.equal(engine.save(storage, session).ok, true);
  session = engine.load(storage).session;
  assert.deepEqual(session.answers['base-2'], [3, 0]);
  assert.equal(session.read['base-1'].done, true);
  assert.equal(engine.progress(session).completed, 1);
  engine.answer(session, [3, 2, 1, 0]);
  assert.deepEqual(engine.submit(session), { ok: true, correct: false });
  assert.equal(session.queue.length, 7);
  finish(session);
  assert.equal(engine.results(session).correct, 5);
});

test('auto passage segment and elapsed time restore; revisiting completed reading does not increase reading time', () => {
  const session = fresh('fluency', { taskIds: ['auto', 'auto-q'], reviewOf: 'original' });
  engine.tick(session, 4000);
  session.read['base-1'].autoIndex = 1;
  const restored = engine.normalize(copy(session));
  assert.equal(restored.read['base-1'].autoIndex, 1);
  assert.equal(restored.read['base-1'].elapsedMs, 4000);
  engine.finishRead(restored); engine.next(restored);
  engine.previous(restored); engine.tick(restored, 5000);
  assert.equal(restored.read['base-1'].elapsedMs, 4000);
  assert.equal(restored.elapsedMs, 9000);
});

test('submitted answers cannot change on previous navigation; non-vocabulary wrong answers do not insert retries', () => {
  const session = fresh('fluency');
  engine.finishRead(session); engine.next(session);
  engine.answer(session, 0); engine.submit(session); engine.next(session);
  assert.equal(engine.previous(session), true);
  assert.equal(engine.answer(session, 1), false);
  assert.equal(engine.submit(session).correct, false);
  assert.equal(session.queue.length, 6);
  assert.equal(engine.results(session).correct, 0);
  assert.equal(engine.results(session).wrong, 1);
});

test('completed history is deduplicated, scores derive from answers, and active data cannot become a history record', () => {
  const storage = new MemoryStorage();
  const session = finish(fresh('reading'));
  session.results = { accuracy: 0, correct: 999 };
  session.submitted['base-2'].correct = false;
  assert.equal(engine.results(session).correct, 6);
  assert.equal(engine.saveCompleted(storage, session).ok, true);
  assert.equal(engine.saveCompleted(storage, session).ok, true);
  const loaded = engine.loadHistory(storage);
  assert.equal(loaded.warning, null);
  assert.equal(loaded.records.length, 1);
  assert.equal(loaded.records[0].submitted['base-2'].correct, true);
  assert.equal(loaded.records[0].results, undefined);
  assert.equal(engine.results(loaded.records[0]).accuracy, 100);
  assert.equal(engine.saveCompleted(storage, fresh()).ok, false);
});

test('review supports original-order subsets with source identity and retains separate results', () => {
  const session = fresh('reading', { taskIds: ['content-3', 'passage', 'order'], reviewOf: 'completed-1' });
  assert.deepEqual(session.taskIds, ['passage', 'order', 'content-3']);
  assert.equal(session.reviewOf, 'completed-1');
  assert.equal(engine.results(session).totalQuestions, 2);
  finish(session);
  assert.ok(engine.normalize(session));
  assert.throws(() => fresh('reading', { taskIds: ['other'], reviewOf: 'completed-1' }));
});

test('storage rejects malformed identity, dates, versions, unknown tasks, skipped activities, and forged completion', () => {
  const base = fresh('reading');
  const variants = [
    { version: 9 }, { id: '' }, { area: 'other' }, { startedAt: '2026-02-30T00:00:00.000Z' },
    { elapsedMs: -1 }, { elapsedMs: Infinity }, { cursor: 5 }, { status: 'completed', completedAt: '2026-10-08T00:01:00.000Z' },
    { queue: base.queue.slice(1) }, { taskIds: ['passage'] }, { reviewOf: {} },
    { answers: { 'base-2': [0, 0, 1, 2] } },
    { read: { 'base-1': { done: false, autoIndex: 99, elapsedMs: 0 } } }
  ];
  for (const variant of variants) assert.equal(engine.normalize({ ...copy(base), ...variant }), null, JSON.stringify(variant));
  const skipped = copy(base);
  skipped.answers['base-3'] = 1;
  skipped.submitted['base-3'] = { answer: 1, correct: true };
  assert.equal(engine.normalize(skipped), null);
  const injected = copy(base);
  injected.queue[1].taskId = 'not-a-task';
  assert.equal(engine.normalize(injected), null);
});

test('a missing, duplicated, reordered, or mismatched vocabulary retry is rejected', () => {
  const session = fresh();
  engine.answer(session, 0); engine.submit(session);
  const missing = copy(session); missing.queue.splice(2, 1);
  const duplicate = copy(session); duplicate.queue.splice(2, 0, copy(duplicate.queue[2]));
  const moved = copy(session); [moved.queue[1], moved.queue[2]] = [moved.queue[2], moved.queue[1]];
  const changed = copy(session); changed.queue[2].taskId = 'v-3';
  for (const altered of [missing, duplicate, moved, changed]) assert.equal(engine.normalize(altered), null);
});

test('malformed stored JSON remains untouched; unavailable storage and quota produce actionable warnings', () => {
  const storage = new MemoryStorage();
  for (const raw of ['{bad', 'null', '[]', '{"version":1}']) {
    storage.setItem(ActivityEngine.SESSION_KEY, raw);
    const loaded = engine.load(storage);
    assert.equal(loaded.session, null);
    assert.ok(loaded.warning);
    assert.equal(storage.getItem(ActivityEngine.SESSION_KEY), raw);
  }
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.ok(engine.load(denied).warning);
  assert.ok(engine.loadHistory(denied).warning);
  assert.equal(engine.save(denied, fresh()).ok, false);
  assert.ok(engine.save(denied, fresh()).warning);
  const full = new MemoryStorage();
  full.setItem = () => { throw new Error('quota'); };
  assert.equal(engine.saveCompleted(full, finish(fresh())).ok, false);
});

test('invalid prior history remains untouched rather than silently overwritten by a new completion', () => {
  const storage = new MemoryStorage();
  storage.setItem(ActivityEngine.HISTORY_KEY, '{broken');
  const result = engine.saveCompleted(storage, finish(fresh()));
  assert.equal(result.ok, false);
  assert.ok(result.warning);
  assert.equal(storage.getItem(ActivityEngine.HISTORY_KEY), '{broken');
});

test('history capacity preserves all 200 previous records and rejects automatic eviction', () => {
  const storage = new MemoryStorage();
  const completed = finish(fresh('reading'));
  const prior = Array.from({ length: 200 }, (_, index) => ({ ...copy(completed), id: 'past-' + index }));
  const original = JSON.stringify(prior);
  storage.setItem(ActivityEngine.HISTORY_KEY, original);
  assert.equal(engine.loadHistory(storage).records.length, 200);
  const rejected = engine.saveCompleted(storage, completed);
  assert.equal(rejected.ok, false);
  assert.ok(rejected.warning.includes('이전 기록은 유지'));
  assert.equal(storage.getItem(ActivityEngine.HISTORY_KEY), original);
  assert.equal(engine.saveCompleted(storage, prior[0]).ok, true);
  assert.deepEqual(new Set(engine.loadHistory(storage).records.map(record => record.id)), new Set(prior.map(record => record.id)));
});

test('progress includes required passage reads and adaptive retries, reaching 100 only when all are submitted', () => {
  const session = fresh('reading');
  assert.deepEqual(engine.progress(session), { completed: 0, total: 7, percent: 0, baseCompleted: 0, baseTotal: 7 });
  engine.finishRead(session);
  assert.equal(engine.progress(session).percent, 14);
  finish(session);
  assert.deepEqual(engine.progress(session), { completed: 7, total: 7, percent: 100, baseCompleted: 7, baseTotal: 7 });
  assert.equal(engine.previous(session), false);
  assert.equal(engine.tick(session, 1000), false);
});

test('real preserved salt content completes every area and round-trips every intermediate activity', () => {
  const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
  const pkg = JSON.parse(JSON.stringify(vm.runInNewContext(source.slice(0, source.indexOf('const SENT =')) + '\nPKG;')));
  const realCatalog = require('../activity-content.js').createCatalog(pkg);
  const real = ActivityEngine.create(realCatalog);
  const storage = new MemoryStorage();
  for (const area of ['fluency', 'vocabulary', 'reading']) {
    let session = real.newSession(area);
    let steps = 0;
    while (session.status === 'active' && steps++ < 100) {
      const { entry, task } = real.current(session);
      real.tick(session, 4000);
      if (task.kind === 'read') {
        session.read[entry.key].autoIndex = Math.min(1, task.sentences.length - 1);
        real.finishRead(session);
      } else {
        const choice = area === 'vocabulary' && session.cursor === 0 ? (task.answer + 1) % task.options.length : task.answer;
        real.answer(session, choice);
        assert.equal(real.submit(session).ok, true);
      }
      assert.equal(real.save(storage, session).ok, true, area + ' ' + task.id);
      session = real.load(storage).session;
      assert.ok(session);
      assert.equal(real.next(session), true);
    }
    assert.equal(session.status, 'completed');
    assert.equal(real.progress(session).percent, 100);
    assert.equal(real.results(session).totalQuestions, { fluency: 3, vocabulary: 32, reading: 6 }[area]);
    assert.equal(real.saveCompleted(storage, session).ok, true);
  }
  assert.equal(real.loadHistory(storage).records.length, 3);
});
