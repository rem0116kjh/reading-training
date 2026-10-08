const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const Store = require('../training-store.js');

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function session(options = {}) {
  return Store.createSession({ id: 'test-session', startedAt: '2026-10-08T00:00:00.000Z', ...options });
}

function completed(options = {}) {
  const value = session({ mode: 'area', requiredSteps: [1], ...options });
  value.draft.vocab = [1, 2, 3, 0, 1];
  value.draft.compose = ['소금이 단단하게 굳었다.', '소금은 맛을 내는 역할을 한다.'];
  value.submitted.vocab = true;
  value.status = 'completed';
  value.currentStep = 5;
  value.completedAt = '2026-10-08T00:01:00.000Z';
  value.elapsedMs = 60000;
  value.stepMs[0] = 60000;
  value.results = { vocab: { correct: 5, total: 5 }, accuracy: 100 };
  return value;
}

function record(value = completed()) {
  return { version: 1, id: value.id, packageId: value.packageId, title: value.title, mode: value.mode, reviewOf: value.reviewOf, completedAt: value.completedAt, totalTime: value.elapsedMs, results: value.results, session: value };
}

test('browser script exposes its API without a bundler', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../training-store.js'), 'utf8'), context);
  assert.equal(typeof context.TrainingStore.createSession, 'function');
  assert.equal(context.TrainingStore.createSession().version, 1);
});

test('new sessions are independent and normal partial drafts round-trip unchanged', () => {
  const storage = new MemoryStorage();
  const first = session();
  const second = session();
  first.draft.vocab[2] = 3;
  first.draft.compose[0] = '소금이 굳었다.';
  first.draft.blanks[0] = '중심 문장';
  first.draft.confidence[0] = 'maybe';
  first.draft.key = [0, 3];
  first.draft.slots = [[0], [3], []];
  first.draft.essay = '<script>alert("text remains plain data")</script>';
  first.metrics.readingMs = 123.5;
  first.elapsedMs = 2222.25;
  assert.equal(second.draft.vocab[2], null);
  assert.deepEqual(Store.saveSession(storage, first), { ok: true, warning: null });
  assert.deepEqual(Store.loadSession(storage), { session: first, warning: null });
});

test('corrupt JSON, unsupported versions and unrelated packages are rejected without erasing raw data', () => {
  const storage = new MemoryStorage();
  for (const value of ['{oops', 'null', '[]', JSON.stringify({ ...session(), version: 2 }), JSON.stringify({ ...session(), version: 0 }), JSON.stringify({ ...session(), packageId: 'another-package' })]) {
    storage.setItem('trainingSession', value);
    const loaded = Store.loadSession(storage);
    assert.equal(loaded.session, null);
    assert.ok(loaded.warning);
    assert.equal(storage.getItem('trainingSession'), value);
  }
});

test('missing identity and impossible dates cannot silently create different sessions', () => {
  assert.equal(Store.normalizeSession({ ...session(), id: '' }), null);
  assert.equal(Store.normalizeSession({ ...session(), startedAt: '2026-02-30T00:00:00.000Z' }), null);
  assert.equal(Store.normalizeSession({ ...session(), startedAt: 'yesterday' }), null);
  assert.equal(Store.normalizeSession({ ...session(), mode: 'invented' }), null);
});

