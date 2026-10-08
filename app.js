const PKG = {
  vocab:[
    {word:"방법",pos:"명사",d:0,src:"교과서 908·기존풀",meaning:"어떤 일을 해 나가거나 목적을 이루기 위하여 취하는 수단이나 방식",s:16},
    {word:"사용",pos:"명사",d:2,src:"교과서 908(3학년)·기존풀",meaning:"일정한 목적이나 기능에 맞게 씀",s:1},
    {word:"재료",pos:"명사",d:2,src:"기존풀",meaning:"무언가를 만드는 데 필요한 것",s:14},
    {word:"순서",pos:"명사",d:1,src:"기존풀",meaning:"정하여진 기준에서 말하는 앞뒤의 차례",s:13},
    {word:"역할",pos:"명사",d:2,src:"기존풀",meaning:"자기가 마땅히 하여야 할 맡은 바 일",s:15},
    {word:"생산",pos:"명사",d:3,src:"교과서 908·기존풀",meaning:"생활하는 데 필요한 여러 물건을 만들어 냄",s:16},
    {word:"녹다",pos:"동사",d:0,src:"기존풀",meaning:"고체가 액체로 변하다",s:4},
    {word:"굳다",pos:"동사",d:2,src:"기존풀",meaning:"부드러운 물질이 단단하게 변하다",s:7},
    {word:"증발하다",pos:"동사",d:3,src:"기존풀",meaning:"액체 상태에서 기체 상태로 변하다",s:7},
    {word:"대부분",pos:"부사",d:1,src:"교과서 908·기존풀",meaning:"절반이 훨씬 넘어 거의 전부에 가까운 정도로",s:0}
  ],
  compose:["굳다","역할"],
  paragraphs:[
    {role:"도입",s:["우리가 먹는 음식에는 대부분 소금이 들어 있어요.","국을 끓일 때도, 김치를 담글 때도 소금을 사용해요.","그런데 이 소금은 어디에서 오는 걸까요?"]},
    {role:"전개 · 바다",s:["소금은 대부분 바닷물에서 얻어요.","바닷물에는 소금이 녹아 있어요.","사람들은 바닷가에 ‘염전’이라는 넓은 밭을 만들어요.","그리고 염전에 바닷물을 끌어와 햇볕에 말려요.","물이 천천히 증발하면, 하얀 소금만 남아 굳어요.","이렇게 만든 소금을 ‘천일염’이라고 해요."]},
    {role:"전개 · 땅속",s:["소금은 땅속에서도 얻을 수 있어요.","아주 오래전에 바다였던 곳이 땅으로 변하면서 소금이 두껍게 쌓인 거예요.","이런 곳을 ‘암염 광산’이라고 해요.","사람들은 광산에서 돌처럼 굳은 소금을 캐내요."]},
    {role:"정리",s:["바다에서 얻든 땅에서 얻든, 소금을 만드는 순서는 비슷해요.","소금이 있는 재료를 모으고, 물기를 없애고, 남은 소금을 거두는 거예요.","소금은 음식의 맛을 내는 역할뿐 아니라 음식을 오래 보관하는 데도 사용돼요.","그래서 옛날부터 사람들은 여러 방법으로 소금을 생산해 왔답니다."]}
  ],
  key:[0,3,9,13],
  concept:{
    parts:["글을 읽고 중요한 내용을 간추리려면 먼저 각 문단에서 ",0," 을 찾아요. 중심 문장은 그 문단에서 가장 중요한 내용을 담은 문장이에요. 중심 문장을 자세히 설명하거나 예를 드는 문장은 ",1," 이라고 해요. 간추릴 때는 중심 문장은 남기고, 뒷받침 문장은 줄이거나 빼요. 「소금은 어디에서 올까」에서 소금은 ",2," 과 땅속에서 얻어요. ",3," 에서는 바닷물의 물기를 햇볕에 ",4," 시켜 소금을 얻고, 땅속에서는 굳은 소금을 캐내요."],
    blanks:[
      {k:"중심 문장",ok:["중심문장"]},
      {k:"뒷받침 문장",ok:["뒷받침문장","뒤받침문장"]},
      {k:"바닷물",ok:["바다물","바다"]},
      {k:"염전",ok:[]},
      {k:"증발",ok:["증발시켜","증발하게"]}
    ]
  },
  questions:[
    {t:"사실적",q:"우리가 먹는 음식에 대부분 들어 있는 것은 무엇인가요?",o:["설탕","소금","식초","기름","후추"],a:1,ev:[0]},
    {t:"사실적",q:"사람들이 바닷가에 만드는 넓은 밭을 무엇이라고 하나요?",o:["논","광산","염전","텃밭","갯벌"],a:2,ev:[5]},
    {t:"사실적",q:"염전에서 바닷물의 물을 없애는 방법은 무엇인가요?",o:["불에 끓인다","햇볕에 말린다","얼음으로 얼린다","기계로 짠다","땅에 묻는다"],a:1,ev:[6,7]},
    {t:"사실적",q:"땅속에서 굳은 소금을 캐내는 곳을 무엇이라고 하나요?",o:["염전","동굴","암염 광산","우물","공장"],a:2,ev:[11,12]},
    {t:"사실적",q:"이 글에서 말한 소금의 역할 두 가지는 무엇인가요?",o:["맛을 내고 색을 낸다","맛을 내고 음식을 오래 보관한다","음식을 부드럽게 하고 차갑게 한다","향을 내고 달게 한다","음식을 익히고 식힌다"],a:1,ev:[15]},
    {t:"추론적",q:"염전을 비가 많이 오는 곳보다 햇볕이 강한 곳에 만드는 까닭은 무엇일까요?",o:["소금이 더 하얗게 되기 때문에","물이 잘 증발해야 소금이 남기 때문에","바닷물이 더 짜기 때문에","사람들이 더 많이 살기 때문에","비가 오면 소금이 녹아 사라지기 때문에"],a:1,ev:[6,7]},
    {t:"추론적",q:"땅속에 소금이 두껍게 쌓여 있는 것으로 보아 알 수 있는 것은 무엇일까요?",o:["그곳은 지금도 바다이다","그곳은 아주 오래전에 바다였다","그곳에는 염전이 있다","그곳은 항상 햇볕이 강하다","그곳 사람들은 소금을 많이 먹는다"],a:1,ev:[10]}
  ],
  outline:{
    slots:[{label:"처음",hint:"소금은 무엇에 쓰이고, 어디에서 올까?",s:[0]},{label:"중간",hint:"소금을 얻는 두 곳",s:[3,9]},{label:"끝",hint:"만드는 순서와 소금의 역할",s:[13,15]}],
    ref:"우리가 먹는 음식에는 소금이 많이 쓰인다. 소금은 바닷물을 염전에서 햇볕에 말려 얻거나, 땅속 광산에서 굳은 소금을 캐내어 얻는다. 소금은 음식의 맛을 내고 오래 보관하는 데 쓰인다.",
    guide:150
  },
  vquiz:[
    {k:"뜻 고르기",q:"‘증발하다’의 뜻으로 알맞은 것은?",o:["단단하게 변하다","액체가 기체로 변하다","고체가 액체로 변하다","한데 모이다","넓게 퍼지다"],a:1},
    {k:"문맥 빈칸",q:"바닷물을 햇볕에 말리면 물이 (    ) 소금만 남아요.",o:["녹아서","굳어서","증발하고","쌓여서","모여서"],a:2},
    {k:"문맥 빈칸",q:"소금은 음식을 오래 보관하는 (    )을 해요.",o:["재료","순서","방법","역할","생산"],a:3},
    {k:"비슷한 말",q:"‘방법’과 뜻이 가장 비슷한 낱말은?",o:["방식","재료","순서","역할","결과"],a:0},
    {k:"잘못 쓴 문장",q:"낱말을 잘못 사용한 문장은?",o:["소금은 바닷물에 녹아 있어요.","얼음이 햇볕에 굳었어요.","김치를 담글 때 소금을 사용해요.","순서대로 재료를 모아요.","옛날부터 소금을 생산해 왔어요."],a:1}
  ]
};
const SENT = PKG.paragraphs.flatMap(p=>p.s);
const PARA_OF = PKG.paragraphs.flatMap((p,i)=>p.s.map(()=>i));
const TOTAL_CHARS = SENT.join("").length;
const stem = w => w.endsWith("하다") ? w.slice(0,-2) : (w.endsWith("다") ? w.slice(0,-1) : w);
const KEYWORDS = [...PKG.vocab.map(v=>v.word), ...PKG.concept.blanks.map(b=>b.k)];

