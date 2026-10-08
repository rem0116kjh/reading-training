const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createCatalog } = require('../activity-content.js');
const { extend } = require('../fluency-content.js');
const { create, SESSION_KEY, HISTORY_KEY } = require('../activity-engine.js');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const pkg = vm.runInNewContext(source.slice(0, source.indexOf('const SENT =')) + '\nJSON.parse(JSON.stringify(PKG))');
const base = createCatalog(pkg), catalog = extend(base, pkg), engine = create(catalog);
const copy = value => JSON.parse(JSON.stringify(value));
const fresh = area => engine.newSession(area, { startedAt: '2026-10-08T00:00:00.000Z' });
const storage = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) }; };
function finishRead(s) {
  const { task } = engine.current(s);
  if (task.stage) {
    engine.startRead(s);
    if (task.mode === 'tap') task.units.forEach(() => { engine.tick(s, 150); assert.equal(engine.tapRead(s), true); });
    else engine.tick(s, task.units.length * task.displayInterval);
  } else engine.tick(s, 500);
  assert.equal(engine.finishRead(s), true);
}
function finish(s, wrong = new Set()) {
  while(s.status === 'active') {
    const { task, entry } = engine.current(s);
    if(task.kind === 'read') finishRead(s);
    else {
      engine.tick(s, 700);
      const value = wrong.has(task.id) && !entry.retryOf ? task.kind === 'order' ? task.answer.slice().reverse() : (task.answer + 1) % task.options.length : task.answer;
      engine.answer(s, value); assert.equal(engine.submit(s).ok, true);
    }
    assert.ok(engine.normalize(s), 'every intermediate action is valid');
    assert.equal(engine.next(s), true);
    assert.ok(engine.normalize(s), 'every transition is restorable');
  }
  return s;
}

test('fixture preserves the package and all old tasks; new course is vocabulary -> three stages -> four quizzes -> reading', () => {
  const before = JSON.stringify(pkg), again = extend(base, pkg);
  assert.equal(JSON.stringify(pkg), before);
  for(const key of ['fluency', 'vocabulary', 'reading']) assert.equal(again[key], base[key]);
  const tasks = catalog.course.tasks;
  assert.equal(tasks.length, 46);
  assert.equal(tasks.slice(0,32).every(t => t.trainingArea === 'vocabulary'), true);
  assert.deepEqual(tasks.slice(32,35).map(t => t.mode), ['tap','paced','continuous']);
  assert.equal(tasks.slice(35,39).every(t => t.trainingArea === 'fluency'), true);
  assert.equal(tasks.slice(39).every(t => t.trainingArea === 'reading'), true);
  const sequence = tasks.find(t => t.quizType === 'sequence');
  assert.equal(sequence.fixture, true);
  assert.equal(sequence.answer.map(id => sequence.paragraphs.find(p=>p.id===id).text).join(' '), pkg.paragraphs[3].s[1]);
  assert.equal(tasks.filter(t=>t.stage).every(t=>t.units.join(' ') === pkg.paragraphs.flatMap(p=>p.s).join(' ')), true);
});

test('all stages gate normal completion, preserve taps and timing, and reject forged read progress', () => {
  let s = fresh('fluencyStages'); const {task,entry} = engine.current(s);
  assert.equal(engine.tapRead(s), false); assert.equal(engine.tick(s, 500), false); assert.equal(engine.finishRead(s), false);
  engine.startRead(s); engine.tick(s, 340); engine.tapRead(s);
  assert.equal(s.read[entry.key].position, 1); assert.deepEqual(s.read[entry.key].tapIntervals,[340]);
  assert.equal(engine.finishRead(s), false);
  s = engine.normalize(s); assert.ok(s); assert.equal(s.read[entry.key].position, 1);
  for(let i=1;i<task.units.length;i++) { engine.tick(s,100); engine.tapRead(s); }
  assert.equal(engine.finishRead(s), true); engine.next(s);
  engine.startRead(s); engine.tick(s, 2100);
  const second = engine.current(s).entry.key;
  assert.equal(s.read[second].position, 3);
  const forged = copy(s); forged.read[second].done = true;
  assert.equal(engine.normalize(forged), null);
  const future = copy(s); future.read['base-3'].started = true;
  assert.equal(engine.normalize(future), null);
  s = engine.normalize(s); assert.ok(s); assert.equal(s.read[second].displayInterval,700);
  assert.equal(engine.finishRead(s), false);
});