test('partial and malformed fields recover valid drafts but never retain false completion', () => {
  const storage = new MemoryStorage();
  const value = completed();
  value.draft.vocab = [1, '2', 999, null, 1];
  value.draft.compose = ['valid sentence', 2];
  value.draft.confidence = ['sure', 'maybe', 'unknown', false, ''];
  value.draft.slots = [[0, 1], [0, 3], [3, 13]];
  value.draft.selectedSentence = 0;
  value.submitted = { vocab: true, concept: true, reading: true, outline: true, writing: true };
  value.phase = { concept: 'invalid', reading: 'quiz' };
  value.metrics = { readingMs: -5, dwell: [9, Infinity, -1], reg: -1, maxP: 99 };
  storage.setItem('trainingSession', JSON.stringify(value));
  const loaded = Store.loadSession(storage);
  assert.ok(loaded.warning);
  assert.equal(loaded.session.status, 'active');
  assert.equal(loaded.session.completedAt, null);
  assert.equal(loaded.session.results, null);
  assert.equal(loaded.session.currentStep, 1);
  assert.deepEqual(loaded.session.draft.vocab, [1, null, null, null, 1]);
  assert.deepEqual(loaded.session.draft.compose, ['valid sentence', '']);
  assert.deepEqual(loaded.session.submitted, { vocab: false, concept: false, reading: false, outline: false, writing: false });
  assert.equal(loaded.session.phase.reading, 'key');
  assert.equal(loaded.session.draft.selectedSentence, null);
  assert.deepEqual(loaded.session.metrics, { readingMs: 0, dwell: [9, 0, 0, 0], reg: 0, maxP: -1 });
});

test('a sparse valid session has safe defaults and preserves provided answers', () => {
  const value = session();
  delete value.submitted;
  delete value.phase;
  delete value.metrics;
  delete value.stepMs;
  value.draft = { vocab: [1] };
  const normalized = Store.normalizeSession(value);
  assert.deepEqual(normalized.draft.vocab, [1, null, null, null, null]);
  assert.deepEqual(normalized.stepMs, [0, 0, 0, 0]);
  assert.equal(normalized.submitted.vocab, false);
});

test('concept submission requires nonempty answers and explicit confidence for every blank', () => {
  const value = session({ mode: 'area', requiredSteps: [2] });
  value.draft.blanks = ['중심 문장', '뒷받침 문장', '바닷물', '염전', '증발'];
  value.draft.confidence = ['sure', 'sure', 'sure', 'sure', ''];
  value.submitted.concept = true;
  assert.equal(Store.normalizeSession(value).submitted.concept, false);
  value.draft.confidence[4] = 'maybe';
  assert.equal(Store.normalizeSession(value).submitted.concept, true);
  assert.equal(Store.normalizeSession(value).phase.concept, 'fill');
});

test('repeated sentence choices cannot complete reading or outline', () => {
  const value = session();
  value.draft.key = [0, 0, 0, 0];
  value.draft.readingAnswers = Array(7).fill(1);
  value.draft.slots = [[0], [0, 3], [9, 13]];
  value.draft.essay = '가'.repeat(40);
  value.submitted.reading = value.submitted.outline = value.submitted.writing = true;
  const normalized = Store.normalizeSession(value);
  assert.equal(normalized.submitted.reading, false);
  assert.equal(normalized.submitted.outline, false);
  assert.equal(normalized.submitted.writing, false);
});

test('reading completion requires one key sentence from each actual paragraph', () => {
  const value = session({ mode: 'area', requiredSteps: [3] });
  value.phase.reading = 'quiz';
  value.draft.readingAnswers = Array(7).fill(1);
  value.submitted.reading = true;
  for (const keys of [[0, 1, 2, 3], [0, 3, 8, 13], [0, 3, 9], [0, 3, 9, 13, 16]]) {
    value.draft.key = keys;
    const recovered = Store.normalizeSession(value);
    assert.equal(recovered.submitted.reading, false);
    assert.equal(recovered.phase.reading, 'key');
    assert.deepEqual(recovered.draft.key, keys.slice(0, 4));
  }
  value.draft.key = [2, 8, 12, 16];
  const valid = Store.normalizeSession(value);
  assert.equal(valid.submitted.reading, true);
  assert.equal(valid.phase.reading, 'quiz');
});

