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
const Diagnostic = require('../reading-diagnostic.js');
const { create } = require('../activity-engine.js');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const pkg = JSON.parse(vm.runInNewContext(source.slice(0, source.indexOf('const SENT =')) + '\nJSON.stringify(PKG)'));
const reading = Reading.extend(Vocabulary.extend(Fluency.extend(Content.createCatalog(pkg), pkg), pkg, Fluency.CURRENT_AREAS.course), pkg, Vocabulary.CURRENT_AREAS.course);
const comprehension = Comprehension.extend(Concept.extend(reading, pkg, Reading.CURRENT_AREAS.course), pkg, { reading: Reading.CURRENT_AREAS.reading, course: Concept.CURRENT_AREAS.course });
const before = Flow.extend(comprehension.catalog, comprehension.currentAreas);
const { catalog, currentAreas } = Diagnostic.extend(before.catalog, before.currentAreas);
const engine = create(catalog);
const expected = ['reading-passage', 'reading-key', ...Array.from({ length: 7 }, (_, index) => 'reading-content-' + (index + 1)), 'reading-outline', 'reading-summary'];

test('passage two and full course use the requested order and preserve original questions, writing and other areas', () => {
  for (const [area, definition] of Object.entries(before.catalog)) assert.equal(catalog[area], definition);
  for (const area of [currentAreas.reading, currentAreas.course]) {
    const tasks = catalog[area].tasks.filter(task => task.trainingArea === 'reading' || task.id === 'reading-passage');
    assert.deepEqual(tasks.map(task => task.id), expected);
    assert.deepEqual(tasks.filter(task => task.comprehensionType), before.catalog[before.currentAreas.reading].tasks.filter(task => task.comprehensionType));
    assert.deepEqual(tasks.find(task => task.kind === 'summary'), before.catalog[before.currentAreas.reading].tasks.find(task => task.kind === 'summary'));
    const passage = tasks.find(task => task.id === 'reading-passage');
    const diagnostic = tasks.find(task => task.id === 'reading-key');
    assert.equal(passage.readingTrace, true);
    assert.equal(diagnostic.display, 'key-passage');
    assert.equal(diagnostic.selectionType, 'key');
    assert.deepEqual(diagnostic.paragraphs, pkg.paragraphs);
    assert.deepEqual(diagnostic.groups.map(group => group.label), pkg.paragraphs.map(paragraph => paragraph.role));
    assert.deepEqual(diagnostic.groups.map(({ label, ...group }) => group), before.catalog[before.currentAreas.reading].tasks.find(task => task.id === 'reading-key').groups.map(({ label, ...group }) => group));
    assert.equal(tasks.find(task => task.id === 'reading-outline').display, 'sentence-roles');
  }
  assert.deepEqual(catalog[currentAreas.course].tasks.filter(task => task.trainingArea !== 'reading'), before.catalog[before.currentAreas.course].tasks.filter(task => task.trainingArea !== 'reading'));
});

test('diagnostic captures reading time, grades all four paragraphs and restores a partial selection before seven questions', () => {
  let session = engine.newSession(currentAreas.reading);
  engine.tick(session, 3200); engine.finishRead(session); engine.next(session);
  assert.equal(engine.current(session).task.diagnostic, true);
  assert.equal(engine.next(session), false);
  engine.answer(session, [0, null, null, null]);
  session = engine.normalize(JSON.parse(JSON.stringify(session)));
  assert.deepEqual(session.answers['base-2'], [0, null, null, null]);
  assert.equal(engine.submit(session).ok, false);
  engine.answer(session, [0, 4, 9, 13]); engine.submit(session);
  assert.deepEqual(Diagnostic.results(catalog[session.area], session), { readingMs: 3200, skipped: false, answered: true, correct: 3, total: 4 });
  engine.next(session); assert.equal(engine.current(session).task.id, 'reading-content-1');
  while (engine.current(session).task.comprehensionType) {
    engine.answer(session, engine.current(session).task.answer); engine.submit(session); engine.next(session);
  }
  assert.equal(engine.current(session).task.id, 'reading-outline');
  engine.answer(session, engine.current(session).task.answer); engine.submit(session); engine.next(session);
  assert.equal(engine.current(session).task.id, 'reading-summary');
  engine.answer(session, pkg.outline.ref); engine.submit(session); engine.next(session);
  assert.equal(session.status, 'completed'); assert.equal(engine.results(session).totalQuestions, 9);
  assert.deepEqual(engine.normalize(session), session);
});

test('skipping reading is explicit and a diagnostic-only review does not invent a reading time', () => {
  const skipped = engine.newSession(currentAreas.reading);
  engine.tick(skipped, 500); engine.skipRead(skipped); engine.next(skipped);
  assert.equal(Diagnostic.results(catalog[skipped.area], skipped).skipped, true);
  const review = engine.newSession(currentAreas.reading, { reviewOf: 'completed-source', taskIds: ['reading-key'] });
  assert.equal(Diagnostic.results(catalog[review.area], review).readingMs, null);
});