test('explicit skips preserve partial readings, restore every stage and never count as completed reading or reading speed', () => {
  let s = fresh('fluencyIntegratedV1');
  while (s.status === 'active') {
    const { task, entry } = engine.current(s);
    if (task.kind === 'read') {
      engine.startRead(s);
      engine.tick(s, task.mode === 'tap' ? 400 : task.displayInterval * 2);
      if (task.mode === 'tap') engine.tapRead(s);
      const before = copy(s.read[entry.key]), elapsed = s.elapsedMs;
      assert.equal(engine.skipRead(s), true);
      assert.deepEqual(s.read[entry.key], { ...before, skipped: true });
      assert.equal(engine.tick(s, 5000), false);
      assert.equal(s.elapsedMs, elapsed);
      assert.equal(engine.finishRead(s), false);
      assert.equal(engine.startRead(s), false);
      assert.equal(engine.skipRead(s), false);
      s = engine.normalize(s); assert.ok(s, 'a skipped stage restores before navigation');
    } else {
      assert.equal(engine.skipRead(s), false, 'quizzes cannot be skipped');
      engine.answer(s, task.answer); assert.equal(engine.submit(s).ok, true);
    }
    assert.equal(engine.next(s), true);
    s = engine.normalize(s); assert.ok(s, 'skipped stages stay valid after navigation');
    assert.ok(engine.progress(s).percent <= 100);
  }
  const result = engine.results(s);
  assert.equal(result.accuracy, 100); assert.equal(result.totalQuestions, 6);
  assert.deepEqual(result.fluency.completedStages, []);
  assert.ok(result.fluency.stages.every(stage => stage.skipped && !stage.complete && stage.wordsPerMinute === null));
  const store = storage(); assert.equal(engine.save(store, s).ok, true);
  assert.equal(engine.saveCompleted(store, s).ok, true);
  assert.deepEqual(engine.results(engine.load(store).session), result);
  assert.deepEqual(engine.results(engine.loadHistory(store).records[0]), result);
});

test('unstarted stages and ordinary passages can be skipped while malformed or out-of-order skip records are rejected', () => {
  const s = fresh('fluencyStages'), key = engine.current(s).entry.key;
  assert.equal(engine.skipRead(s), true);
  assert.equal(s.read[key].started, false); assert.equal(s.read[key].position, 0);
  assert.ok(engine.normalize(s));
  for (const mutate of [v => v.read[key].skipped = 'yes', v => v.read[key].done = true, v => v.read['base-3'].skipped = true]) {
    const broken = copy(s); mutate(broken); assert.equal(engine.normalize(broken), null);
  }
  const reading = fresh('reading'), entry = engine.current(reading).entry;
  engine.tick(reading, 500); assert.equal(engine.skipRead(reading), true);
  assert.equal(reading.read[entry.key].elapsedMs, 500);
  assert.equal(engine.next(reading), true); assert.ok(engine.normalize(reading));
  assert.equal(engine.skipRead(reading), false); assert.equal(engine.next(reading), false);
});

test('full course stores area metrics and fluency details, retains vocabulary retries, deduplicates completion and reviews only wrong questions', () => {
  const s = finish(fresh('course'), new Set(['vocabulary-meaning-1','salt-fluency-v1-quiz-1','salt-fluency-v1-sequence']));
  const r = engine.results(s);
  assert.equal(r.totalQuestions,42); assert.equal(r.correct,39); assert.equal(r.wrong,3);
  assert.equal(r.reviewAttempts,1); assert.equal(s.queue[2].retryOf,'base-1');
  assert.deepEqual(Object.keys(r.areas), ['vocabulary','fluency','reading']);
  assert.deepEqual(r.fluency.completedStages,[1,2,3]); assert.equal(r.fluency.passageId,'salt-original-v1');
  assert.equal(r.fluency.correct,2); assert.equal(r.fluency.total,4); assert.equal(r.fluency.accuracy,50);
  assert.equal(r.fluency.quizResults.find(q=>q.type==='blank').correct,false);
  assert.equal(r.fluency.quizResults.find(q=>q.type==='sequence').correct,false);
  assert.ok(r.fluency.stages.every(stage=>stage.elapsedMs>0 && stage.wordsPerMinute>0));
  assert.ok(r.fluency.quizResults.every(q=>q.responseMs===700));
  const store=storage(); assert.equal(engine.save(store,s).ok,true);
  assert.deepEqual(engine.results(engine.load(store).session),r);
  for(let i=0;i<3;i++) assert.equal(engine.saveCompleted(store,s).ok,true);
  assert.equal(engine.loadHistory(store).records.length,1);
  const review=finish(engine.newSession('course',{reviewOf:s.id,taskIds:r.mistakes}));
  assert.equal(engine.results(review).totalQuestions,3); assert.equal(engine.results(review).accuracy,100);
  assert.equal(review.queue.some(q=>catalog.course.tasks.find(t=>t.id===q.taskId).kind==='read'),false);
  engine.saveCompleted(store,review); assert.equal(engine.loadHistory(store).records.length,2);
  assert.deepEqual(engine.loadHistory(store).records.find(x=>x.id===s.id),engine.normalize(s));
});