test('a new review preserves only canonical mistakes provided by the session adapter', () => {
  const mistakes = [{ type: 'vocab', index: 0 }, ...Array.from({ length: 17 }, (_, index) => ({ type: 'outline', index }))];
  const value = session({ mode: 'mistakes', reviewOf: 'original', mistakes });
  assert.deepEqual(value.mistakes, [{ type: 'vocab', index: 0 }, ...[0, 3, 9, 13, 15].map(index => ({ type: 'outline', index }))]);
  assert.deepEqual(value.mistakeAnswers, {});
  assert.equal(value.mistakeSubmitted, false);
  assert.equal(value.currentStep, 5);
});

test('restored outline mistakes must have a canonical target and key answers must belong to their paragraph', () => {
  const value = session({ mode: 'mistakes', mistakes: [{ type: 'key', index: 1 }, { type: 'outline', index: 3 }] });
  value.mistakeAnswers = { 'key-1': 0, 'outline-3': 1 };
  value.mistakeSubmitted = true;
  let normalized = Store.normalizeSession(value);
  assert.equal(normalized.mistakeSubmitted, false);
  assert.equal(owns(normalized.mistakeAnswers, 'key-1'), false);
  value.mistakeAnswers['key-1'] = 8;
  assert.equal(Store.normalizeSession(value).mistakeSubmitted, true);
  value.mistakes.push({ type: 'outline', index: 2 });
  value.mistakeAnswers['outline-2'] = 1;
  normalized = Store.normalizeSession(value);
  assert.deepEqual(normalized.mistakes, [{ type: 'key', index: 1 }, { type: 'outline', index: 3 }]);
  assert.equal(normalized.mistakeSubmitted, false);
});

test('normal adapter intermediate phases persist without recovery warnings', () => {
  const storage = new MemoryStorage();
  const value = session({ mode: 'area', requiredSteps: [3] });
  value.metrics.readingMs = 1234.5;
  value.phase.reading = 'key';
  value.draft.key = [0, 3];
  assert.equal(Store.saveSession(storage, value).warning, null);
  value.draft.key = [0, 3, 9, 13];
  value.phase.reading = 'quiz';
  assert.equal(Store.saveSession(storage, value).warning, null);
  value.draft.readingAnswers[0] = 1;
  assert.equal(Store.saveSession(storage, value).warning, null);
  value.draft.readingAnswers = Array(7).fill(1);
  value.submitted.reading = true;
  assert.equal(Store.saveSession(storage, value).warning, null);
  value.currentStep = 5;
  assert.equal(Store.saveSession(storage, value).warning, null);
});

test('revisiting a completed step preserves completion and the visited stage without warnings', () => {
  const storage = new MemoryStorage();
  const value = completed();
  value.currentStep = 1;
  assert.deepEqual(Store.saveSession(storage, value), { ok: true, warning: null });
  const restored = Store.loadSession(storage);
  assert.equal(restored.warning, null);
  assert.equal(restored.session.currentStep, 1);
  assert.equal(restored.session.status, 'completed');
  value.currentStep = 3;
  assert.equal(Store.normalizeSession(value).currentStep, 5);
});

test('mistake reviews only accept canonical entries and matching answers', () => {
  const value = session({ mode: 'mistakes', reviewOf: 'original-session' });
  value.mistakes = [{ type: 'vocab', index: 0 }, { type: 'concept', index: 1 }, { type: 'vocab', index: 0 }, { type: 'key', index: 4 }, { type: '__proto__', index: 0 }];
  value.mistakeAnswers = { 'vocab-0': 1, 'concept-1': '  ', 'unrelated-9': 3 };
  value.mistakeSubmitted = true;
  let normalized = Store.normalizeSession(value);
  assert.deepEqual(normalized.requiredSteps, []);
  assert.equal(normalized.currentStep, 5);
  assert.deepEqual(normalized.mistakes, [{ type: 'vocab', index: 0 }, { type: 'concept', index: 1 }]);
  assert.equal(normalized.mistakeSubmitted, false);
  assert.equal(owns(normalized.mistakeAnswers, 'unrelated-9'), false);
  value.mistakes = normalized.mistakes;
  value.mistakeAnswers['concept-1'] = '뒷받침 문장';
  value.status = 'completed';
  value.completedAt = '2026-10-08T00:01:00.000Z';
  value.results = { correct: 2, total: 2 };
  normalized = Store.normalizeSession(value);
  assert.equal(normalized.mistakeSubmitted, true);
  assert.equal(normalized.status, 'completed');
  value.mistakes = [];
  assert.equal(Store.normalizeSession(value).status, 'active');
});

