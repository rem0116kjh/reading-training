const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createCatalog } = require('../activity-content.js');
const Fluency = require('../fluency-content.js');
const Vocabulary = require('../vocabulary-content.js');
const { create, SESSION_KEY, HISTORY_KEY } = require('../activity-engine.js');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const pkg = JSON.parse(vm.runInNewContext(source.slice(0, source.indexOf('const SENT =')) + '\nJSON.stringify(PKG)'));
const original = require('../docs/vocabulary-audit/public-artifact.json').package;
const before = Fluency.extend(createCatalog(pkg), pkg);
const catalog = Vocabulary.extend(before, pkg, Fluency.CURRENT_AREAS.course);
const engine = create(catalog);
const copy = value => JSON.parse(JSON.stringify(value));
const sentences = ['말랑한 반죽이 시간이 지나 단단하게 굳었어요.', '소금은 음식의 맛을 내는 역할을 해요.'];
const store = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) }; };
const fresh = () => engine.newSession(Vocabulary.CURRENT_AREAS.vocabulary);

test('live Artifact questions and all original learning content are reused without changing other area catalogs', () => {
  assert.deepEqual(pkg, original);
  const current = catalog[Vocabulary.CURRENT_AREAS.vocabulary];
  const quizzes = current.tasks.filter(t => t.kind === 'choice');
  assert.equal(quizzes.length, 5);
  quizzes.forEach((task, i) => {
    assert.deepEqual([task.question, task.options, task.answer], [original.vquiz[i].q, original.vquiz[i].o, original.vquiz[i].a]);
    assert.equal(task.sourceRef, 'vquiz.' + i);
  });
  assert.equal(new Set(quizzes.map(t => t.question)).size, 5);
  assert.deepEqual(current.tasks.at(-1).prompts.map(p => p.word), original.compose);
  current.words.forEach((word, i) => {
    assert.equal(word.meaning, original.vocab[i].meaning);
    assert.equal(word.example, original.paragraphs.flatMap(p => p.s)[original.vocab[i].s]);
  });
  for (const key of Object.keys(before)) assert.equal(catalog[key], before[key], 'old catalog identity: ' + key);
  const nonVocabulary = before[Fluency.CURRENT_AREAS.course].tasks.filter(t => t.trainingArea !== 'vocabulary');
  catalog[Vocabulary.CURRENT_AREAS.course].tasks.slice(6).forEach((task,i) => assert.equal(task, nonVocabulary[i]));
});

function reachPractice(storage) {
  let s = fresh();
  engine.tick(s, 1000, { answering: false });
  while (engine.current(s).task.kind !== 'practice') {
    const {task,entry} = engine.current(s);
    engine.tick(s, 500);
    engine.answer(s, task.id === 'salt-vocabulary-original-1' && !entry.retryOf ? 0 : task.answer);
    engine.submit(s); engine.next(s);
    assert.equal(engine.save(storage,s).ok,true);
    s = engine.load(storage).session;
    assert.ok(s, 'intermediate answers, retries and time restore');
  }
  return s;
}

