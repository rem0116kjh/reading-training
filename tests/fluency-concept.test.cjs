const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Content = require('../activity-content.js');
const Fluency = require('../fluency-content.js');
const Vocabulary = require('../vocabulary-content.js');
const Reading = require('../reading-content.js');
const Concept = require('../fluency-concept-content.js');
const { create } = require('../activity-engine.js');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const pkg = JSON.parse(vm.runInNewContext(source.slice(0, source.indexOf('const SENT =')) + '\nJSON.stringify(PKG)'));
const before = Reading.extend(Vocabulary.extend(Fluency.extend(Content.createCatalog(pkg), pkg), pkg, Fluency.CURRENT_AREAS.course), pkg, Vocabulary.CURRENT_AREAS.course);
const catalog = Concept.extend(before, pkg, Reading.CURRENT_AREAS.course), engine = create(catalog);
const clone = value => JSON.parse(JSON.stringify(value));
const fresh = () => engine.newSession(Concept.CURRENT_AREAS.fluency);

test('concept stages 1 and 2 read consecutively before one final cloze and preserve every older catalog and other course areas', () => {
  const original = JSON.stringify(pkg), definition = catalog[Concept.CURRENT_AREAS.fluency];
  assert.deepEqual(definition.tasks.map(task => task.stage || 'fill' + task.quizStage), [1, 2, 'fill2']);
  assert.equal(definition.tasks[1].display, 'masked-phrases');
  assert.equal(definition.tasks[1].displayInterval, 1200);
  assert.ok(definition.tasks.every(task => !['choice', 'order'].includes(task.kind)));
  const text = pkg.concept.parts.map(part => typeof part === 'number' ? pkg.concept.blanks[part].k : part).join('');
  definition.tasks.forEach(task => assert.equal(task.source, text));
  definition.tasks.filter(task => task.stage).forEach(task => assert.equal(task.units.join(' '), text));
  definition.tasks.filter(task => task.kind === 'cloze').forEach(task => {
    assert.deepEqual(task.parts, pkg.concept.parts);
    assert.deepEqual(task.blanks.map(blank => blank.answer), pkg.concept.blanks.map(blank => blank.k));
  });
  for (const key of Object.keys(before)) assert.equal(catalog[key], before[key]);
  for (const area of ['vocabulary', 'reading']) {
    const old = before[Reading.CURRENT_AREAS.course].tasks.filter(task => task.trainingArea === area);
    const current = catalog[Concept.CURRENT_AREAS.course].tasks.filter(task => task.trainingArea === area);
    assert.equal(current.length, old.length); current.forEach((task, i) => assert.equal(task, old[i]));
  }
  assert.equal(JSON.stringify(pkg), original);
});

test('cloze restores incomplete drafts, requires all five answers and valid confidence, and locks submitted answers', () => {
  let session = fresh();
  for (let i = 0; i < 2; i++) { engine.skipRead(session); engine.next(session); }
  const { task, entry } = engine.current(session), draft = task.blanks.flatMap(() => ['', 'maybe']);
  draft[0] = '중심문장'; draft[1] = 'sure';
  assert.equal(engine.answer(session, draft), true); assert.equal(engine.canSubmit(session), false);
  session = engine.normalize(session); assert.ok(session); assert.deepEqual(session.answers[entry.key], draft);
  const invalid = clone(session); invalid.answers[entry.key][1] = 'invalid'; assert.equal(engine.normalize(invalid), null);
  const full = task.answer.slice(); full[0] = '중심문장'; full[2] = '틀린 답'; full[3] = 'sure';
  engine.answer(session, full); assert.equal(engine.submit(session).ok, true);
  assert.equal(session.submitted[entry.key].correct, false);
  assert.equal(engine.answer(session, task.answer), false);
  assert.ok(engine.normalize(session));
  assert.equal(engine.results(session).correct, 4); assert.equal(engine.results(session).answered, 5);
});

