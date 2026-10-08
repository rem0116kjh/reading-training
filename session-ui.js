/* Session lifecycle adapter. Existing lesson data, cards and quiz renderers stay in app.js. */
let storage;
try { storage = window.localStorage; } catch { storage = null; }
const loaded = TrainingStore.loadSession(storage);
let S = loaded.session || TrainingStore.createSession();
let gateOpen = !!loaded.session;
let historyOpen = false;
let viewingRecord = null;
let confirmation = null;
let lastTick = performance.now();
let storageWarning = loaded.warning;
let writeWarning = null;
let historyWarning = null;
let saveCounter = 0;
const STEP_NAMES = ['어휘','개념·인출','읽기·진단','구조화·글쓰기'];

function isLearningActive() {
  return S.status === 'active' && !gateOpen && !historyOpen && !viewingRecord && !$('confirm-dialog').open && !document.hidden && (!window.TrainingUI || window.TrainingUI.isLearningVisible());
}
function tick() {
  const now = performance.now(), delta = Math.max(0, Math.min(5000, now - lastTick));
  lastTick = now;
  if (!isLearningActive()) return;
  S.elapsedMs += delta;
  if (S.currentStep <= 4) S.stepMs[S.currentStep - 1] += delta;
  if (S.currentStep === 3 && S.phase.reading === 'read') S.metrics.readingMs += delta;
}
function formatTime(ms) {
  const sec = Math.floor(Math.max(0, ms || 0) / 1000);
  return `${Math.floor(sec / 60)}분 ${sec % 60}초`;
}
function setWarning(warning) {
  writeWarning = warning;
  const messages = [...new Set([storageWarning, writeWarning, historyWarning].filter(Boolean))];
  $('storage-warning').textContent = messages.join(' ');
  $('storage-warning').hidden = !messages.length;
}
function persist() {
  if (gateOpen || viewingRecord) return;
  S.results = deriveResults(S);
  const saved = TrainingStore.saveSession(storage, S);
  setWarning(saved.warning);
  $('save-status').textContent = saved.ok ? '이 기기에 자동 저장됨' : '저장 불가 · 현재 화면에서만 유지';
  updateProgress();
}
function stepDone(session, step) {
  const a = session.submitted;
  return step === 1 ? a.vocab : step === 2 ? a.concept : step === 3 ? a.reading : a.outline && a.writing;
}
function allDone(session = S) {
  return session.mode === 'mistakes' ? session.mistakeSubmitted : session.requiredSteps.every(n => stepDone(session, n));
}
function canVisit(n) {
  if (S.mode === 'mistakes') return n === 5;
  if (n === 5) return allDone();
  return S.requiredSteps.includes(n) && S.requiredSteps.filter(x => x < n).every(x => stepDone(S, x));
}
function progress(session) {
  if (session.mode === 'mistakes') return session.mistakeSubmitted ? 100 : 0;
  const units = {1: 7, 2: 5, 3: 12, 4: 6};
  let completed = 0, total = 1;
  for (const step of session.requiredSteps) {
    total += units[step];
    if (stepDone(session, step)) completed += units[step];
    else if (step === 3) completed += (session.phase.reading !== 'read' ? 1 : 0) + (session.phase.reading === 'quiz' ? 4 : 0);
    else if (step === 4 && session.submitted.outline) completed += 5;
  }
  if (session.status === 'completed') completed++;
  return pct(completed, total);
}
function updateProgress() {
  const percent = progress(S);
  $('overall-progress').value = percent;
  $('progress-label').textContent = `${S.mode === 'full' ? '전체 학습' : '재학습'} 진행률 ${percent}% · ${formatTime(S.elapsedMs)}`;
  $('step-status').textContent = S.mode === 'mistakes' ? `오답 ${S.mistakes.length}문항 · ${S.mistakeSubmitted ? '완료' : '진행 중'}` : S.requiredSteps.map(n => `${STEP_NAMES[n-1]} ${stepDone(S,n)?'완료':S.currentStep===n?'진행 중':'진행 전'}`).join(' · ');
  window.TrainingUI?.refreshProgress();
}
function bindValue(input, apply) {
  const event = input.tagName === 'SELECT' ? 'change' : 'input';
  input['on' + event] = () => {
    if (input.disabled || S.status === 'completed') return;
    tick(); apply(input.value); S.currentQuestion = input.id; persist();
  };
}
function bindQuiz(prefix, answers, locked) {
  answers.forEach((answer, i) => {
    document.querySelectorAll(`input[name="${prefix}${i}"]`).forEach(input => {
      input.checked = answer === +input.value;
      input.disabled = locked;
      input.closest('.opt').classList.toggle('sel', input.checked);
      input.onchange = () => {
        if (locked || S.status === 'completed') return;
        tick(); answers[i] = +input.value; S.currentQuestion = input.id; persist();
      };
    });
  });
}
function deriveResults(session) {
  const d = session.draft, a = session.submitted;
  const result = {stage:session.currentStep,done:{}};
  session.requiredSteps.forEach(n => result.done[n] = stepDone(session,n));
  result.done[5] = session.status === 'completed';
  if (a.vocab) result.v = {quiz:{ans:d.vocab.slice(),correct:d.vocab.filter((x,i)=>x===PKG.vquiz[i].a).length,total:PKG.vquiz.length},compose:TrainingFeedback.generateVocabularyFeedback({words:PKG.compose,sentences:d.compose})};
  if (a.concept) {
    const rows = PKG.concept.blanks.map((b,i) => ({k:b.k,a:d.blanks[i],c:d.confidence[i],res:[b.k,...b.ok].map(norm).includes(norm(d.blanks[i]))?'exact':'wrong'}));
    const correct=rows.filter(r=>r.res==='exact').length, confident=rows.filter(r=>r.c!=='maybe');
    result.c={rows,correct,recall:pct(correct,rows.length),conf:confident.length?pct(confident.filter(r=>(r.c==='sure')===(r.res==='exact')).length,confident.length):null,illusion:rows.filter(r=>r.c==='sure'&&r.res==='wrong').length,under:rows.filter(r=>r.c==='unknown'&&r.res==='exact').length};
  }
  if (session.phase.reading !== 'read') {
    const m=session.metrics,elapsed=Math.max(1,m.readingMs),tracked=m.dwell.reduce((a,b)=>a+b,0),est=tracked<elapsed*0.3;
    const rates=m.dwell.map((value,i)=>value/PKG.paragraphs[i].s.join('').length);
    result.g={elapsed,tracked,dwell:m.dwell.slice(),est,reg:m.reg,hot:est?null:rates.indexOf(Math.max(...rates)),speed:elapsed>=1000?Math.round(TOTAL_CHARS/(elapsed/60000)):null,coverage:Math.min(100,pct(tracked,elapsed)),order:m.maxP>=3};
  }
  if (session.phase.reading === 'quiz') result.r={key:{hit:d.key.filter(k=>PKG.key.includes(k)).length,picked:d.key.slice()}};
  if (a.reading) {
    const fact=PKG.questions.map((q,i)=>({q,ok:d.readingAnswers[i]===q.a})).filter(x=>x.q.t==='사실적');
    const infer=PKG.questions.map((q,i)=>({q,ok:d.readingAnswers[i]===q.a})).filter(x=>x.q.t==='추론적');
    Object.assign(result.r,{ans:d.readingAnswers.slice(),factCorrect:fact.filter(x=>x.ok).length,inferCorrect:infer.filter(x=>x.ok).length,fact:pct(fact.filter(x=>x.ok).length,fact.length),infer:pct(infer.filter(x=>x.ok).length,infer.length)});
  }
  if (a.outline) result.o={hit:d.slots.reduce((sum,slot,i)=>sum+slot.filter(k=>PKG.outline.slots[i].s.includes(k)).length,0),total:PKG.outline.slots.reduce((sum,slot)=>sum+slot.s.length,0)};
  if (a.writing) result.w=TrainingFeedback.generateWritingFeedback({text:d.essay,keywords:KEYWORDS});
  let correct=0,total=0;
  if (result.v) {correct+=result.v.quiz.correct;total+=result.v.quiz.total;}
  if (result.c) {correct+=result.c.correct;total+=result.c.rows.length;}
  if (a.reading) {correct+=result.r.factCorrect+result.r.inferCorrect+result.r.key.hit;total+=PKG.questions.length+PKG.key.length;}
  if (result.o) {correct+=result.o.hit;total+=result.o.total;}
  if (session.mode==='mistakes') {total=session.mistakes.length;correct=session.mistakeSubmitted?session.mistakes.filter(item=>isMistakeCorrect(item,session.mistakeAnswers[mistakeId(item)])).length:0;}
  return {...result,totalCorrect:correct,totalQuestions:total,totalScore:total?pct(correct,total):null,completion:progress(session),elapsedMs:session.elapsedMs,stepMs:session.stepMs.slice(),provider:'rule-based'};
}
function syncResults() { for(const key of Object.keys(R)) delete R[key]; Object.assign(R,deriveResults(S)); }
function navigateStage(n) {
  if (!canVisit(n)) {status('아직 완료하지 않은 문제가 있습니다. 현재 단계를 먼저 완료해 주세요.');return;}
  tick();historyOpen=false;viewingRecord=null;S.currentStep=n;S.currentQuestion=null;persist();renderCurrentStage();window.scrollTo({top:0});
}
function renderCurrentStage(scroll = false) {
  syncResults();
  $('history-panel').hidden=true;$('mistake-panel').hidden=true;
  for(let n=1;n<=5;n++) $('s'+n).hidden=n!==S.currentStep;
  document.querySelectorAll('#rail button').forEach(b=>{const n=+b.dataset.s;b.disabled=!canVisit(n);b.classList.toggle('cur',n===S.currentStep);b.classList.toggle('done',!!R.done[n]&&n!==S.currentStep);});
  if(S.mode==='mistakes'&&!S.mistakeSubmitted){$('s5').hidden=true;renderMistakes();}
  else {
    ({1:initS1,2:initS2,3:initS3,4:initS4,5:initS5})[S.currentStep]();
    if(S.currentStep===1){
      PKG.compose.forEach((_,i)=>{$('comp'+i).value=S.draft.compose[i];bindValue($('comp'+i),value=>S.draft.compose[i]=value);});
      bindQuiz('vq',S.draft.vocab,S.submitted.vocab);$('s1result').hidden=!S.submitted.vocab;
      if(S.submitted.vocab)showVocabResult();
    }
    if(S.currentStep===4){
      $('o-score').hidden=!S.submitted.outline;$('o-write').hidden=!S.submitted.outline;$('feedback').hidden=!S.submitted.writing;
      if(S.submitted.outline)showOutlineResult();
      if(S.submitted.writing)showWritingResult();
    }
  }
  renderActions();updateProgress();
  window.TrainingUI?.showLearning();
  if(scroll)window.scrollTo({top:0});
}
function renderActions() {
  const n=S.currentStep;
  const previous=S.requiredSteps.filter(x=>x<n).at(-1);
  $('btn-prev').hidden=!previous||S.mode==='mistakes';$('btn-prev').onclick=()=>navigateStage(previous);
  $('btn-reset').hidden=false;$('btn-reset').textContent='처음부터';$('btn-reset').onclick=()=>confirmRestart();
  if(S.mode==='mistakes'&&!S.mistakeSubmitted){mainBtn(S.mistakes.length?'오답 재학습 제출':'전체 학습 시작',S.mistakes.length?submitMistakes:confirmRestart);status(S.mistakes.length?'이전 회차에서 틀린 문제를 다시 풀어 보세요.':'복원할 오답이 없습니다. 전체 학습을 새로 시작해 주세요.');return;}
  if(n===5){mainBtn('학습 완료',finishLearning);status(S.status==='completed'?'회차 완료. 기록을 확인할 수 있습니다.':'결과를 확인하세요.');return;}
  if(stepDone(S,n)){
    const next=S.requiredSteps.find(x=>x>n)||5;
    mainBtn(next===5?'리포트 보기':`다음: ${STEP_NAMES[next-1]}`,()=>navigateStage(next));status(`${STEP_NAMES[n-1]} 완료. 답안과 결과를 확인할 수 있습니다.`);return;
  }
  if(n===1){mainBtn('채점하기',gradeS1);status('글짓기 두 문장과 문제를 모두 풀어 주세요.');}
  if(n===2){mainBtn(S.phase.concept==='read'?'다 읽었어요 → 빈칸 채우기':'제출',S.phase.concept==='read'?beginRecall:gradeS2);status(S.phase.concept==='read'?'개념 글을 읽어 주세요.':'빈칸과 확신도를 모두 입력해 주세요.');}
  if(n===3){const phase=S.phase.reading;mainBtn(phase==='read'?'다 읽었어요 → 핵심 문장 찾기':phase==='key'?'선택 완료 → 문제 풀기':'제출',phase==='read'?startKeySelect:phase==='key'?finishKey:gradeS3);status(phase==='read'?'처음부터 끝까지 읽어 주세요.':phase==='key'?`${S.draft.key.length}/4 문단 선택`:'문제 7개를 모두 풀어 주세요.');}
  if(n===4){mainBtn(S.submitted.outline?'첨삭 받기':'뼈대 완성 → 글쓰기',S.submitted.outline?gradeS4:gradeOutline);status(S.submitted.outline?'40자 이상 간추려 쓰세요.':'문장을 고른 다음 들어갈 자리를 누르세요.');}
}
function completeSession() {
  if(!allDone())return false;
  tick();
  if(S.status!=='completed'){S.status='completed';S.completedAt=new Date().toISOString();}
  S.results=deriveResults(S);
  const outcome=TrainingStore.upsertHistory(storage,{version:1,id:S.id,packageId:S.packageId,title:S.title,mode:S.mode,reviewOf:S.reviewOf,completedAt:S.completedAt,totalTime:S.elapsedMs,results:S.results,session:structuredClone(S)});
  historyWarning=outcome.warning;persist();return outcome.ok;
}
function renderReport(session) {
  if(session===S&&!viewingRecord){completeSession();syncResults();}
  const r=deriveResults(session),row=(label,value,note='')=>`<div class="mrow"><span>${esc(label)}${note?` <span class="tiny">${esc(note)}</span>`:''}</span><span class="v">${esc(value)}</span></div>`;
  const report=$('report');report.innerHTML='';
  const summary=el('div','card',`<h3>${session.mode==='full'?'전체 학습':session.mode==='area'?'영역 재학습':'오답 재학습'} 결과</h3>${row('객관 채점 정답률',r.totalScore===null?'—':r.totalScore+'%',`${r.totalCorrect}/${r.totalQuestions} · 글짓기 의미 평가는 제외`)}${row('완료율',progress(session)+'%')}${row('학습 시간',formatTime(session.elapsedMs),'화면에서 활동한 시간')}${row('완료 시각',new Date(session.completedAt).toLocaleString('ko-KR'))}`);report.append(summary);
  if(session.mode!=='mistakes'){
    const areas=el('div','areas');
    areas.innerHTML=`<div class="card area"><h3>인지·문해</h3>${row('어휘 정답률',r.v?pct(r.v.quiz.correct,r.v.quiz.total)+'%':'이번 회차 미수행')}${row('글짓기 낱말 포함',r.v?r.v.compose.filter(x=>x.contains).length+'/2':'—','규칙 기반')}${row('개념 인출 성공률',r.c?r.c.recall+'%':'이번 회차 미수행')}${row('확신도 점검 일치율',r.c&&r.c.conf!==null?r.c.conf+'%':'비교 응답 없음','아마 제외')}${row('사실적 이해',r.r?.fact===undefined?'이번 회차 미수행':r.r.fact+'%')}${row('추론적 이해',r.r?.infer===undefined?'이번 회차 미수행':r.r.infer+'%')}</div>
    <div class="card area b"><h3>행동·습관</h3>${row('읽은 시간',r.g?formatTime(r.g.elapsed):'이번 회차 미수행')}${row('읽기 속도',r.g?.speed?r.g.speed+' 글자/분':'측정 부족','포인터 기반 데모')}${row('역행 횟수',r.g?.reg??'—')}${row('병목 문단',r.g?.hot==null?'측정 부족':PKG.paragraphs[r.g.hot].role)}${row('핵심 문장',r.r?r.r.key.hit+'/4':'—')}</div>
    <div class="card area c"><h3>표현·사고</h3>${row('뼈대 정확도',r.o?pct(r.o.hit,r.o.total)+'%':'이번 회차 미수행')}${row('핵심 낱말 포함율',r.w?r.w.local.kw+'%':'—','규칙 기반')}${row('작성 글자 수',r.w?r.w.local.len:'—','공백 제외')}${row('의미·문맥 첨삭','제공하지 않음','외부 AI 미연결')}</div>`;
    report.append(areas);
  } else {
    const answers=el('div','card');answers.innerHTML='<h3>오답 재학습 결과</h3>';
    session.mistakes.forEach(item=>{const q=mistakeQuestion(item),answer=session.mistakeAnswers[mistakeId(item)];answers.append(el('p','muted',`${esc(q.q)} · ${isMistakeCorrect(item,answer)?'정답':'오답'} · 정답: ${esc(q.correctLabel)}`));});report.append(answers);
  }
  const recommendations=el('div','card stack');recommendations.append(el('h3','', '맞춤형 후속 학습'));
  const suggested=[];
  if(r.v&&pct(r.v.quiz.correct,r.v.quiz.total)<70)suggested.push([1,'어휘를 다시 연습해 보세요.']);
  if(r.c&&r.c.recall<70)suggested.push([2,'개념·인출을 다시 연습해 보세요.']);
  if(r.r?.infer<70||r.r?.fact<70||r.r?.key.hit<4)suggested.push([3,'읽기·진단을 다시 학습해 보세요.']);
  if(r.o&&pct(r.o.hit,r.o.total)<80||r.w&&r.w.local.kw<60)suggested.push([4,'구조화·글쓰기를 다시 연습해 보세요.']);
  for(const [step,message] of suggested){const box=el('div','rx');box.append(el('p','muted',message));const button=el('button','btn secondary',`${STEP_NAMES[step-1]} 다시 학습`);button.onclick=()=>startReview(session,'area',[step]);box.append(button);recommendations.append(box);}
  if(!suggested.length)recommendations.append(el('p','muted','전체 다시 학습하거나 이전 기록을 확인할 수 있습니다.'));
  report.append(recommendations);
  const actions=el('div','card session-actions');
  const mistakes=collectMistakes(session);
  const wrong=el('button','btn secondary','틀린 문제 다시 풀기');wrong.disabled=!mistakes.length;wrong.onclick=()=>startReview(session,'mistakes',[],mistakes);actions.append(wrong);
  const weak=el('button','btn secondary','부족한 영역 다시 학습');weak.disabled=!suggested.length;weak.onclick=()=>startReview(session,'area',suggested.map(x=>x[0]));actions.append(weak);
  const repeat=el('button','btn secondary','전체 다시 학습');repeat.onclick=()=>startReview(session,'full',[1,2,3,4]);actions.append(repeat);
  const history=el('button','btn ghost','학습 기록 보기');history.onclick=showHistory;actions.append(history);report.append(actions);
  report.append(el('p','note','기록은 현재 브라우저에 저장됩니다. 다른 기기와 동기화되지 않으며 브라우저 데이터 삭제 시 사라질 수 있습니다.'));
  window.TrainingUI?.decorateReport(session);
}
function finishLearning(){
  if(!completeSession()){status('기록을 저장하지 못했습니다. 현재 결과를 유지했습니다. 저장 공간을 확보한 뒤 학습 완료를 다시 눌러 주세요.');return;}
  showHistory();
}
function showHistory(){
  tick();persist();historyOpen=true;viewingRecord=null;
  for(let n=1;n<=5;n++)$('s'+n).hidden=true;$('mistake-panel').hidden=true;
  const root=$('history-list');root.replaceChildren();$('history-panel').hidden=false;
  const history=TrainingStore.loadHistory(storage);historyWarning=history.warning||historyWarning;setWarning(writeWarning);
  if(!history.records.length)root.append(el('p','muted','저장된 학습 기록이 없습니다.'));
  for(const record of history.records.slice().sort((a,b)=>b.completedAt.localeCompare(a.completedAt))){
    const r=deriveResults(record.session),card=el('div','card stack');
    card.append(el('h3','',esc(record.title)),el('p','muted',`${esc(new Date(record.completedAt).toLocaleString('ko-KR'))} · ${record.mode==='full'?'전체 학습':record.mode==='area'?'영역 재학습':'오답 재학습'} · 정답률 ${r.totalScore??'—'}% · ${formatTime(record.totalTime)}`));
    const button=el('button','btn secondary','결과 보기');button.onclick=()=>showHistoryReport(record);card.append(button);root.append(card);
  }
  $('btn-prev').hidden=true;$('btn-reset').hidden=true;mainBtn(S.status==='completed'?'현재 리포트로':'학습으로 돌아가기',returnToSession);status('학습 기록');
  window.TrainingUI?.showHistory();
}
function showHistoryReport(record){
  viewingRecord=record;historyOpen=false;$('history-panel').hidden=true;$('s5').hidden=false;renderReport(record.session);
  $('btn-prev').hidden=false;$('btn-prev').onclick=showHistory;$('btn-reset').hidden=true;mainBtn('현재 학습으로',returnToSession);status('이전 학습 기록 · 읽기 전용');
  window.TrainingUI?.showReport();
}
function returnToSession(){historyOpen=false;viewingRecord=null;lastTick=performance.now();renderCurrentStage();}
function confirmAction(message,action){
  tick();$('confirm-message').textContent=message;confirmation=action;$('confirm-dialog').showModal();
}
function confirmRestart(){confirmAction('현재 회차의 진행 내용을 초기화하고 처음부터 시작할까요? 완료된 학습 기록은 유지됩니다.',()=>replaceSession({mode:'full',requiredSteps:[1,2,3,4]}));}
function startReview(base,mode,steps,mistakes=[]){
  const action=()=>replaceSession({mode,requiredSteps:steps,reviewOf:base.id,mistakes});
  if(S.status==='active'&&S.id!==base.id)confirmAction('진행 중인 회차를 새 재학습으로 바꿀까요? 완료된 기록은 유지됩니다.',action);else action();
}
function replaceSession(options){
  if(S.status==='completed'&&!completeSession()){
    gateOpen=false;historyOpen=false;viewingRecord=null;S.currentStep=5;
    $('resume-dialog').close();renderCurrentStage(true);
    status('기록을 저장하지 못해 새 학습을 시작하지 않았습니다. 현재 결과를 유지했습니다. 저장 공간을 확보한 뒤 다시 시도해 주세요.');
    return false;
  }
  tick();S=TrainingStore.createSession(options);gateOpen=false;historyOpen=false;viewingRecord=null;lastTick=performance.now();
  $('resume-dialog').close();persist();renderCurrentStage(true);
  return true;
}
function mistakeId(item){return `${item.type}-${item.index}`;}
function mistakeQuestion(item){
  const i=item.index;
  if(item.type==='vocab'||item.type==='reading'){const q=(item.type==='vocab'?PKG.vquiz:PKG.questions)[i];return {...q,values:q.o.map((_,n)=>n),correctLabel:q.o[q.a]};}
  if(item.type==='concept'){const b=PKG.concept.blanks[i];return {q:`개념 빈칸 ${i+1}: ${PKG.concept.parts[PKG.concept.parts.indexOf(i)-1]} (    )`,answer:b.k,accepted:[b.k,...b.ok],correctLabel:b.k};}
  if(item.type==='key'){const values=PARA_OF.map((p,k)=>p===i?k:-1).filter(k=>k>=0),answer=PKG.key[i];return {q:`${PKG.paragraphs[i].role}: 중심 문장을 고르세요.`,o:values.map(k=>SENT[k]),values,a:values.indexOf(answer),correctLabel:SENT[answer]};}
  const a=PKG.outline.slots.findIndex(slot=>slot.s.includes(i));return {q:`다음 문장은 어느 부분에 들어갈까요? ${SENT[i]}`,o:STEP_OUTLINE_LABELS,values:[0,1,2],a,correctLabel:STEP_OUTLINE_LABELS[a]};
}
const STEP_OUTLINE_LABELS=['처음','중간','끝'];
function isMistakeCorrect(item,answer){const q=mistakeQuestion(item);return q.accepted?q.accepted.map(norm).includes(norm(String(answer??''))):answer===q.values[q.a];}
function collectMistakes(session){
  if(session.mode==='mistakes')return session.mistakes.filter(item=>!isMistakeCorrect(item,session.mistakeAnswers[mistakeId(item)]));
  const items=[],d=session.draft,a=session.submitted;
  if(a.vocab)d.vocab.forEach((x,i)=>{if(x!==PKG.vquiz[i].a)items.push({type:'vocab',index:i});});
  if(a.concept)PKG.concept.blanks.forEach((b,i)=>{if(![b.k,...b.ok].map(norm).includes(norm(d.blanks[i])))items.push({type:'concept',index:i});});
  if(a.reading){d.readingAnswers.forEach((x,i)=>{if(x!==PKG.questions[i].a)items.push({type:'reading',index:i});});PKG.key.forEach((k,i)=>{if(!d.key.includes(k))items.push({type:'key',index:i});});}
  if(a.outline)PKG.outline.slots.forEach((slot,i)=>slot.s.forEach(k=>{if(!d.slots[i].includes(k))items.push({type:'outline',index:k});}));
  return items;
}
function renderMistakes(){
  $('mistake-panel').hidden=false;const root=$('mistake-questions');root.replaceChildren();
  S.mistakes.forEach((item,index)=>{
    const q=mistakeQuestion(item),id=mistakeId(item),answer=S.mistakeAnswers[id];
    if(q.o){const block=renderQ(q,index,'mq');root.append(block);block.querySelectorAll('input').forEach(input=>{input.checked=answer===q.values[+input.value];input.closest('.opt').classList.toggle('sel',input.checked);input.onchange=()=>{S.mistakeAnswers[id]=q.values[+input.value];S.currentQuestion=input.id;persist();};});}
    else {const block=el('div','q'),label=el('label','',esc(q.q)),input=document.createElement('input');input.id='mistake-'+id;label.htmlFor=input.id;input.value=answer??'';bindValue(input,value=>S.mistakeAnswers[id]=value);block.append(label,input);root.append(block);}
  });
}
function submitMistakes(){
  if(S.mistakeSubmitted)return;
  if(!S.mistakes.length){status('복원할 오답이 없습니다. 전체 학습을 새로 시작해 주세요.');return;}
  if(S.mistakes.some(item=>{const answer=S.mistakeAnswers[mistakeId(item)];return answer===undefined||answer===null||typeof answer==='string'&&!answer.trim();})){status('오답 문제를 모두 풀어 주세요.');return;}
  S.mistakeSubmitted=true;persist();renderCurrentStage();
}
function resume(){
  gateOpen=false;$('resume-dialog').close();lastTick=performance.now();renderCurrentStage();
  const target=S.currentQuestion&&document.getElementById(S.currentQuestion);if(target){target.scrollIntoView({block:'center'});if(!target.disabled)target.focus({preventScroll:true});}persist();
}
$('confirm-yes').onclick=()=>{const action=confirmation;confirmation=null;$('confirm-dialog').close();lastTick=performance.now();action?.();};
$('confirm-no').onclick=()=>{$('confirm-dialog').close();confirmation=null;lastTick=performance.now();};
$('confirm-dialog').addEventListener('cancel',()=>{confirmation=null;lastTick=performance.now();});
$('resume-continue').onclick=resume;$('resume-restart').onclick=confirmRestart;
$('resume-dialog').addEventListener('cancel',event=>event.preventDefault());
$('history-button').onclick=showHistory;
$('history-new').onclick=()=>S.status==='completed'?replaceSession({mode:'full'}):confirmRestart();
document.querySelectorAll('#rail button').forEach(button=>button.onclick=()=>navigateStage(+button.dataset.s));
document.addEventListener('visibilitychange',()=>{tick();persist();lastTick=performance.now();pointerSample={at:null,paragraph:null};});
window.addEventListener('pagehide',()=>{tick();persist();});
window.addEventListener('beforeunload',()=>{tick();persist();});
setInterval(()=>{
  // Keep idle screens from recalculating results or writing an unchanged lesson.
  if(!isLearningActive()){lastTick=performance.now();return;}
  tick();
  if(++saveCounter%5===0)persist();else updateProgress();
},1000);
setWarning(loaded.warning);
if(gateOpen){
  $('resume-description').textContent=`${S.title} · ${S.mode==='full'?'전체 학습':'재학습'} · 진행률 ${progress(S)}% · ${formatTime(S.elapsedMs)}`;
  $('resume-title').textContent=S.status==='completed'?'완료한 학습이 있습니다.':'진행 중인 학습이 있습니다.';
  $('resume-continue').textContent=S.status==='completed'?(S.currentStep===5?'결과 보기':'학습 내용 보기'):'이어하기';
  for(let n=1;n<=5;n++)$('s'+n).hidden=true;
  $('resume-dialog').showModal();updateProgress();
}else{persist();renderCurrentStage();}