test('recovering overflow in one outline slot preserves valid sentences in later slots', () => {
  const value = session();
  value.draft.slots = [[0, 3], [3, 9], [13, 15]];
  assert.deepEqual(Store.normalizeSession(value).draft.slots, [[0], [3, 9], [13, 15]]);
});

test('missing earlier answers restore to the unfinished required step', () => {
  const value = session();
  value.currentStep = 4;
  assert.equal(Store.normalizeSession(value).currentStep, 1);
  value.mode = 'area';
  value.requiredSteps = [3];
  value.currentStep = 3;
  assert.equal(Store.normalizeSession(value).currentStep, 3);
});

test('full completion requires every stage, a results object and a valid completion date', () => {
  const value = completed({ mode: 'full' });
  assert.equal(Store.normalizeSession(value).status, 'active');
  value.draft.blanks = ['중심 문장', '뒷받침 문장', '바닷물', '염전', '증발'];
  value.draft.confidence = Array(5).fill('sure');
  value.draft.key = [0, 3, 9, 13];
  value.draft.readingAnswers = [1, 2, 1, 2, 1, 1, 1];
  value.draft.slots = [[0], [3, 9], [13, 15]];
  value.draft.essay = '가'.repeat(40);
  value.submitted = { vocab: true, concept: true, reading: true, outline: true, writing: true };
  assert.equal(Store.normalizeSession(value).status, 'completed');
  value.completedAt = '2026-10-07T23:59:00.000Z';
  assert.equal(Store.normalizeSession(value).status, 'active');
  value.completedAt = '2026-10-08T00:01:00.000Z';
  value.results = null;
  assert.equal(Store.normalizeSession(value).status, 'active');
});

function owns(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }

test('completed results are saved once per stable ID and sorted newest first', () => {
  const storage = new MemoryStorage();
  const first = record();
  assert.deepEqual(Store.upsertHistory(storage, first), { ok: true, warning: null });
  assert.deepEqual(Store.upsertHistory(storage, first), { ok: true, warning: null });
  assert.equal(Store.loadHistory(storage).records.length, 1);
  const secondSession = completed({ id: 'second-session' });
  secondSession.completedAt = '2026-10-08T00:02:00.000Z';
  assert.equal(Store.upsertHistory(storage, record(secondSession)).ok, true);
  assert.deepEqual(Store.loadHistory(storage).records.map(item => item.id), ['second-session', 'test-session']);
  first.results.accuracy = 80;
  assert.equal(Store.upsertHistory(storage, first).ok, true);
  assert.equal(Store.loadHistory(storage).records.length, 2);
  assert.equal(Store.loadHistory(storage).records[1].results.accuracy, 80);
});

test('a malformed history entry cannot discard valid neighbors and duplicate IDs recover safely', () => {
  const storage = new MemoryStorage();
  const good = record();
  const another = record(completed({ id: 'second-session' }));
  storage.setItem('trainingHistory', JSON.stringify([null, good, { ...another, version: 99 }, { ...good, session: null }, another, good]));
  const loaded = Store.loadHistory(storage);
  assert.ok(loaded.warning);
  assert.equal(loaded.records.length, 2);
  assert.ok(loaded.records.some(item => item.id === 'test-session'));
  assert.ok(loaded.records.some(item => item.id === 'second-session'));
  const third = record(completed({ id: 'third-session' }));
  assert.equal(Store.upsertHistory(storage, third).ok, true);
  assert.equal(Store.loadHistory(storage).records.length, 3);
});

