/* Area activities reuse PKG. The original integrated course keeps its own saved session. */
(() => {
  'use strict';
  const catalog = ActivityContent.createCatalog(PKG);
  const engine = ActivityEngine.create(catalog);
  const loadedActivity = engine.load(storage);
  let session = loadedActivity.session;
  let last = performance.now();
  let playing = false;
  const panel = $('activity-panel');
  const warning = el('p', 'note'); warning.id = 'activity-storage-warning'; warning.role = 'alert'; warning.hidden = true;
  $('storage-warning').after(warning);
  const AUTO_MS = 4000, SPEED_MS = 60000;
  const active = () => session?.status === 'active';
  const visible = () => active() && document.querySelector('.app').dataset.view === 'activity' && !document.hidden && !$('menu-drawer').open && !$('confirm-dialog').open;
  const showWarning = message => { warning.textContent = message || ''; warning.hidden = !message; };
  const button = (id, text, action, cls = 'btn') => { const b = el('button', cls, esc(text)); b.id = id; b.type = 'button'; b.onclick = action; return b; };
  function save() {
    if (!session) return true;
    const saved = engine.save(storage, session);
    const historySaved = session.status === 'completed' ? engine.saveCompleted(storage, session) : { ok: true };
    showWarning(saved.warning || historySaved.warning);
    if ($('activity-save')) $('activity-save').textContent = saved.ok && historySaved.ok ? '이 기기에 자동 저장됨' : '저장되지 않았어요. 이 화면을 유지해 주세요.';
    return saved.ok && historySaved.ok;
  }
  function clock() {
    const now = performance.now(), delta = Math.max(0, Math.min(5000, now - last)); last = now;
    if (!visible()) return;
    const current = engine.current(session);
    // Automatic reading only runs after the learner presses play.
    if (current.task.kind === 'read' && current.task.mode === 'auto' && !playing) return;
    engine.tick(session, delta);
  }
  function pause() { clock(); playing = false; save(); last = performance.now(); }
  function progressHeader() {
    if (!session || !$('activity-progress')) return;
    const p = engine.progress(session);
    $('activity-progress').value = p.percent;
    $('activity-progress-label').textContent = `${p.percent}% 완료 · ${formatTime(session.elapsedMs)}`;
  }
  function records() {
    const history = engine.loadHistory(storage);
    if (history.warning) showWarning(history.warning);
    return history.records.map(s => ({
      activity: true, id: s.id, session: s, title: s.title, mode: 'area',
      completedAt: s.completedAt, totalTime: s.elapsedMs
    }));
  }
  function results(s) {
    const r = engine.results(s); return { ...r, totalScore: r.accuracy, totalCorrect: r.correct };
  }
  function start(area, options = {}) {
    if (!options.reviewOf && !options.restart && active() && session.area === area) { resume(); return; }
    const replace = () => {
      if (session?.status === 'completed' && !save()) return;
      session = engine.newSession(area, options); last = performance.now(); save(); render();
    };
    if (active()) { pause(); confirmAction('진행 중인 영역 학습을 새 회차로 바꿀까요? 현재 회차의 답안은 초기화되고 완료 기록은 유지돼요.', replace); }
    else replace();
  }
  function resume() { if (!session) return; session.status === 'completed' ? showReport(session) : render(); }
  function home() { pause(); TrainingUI.showHome(); }
  function history() { pause(); showHistory(); }
  function previous() {
    clock();
    // A reading activity is shown once; previous returns to answered questions only.
    let index = session.cursor - 1;
    while (index >= 0 && catalog[session.area].tasks.find(t => t.id === session.queue[index].taskId)?.kind === 'read') index--;
    if (index < 0) return;
    while (session.cursor > index) engine.previous(session);
    save(); render();
  }
  function advance() {
    clock();
    engine.next(session);
    // Returning from an answered question must not repeat a completed reading activity.
    while (session.status === 'active') {
      const { entry, task } = engine.current(session);
      if (task.kind !== 'read' || !session.read[entry.key]?.done) break;
      engine.next(session);
    }
    save(); session.status === 'completed' ? showReport(session) : render();
  }
  function submit() {
    clock(); const answer = engine.submit(session);
    if (!answer.ok) { $('activity-feedback').textContent = answer.warning || '답을 골라 주세요.'; return; }
    save(); render(); $('activity-feedback').focus({ preventScroll: true });
  }
  function finishRead() { clock(); if (engine.finishRead(session)) advance(); }
  function heading(task, entry) {
    const header = el('header', 'activity-header');
    const row = el('div', 'activity-heading');
    row.append(button('activity-home', '←', home, 'icon-button'), el('div', '', `<span class="home-eyebrow">${esc(catalog[session.area].label)}</span><h1 id="activity-title" tabindex="-1">${esc(task.label)}</h1>`));
    row.firstChild.setAttribute('aria-label', '홈으로 돌아가기'); header.append(row);
    const phaseTasks = catalog[session.area].tasks.filter(t => t.kind !== 'read' && t.phase === task.phase);
    const position = phaseTasks.findIndex(t => t.id === task.id) + 1;
    const label = entry.retryOf ? '오답 복습' : task.kind === 'read' ? '글 읽기' : `${position} / ${phaseTasks.length}문항`;
    header.append(el('p', 'muted', `${esc(task.phase)} · ${label}${task.review && !entry.retryOf ? ' · 낱말 복습' : ''}`));
    const p = document.createElement('progress'); p.id = 'activity-progress'; p.max = 100; p.setAttribute('aria-label', '영역 학습 진행률');
    header.append(p, el('p', 'tiny', '<span id="activity-progress-label"></span> · <span id="activity-save"></span>'));
    panel.append(header);
  }
  function render(scroll = true) {
    TrainingUI.showActivity(session.area); last = performance.now();
    panel.replaceChildren();
    const { entry, task } = engine.current(session);
    heading(task, entry);
    if (task.kind === 'read') renderRead(task, entry); else renderQuestion(task, entry);
    const actions = el('div', 'activity-actions');
    const hasPrevious = session.queue.slice(0, session.cursor).some(q => catalog[session.area].tasks.find(t => t.id === q.taskId)?.kind !== 'read');
    const prev = button('activity-prev', '이전 문제', previous, 'btn secondary'); prev.hidden = !hasPrevious || task.kind === 'read'; actions.append(prev);
    if (task.kind === 'read') {
      const main = button('activity-main', '다 읽었어요 · 문제 풀기', finishRead); main.disabled = task.mode === 'auto'; actions.append(main);
    } else {
      const submitted = session.submitted[entry.key];
      const main = button('activity-main', submitted ? session.cursor === session.queue.length - 1 ? '결과 보기' : '다음 문제' : '정답 확인', submitted ? advance : submit);
      main.disabled = !submitted && (task.kind === 'order' ? session.answers[entry.key]?.length !== task.answer.length : !Number.isInteger(session.answers[entry.key]));
      actions.append(main);
    }
    panel.append(actions, button('activity-history', '학습 기록 보기', history, 'text-button'));
    progressHeader(); save();
    if (scroll) { window.scrollTo({ top: 0 }); $('activity-title').focus({ preventScroll: true }); }
  }
  function renderRead(task, entry) {
    const card = el('div', 'card activity-passage');
    card.append(el('h2', '', esc(session.title)));
    if (task.mode === 'auto') {
      card.append(el('p', 'muted', '한 문장씩 4초 동안 표시돼요. 마지막 문장까지 읽으면 퀴즈가 열려요.'), el('p', 'tiny', '<span id="activity-auto-count"></span>'));
      const text = el('p', 'activity-auto-text'); text.id = 'activity-auto-text'; card.append(text);
      card.append(button('activity-play', '자동 읽기 시작', () => {
        clock(); playing = !playing; last = performance.now(); updateRead(); save();
      }, 'btn secondary'));
      panel.append(card); updateRead();
    } else {
      if (task.mode === 'speed') card.append(el('p', 'activity-read-clock', '60초 안에 읽어 보세요. <strong id="activity-speed-time"></strong>'), el('p', 'tiny', '다 읽으면 바로 문제로 넘어갈 수 있어요. 60초가 지나면 글이 닫혀요.'));
      task.paragraphs.forEach(paragraph => card.append(el('p', '', esc(paragraph.s.join(' ')))));
      panel.append(card); updateRead();
    }
  }
  function updateRead() {
    if (!active()) return;
    const { task, entry } = engine.current(session);
    if (task.kind !== 'read') return;
    const r = session.read[entry.key];
    if (task.mode === 'auto' && $('activity-auto-text')) {
      const index = Math.min(task.sentences.length - 1, Math.floor((r?.elapsedMs || 0) / AUTO_MS));
      if (r) r.autoIndex = index;
      $('activity-auto-text').textContent = task.sentences[index];
      $('activity-auto-count').textContent = `${index + 1} / ${task.sentences.length}문장`;
      $('activity-play').textContent = playing ? '일시 정지' : (r?.elapsedMs || 0) ? '자동 읽기 계속' : '자동 읽기 시작';
    }
    if (task.mode === 'speed' && $('activity-speed-time')) $('activity-speed-time').textContent = `${Math.max(0, Math.ceil((SPEED_MS - (r?.elapsedMs || 0)) / 1000))}초 남음`;
  }
  function answerLabel(task, answer) {
    if (task.kind === 'order') return (answer || []).map(id => `${task.paragraphs.findIndex(p => p.id === id) + 1}번 문단`).join(' → ');
    return task.options[answer] ?? '미응답';
  }
  function renderQuestion(task, entry) {
    const selected = session.answers[entry.key], submitted = session.submitted[entry.key];
    const card = el('section', 'card activity-question'); card.setAttribute('aria-labelledby', 'activity-question-title');
    card.append(el('h2', '', `<span id="activity-question-title">${esc(task.question)}</span>`));
    if (session.area === 'vocabulary') card.append(el('p', 'tiny', catalog.vocabulary.note));
    if (task.kind === 'order') {
      card.append(el('p', 'muted', '먼저 나오는 문단부터 눌러 주세요.'));
      const chosen = selected || [];
      const order = el('div', 'activity-order-summary'); order.setAttribute('aria-live', 'polite');
      order.textContent = chosen.length ? `선택한 순서: ${answerLabel(task, chosen)}` : '아직 선택한 문단이 없어요.'; card.append(order);
      task.paragraphs.forEach((paragraph, index) => {
        const b = button(`activity-paragraph-${paragraph.id}`, '', () => { engine.answer(session, [...chosen, paragraph.id]); save(); render(false); }, 'activity-paragraph');
        b.dataset.paragraph = paragraph.id; b.disabled = !!submitted || chosen.includes(paragraph.id);
        b.innerHTML = `<strong>${index + 1}번 문단${chosen.includes(paragraph.id) ? ` · ${chosen.indexOf(paragraph.id) + 1}번째로 선택` : ''}</strong><span>${esc(paragraph.text)}</span>`; card.append(b);
      });
      if (!submitted) card.append(button('activity-order-reset', '순서 다시 고르기', () => { engine.answer(session, []); save(); render(false); }, 'text-button'));
    } else {
      task.options.forEach((option, index) => {
        const label = el('label', 'activity-option');
        const input = document.createElement('input'); input.type = 'radio'; input.name = 'activity-answer'; input.id = 'activity-option-' + index; input.value = index; input.checked = selected === index; input.disabled = !!submitted;
        input.onchange = () => { clock(); engine.answer(session, index); save(); $('activity-main').disabled = false; card.querySelectorAll('.activity-option').forEach(row => row.classList.toggle('selected', row.querySelector('input').checked)); };
        label.classList.toggle('selected', selected === index);
        const marker = submitted && index === task.answer ? '✓ 정답' : submitted && selected === index ? '✕ 내 답' : '';
        if (submitted && index === task.answer) label.classList.add('correct');
        if (submitted && selected === index && index !== task.answer) label.classList.add('incorrect');
        label.append(input, el('span', '', esc(option)), el('small', '', marker)); card.append(label);
      });
    }
    const feedback = el('div', 'activity-feedback'); feedback.id = 'activity-feedback'; feedback.tabIndex = -1; feedback.setAttribute('role', 'status');
    if (submitted) {
      feedback.classList.add(submitted.correct ? 'correct' : 'incorrect');
      feedback.append(el('strong', '', submitted.correct ? '정답이에요.' : '다시 살펴보세요.'), el('p', '', `정답: ${esc(answerLabel(task, task.answer))}`));
      if (!submitted.correct && session.area === 'vocabulary') feedback.append(el('p', '', '다음 두 문항 안에 이 문제를 다시 풀어요.'));
      feedback.append(el('p', '', esc(task.meaning || task.source)));
      if (task.answerForm) feedback.append(el('p', 'tiny', `글에서는 ‘${esc(task.answerForm)}’로 쓰였어요.`));
    }
    card.append(feedback); panel.append(card);
  }
  function showReport(s) {
    pause(); TrainingUI.showActivity(s.area, true); panel.replaceChildren();
    const r = engine.results(s), hero = el('section', 'card activity-result'); hero.id = 'activity-result';
    hero.append(el('p', 'home-eyebrow', `${esc(catalog[s.area].label)}${s.reviewOf ? ' · 오답 복습' : ''} 완료`), el('h1', '', esc(s.title)), el('strong', 'activity-score', `${r.accuracy}%`), el('p', 'muted', `첫 풀이 ${r.totalQuestions}문항 중 ${r.correct}문항 정답 · 오답 ${r.wrong}문항`), el('p', 'muted', `학습 시간 ${formatTime(s.elapsedMs)}`));
    if (r.reviewAttempts) hero.append(el('p', 'muted', `추가 오답 복습 ${r.reviewAttempts}회 중 ${r.reviewCorrect}회 정답`));
    const reads = s.queue.filter(q => catalog[s.area].tasks.find(t => t.id === q.taskId)?.kind === 'read');
    if (reads.length) {
      const list = el('div', 'activity-read-results');
      reads.forEach(q => { const task = catalog[s.area].tasks.find(t => t.id === q.taskId); list.append(el('p', 'tiny', `${esc(task.label)} · ${formatTime(s.read[q.key]?.elapsedMs || 0)}`)); });
      hero.append(list);
    }
    panel.append(hero);
    const review = el('section', 'card'); review.id = 'activity-review'; review.append(el('h2', '', '풀이 확인'));
    s.queue.filter(q => !q.retryOf && catalog[s.area].tasks.find(t => t.id === q.taskId)?.kind !== 'read').forEach(q => {
      const task = catalog[s.area].tasks.find(t => t.id === q.taskId), a = s.submitted[q.key];
      const details = el('details', 'activity-review-item');
      details.append(el('summary', '', `${a?.correct ? '✓ 정답' : '✕ 오답'} · ${esc(task.question)}`), el('p', '', `내 답: ${esc(answerLabel(task, a?.answer))}`), el('p', '', `정답: ${esc(answerLabel(task, task.answer))}`), el('p', 'muted', esc(task.source))); review.append(details);
    });
    panel.append(review);
    const actions = el('div', 'activity-actions');
    const wrongIds = s.queue.filter(q => !q.retryOf && s.submitted[q.key]?.correct === false).map(q => q.taskId);
    if (wrongIds.length) actions.append(button('activity-retry-wrong', '틀린 문제 다시 풀기', () => start(s.area, { reviewOf: s.id, taskIds: wrongIds })));
    actions.append(button('activity-retry-area', '이 영역 다시 학습', () => start(s.area, { restart: true }), 'btn secondary'), button('activity-home', '홈으로', home, 'btn secondary'), button('activity-history', '전체 기록', history, 'text-button'));
    panel.append(actions); window.scrollTo({ top: 0 });
  }
  function decorateResume() {
    if (!active()) return;
    const p = engine.progress(session), task = engine.current(session).task;
    $('home-resume-title').textContent = session.title;
    $('home-resume-description').textContent = `${catalog[session.area].label} · ${task.phase} · ${p.percent}% 완료 · ${formatTime(session.elapsedMs)}`;
    $('home-resume-progress').value = p.percent;
  }
  window.AreaTraining = { start, resume, pause, showReport, records, results, decorateResume, hasActive: active, getSession: () => session };
  document.addEventListener('visibilitychange', () => { clock(); save(); last = performance.now(); });
  window.addEventListener('pagehide', () => { clock(); save(); });
  window.addEventListener('beforeunload', () => { clock(); save(); });
  setInterval(() => {
    clock();
    if (!visible()) return;
    const { task, entry } = engine.current(session), read = session.read[entry.key];
    if (task.kind === 'read' && ((task.mode === 'speed' && read?.elapsedMs >= SPEED_MS) || (task.mode === 'auto' && playing && read?.elapsedMs >= task.sentences.length * AUTO_MS))) { finishRead(); return; }
    updateRead(); progressHeader(); save();
  }, 1000);
  if (loadedActivity.warning) showWarning(loadedActivity.warning);
  if (session?.status === 'completed') save();
  TrainingUI.showHome(false);
})();
