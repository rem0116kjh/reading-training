const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Content = require('../activity-content.js');
const Comprehension = require('../reading-comprehension.js');
const { create } = require('../activity-engine.js');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const pkg = JSON.parse(vm.runInNewContext(source.slice(0, source.indexOf('const SENT =')) + '\nJSON.stringify(PKG)'));
const before = Content.createCatalog(pkg);
const { catalog } = Comprehension.extend(before, pkg);
const area = Comprehension.CURRENT_AREAS.reading, definition = catalog[area], engine = create(catalog);
const EXPECTED = ['소금', '염전', '햇볕에 말린다', '암염 광산', '맛을 내고 음식을 오래 보관한다',
  '물이 잘 증발해야 소금이 남기 때문에', '그곳은 아주 오래전에 바다였다'];

test('replace the four content questions with exactly five fact and two inference choices, preserving every other task and catalog', () => {
  for (const key of Object.keys(before)) assert.equal(catalog[key], before[key]);
  assert.deepEqual(definition.tasks.filter(t => !t.comprehensionType), before.reading.tasks.filter(t => !t.id.startsWith('reading-content-')));
  const questions = definition.tasks.filter(t => t.comprehensionType);
  assert.equal(questions.length, 7); assert.equal(new Set(definition.tasks.map(t => t.id)).size, definition.tasks.length);
  assert.equal(questions.filter(t => t.comprehensionType === 'fact').length, 5);
  assert.equal(questions.filter(t => t.comprehensionType === 'inference').length, 2);
  assert.deepEqual(questions.map(t => t.options[t.answer]), EXPECTED);
  questions.forEach((t, i) => { assert.equal(t.question, pkg.questions[i].q); assert.deepEqual(t.options, pkg.questions[i].o); assert.equal(t.options.length, 5); assert.equal(t.questionNumber, i + 1); });
  assert.throws(() => Comprehension.extend(before, { ...pkg, questions: pkg.questions.slice(0, 4) }), /5문제/);
});

test('the full course replaces only its reading content block and retains all other reading and other-area tasks', () => {
  const extra = { id: 'reading-extra', kind: 'choice', options: ['기존', '새'], answer: 0, trainingArea: 'reading' };
  const reading = { ...before.reading, tasks: [...before.reading.tasks, extra] };
  const course = { integrated: true, tasks: [...before.vocabulary.tasks, ...reading.tasks] };
  const old = { ...before, expanded: reading, course };
  const next = Comprehension.extend(old, pkg, { reading: 'expanded', course: 'course' });
  assert.equal(next.catalog.course, course); assert.equal(next.catalog.expanded, reading);
  assert.deepEqual(next.catalog[next.currentAreas.course].tasks.filter(t => !t.comprehensionType), course.tasks.filter(t => !t.id.startsWith('reading-content-')));
  assert.equal(next.catalog[next.currentAreas.reading].tasks.at(-1), extra);
});

test('four submitted answers restore at question five, every answer key scores correctly, and wrong-only review preserves original scores', () => {
  let s = engine.newSession(area);
  while (engine.current(s).task.id !== 'reading-content-5') {
    const { task } = engine.current(s);
    if (task.kind === 'read') engine.finishRead(s);
    else { engine.answer(s, task.answer); engine.submit(s); }
    engine.next(s);
  }
  const data = new Map(), storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  assert.equal(engine.save(storage, s).ok, true); s = engine.load(storage).session;
  assert.equal(engine.current(s).task.id, 'reading-content-5');
  assert.equal(Comprehension.results(definition, s).answered, 4);
  assert.equal(engine.next(s), false);
  while (s.status === 'active') {
    const { task } = engine.current(s);
    engine.answer(s, task.id === 'reading-content-6' ? 0 : task.answer); engine.submit(s); engine.next(s);
  }
  assert.deepEqual(Comprehension.results(definition, s), { correct: 6, total: 7, answered: 7,
    fact: { correct: 5, total: 5, answered: 5 }, inference: { correct: 1, total: 2, answered: 2 } });
  assert.deepEqual(engine.results(s).mistakes, ['reading-content-6']);
  assert.equal(engine.progress(s).percent, 100); assert.equal(engine.saveCompleted(storage, s).ok, true);
  const review = engine.newSession(area, { reviewOf: s.id, taskIds: engine.results(s).mistakes });
  assert.deepEqual(review.taskIds, ['reading-content-6']); engine.answer(review, 1); engine.submit(review); engine.next(review);
  assert.equal(Comprehension.results(definition, review).correct, 1);
  assert.equal(Comprehension.results(definition, s).correct, 6);
  assert.deepEqual(engine.loadHistory(storage).records[0], s);
});

test('older four-question sessions keep their saved queue, answers, completion and six-question score', () => {
  const oldEngine = create(before), s = oldEngine.newSession('reading');
  while (s.status === 'active') {
    const { task } = oldEngine.current(s);
    if (task.kind === 'read') oldEngine.finishRead(s); else { oldEngine.answer(s, task.answer); oldEngine.submit(s); }
    oldEngine.next(s);
  }
  assert.deepEqual(engine.normalize(s), s);
  assert.deepEqual(engine.results(s), oldEngine.results(s));
  assert.equal(engine.results(s).totalQuestions, 6);
});