// Results are derived from the persisted session; never from a leftover screen.
const R = {};
const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const el = (t,c,h)=>{ const e=document.createElement(t); if(c) e.className=c; if(h!=null) e.innerHTML=h; return e; };
const pct = (a,b)=> b? Math.round(a/b*100):0;
const status = t => { $("status").textContent = t; };
const mainBtn = (label, fn, disabled=false) => { const b=$("btn-main"); b.textContent=label; b.onclick=fn; b.disabled=disabled; b.hidden=false; };
const kpi = (label,value,note="")=>`<div class="kpi"><div class="l">${esc(label)}</div><div class="v">${esc(value)}</div><div class="s">${esc(note)}</div></div>`;
function setStage(n){ navigateStage(n); }

// ---------- ① 어휘 ----------
function highlight(text, w){ const s=stem(w); const i=text.indexOf(s); if(i<0) return text; let j=i+s.length; while(j<text.length && /[가-힣]/.test(text[j])) j++; return text.slice(0,i)+"<mark>"+text.slice(i,j)+"</mark>"+text.slice(j); }
function initS1(){
  ["vgrid","compose","vquiz"].forEach(id=>$(id).replaceChildren());
  PKG.vocab.forEach(v=>{
    const c=el("div","vcard");
    c.innerHTML=`<div class="w">${v.word}<span class="chip pos-${v.pos}">${v.pos}</span></div><div class="d">난이도 d${v.d} · ${v.src}</div><div class="m">${v.meaning}</div><div class="ex">${highlight(SENT[v.s],v.word)}</div>`;
    $("vgrid").append(c);
  });
  PKG.compose.forEach((w,i)=>{
    const v=PKG.vocab.find(x=>x.word===w);
    const d=el("div"); d.innerHTML=`<label for="comp${i}">${w} <span class="chip pos-${v.pos}">${v.pos}</span><span class="tiny">${v.meaning}</span></label><input id="comp${i}" placeholder="‘${w}’를 넣어 한 문장" style="width:100%"><div class="fb" hidden id="compfb${i}"></div>`;
    $("compose").append(d);
  });
  PKG.vquiz.forEach((q,i)=>$("vquiz").append(renderQ(q,i,"vq")));
  mainBtn("채점하기", gradeS1);
  status("낱말 카드를 읽고, 글짓기와 문제를 풀어 보세요.");
}
function renderQ(q,i,pfx){
  const d=el("div","q");
  d.innerHTML=`<div class="stem"><span class="num">${i+1}.</span><span>${q.t?`<span class="chip ${q.t==="사실적"?"fact":"infer"}">${q.t} 이해</span> `:""}${q.k?`<span class="chip">${q.k}</span> `:""}${q.q}</span></div>`;
  const o=el("div","opts");
  q.o.forEach((t,j)=>{ const id=`${pfx}${i}_${j}`; const l=el("label","opt"); l.innerHTML=`<input type="radio" name="${pfx}${i}" id="${id}" value="${j}"><span>${t}</span>`; l.onclick=()=>{ if(l.querySelector("input").disabled) return; o.querySelectorAll(".opt").forEach(x=>x.classList.remove("sel")); l.classList.add("sel"); }; o.append(l); });
  d.append(o); return d;
}
function readAnswers(pfx,n){ return Array.from({length:n},(_,i)=>{ const r=document.querySelector(`input[name="${pfx}${i}"]:checked`); return r?+r.value:null; }); }
function markQ(pfx,qs,ans){ qs.forEach((q,i)=>{ document.querySelectorAll(`input[name="${pfx}${i}"]`).forEach(inp=>{ const l=inp.closest(".opt"); inp.disabled=true; if(+inp.value===q.a) l.classList.add("right"); else if(ans[i]===+inp.value) l.classList.add("wrong"); }); if(q.ev){ const e=el("div"); e.innerHTML=`<span class="ev">근거: 문장 ${q.ev.map(x=>x+1).join(", ")} — “${SENT[q.ev[0]]}”</span>`; document.querySelector(`input[name="${pfx}${i}"]`).closest(".q").append(e);} }); }
function gradeS1(){
  if(S.submitted.vocab) return;
  if(S.draft.vocab.includes(null)){ status("아직 완료하지 않은 문제가 있습니다. 문제를 모두 풀어 주세요."); return; }
  if(S.draft.compose.some(s=>!s.trim())){ status("글짓기 두 문장을 모두 써 주세요."); return; }
  S.submitted.vocab=true; persist(); renderCurrentStage();
}
function showVocabResult(){
  markQ("vq",PKG.vquiz,S.draft.vocab);
  R.v.compose.forEach((j,i)=>{const fb=$("compfb"+i);fb.hidden=false;fb.innerHTML=`<span class="chip ${j.contains?"good":"bad"}">${j.contains?"포함":"낱말 없음"}</span> ${esc(j.feedback)}`;$("comp"+i).disabled=true;});
  $("s1result").hidden=false;
  $("s1result").innerHTML=`<div class="kpis">${kpi("어휘 정답률",pct(R.v.quiz.correct,PKG.vquiz.length)+"%",`${R.v.quiz.correct}/${PKG.vquiz.length}`)}${kpi("글짓기 낱말 포함",R.v.compose.filter(j=>j.contains).length+"/2","규칙 기반 · 문장 의미 평가 아님")}</div>`;
}