test('legacy area and integrated storage remain intact alongside new sessions, including old history', () => {
  const store=storage(); const old=finish(fresh('fluency')); const oldSaved=JSON.stringify(old);
  store.setItem('trainingSession','untouched'); store.setItem('trainingHistory','untouched-history');
  store.setItem(SESSION_KEY, oldSaved); store.setItem(HISTORY_KEY,JSON.stringify([old]));
  assert.equal(engine.load(store).session.area,'fluency');
  const next=fresh('course'); engine.save(store,next);
  assert.equal(engine.loadHistory(store).records[0].area,'fluency');
  assert.equal(store.getItem('trainingSession'),'untouched'); assert.equal(store.getItem('trainingHistory'),'untouched-history');
});

test('metrics reject invalid durations, unknown response keys and forged passage identity without overwriting stored bytes', () => {
  const s=fresh('course'); engine.tick(s,1000);
  for(const mutate of [v=>v.metrics.responseMs.unknown=4,v=>v.metrics.areaMs.vocabulary=-1,v=>v.passageId='other',v=>v.metrics.responseMs['base-2']=2000]) {
    const broken=copy(s); mutate(broken); assert.equal(engine.normalize(broken),null);
    const store=storage(); store.setItem(SESSION_KEY,'existing'); assert.equal(engine.save(store,broken).ok,false); assert.equal(store.getItem(SESSION_KEY),'existing');
  }
});


test('corrected rounds preserve source questions, follow read-quiz order, and end with multiple choice', () => {
  const tasks=catalog.fluencyRounds.tasks;
  assert.deepEqual(tasks.map(t=>t.stage ? 'read'+t.stage : 'quiz'+t.quizStage), ['read1','quiz1','read2','quiz2','quiz2','read3','quiz3']);
  assert.equal(tasks.at(-1).kind,'choice');
  assert.equal(tasks[5].units.join(' '),pkg.paragraphs.flatMap(p=>p.s).join(' '));
  assert.ok(tasks[5].units.every(p=>p.split(/\s+/).length<=3));
  const oldQuiz=catalog.fluencyStages.tasks.filter(t=>t.kind!=='read');
  for(const task of tasks.filter(t=>t.kind!=='read')) {
    const old=oldQuiz.find(t=>t.id===task.id);
    assert.equal(task.question,old.question); assert.deepEqual(task.answer,old.answer);
  }
  const s=finish(fresh('courseRounds'));
  assert.equal(engine.results(s).totalQuestions,42); assert.equal(engine.results(s).accuracy,100);
  assert.deepEqual(engine.results(s).fluency.completedStages,[1,2,3]);
  assert.deepEqual(engine.normalize(s),s);
});

test('new timed rounds advance every two seconds and keep earlier saved timings intact', () => {
  for (const area of ['fluencyRounds2s', 'courseRounds2s']) {
    const reads = catalog[area].tasks.filter(t => t.stage && t.mode !== 'tap');
    assert.deepEqual(reads.map(t => t.displayInterval), [2000, 2000]);
    const s = fresh(area);
    while (s.status === 'active') {
      const { task, entry } = engine.current(s), key = entry.key;
      if (reads.includes(task)) {
        engine.startRead(s); engine.tick(s, 1999);
        assert.equal(s.read[key].position, 0);
        engine.tick(s, 1); assert.equal(s.read[key].position, 1);
        assert.deepEqual(engine.normalize(s), s);
        engine.tick(s, (task.units.length - 1) * 2000);
        assert.equal(engine.finishRead(s), true);
        assert.equal(s.read[key].elapsedMs, task.units.length * 2000);
      } else if (task.kind === 'read') finishRead(s);
      else { engine.answer(s, task.answer); engine.submit(s); }
      engine.next(s);
    }
    assert.equal(engine.results(s).accuracy, 100);
  }
  const saved = fresh('fluencyRounds');
  assert.deepEqual(engine.normalize(saved), saved);
  assert.deepEqual(catalog.fluencyRounds.tasks.filter(t=>t.stage).map(t=>t.displayInterval), [0,700,2100]);
  const completed = finish(fresh('courseRounds'));
  assert.deepEqual(engine.normalize(completed), completed);
});