test('a corrupt whole history is reported, an invalid new record never replaces it', () => {
  const storage = new MemoryStorage();
  storage.setItem('trainingHistory', '{bad');
  assert.deepEqual(Store.loadHistory(storage).records, []);
  assert.ok(Store.loadHistory(storage).warning);
  assert.equal(Store.upsertHistory(storage, record(session())).ok, false);
  assert.equal(storage.getItem('trainingHistory'), '{bad');
});

test('invalid completed sessions and mismatched IDs cannot enter history', () => {
  const storage = new MemoryStorage();
  const invalid = record();
  invalid.session.draft.vocab[0] = null;
  assert.equal(Store.upsertHistory(storage, invalid).ok, false);
  const mismatched = record();
  mismatched.id = 'different-id';
  assert.equal(Store.upsertHistory(storage, mismatched).ok, false);
  assert.equal(storage.getItem('trainingHistory'), null);
});

test('quota errors leave previous persisted session and history intact', () => {
  const storage = new MemoryStorage();
  Store.saveSession(storage, session());
  Store.upsertHistory(storage, record());
  const oldSession = storage.getItem('trainingSession');
  const oldHistory = storage.getItem('trainingHistory');
  storage.setItem = () => { const error = new Error('full'); error.name = 'QuotaExceededError'; throw error; };
  const write = Store.saveSession(storage, session({ id: 'new-session' }));
  assert.equal(write.ok, false);
  assert.match(write.warning, /공간/);
  const historyWrite = Store.upsertHistory(storage, record(completed({ id: 'new-session' })));
  assert.equal(historyWrite.ok, false);
  assert.match(historyWrite.warning, /공간/);
  assert.equal(storage.getItem('trainingSession'), oldSession);
  assert.equal(storage.getItem('trainingHistory'), oldHistory);
});

test('disabled and inaccessible storage never throw, including removal', () => {
  const disabled = {
    getItem() { const error = new Error('denied'); error.name = 'SecurityError'; throw error; },
    setItem() { const error = new Error('denied'); error.name = 'SecurityError'; throw error; },
    removeItem() { const error = new Error('denied'); error.name = 'SecurityError'; throw error; }
  };
  for (const storage of [null, {}, disabled]) {
    assert.ok(Store.loadSession(storage).warning);
    assert.ok(Store.loadHistory(storage).warning);
    assert.equal(Store.saveSession(storage, session()).ok, false);
    assert.equal(Store.upsertHistory(storage, record()).ok, false);
    assert.equal(Store.clearSession(storage).ok, false);
  }
});

test('a throwing default localStorage getter is handled in the browser', () => {
  const context = vm.createContext({});
  vm.runInContext('Object.defineProperty(globalThis, "localStorage", { get() { throw new Error("denied"); } });', context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../training-store.js'), 'utf8'), context);
  assert.ok(context.TrainingStore.loadSession().warning);
  assert.ok(context.TrainingStore.loadHistory().warning);
  assert.equal(context.TrainingStore.saveSession(undefined, context.TrainingStore.createSession()).ok, false);
});

test('clearing a session preserves completed history', () => {
  const storage = new MemoryStorage();
  Store.saveSession(storage, session());
  Store.upsertHistory(storage, record());
  assert.deepEqual(Store.clearSession(storage), { ok: true, warning: null });
  assert.deepEqual(Store.loadSession(storage), { session: null, warning: null });
  assert.equal(Store.loadHistory(storage).records.length, 1);
});

test('result payloads are bounded JSON data and cannot pollute prototypes', () => {
  const value = completed();
  value.results = JSON.parse('{"accuracy":100,"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"feedback":"<img src=x onerror=alert(1)>"}');
  const normalized = Store.normalizeSession(value);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(owns(normalized.results, '__proto__'), false);
  assert.equal(owns(normalized.results, 'constructor'), false);
  assert.equal(normalized.results.feedback, '<img src=x onerror=alert(1)>');
});