// ---------- ② 개념 ----------
function initS2(){
  $("ctext").innerHTML=PKG.concept.parts.map(x=>typeof x==="number"?`<span class="kw">${PKG.concept.blanks[x].k}</span>`:x).join("");
  $("c-read").hidden=S.phase.concept!=="read";
  $("c-fill").hidden=S.phase.concept==="read";
  $("s2result").hidden=!S.submitted.concept;
  $("cblanks").innerHTML=PKG.concept.parts.map(x=>typeof x==="number"?`<span class="blank" data-i="${x}"><input id="bl${x}" autocomplete="off" aria-label="빈칸 ${x+1}"><select id="cf${x}" aria-label="빈칸 ${x+1} 확신도"><option value="">확신도 선택</option><option value="sure">확실</option><option value="maybe">아마</option><option value="unknown">모름</option></select></span>`:x).join("");
  PKG.concept.blanks.forEach((b,i)=>{
    $("bl"+i).value=S.draft.blanks[i];$("cf"+i).value=S.draft.confidence[i];
    bindValue($("bl"+i),v=>S.draft.blanks[i]=v);bindValue($("cf"+i),v=>S.draft.confidence[i]=v);
    if(S.submitted.concept){const r=R.c.rows[i];$("bl"+i).disabled=true;$("cf"+i).disabled=true;$("bl"+i).closest(".blank").classList.add(r.res==="exact"?"right":"wrong");if(r.res!=="exact"){$("bl"+i).value=r.a+" → "+r.k;}}
  });
  if(S.submitted.concept) $("s2result").innerHTML=`<div class="kpis">${kpi("인출 성공률",R.c.recall+"%",`${R.c.correct}/${PKG.concept.blanks.length}`)}${kpi("확신도 점검 일치율",(R.c.conf===null?"비교 응답 없음":R.c.conf+"%"),"확실/모름 응답만 비교 · 아마 제외")}${kpi("착각",R.c.illusion,"확실 → 오답")}${kpi("과소평가",R.c.under,"모름 → 정답")}</div>`;
}
function beginRecall(){S.phase.concept="fill";persist();renderCurrentStage();}
function norm(s){return s.replace(/\s+/g,"").replace(/[을를이가은는]$/,"");}
function gradeS2(){
  if(S.submitted.concept) return;
  if(S.draft.blanks.some(x=>!x.trim())||S.draft.confidence.some(x=>!x)){status("빈칸과 확신도를 모두 입력해 주세요.");return;}
  S.submitted.concept=true;persist();renderCurrentStage();
}