test('mixed-answer vocabulary saves 80 percent and writing after exactly five questions without automatic retries', () => {
  const storage = store(), s = reachPractice(storage);
  const task = engine.current(s), draft = sentences.slice();
  draft[1] = '';
  engine.answer(s,draft); engine.save(storage,s);
  assert.deepEqual(engine.load(storage).session.answers[task.entry.key],draft);
  assert.equal(engine.submit(s).ok,false);
  assert.equal(engine.next(s),false);
  engine.answer(s,['ㄱ','ㅇ']); assert.equal(engine.canSubmit(s),true);
  engine.answer(s,sentences); engine.tick(s,1200);
  assert.equal(engine.submit(s).correct,null);
  assert.equal(s.queue.length,6, 'five choices and one unchanged ungraded practice');
  assert.equal(engine.next(s),true);
  const result = engine.results(s);
  assert.equal(result.totalQuestions,5); assert.equal(result.correct,4); assert.equal(result.accuracy,80);
  assert.equal(result.reviewAttempts,0); assert.equal(result.reviewCorrect,0);
  assert.deepEqual(result.mistakes,['salt-vocabulary-original-1']);
  assert.equal(result.vocabulary.elapsedMs,4700);
  assert.ok(result.vocabulary.questions.every(q=>q.responseMs===500));
  assert.deepEqual(result.vocabulary.practice[0].answers,sentences);
  assert.equal(s.metrics.responseMs[task.entry.key],undefined);
  engine.save(storage,s); engine.saveCompleted(storage,s); engine.saveCompleted(storage,s);
  assert.equal(engine.loadHistory(storage).records.length,1);
  assert.deepEqual(engine.results(engine.load(storage).session),result);
  const review = engine.newSession(s.area,{reviewOf:s.id,taskIds:result.mistakes});
  engine.answer(review,1); engine.submit(review); engine.next(review); engine.saveCompleted(storage,review);
  assert.equal(engine.results(review).accuracy,100);
  assert.equal(engine.loadHistory(storage).records.length,2);
  assert.equal(engine.results(engine.loadHistory(storage).records.find(r=>r.id===s.id)).accuracy,80);
});

test('ungraded practice validation rejects forged completion and never creates an incorrect retry', () => {
  const s = reachPractice(store()), key = engine.current(s).entry.key;
  const bad = copy(s); bad.answers[key] = ['ㄱ','  ']; bad.submitted[key] = {answer:bad.answers[key],correct:true};
  assert.equal(engine.normalize(bad),null);
  assert.equal(engine.answer(s,['x'.repeat(501), '역할']),false);
  engine.answer(s,['ㄱ','ㅇ']); assert.equal(engine.submit(s).ok,true);
  const forged = copy(s); forged.submitted[key].correct = true;
  assert.equal(engine.normalize(forged).submitted[key].correct,null);
  const pollutedTime=copy(s); pollutedTime.metrics.responseMs[key]=1;
  assert.equal(engine.normalize(pollutedTime),null);
});

test('old 32-question vocabulary sessions and completed history restore unchanged', () => {
  const legacyEngine=create(before), storage=store(), active=legacyEngine.newSession('vocabulary');
  legacyEngine.answer(active,2); legacyEngine.save(storage,active);
  assert.deepEqual(engine.load(storage).session,active);
  assert.equal(engine.current(active).task.id,'vocabulary-meaning-1');
  while(active.status==='active') { const {task}=legacyEngine.current(active); legacyEngine.answer(active,task.answer); legacyEngine.submit(active); legacyEngine.next(active); }
  legacyEngine.saveCompleted(storage,active);
  const historyBytes=storage.getItem(HISTORY_KEY);
  assert.equal(engine.results(engine.loadHistory(storage).records[0]).totalQuestions,32);
  engine.save(storage,fresh());
  assert.equal(storage.getItem(HISTORY_KEY),historyBytes);
  assert.equal(JSON.parse(storage.getItem(SESSION_KEY)).area,Vocabulary.CURRENT_AREAS.vocabulary);
});