test('historical V2 sentence roles retain their original categories and scoring', () => {
  const s = engine.newSession('readingDiagnosticV2'); engine.finishRead(s); engine.next(s);
  assert.equal(engine.current(s).task.display, 'sentence-roles');
  assert.deepEqual(engine.current(s).task.groups.map(g => [g.label, g.capacity]), [['처음', 1], ['중간', 2], ['끝', 1]]);
  assert.equal(engine.answer(s, [0, 9, 3, 13]), true); assert.equal(engine.submit(s).correct, true);
  assert.equal(Diagnostic.results(catalog[s.area], s).correct, 4);
  const wrong = engine.newSession('readingDiagnosticV2'); engine.finishRead(wrong); engine.next(wrong);
  assert.equal(engine.answer(wrong, [3, 0, 9, 13]), true); assert.equal(engine.submit(wrong).correct, false);
  assert.equal(Diagnostic.results(catalog[wrong.area], wrong).correct, 2);
});
test('current diagnostic selects one sentence in each paragraph before the later role exercise', () => {
  const s = engine.newSession(currentAreas.reading); engine.finishRead(s); engine.next(s);
  assert.equal(engine.answer(s, [0, 9, 3, 13]), false);
  assert.equal(engine.answer(s, [0, 3, 9, 13]), true);
  assert.equal(engine.submit(s).correct, true);
  assert.equal(Diagnostic.results(catalog[s.area], s).correct, 4);
  const outline = engine.newSession(currentAreas.reading, { reviewOf: 'completed-source', taskIds: ['reading-outline'] });
  assert.equal(engine.current(outline).task.display, 'sentence-roles');
  const answer = engine.current(outline).task.answer.slice();
  [answer[1], answer[2]] = [answer[2], answer[1]];
  assert.equal(engine.answer(outline, answer), true); assert.equal(engine.submit(outline).correct, true);
});
test('active V1 diagnostics migrate without losing the existing answer, time or later submissions while completed V1 remains unchanged', () => {
  const s = engine.newSession('readingDiagnosticV1'); engine.tick(s, 600); engine.finishRead(s); engine.next(s);
  engine.answer(s, [0, 3, null, null]); const next = Diagnostic.migrate(s, catalog, engine);
  assert.equal(next.area, currentAreas.reading); assert.deepEqual(next.answers, s.answers); assert.equal(next.elapsedMs, s.elapsedMs);
  assert.deepEqual(engine.normalize(next), next); assert.equal(s.area, 'readingDiagnosticV1');
  engine.answer(s, [0, 3, 9, 13]); engine.submit(s); engine.next(s);
  engine.answer(s, engine.current(s).task.answer); engine.submit(s); engine.next(s);
  const later = Diagnostic.migrate(s, catalog, engine); assert.deepEqual(later.submitted, s.submitted);
  assert.equal(engine.current(later).task.id, 'reading-content-2');
  while (s.status === 'active') {
    const task = engine.current(s).task;
    engine.answer(s, task.kind === 'summary' ? task.source : task.answer); engine.submit(s); engine.next(s);
  }
  assert.equal(Diagnostic.migrate(s, catalog, engine), s); assert.deepEqual(engine.normalize(s), s);
});

test('unfinished V2 drafts map selected sentences to their paragraph without mutating source answers', () => {
  for (const area of ['readingDiagnosticV2', 'courseDiagnosticV2']) {
    const s = engine.newSession(area, { reviewOf: 'completed-source', taskIds: ['reading-passage', 'reading-key'] });
    engine.tick(s, 950); engine.finishRead(s); engine.next(s);
    engine.answer(s, [9, 13, 3, 0]);
    const migrated = Diagnostic.migrate(s, catalog, engine);
    assert.equal(migrated.area, area === 'readingDiagnosticV2' ? currentAreas.reading : currentAreas.course);
    assert.deepEqual(migrated.answers['base-2'], [0, 3, 9, 13]);
    assert.deepEqual(s.answers['base-2'], [9, 13, 3, 0]);
    assert.equal(migrated.elapsedMs, 950);
    assert.deepEqual(migrated.read['base-1'].elapsedMs, s.read['base-1'].elapsedMs);
    assert.deepEqual(engine.normalize(migrated), migrated);
  }
});

test('V2 migration keeps the first selected sentence per paragraph and leaves missing paragraphs empty', () => {
  const s = engine.newSession('readingDiagnosticV2'); engine.finishRead(s); engine.next(s);
  engine.answer(s, [4, 3, 0, null]);
  const migrated = Diagnostic.migrate(s, catalog, engine);
  assert.deepEqual(migrated.answers['base-2'], [0, 4, null, null]);
  assert.equal(engine.submit(migrated).ok, false);
  assert.deepEqual(s.answers['base-2'], [4, 3, 0, null]);
});

test('submitted V2 diagnostics and completed histories stay in their original catalog', () => {
  const s = engine.newSession('readingDiagnosticV2'); engine.finishRead(s); engine.next(s);
  engine.answer(s, [3, 0, 9, 13]); engine.submit(s); engine.next(s);
  assert.equal(Diagnostic.migrate(s, catalog, engine), s);
  assert.equal(Diagnostic.results(catalog[s.area], s).correct, 2);
  while (s.status === 'active') {
    const task = engine.current(s).task;
    engine.answer(s, task.kind === 'summary' ? task.source : task.answer); engine.submit(s); engine.next(s);
  }
  assert.equal(Diagnostic.migrate(s, catalog, engine), s);
  assert.deepEqual(engine.normalize(s), s);
});