// ---------- ③ 읽기 ----------
let pointerSample={at:null,paragraph:null};
function initS3(){
  const P=$("passage"); P.innerHTML=`<h3>소금은 어디에서 올까</h3>`;
  let k=0;
  PKG.paragraphs.forEach((p,i)=>{const d=el("div","para");d.dataset.i=i;d.innerHTML=`<span class="role">${p.role}</span>`+p.s.map(()=>{const tag=S.phase.reading==="key"?"button":"span";return `<${tag} class="sent" data-k="${k++}"></${tag}>`;}).join(" ");P.append(d);});
  P.querySelectorAll(".sent").forEach(node=>{
    const index=+node.dataset.k;node.id="key-"+index;node.textContent=SENT[index];
    node.classList.toggle("picked",S.draft.key.includes(index));
    node.classList.toggle("key",S.phase.reading==="quiz"&&PKG.key.includes(index));
    if(S.phase.reading==="key"){
      node.tabIndex=0;node.setAttribute("role","button");node.setAttribute("aria-pressed",String(S.draft.key.includes(index)));
      node.onclick=()=>{S.currentQuestion="key-"+index;const selected=S.draft.key.includes(index);S.draft.key=S.draft.key.filter(x=>PARA_OF[x]!==PARA_OF[index]);if(!selected)S.draft.key.push(index);persist();renderCurrentStage(false);};

    }
  });
  P.classList.toggle("sel-mode",S.phase.reading==="key");
  pointerSample={at:null,paragraph:null};
  const track=e=>{
    if(S.phase.reading!=="read"||!isLearningActive()) return;
    const para=e.target.closest(".para");if(!para)return;
    const now=performance.now(),i=+para.dataset.i;
    if(pointerSample.at!==null&&now-pointerSample.at<1500)S.metrics.dwell[pointerSample.paragraph]+=now-pointerSample.at;
    if(pointerSample.paragraph!==null&&i<pointerSample.paragraph)S.metrics.reg++;
    S.metrics.maxP=Math.max(S.metrics.maxP,i);pointerSample={at:now,paragraph:i};
  };
  P.onpointermove=track;P.onpointerdown=track;
  $("gaze").hidden=S.phase.reading==="read";
  $("rquiz").hidden=S.phase.reading!=="quiz";$("rquiz").replaceChildren();
  $("s3result").hidden=!S.submitted.reading;
  if(S.phase.reading==="read") $("r-guide").textContent="처음부터 끝까지 읽은 뒤 다 읽었어요를 눌러 주세요. 포인터 측정은 시선 추적이 아닌 데모 지표입니다.";
  else {
    const g=R.g;
    $("gaze").innerHTML=`<h3>읽기 기록 <span class="tiny">${g.est?"포인터 기록 부족 · 체류 추정":"포인터 체류 기준"}</span></h3><div class="kpis">${kpi("읽은 시간",formatTime(g.elapsed))}${kpi("읽기 속도",g.speed??"측정 부족","글자/분 · 시선 측정 아님")}${kpi("역행",g.reg)}${kpi("체류 포착률",g.coverage+"%")}</div><p class="note">${g.est?"측정 자료가 부족해 병목 문단을 판단하지 않습니다.":"포인터 기록은 실제 읽기 능력을 확정하지 않습니다."}</p>`;
    $("r-guide").textContent=S.phase.reading==="key"?"각 문단에서 중심 문장을 하나씩 골라 누르세요. (4개)":`핵심 문장 ${R.r.key.hit}/4 정답. 초록 = 맞게 고름, 빨강 = 잘못 고름, 파랑 = 정답`;
  }
  if(S.phase.reading==="quiz"){
    $("rquiz").innerHTML='<h3>이해도 확인 <span class="tiny">사실적 이해 5 · 추론적 이해 2</span></h3>';
    PKG.questions.forEach((q,i)=>$("rquiz").append(renderQ(q,i,"rq")));
    bindQuiz("rq",S.draft.readingAnswers,S.submitted.reading);
    if(S.submitted.reading){markQ("rq",PKG.questions,S.draft.readingAnswers);$("s3result").innerHTML=`<div class="kpis">${kpi("사실적 이해",R.r.fact+"%",`${R.r.factCorrect}/5`)}${kpi("추론적 이해",R.r.infer+"%",`${R.r.inferCorrect}/2`)}${kpi("핵심 문장",R.r.key.hit+"/4")}</div>`;}
  }
}
function startKeySelect(){tick();S.phase.reading="key";persist();renderCurrentStage();}
function finishKey(){
  if(S.draft.key.length!==PKG.paragraphs.length||new Set(S.draft.key.map(k=>PARA_OF[k])).size!==PKG.paragraphs.length){status("각 문단에서 중심 문장을 하나씩 골라 주세요.");return;}
  S.phase.reading="quiz";persist();renderCurrentStage();
}
function gradeS3(){
  if(S.submitted.reading)return;
  if(S.phase.reading!=="quiz"||S.draft.readingAnswers.includes(null)){status("읽기 활동과 문제를 모두 완료해 주세요.");return;}
  S.submitted.reading=true;persist();renderCurrentStage();
}