test('even five wrong answers lead directly to unchanged writing in both area and full courses after reload', () => {
  for (const area of Object.values(Vocabulary.CURRENT_AREAS)) {
    const storage = store(); let s = engine.newSession(area), answered = 0;
    const originalQueue = copy(s.queue);
    for (let guard = 0; engine.current(s).task.kind !== 'practice' && guard < 20; guard++) {
      const {task, entry} = engine.current(s);
      assert.equal(task.kind,'choice'); assert.equal(task.trainingArea,'vocabulary');
      assert.equal(entry.retryOf,null);
      engine.answer(s,(task.answer+1)%task.options.length);
      engine.submit(s); engine.next(s);
      answered++;
      assert.equal(engine.save(storage,s).ok,true);
      s=engine.load(storage).session; assert.ok(s);
    }
    assert.equal(engine.current(s).task.kind,'practice');
    assert.equal(answered,5);
    assert.deepEqual(s.queue,originalQueue);
    assert.equal(engine.results(s).vocabulary.correct,0);
    assert.equal(engine.current(s).task,catalog[area].tasks.find(t=>t.sourceRef==='compose'));
    assert.ok(s.queue.slice(0,s.cursor).every(q=>s.submitted[q.key]));
    assert.ok(s.queue.slice(s.cursor+1).every(q=>catalog[area].tasks.find(t=>t.id===q.taskId).trainingArea!=='vocabulary'));
    engine.answer(s,['ㄱ','ㅇ']); engine.submit(s); engine.next(s);
    if (catalog[area].integrated) assert.equal(engine.current(s).task.trainingArea,'fluency');
    else assert.equal(s.status,'completed');
  }
});

test('five-question policy rejects injected retries and leaves legacy retry policy valid', () => {
  const s=fresh();
  assert.equal(s.retryPolicy,'none');
  engine.answer(s,0); engine.submit(s);
  const injected=copy(s);
  injected.queue.splice(2,0,{key:'retry-1',taskId:injected.queue[0].taskId,retryOf:'base-1'});
  assert.equal(engine.normalize(injected),null);
  assert.deepEqual(engine.normalize(s),s);
  const legacy=fresh(); legacy.retryPolicy='before-practice';
  engine.answer(legacy,0); engine.submit(legacy);
  assert.equal(legacy.queue[2].retryOf,'base-1');
  assert.deepEqual(engine.normalize(legacy),legacy);
  const base=create(before).newSession('vocabulary'); base.retryPolicy='none';
  assert.equal(engine.normalize(base),null);
});

function oldWritingSession(area) {
  const s=engine.newSession(area); delete s.retryPolicy;
  while(engine.current(s).task.kind!=='practice') {
    const {task}=engine.current(s);
    engine.answer(s,task.id.endsWith('-5') ? 0 : task.answer); engine.submit(s); engine.next(s);
  }
  engine.answer(s,['ㄱ','ㅇ']);
  return s;
}

test('resume moves an old unfinished writing draft after queued quizzes without losing answers or time', () => {
  for (const area of Object.values(Vocabulary.CURRENT_AREAS)) {
    const storage=store(), old=oldWritingSession(area), writingKey=engine.current(old).entry.key;
    engine.tick(old,1234); engine.save(storage,old);
    const loaded=engine.load(storage), s=loaded.session;
    assert.equal(loaded.warning,null); assert.equal(s.id,old.id);
    assert.equal(s.retryPolicy,'before-practice');
    assert.deepEqual(s.answers,old.answers); assert.deepEqual(s.submitted,old.submitted);
    assert.deepEqual(s.metrics,old.metrics); assert.equal(s.elapsedMs,old.elapsedMs);
    assert.equal(engine.current(s).task.id,'salt-vocabulary-original-5');
    assert.equal(engine.current(s).entry.retryOf,'base-5');
    engine.answer(s,1); engine.submit(s); engine.next(s);
    assert.equal(engine.current(s).entry.key,writingKey);
    assert.deepEqual(s.answers[writingKey],['ㄱ','ㅇ']);
    assert.equal(engine.save(storage,s).ok,true);
    assert.deepEqual(engine.load(storage).session,s);
  }
});

test('already submitted writing and completed legacy records keep their original order', () => {
  const storage=store(), old=oldWritingSession(Vocabulary.CURRENT_AREAS.vocabulary);
  engine.submit(old); engine.next(old); engine.save(storage,old);
  assert.deepEqual(engine.load(storage).session,old);
  engine.answer(old,1); engine.submit(old); engine.next(old); engine.saveCompleted(storage,old);
  assert.deepEqual(engine.loadHistory(storage).records,[old]);
});
