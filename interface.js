/* Presentation only: existing engine owns answers, scoring, persistence and lifecycle. */
(() => {
  const app = document.querySelector('.app');
  const AREA = {
    vocabulary: { label: '어휘력', steps: [1], short: '어휘' },
    fluency: { label: '읽기 유창성', homeLabel: '지문 1', steps: [3], short: '읽기·진단' },
    reading: { label: '독해력', homeLabel: '지문 2', steps: [2, 3, 4], short: '개념·인출 · 읽기·진단 · 구조화·글쓰기' }
  };
  let view = 'learning';
  let drawerReturnFocus = null;
  const history = () => [...TrainingStore.loadHistory(storage).records, ...(window.AreaTraining?.records() || [])];
  const areaActive = () => window.AreaTraining?.hasActive() || false;
  const resultOf = record => record.activity ? window.AreaTraining.results(record.session) : deriveResults(record.session);
  const openRecord = record => record.activity ? window.AreaTraining.showReport(record.session) : showHistoryReport(record);
  const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
  const labelFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
  const dateKey = value => dateFormatter.format(new Date(value));
  const dayLabel = value => labelFormatter.format(new Date(value));
  const meaningful = () => S.status === 'active' && (S.elapsedMs >= 1000 || S.currentStep !== S.requiredSteps[0] || S.mode === 'mistakes' || Object.values(S.submitted).some(Boolean) || S.phase.concept !== 'read' || S.phase.reading !== 'read' || S.draft.vocab.some(x => x !== null) || S.draft.compose.some(Boolean) || S.draft.blanks.some(Boolean) || S.draft.readingAnswers.some(x => x !== null) || S.draft.key.length || S.draft.slots.some(x => x.length) || S.draft.essay);
  const courseActive = () => window.AreaTraining ? areaActive() && window.AreaTraining.isCourse() : meaningful() && S.mode === 'full';

  function setView(next, records) {
    window.AreaTraining?.pause();
    const changed = view !== next;
    view = next; app.dataset.view = next;
    if ($('activity-panel')) $('activity-panel').hidden = true;
    document.title = next === 'home' ? '맞춤형 훈련 · 읽는 힘' : next === 'history' ? '학습 기록 · 읽는 힘' : next === 'report' ? '학습 리포트 · 읽는 힘' : `${S.title} · ${AREA[currentArea()].label}`;
    $('home-panel').hidden = next !== 'home';
    $('learning-shell').hidden = next === 'home';
    document.querySelector('.top').hidden = next !== 'learning';
    $('rail').hidden = S.mode === 'mistakes';
    document.querySelector('.actionbar').hidden = next === 'home';
    $('view-heading').hidden = next === 'home' || next === 'learning';
    $('view-context').textContent = next === 'history' ? '학습 기록' : '학습 리포트';
    app.dataset.area = currentArea();
    document.querySelector('.actionbar').dataset.area = app.dataset.area;
    if (changed) refreshMenu(records);
  }
  function currentArea() {
    if (S.mode === 'area' && S.requiredSteps.length > 1) return 'reading';
    return S.currentStep === 1 ? 'vocabulary' : S.currentStep === 3 ? 'fluency' : 'reading';
  }
  function totalLearningTime(records) {
    const byId = new Map(records.map(record => [record.id, record.totalTime]));
    if (!byId.has(S.id)) byId.set(S.id, S.elapsedMs);
    const activity = window.AreaTraining?.getSession();
    if (activity && !byId.has(activity.id)) byId.set(activity.id, activity.elapsedMs);
    return [...byId.values()].reduce((sum, ms) => sum + ms, 0);
  }
  function todayStatus(records) {
    const today = dateKey(Date.now());
    const submitted = new Set();
    const completedAreas = new Set();
    for (const record of records) {
      if (record.mode === 'mistakes' || (record.activity && record.session.reviewOf) || dateKey(record.completedAt) !== today) continue;
      if (record.activity) (window.AreaTraining.completedAreas?.(record.session) || [record.session.area]).forEach(area => completedAreas.add(area));
      else record.session.requiredSteps.forEach(step => { if (stepDone(record.session, step)) submitted.add(step); });
    }
    return Object.fromEntries(Object.entries(AREA).map(([key, area]) => [key, completedAreas.has(key) || area.steps.every(step => submitted.has(step))]));
  }
  function recordArea(record) {
    if (record.activity) return { key: window.AreaTraining.areaOf?.(record.session) || record.session.area, label: (window.AreaTraining.label?.(record.session) || AREA[record.session.area].label) + (record.session.reviewOf ? ' · 오답 복습' : '') };
    if (record.mode === 'mistakes') return { key: 'reading', label: '오답 재학습' };
    if (record.session.requiredSteps.length === 1) {
      const step = record.session.requiredSteps[0];
      return step === 1 ? { key: 'vocabulary', label: '어휘력' } : step === 3 ? { key: 'fluency', label: '읽기 유창성' } : { key: 'reading', label: STEP_NAMES[step - 1] };
    }
    return { key: 'reading', label: record.mode === 'full' ? '전체 학습' : '독해력' };
  }
  function recordCard(record) {
    const area = recordArea(record), result = resultOf(record), date = dayLabel(record.completedAt);
    const card = el('article', 'record-card'); card.dataset.area = area.key;
    card.innerHTML = `<div class="record-main"><span class="record-area">${esc(area.label)}</span><h3>${esc(record.title)}</h3><span class="record-meta">${esc(date)} · ${esc(formatTime(record.totalTime))}</span></div><div class="record-score"><strong>${result.totalScore ?? '—'}<small>%</small></strong><span>정답률</span></div>`;
    const button = el('button', 'icon-button', '→');
    button.setAttribute('aria-label', `${area.label} ${date} 결과 보기`);
    button.onclick = () => openRecord(record); card.append(button);
    return card;
  }
  function renderHome(records = history()) {
    records.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    const done = todayStatus(records), count = Object.values(done).filter(Boolean).length;
    $('home-time').textContent = formatTime(totalLearningTime(records));
    $('today-count').innerHTML = `${count} <span>/ 3 완료</span>`;
    $('today-progress').value = count;
    $('today-checklist').replaceChildren();
    Object.entries(AREA).forEach(([key, area]) => {
      const homeLabel = area.homeLabel || area.label;
      const item = el('span', 'today-item' + (done[key] ? ' is-complete' : ''));
      item.dataset.area = key;
      item.innerHTML = `<span aria-hidden="true">${done[key] ? '✓' : '○'}</span> ${homeLabel}<small>${done[key] ? '완료' : '진행 전'}</small>`;
      $('today-checklist').append(item);
    });
    const continuing = courseActive();
    const stage = Object.keys(AREA).indexOf(window.AreaTraining?.currentArea() || currentArea()) + 1;
    $('course-status').textContent = continuing ? `${stage}단계 진행 중` : '3단계 과정';
    $('home-full-start').innerHTML = `맞춤형 훈련 ${continuing ? '이어하기' : '시작'} <span aria-hidden="true">→</span>`;
    $('course-start-detail').textContent = continuing ? '학습 중이던 단계에서 이어서 진행해요.' : '중간에 멈춰도 이어서 학습할 수 있어요.';
    $('today-message').textContent = count === 3 ? '오늘의 세 단계를 모두 완료했어요. 수고했어요!' : '완료한 회차가 오늘의 진행도에 반영돼요.';
    $('home-resume').hidden = !meaningful() && !areaActive();
    $('home-resume-title').textContent = S.title;
    $('home-resume-description').textContent = `${S.mode === 'mistakes' ? '오답 재학습' : STEP_NAMES[S.currentStep - 1]} · ${progress(S)}% 완료 · ${formatTime(S.elapsedMs)}`;
    $('home-resume-progress').value = progress(S);
    window.AreaTraining?.decorateResume();
    const recent = $('recent-list'); recent.replaceChildren();
    if (!records.length) {
      const empty = el('div', 'empty-state', '<span class="empty-symbol" aria-hidden="true">↗</span><h3>아직 완료한 학습이 없어요.</h3><p>첫 학습을 마치면 나의 기록이 여기에 쌓여요.</p>');
      recent.append(empty);
    } else records.slice(0, 3).forEach(record => recent.append(recordCard(record)));
  }
  function home(focus = true) {
    window.AreaTraining?.pause();
    tick(); persist();
    gateOpen = false; historyOpen = false; viewingRecord = null;
    const records = history();
    $('resume-dialog').close(); setView('home', records); renderHome(records);
    lastTick = performance.now(); window.scrollTo({ top: 0 });
    if (focus) $('home-title').focus({ preventScroll: true });
  }
  function continueLearning() { if (areaActive()) { window.AreaTraining.resume(); return; } historyOpen = false; viewingRecord = null; resume(); }
  function startFull() {
    if (courseActive()) { continueLearning(); return; }
    if (window.AreaTraining?.startCourse) { window.AreaTraining.startCourse(); return; }
    startLegacy();
  }
  function startLegacy() {
    if (meaningful() && S.mode === 'full') { historyOpen = false; viewingRecord = null; resume(); return; }
    startEntry([1, 2, 3, 4], 'full');
  }
  function startEntry(steps, mode = 'area') {
    if (meaningful() && steps.every(step => S.requiredSteps.includes(step))) { continueLearning(); return; }
    const action = () => replaceSession({ mode, requiredSteps: steps });
    if (meaningful()) confirmAction('다른 학습을 시작하면 진행 중인 회차가 바뀝니다. 현재 답안을 초기화하고 새로 시작할까요? 완료 기록은 유지됩니다.', action);
    else action();
  }
  function questionLabel() {
    const id = S.currentQuestion || '';
    if (S.mode === 'mistakes') return `오답 ${Object.keys(S.mistakeAnswers).length} / ${S.mistakes.length}문항 응답`;
    if (S.currentStep === 1) {
      const match = id.match(/^vq(\d+)_/);
      return match ? `현재 문제 ${+match[1] + 1} / ${PKG.vquiz.length}` : `활용 문제 ${S.draft.vocab.filter(x => x !== null).length} / ${PKG.vquiz.length} 응답`;
    }
    if (S.currentStep === 2) return S.phase.concept === 'read' ? '개념 읽기' : `빈칸 ${S.draft.blanks.filter(x => x.trim()).length} / ${PKG.concept.blanks.length} 응답`;
    if (S.currentStep === 3) {
      if (S.phase.reading === 'read') return '지문 읽기';
      if (S.phase.reading === 'key') return `핵심 문장 ${S.draft.key.length} / ${PKG.key.length} 선택`;
      const match = id.match(/^rq(\d+)_/);
      return match ? `현재 문제 ${+match[1] + 1} / ${PKG.questions.length}` : `이해도 ${S.draft.readingAnswers.filter(x => x !== null).length} / ${PKG.questions.length} 응답`;
    }
    return S.submitted.outline ? `간추려 쓰기 · ${S.draft.essay.replace(/\s/g, '').length}자` : `문장 배치 ${S.draft.slots.flat().length} / 5`;
  }
  function refreshProgress() {
    $('learning-area').textContent = S.mode === 'mistakes' ? '오답 재학습' : AREA[currentArea()].label;
    $('question-label').textContent = questionLabel();
    document.querySelectorAll('#rail button').forEach(button => {
      if (+button.dataset.s === S.currentStep) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    });
  }
  function decorateInputs() {
    document.querySelectorAll('.q').forEach((question, i) => {
      const stem = question.querySelector('.stem');
      if (stem) { stem.id = `question-heading-${i}`; question.setAttribute('role', 'group'); question.setAttribute('aria-labelledby', stem.id); }
    });
    document.querySelectorAll('.opt').forEach(option => {
      let badge = option.querySelector('.option-status');
      if (!badge) { badge = el('span', 'option-status'); option.append(badge); }
      const input = option.querySelector('input');
      badge.textContent = option.classList.contains('right') ? '✓ 정답' : option.classList.contains('wrong') ? '✕ 오답' : input.checked ? '선택' : '';
      badge.hidden = !badge.textContent;
    });
    document.querySelectorAll('.schip').forEach(button => {
      button.setAttribute('aria-pressed', String(button.classList.contains('sel')));
      button.setAttribute('aria-disabled', String(button.classList.contains('used') || S.submitted.outline));
    });
    document.querySelectorAll('#slots .slot').forEach((slot, index) => {
      slot.removeAttribute('role'); slot.removeAttribute('tabindex'); slot.onkeydown = null;
      if (!S.submitted.outline && !slot.querySelector('.slot-add')) {
        const add = el('button', 'btn secondary slot-add', '여기에 문장 넣기');
        add.type = 'button'; add.setAttribute('aria-label', `${PKG.outline.slots[index].label}에 문장 넣기`);
        slot.append(add); // Native button bubbles to the original slot click handler.
      }
    });
    document.querySelectorAll('#passage .sent').forEach(sentence => {
      if (S.phase.reading !== 'quiz' || sentence.querySelector('.sentence-status')) return;
      const correct = sentence.classList.contains('key'), picked = sentence.classList.contains('picked');
      if (correct || picked) sentence.append(el('span', 'sentence-status', correct ? picked ? ' ✓ 선택한 정답' : ' 정답 문장' : ' ✕ 선택한 오답'));
    });
    document.querySelectorAll('#slots .item').forEach(item => {
      let badge = item.querySelector('.placement-status');
      if (!badge && (item.classList.contains('ok') || item.classList.contains('no'))) { badge = el('span', 'placement-status', item.classList.contains('ok') ? '✓ 정답' : '✕ 다시 확인'); item.append(badge); }
    });
  }
  function showLearning() {
    setView(S.currentStep === 5 && (S.mode !== 'mistakes' || S.mistakeSubmitted) ? 'report' : 'learning');
    if (S.currentStep === 4) {
      const build = $('o-build');
      let review = $('outline-review');
      if (S.submitted.outline && !review) {
        review = el('details', 'report-details outline-review'); review.id = 'outline-review';
        review.append(el('summary', '', '내 문장 배치 결과 보기')); build.before(review); review.append(build);
      } else if (!S.submitted.outline && review) { review.before(build); review.remove(); }
    }
    refreshProgress(); decorateInputs();
    if (S.phase.reading === 'key' && S.currentQuestion?.startsWith('key-')) $(S.currentQuestion)?.focus({ preventScroll: true });
  }
  function decorateReport(session) {
    const report = $('report'), r = deriveResults(session);
    const summary = report.firstElementChild;
    summary.classList.add('report-hero');
    summary.prepend(el('p', 'home-eyebrow', '학습 완료'), el('h2', '', esc(session.title)));
    const stats = el('div', 'report-kpis');
    const metrics = [
      ['어휘', r.v ? pct(r.v.quiz.correct, r.v.quiz.total) : null, '활용 문제 기준', 'vocabulary'],
      ['개념·인출', r.c?.recall ?? null, '빈칸 정답 기준', 'reading'],
      ['읽기·진단', r.r?.factCorrect === undefined ? null : pct(r.r.factCorrect + r.r.inferCorrect + r.r.key.hit, PKG.questions.length + PKG.key.length), '독해·핵심 문장 기준', 'fluency'],
      ['구조화·글쓰기', r.o ? pct(r.o.hit, r.o.total) : null, '문장 배치 기준 · 의미 평가는 제외', 'reading']
    ];
    if (session.mode !== 'mistakes') metrics.forEach(([label, score, note, area]) => {
      const card = el('div', 'report-stat'); card.dataset.area = area;
      card.innerHTML = `<h3>${label}</h3><strong>${score === null ? '—' : score + '<small>%</small>'}</strong><p>${score === null ? '이번 회차 미수행' : note}</p>`; stats.append(card);
    });
    summary.after(stats);
    const good = [], practice = [];
    metrics.filter(([, score]) => score !== null).forEach(([label, score]) => { (score >= 80 ? good : practice).push(`${label === '구조화·글쓰기' ? '문장 배치' : label} 정답률 ${score}%${score >= 80 ? '로 잘 마쳤어요.' : '예요. 틀린 내용을 한 번 더 살펴보세요.'}`); });
    if (r.r?.infer < 70) practice.push(`추론 문제 정답률은 ${r.r.infer}%예요. 글 속 단서를 연결해 보세요.`);
    if (r.w) (r.w.local.kw >= 60 ? good : practice).push(`요약에 핵심 낱말 ${r.w.local.kw}%가 포함됐어요. 문장의 의미·문맥을 평가한 결과는 아니에요.`);
    if (session.mode === 'mistakes') (r.totalScore >= 80 ? good : practice).push(`이번 오답 재학습에서 ${r.totalQuestions}문제 중 ${r.totalCorrect}문제를 맞혔어요.`);
    const feedback = el('section', 'report-feedback'); feedback.setAttribute('aria-label', '학습 피드백');
    [['잘한 점', good.length ? good : ['모든 필수 활동을 끝까지 마쳤어요.'], 'good'], ['보완할 점', practice.length ? practice : ['다음 학습에서도 차근차근 이어가 보세요.'], 'practice']].forEach(([title, messages, type]) => {
      const column = el('div', `feedback-column ${type}`); column.innerHTML = `<h3>${title}</h3><ul>${messages.map(message => `<li>${esc(message)}</li>`).join('')}</ul>`; feedback.append(column);
    }); stats.after(feedback);
    const recommendation = [...report.children].find(node => node.querySelector('h3')?.textContent === '맞춤형 후속 학습');
    if (recommendation) { recommendation.classList.add('report-recommendations'); recommendation.querySelector('h3').textContent = '조금 더 연습하면 좋아요'; feedback.after(recommendation); }
    const areas = report.querySelector('.areas');
    if (areas) { const details = el('details', 'report-details'); details.append(el('summary', '', '영역별 상세 결과 보기')); areas.before(details); details.append(areas); }
  }
  function refreshMenu(records) {
    $('menu-continue').hidden = !meaningful() && !areaActive();
    $('menu-report').hidden = S.status !== 'completed' && !(records || history()).length;
    document.querySelectorAll('[data-menu]').forEach(button => {
      if (button.dataset.menu === view || button.dataset.menu === 'continue' && view === 'learning') button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
  }
  function decorateHistory() {
    const records = history().sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    if (window.AreaTraining) {
      $('history-list').replaceChildren(...records.map(recordCard));
      if (!records.length) $('history-list').append(el('p', 'muted', '저장된 학습 기록이 없습니다.'));
      $('btn-main').textContent = '홈으로'; $('btn-main').onclick = () => home();
      $('history-new').onclick = () => home();
      return;
    }
    document.querySelectorAll('#history-list > .card').forEach((card, index) => {
      const record = records[index]; if (!record) return;
      const area = recordArea(record), result = resultOf(record);
      card.classList.add('record-card'); card.dataset.area = area.key;
      const main = el('div', 'record-main');
      main.append(el('span', 'record-area', esc(area.label)), card.querySelector('h3'));
      const meta = card.querySelector('p'); meta.className = 'record-meta'; meta.textContent = `${dayLabel(record.completedAt)} · ${formatTime(record.totalTime)}`; main.append(meta);
      const score = el('div', 'record-score', `<strong>${result.totalScore ?? '—'}<small>%</small></strong><span>정답률</span>`);
      card.prepend(main, score);
    });
    if (!records.length) $('history-list').classList.add('empty-state'); else $('history-list').classList.remove('empty-state');
  }
  function closeMenu() {
    $('menu-drawer').close(); $('menu-button').setAttribute('aria-expanded', 'false');
    document.body.classList.remove('menu-open'); lastTick = performance.now(); drawerReturnFocus?.focus({ preventScroll: true });
  }
  function latestReport() {
    if (window.AreaTraining) { const latest = history().sort((a,b) => b.completedAt.localeCompare(a.completedAt))[0]; if (latest) openRecord(latest); return; }
    if (S.status === 'completed') { gateOpen = false; historyOpen = false; viewingRecord = null; navigateStage(5); }
    else { const latest = history().sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0]; if (latest) showHistoryReport(latest); }
  }
  window.TrainingUI = {
    isLearningVisible: () => view === 'learning' && !$('menu-drawer').open,
    refreshProgress, showLearning, decorateReport, decorateInputs,
    showHistory: () => { setView('history'); decorateHistory(); window.scrollTo({ top: 0 }); },
    showReport: () => { for (let n = 1; n < 5; n++) $('s' + n).hidden = true; $('mistake-panel').hidden = true; setView('report'); window.scrollTo({ top: 0 }); },
    showHome: home,
    showActivity: (area, report = false) => {
      setView(report ? 'activity-report' : 'activity');
      $('learning-shell').hidden = true; $('activity-panel').hidden = false;
      document.querySelector('.actionbar').hidden = true;
      app.dataset.area = area; document.title = `${AREA[area].label}${report ? ' 결과' : ''} · 읽는 힘`;
    }
  };
  $('brand-home').onclick = () => home(); $('learning-home').onclick = () => home(); $('view-home').onclick = () => home();
  $('home-continue').onclick = continueLearning; $('home-full-start').onclick = startFull;
  $('home-history-all').onclick = showHistory;
  if ($('menu-legacy')) $('menu-legacy').onclick = () => { closeMenu(); startLegacy(); };
  $('menu-button').onclick = () => { window.AreaTraining?.pause(); tick(); persist(); refreshMenu(); drawerReturnFocus = document.activeElement; $('menu-drawer').showModal(); $('menu-button').setAttribute('aria-expanded', 'true'); document.body.classList.add('menu-open'); };
  $('menu-close').onclick = closeMenu;
  $('menu-drawer').addEventListener('cancel', event => { event.preventDefault(); closeMenu(); });
  $('menu-drawer').addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...$('menu-drawer').querySelectorAll('button')].filter(button => !button.hidden && !button.disabled);
    const first = controls[0], last = controls.at(-1);
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  });
  $('menu-drawer').addEventListener('click', event => { if (event.target === $('menu-drawer')) closeMenu(); });
  document.querySelectorAll('[data-menu]').forEach(button => { button.onclick = () => { closeMenu(); ({ home, continue: continueLearning, history: showHistory, report: latestReport })[button.dataset.menu](); }; });
  document.addEventListener('change', () => { refreshProgress(); decorateInputs(); });
  document.addEventListener('click', event => { if (event.target.closest('.schip, .slot')) decorateInputs(); });
  document.addEventListener('focusin', event => { if (event.target.matches('input, textarea, select') && view === 'learning') refreshProgress(); });
  home(false);
})();