// ---------- ④ 구조화·글쓰기 ----------
const O={sel:null,slots:[[],[],[]]};
function initS4(){
  $("schips").replaceChildren(); O.sel=S.draft.selectedSentence; O.slots=S.draft.slots;
  SENT.forEach((s,k)=>{ const b=el("button","schip",s); b.dataset.k=k; b.onclick=()=>{ if(S.submitted.outline||b.classList.contains("used")) return; document.querySelectorAll(".schip").forEach(x=>x.classList.remove("sel")); if(O.sel===k){O.sel=null;}else{O.sel=k;b.classList.add("sel");} document.querySelectorAll(".slot").forEach(x=>x.classList.toggle("target",O.sel!==null)); status(O.sel!==null?"들어갈 자리를 누르세요.":"문장을 고르세요."); S.draft.selectedSentence=O.sel;persist(); }; $("schips").append(b); });
  renderSlots();
  mainBtn("뼈대 완성 → 글쓰기", gradeOutline); status("문장을 고르세요.");
}
function renderSlots(){
  const slotRoot=$("slots"); slotRoot.innerHTML="";
  PKG.outline.slots.forEach((sl,i)=>{ const d=el("div","slot"); d.innerHTML=`<h4>${sl.label}<span class="tiny">${O.slots[i].length}/${sl.s.length}</span></h4><div class="hint">${sl.hint}</div>`; O.slots[i].forEach(k=>{ const it=el("div","item"); it.innerHTML=`<span>${SENT[k]}</span><button aria-label="빼기">✕</button>`; it.querySelector("button").onclick=e=>{ e.stopPropagation(); O.slots[i]=O.slots[i].filter(x=>x!==k); document.querySelector(`.schip[data-k="${k}"]`).classList.remove("used"); renderSlots(); }; d.append(it); }); d.onclick=()=>{ if(O.sel===null) return; if(O.slots[i].length>=sl.s.length){ status(`${sl.label}에는 ${sl.s.length}문장까지 넣을 수 있어요.`); return; } O.slots[i].push(O.sel); const c=document.querySelector(`.schip[data-k="${O.sel}"]`); c.classList.add("used"); c.classList.remove("sel"); O.sel=null; document.querySelectorAll(".slot").forEach(x=>x.classList.remove("target")); renderSlots(); status("문장을 고르세요."); }; d.tabIndex=0;d.setAttribute("role","button");d.setAttribute("aria-label",sl.label+"에 문장 넣기");d.onkeydown=e=>{if((e.key==="Enter"||e.key===" ")&&e.target===d){e.preventDefault();d.click();}}; slotRoot.append(d); });
  document.querySelectorAll(".schip").forEach(b=>{b.classList.toggle("used",O.slots.flat().includes(+b.dataset.k));b.classList.toggle("sel",O.sel===+b.dataset.k);});
  S.draft.slots=O.slots;S.draft.selectedSentence=O.sel;persist();
  window.TrainingUI?.decorateInputs();
}
function gradeOutline(){
  const total=PKG.outline.slots.reduce((a,s)=>a+s.s.length,0); const filled=O.slots.reduce((a,s)=>a+s.length,0);
  if(filled<total){ status(`뼈대를 다 채워 주세요. (${filled}/${total})`); return; }
  let hit=0; PKG.outline.slots.forEach((sl,i)=>{ O.slots[i].forEach(k=>{ if(sl.s.includes(k)) hit++; }); });
  S.submitted.outline=true;persist();renderCurrentStage();
}
function showOutlineResult(){
  // 표시
  document.querySelectorAll("#slots .slot").forEach((d,i)=>{ d.onclick=null;d.onkeydown=null;d.removeAttribute("role");d.removeAttribute("tabindex"); d.querySelectorAll(".item").forEach((it,j)=>{ it.classList.add(PKG.outline.slots[i].s.includes(O.slots[i][j])?"ok":"no"); it.querySelector("button")?.remove(); }); });
  $("o-score").hidden=false; $("o-score").innerHTML=`<div class="kpis"><div class="kpi"><div class="l">뼈대 정확도</div><div class="v">${pct(R.o.hit,R.o.total)}%</div><div class="s">${R.o.hit}/${R.o.total} 문장이 제자리</div></div></div>`;
  $("o-write").hidden=false;
  $("slots-ref").innerHTML=PKG.outline.slots.map((sl,i)=>`<div class="slot" style="cursor:default;min-height:0"><h4>${sl.label}</h4>${sl.s.map(k=>`<div class="item">${SENT[k]}</div>`).join("")}</div>`).join("");
  $("kwlist").innerHTML=KEYWORDS.map(k=>`<span class="kw" data-k="${k}">${k}</span>`).join("");
  $("essay").value=S.draft.essay; $("essay").disabled=S.submitted.writing;bindValue($("essay"),v=>{S.draft.essay=v;updateMeter();});updateMeter();
  mainBtn("첨삭 받기", gradeS4); status("뼈대를 보면서 간추려 쓰세요.");
}
function kwFound(text){ return KEYWORDS.map(k=>({k,on:text.includes(stem(k).replace(/\s+/g,""))||text.includes(stem(k))})); }
function updateMeter(){ const t=$("essay").value; $("cc").textContent=t.replace(/\s/g,"").length+"자"; const f=kwFound(t); const n=f.filter(x=>x.on).length; $("kwbar").style.width=pct(n,KEYWORDS.length)+"%"; $("kwpct").textContent=`낱말 ${n}/${KEYWORDS.length}`; f.forEach(x=>{ const e=document.querySelector(`.kw[data-k="${x.k}"]`); if(e) e.classList.toggle("on",x.on); }); }
function gradeS4(){
  if(S.submitted.writing) return;
  if(!S.submitted.outline||S.draft.essay.replace(/\s/g,"").length<40){status("뼈대를 완성하고 40자 이상 써 주세요.");return;}
  S.submitted.writing=true;persist();renderCurrentStage();
}
function showWritingResult(){
  const f=R.w.local;$("feedback").hidden=true;if(!S.submitted.writing)return;
  $("feedback").hidden=false;$("feedback").innerHTML=`<h3>첨삭 결과 <span class="chip warn">규칙 기반</span></h3><div class="kpis">${kpi("핵심 낱말 포함율",f.kw+"%","문장의 의미·정확성을 평가하지 않습니다.")}${kpi("글자 수",f.len,"공백 제외 · 가이드 150자")}${kpi("문장 수",f.sents)}</div><p class="muted">외부 AI 연결 없이 낱말 포함과 길이만 확인했습니다.</p>`;
}

function initS5(){renderReport(S);}