test('mixed cloze answers score each blank, preserve actual read metrics, persist history and review without repeating reading', () => {
  let session = fresh();
  while (session.status === 'active') {
    const { task } = engine.current(session);
    if (task.kind === 'read') {
      engine.startRead(session);
      if (task.mode === 'tap') task.units.forEach(() => { engine.tick(session, 100); engine.tapRead(session); });
      else engine.tick(session, task.units.length * task.displayInterval);
      assert.equal(engine.finishRead(session), true);
    } else {
      const answer = task.answer.slice();
      answer[2] = '틀린 답'; answer[3] = 'sure'; answer[8] = '틀린 답'; answer[9] = 'maybe';
      engine.tick(session, 800); engine.answer(session, answer); assert.equal(engine.submit(session).ok, true);
    }
    assert.equal(engine.next(session), true); session = engine.normalize(session); assert.ok(session);
  }
  const result = engine.results(session);
  assert.equal(result.totalQuestions, 5); assert.equal(result.correct, 3); assert.equal(result.wrong, 2); assert.equal(result.accuracy, 60);
  assert.deepEqual(result.fluency.completedStages, [1, 2]);
  assert.deepEqual(result.fluency.quizResults.map(item => item.responseMs), [800]);
  assert.equal(result.fluency.quizResults[0].blankResults[1].confidence, 'sure');
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(engine.save(storage, session).ok, true); assert.equal(engine.saveCompleted(storage, session).ok, true);
  assert.deepEqual(clone(engine.results(engine.load(storage).session)), clone(result));
  assert.equal(engine.loadHistory(storage).records.length, 1);
  const review = engine.newSession(session.area, { reviewOf: session.id, taskIds: result.mistakes });
  const task = engine.current(review).task; assert.equal(task.kind, 'cloze');
  engine.answer(review, task.answer); engine.submit(review); engine.next(review);
  assert.equal(review.status, 'completed'); assert.equal(engine.results(review).totalQuestions, 5); assert.equal(engine.results(review).accuracy, 100);
  assert.deepEqual(engine.results(review).fluency.stages, []);
  assert.deepEqual(clone(engine.loadHistory(storage).records[0]), clone(session));
});

test('previous fluency sessions and their objective answers retain their original catalogs and result scores', () => {
  const oldEngine = create(before), session = oldEngine.newSession('fluencyIntegratedV1');
  oldEngine.skipRead(session); oldEngine.next(session);
  const task = oldEngine.current(session).task; oldEngine.answer(session, task.answer); oldEngine.submit(session);
  const saved = oldEngine.normalize(session), restored = engine.normalize(saved);
  assert.deepEqual(restored, saved); assert.deepEqual(engine.results(restored), oldEngine.results(saved));
});

test('previous 1-cloze-3-cloze sessions retain their draft, stage numbers and ten-blank results', () => {
  for (const area of ['fluencyConceptV1', 'courseConceptV1', 'courseConceptV2']) {
    const tasks = catalog[area].tasks.filter(task => task.trainingArea === 'fluency');
    assert.deepEqual(tasks.map(task => task.stage || 'fill' + task.quizStage), [1, 'fill1', 3, 'fill3']);
  }
  let session = engine.newSession('fluencyConceptV1'); engine.skipRead(session); engine.next(session);
  const { entry, task } = engine.current(session);
  const draft = task.answer.slice(); draft[0] = '중심문장'; draft[1] = 'maybe';
  engine.answer(session, draft); session = engine.normalize(session);
  assert.deepEqual(session.answers[entry.key], draft); assert.equal(engine.current(session).task.quizStage, 1);
  while (session.status === 'active') {
    const { task } = engine.current(session);
    if (task.kind === 'read') engine.skipRead(session);
    else { engine.answer(session, task.answer); engine.submit(session); }
    engine.next(session);
  }
  assert.equal(engine.results(engine.normalize(session)).totalQuestions, 10);
  assert.equal(engine.results(session).correct, 10);
});