test('current fluency replaces only the ordering fixture with multiple choice and uses 1.2-second intervals', () => {
  const { CURRENT_AREAS } = require('../fluency-content.js');
  for (const area of [CURRENT_AREAS.fluency, CURRENT_AREAS.course]) {
    const fluency = catalog[area].tasks.filter(t => t.trainingArea === 'fluency');
    assert.deepEqual(fluency.filter(t => t.kind !== 'read').map(t => t.kind), Array(6).fill('choice'));
    const process = fluency.find(t => t.quizType === 'process');
    assert.equal(process.source, pkg.paragraphs[3].s[1]);
    assert.equal(process.options.length, 4); assert.equal(new Set(process.options).size, 4);
    assert.equal(process.options[process.answer], '소금이 있는 재료 모으기 → 물기 없애기 → 남은 소금 거두기');
    const s = fresh(area);
    while (s.status === 'active') {
      const { task, entry } = engine.current(s);
      if (task.stage && task.mode !== 'tap') {
        assert.equal(task.displayInterval, 1200);
        engine.startRead(s); engine.tick(s, 1199);
        assert.equal(s.read[entry.key].position, 0);
        engine.tick(s, 1); assert.equal(s.read[entry.key].position, 1);
        assert.deepEqual(engine.normalize(s), s);
        engine.tick(s, (task.units.length - 1) * 1200); engine.finishRead(s);
      } else if (task.kind === 'read') finishRead(s);
      else { engine.answer(s, task.answer); engine.submit(s); }
      engine.next(s);
    }
    assert.equal(engine.results(s).accuracy, 100);
    assert.deepEqual(engine.normalize(s), s);
  }
  assert.equal(catalog.reading, base.reading);
  assert.equal(catalog.vocabulary, base.vocabulary);
  assert.deepEqual(engine.normalize(finish(fresh('fluencyRounds2s'))).area, 'fluencyRounds2s');
});

test('integrated stage 3 reuses three source questions with unchanged choices, supports review and preserves older records', () => {
  const tasks = catalog.fluencyIntegratedV1.tasks;
  assert.deepEqual([1,2,3].map(stage=>tasks.filter(t=>t.quizStage===stage).length),[1,2,3]);
  const expected = [pkg.vquiz[2],pkg.questions[5],pkg.questions[6]];
  tasks.filter(t=>t.quizStage===3).forEach((task,i)=>{
    assert.equal(task.question,expected[i].q);
    assert.deepEqual(task.options,expected[i].o);
    assert.equal(task.answer,expected[i].a);
    assert.equal(task.kind,'choice');
    assert.ok(task.source && task.sourceRef);
  });
  const wrongIds = ['salt-fluency-v4-role-blank','salt-fluency-v4-sunlight-inference'];
  const s=finish(fresh('courseIntegratedV1'),new Set(wrongIds));
  const r=engine.results(s);
  assert.equal(r.totalQuestions,44); assert.equal(r.fluency.total,6);
  assert.equal(r.fluency.correct,4); assert.equal(r.fluency.accuracy,67);
  assert.deepEqual(r.mistakes,wrongIds);
  const retry=finish(engine.newSession(s.area,{reviewOf:s.id,taskIds:r.mistakes}));
  assert.equal(engine.results(retry).totalQuestions,2);
  assert.equal(engine.results(retry).accuracy,100);
  const store=storage(), old=finish(fresh('courseChoiceV1'));
  engine.saveCompleted(store,old); engine.saveCompleted(store,s); engine.saveCompleted(store,retry);
  const records=engine.loadHistory(store).records;
  assert.equal(records.length,3); assert.deepEqual(records.find(v=>v.id===old.id),old);
  assert.equal(engine.results(old).totalQuestions,42);
});
