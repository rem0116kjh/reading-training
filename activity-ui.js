/* Area activities reuse PKG. The original integrated course keeps its own saved session. */
(() => {
  'use strict';
  const baseCatalog = ActivityContent.createCatalog(PKG);
  const fluencyCatalog = window.FluencyContent ? FluencyContent.extend(baseCatalog, PKG) : baseCatalog;
  const fluencyAreas = window.FluencyContent?.CURRENT_AREAS || { fluency: 'fluency', course: 'course' };
  const vocabularyCatalog = window.VocabularyContent ? VocabularyContent.extend(fluencyCatalog, PKG, fluencyAreas.course) : fluencyCatalog;
  const vocabularyAreas = { ...fluencyAreas, vocabulary: 'vocabulary', ...window.VocabularyContent?.CURRENT_AREAS };
  const readingCatalog = window.ReadingContent ? ReadingContent.extend(vocabularyCatalog, PKG, vocabularyAreas.course) : vocabularyCatalog;
  const readingAreas = { ...vocabularyAreas, ...window.ReadingContent?.CURRENT_AREAS };
  const previousCatalog = window.FluencyConceptContent ? FluencyConceptContent.extend(readingCatalog, PKG, readingAreas.course) : readingCatalog;
  const comprehension = ReadingComprehension.extend(previousCatalog, PKG, { ...readingAreas, ...window.FluencyConceptContent?.CURRENT_AREAS });
  const readingFlow = ReadingFlow.extend(comprehension.catalog, comprehension.currentAreas);
  const { catalog, currentAreas: latestAreas } = ReadingDiagnostic.extend(readingFlow.catalog, readingFlow.currentAreas);
  const engine = ActivityEngine.create(catalog);
  const taskIndexes = Object.fromEntries(Object.entries(catalog).map(([area, definition]) => [area, new Map(definition.tasks.map(task => [task.id, task]))]));
  const taskFor = (s, id) => taskIndexes[s.area].get(id);
  const loadedActivity = engine.load(storage);
  let session = ReadingDiagnostic.migrate(ReadingFlow.migrate(loadedActivity.session, catalog, engine), catalog, engine);
  // Card display is presentation state; quiz answers and scoring stay in the engine.
  let vocabularyCardsOpen = (session?.area === 'vocabulary' || catalog[session?.area]?.vocabularyVersion || catalog[session?.area]?.integrated) && !session.reviewOf && !Object.keys(session.answers).length;
  let returningToQuestion = false;
  const viewedWords = new Set();
  let structureTarget = null;
  let selectedSentence = null;
  let readingReference = null;
  let readingReferenceScroll = 0;
  let last = performance.now();
  let playing = false;
  let lastSaved = 0;
  let lastProgress = 0;
  let readViewState = null;
  let readingPointer = null;
  const app = document.querySelector('.app');
  const panel = $('activity-panel');
  const warning = el('p', 'note'); warning.id = 'activity-storage-warning'; warning.role = 'alert'; warning.hidden = true;
  $('storage-warning').after(warning);
  const AUTO_MS = 4000, SPEED_MS = 60000;
  const areaOf = s => catalog[s.area].trainingArea || s.area;
  const currentArea = s => engine.current(s)?.task.trainingArea || areaOf(s);
  const areaLabels = { vocabulary: '어휘력', fluency: '읽기 유창성', reading: '독해력' };
  const courseLabels = { vocabulary: '1단계 · 어휘력', fluency: '2단계 · 지문 1', reading: '3단계 · 지문 2' };
  const active = () => session?.status === 'active';
  const visible = () => active() && app.dataset.view === 'activity' && !document.hidden && !$('menu-drawer').open && !$('confirm-dialog').open;
  const showWarning = message => {
    const text = message || '';
    if (warning.textContent !== text) warning.textContent = text;
    if (warning.hidden !== !message) warning.hidden = !message;
  };
  const button = (id, text, action, cls = 'btn') => { const b = el('button', cls, esc(text)); b.id = id; b.type = 'button'; b.onclick = action; return b; };
  function save() {
    if (!session) return true;
    const saved = engine.save(storage, session);
    const historySaved = session.status === 'completed' ? engine.saveCompleted(storage, session) : { ok: true };
    showWarning(saved.warning || historySaved.warning);
    const label = $('activity-save'), text = saved.ok && historySaved.ok ? '이 기기에 자동 저장됨' : '저장되지 않았어요. 이 화면을 유지해 주세요.';
    if (label && label.textContent !== text) label.textContent = text;
    lastSaved = performance.now();
    return saved.ok && historySaved.ok;
  }
  function clock() {
    const now = performance.now(), delta = Math.max(0, Math.min(5000, now - last)); last = now;
    if (!visible()) return;
    const current = engine.current(session);
    if (current.task.stage && (!session.read[current.entry.key].started || (current.task.mode !== 'tap' && !playing))) return;
    // Automatic reading only runs after the learner presses play.
    if (current.task.kind === 'read' && current.task.mode === 'auto' && !playing) return;
    const paragraphIndex = readingPointer?.key === current.entry.key && now - readingPointer.at <= 1500 ? readingPointer.index : null;
    return engine.tick(session, delta, { answering: !vocabularyCardsOpen, paragraphIndex });
  }
  function pause() { clock(); playing = false; readingPointer = null; save(); last = performance.now(); updateRead(); }
  function progressHeader() {
    if (!session || !$('activity-progress')) return;
    const p = engine.progress(session);
    if ($('activity-progress').value !== p.percent) $('activity-progress').value = p.percent;
    const text = `${p.percent}% 완료 · ${formatTime(session.elapsedMs)}`;
    if ($('activity-progress-label').textContent !== text) $('activity-progress-label').textContent = text;
    lastProgress = performance.now();
  }
  function records() {
    const history = engine.loadHistory(storage);
    if (history.warning) showWarning(history.warning);
    return history.records.map(s => ({
      activity: true, id: s.id, session: s, title: s.title, mode: catalog[s.area].integrated ? 'full' : 'area',
      completedAt: s.completedAt, totalTime: s.elapsedMs
    }));
  }
  function results(s) {
    const r = engine.results(s), comprehension = ReadingComprehension.results(catalog[s.area], s), diagnostic = ReadingDiagnostic.results(catalog[s.area], s);
    return { ...r, ...(comprehension ? { comprehension } : {}), ...(diagnostic ? { diagnostic } : {}), totalScore: r.accuracy, totalCorrect: r.correct };
  }
  function start(area, options = {}) {
    if (!options.reviewOf && !options.restart && active() && session.area === area) { resume(); return; }
    const replace = () => {
      if (session?.status === 'completed' && !save()) return;
      session = engine.newSession(area, options);
      vocabularyCardsOpen = (area === 'vocabulary' || catalog[area].vocabularyVersion || catalog[area].integrated) && !options.reviewOf;
      returningToQuestion = false; viewedWords.clear();
      last = performance.now(); save(); render();
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
    while (index >= 0 && taskFor(session, session.queue[index].taskId)?.kind === 'read') index--;
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
      if (task.kind !== 'read' || !(session.read[entry.key]?.done || session.read[entry.key]?.skipped)) break;
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
  function skipRead() {
    clock(); playing = false;
    if (engine.skipRead(session)) advance();
  }
  function heading(task, entry) {
    const cards = currentArea(session) === 'vocabulary' && vocabularyCardsOpen;
    const header = el('header', 'activity-header');
    const row = el('div', 'activity-heading');
    row.append(button('activity-home', '←', home, 'icon-button'), el('div', '', `<span class="home-eyebrow">${esc(areaLabels[currentArea(session)])}${session.reviewOf ? ' · 오답 복습' : catalog[session.area].integrated ? ' · 전체 과정' : ''}</span><h1 id="activity-title" tabindex="-1">${cards ? '오늘의 단어' : esc(task.label)}</h1>`));
    row.firstChild.setAttribute('aria-label', '홈으로 돌아가기'); header.append(row);
    const phaseTasks = catalog[session.area].tasks.filter(t => t.kind !== 'read' && t.phase === task.phase && session.taskIds.includes(t.id));
    const position = phaseTasks.findIndex(t => t.id === task.id) + 1;
    const label = entry.retryOf ? '오답 복습' : task.kind === 'read' ? '글 읽기' : task.kind === 'cloze' ? `빈칸 ${task.blanks.length}개 · 확신도` : task.kind === 'practice' ? `${task.prompts.length}개 문장 · 정답률 제외` : task.kind === 'summary' ? '40자 이상 작성 · 정답률 제외' : `${position} / ${phaseTasks.length}문항`;
    header.append(el('p', 'muted', cards ? '카드를 누르면 단어의 뜻과 예문을 볼 수 있어요.' : `${esc(task.phase)} · ${label}${task.review && !entry.retryOf ? ' · 낱말 복습' : ''}`));
    if (task.comprehensionType) {
      header.append(el('p', 'reading-comprehension-counts', '사실적 이해 5 · 추론적 이해 2'));
      const completed = session.queue.filter(q => !q.retryOf && phaseTasks.some(t => t.id === q.taskId) && session.submitted[q.key]).length;
      const progress = document.createElement('progress'); progress.id = 'reading-comprehension-progress';
      progress.max = phaseTasks.length; progress.value = completed; progress.setAttribute('aria-label', '이해도 확인 진행률');
      header.append(progress, el('p', 'tiny', `${completed} / ${phaseTasks.length}문제 완료`));
    }
    if (catalog[session.area].readingDiagnosticVersion >= 3 && currentArea(session) === 'reading') {
      header.append(el('p', 'tiny reading-flow-label', '읽기 → 핵심 문장 찾기 → 사실 5 · 추론 2 → 처음·중간·끝 → 글쓰기'));
    }
    const p = document.createElement('progress'); p.id = 'activity-progress'; p.max = 100; p.setAttribute('aria-label', '영역 학습 진행률');
    header.append(p, el('p', 'tiny', '<span id="activity-progress-label"></span> · <span id="activity-save"></span>'));
    if (catalog[session.area].integrated) {
      const steps = el('ol', 'course-steps'); steps.setAttribute('aria-label', '맞춤형 훈련 순서');
      Object.entries(courseLabels).forEach(([area, label]) => {
        const item = el('li', area === currentArea(session) ? 'current' : '', esc(label));
        if (area === currentArea(session)) item.setAttribute('aria-current', 'step');
        steps.append(item);
      }); header.append(steps);
    }
    if (catalog[session.area].legacyFlow) header.append(el('p', 'tiny', '이전에 시작한 회차를 이어 보고 있어요. 새 회차는 각 Stage 뒤에 퀴즈가 나와요.'));
    if (catalog[session.area].legacyTiming) header.append(el('p', 'tiny', '이 회차는 시작할 때의 속도로 이어져요. 새 회차는 1.2초 간격이며 모든 퀴즈가 객관식이에요.'));
    if (catalog[session.area].legacyContent) header.append(el('p', 'tiny', '이전에 시작한 문항 구성으로 이어져요. 새 회차의 Stage 3에는 퀴즈가 3문항 있어요.'));
    panel.append(header);
  }
  function render(scroll = true) {
    TrainingUI.showActivity(currentArea(session)); last = performance.now();
    const existingReference = panel.querySelector('.reading-reference-text');
    if (existingReference) readingReferenceScroll = existingReference.scrollTop;
    panel.replaceChildren();
    readViewState = null;
    readingPointer = null;
    const { entry, task } = engine.current(session);
    heading(task, entry);
    if (currentArea(session) === 'vocabulary' && vocabularyCardsOpen) {
      renderVocabularyCards(); progressHeader(); save();
      if (scroll) { window.scrollTo({ top: 0, behavior: 'instant' }); $('activity-title').focus({ preventScroll: true }); }
      return;
    }
    if (task.kind === 'read') renderRead(task, entry); else if (task.kind === 'practice') renderVocabularyPractice(task, entry); else if (task.kind === 'summary') renderSummary(task, entry); else renderQuestion(task, entry);
    const actions = el('div', 'activity-actions');
    const hasPrevious = session.queue.slice(0, session.cursor).some(q => taskFor(session, q.taskId)?.kind !== 'read');
    const prev = button('activity-prev', '이전 문제', previous, 'btn secondary'); prev.hidden = !hasPrevious || task.kind === 'read'; actions.append(prev);
    if (task.kind === 'read') {
      const skip = button('activity-skip-read', '읽기 건너뛰기', skipRead, 'btn secondary');
      skip.hidden = !!(session.read[entry.key].done || session.read[entry.key].skipped);
      actions.append(skip);
      if (task.stage) {
        const read = session.read[entry.key];
        const main = button('activity-main', !read.started ? '시작하기' : read.done ? readingNextLabel() : task.mode === 'tap' ? '다음 어절 읽기' : '읽는 중', () => {
          if (!read.started) { engine.startRead(session); save(); render(); playing = task.mode !== 'tap'; last = performance.now(); updateRead(); }
          else if (read.done) advance();
          else if (task.mode === 'tap') tap();
        });
        main.disabled = read.started && !read.done && task.mode !== 'tap'; actions.append(main);
      } else { const main = button('activity-main', task.nextLabel || (task.id === 'reading-concept' ? '다 읽었어요 · 개념 인출' : '다 읽었어요 · 문제 풀기'), finishRead); main.disabled = task.mode === 'auto'; actions.append(main); }
    } else {
      const submitted = session.submitted[entry.key];
      const nextTask = nextVisibleTask();
      const nextLabel = task.diagnostic && nextTask?.comprehensionType ? '이해도 테스트 시작' : task.comprehensionType && nextTask?.selectionType === 'outline' ? '구조화·글쓰기 시작' : task.selectionType === 'outline' && nextTask?.kind === 'summary' ? '글쓰기 시작' : nextTask?.trainingArea && nextTask.trainingArea !== task.trainingArea ? `${catalog[session.area].integrated ? courseLabels[nextTask.trainingArea] : areaLabels[nextTask.trainingArea]} 시작` : nextTask?.stage ? `Stage ${nextTask.stage} 시작` : '다음 문제';
      const main = button('activity-main', submitted ? session.cursor === session.queue.length - 1 ? '결과 보기' : nextLabel : task.kind === 'practice' ? '연습 저장' : task.kind === 'summary' ? '요약 저장·피드백 확인' : '정답 확인', submitted ? advance : submit);
      main.disabled = !submitted && !engine.canSubmit(session);
      actions.append(main);
    }
    (panel.querySelector('.reading-question-column') || panel).append(actions);
    if (currentArea(session) === 'vocabulary') panel.append(button('activity-show-words', '단어 카드 다시 보기', () => {
      clock(); vocabularyCardsOpen = true; returningToQuestion = true; render();
    }, 'text-button'));
    panel.append(button('activity-history', '학습 기록 보기', history, 'text-button'));
    progressHeader(); save();
    if (scroll) {
      window.scrollTo({ top: 0, behavior: 'instant' }); $('activity-title').focus({ preventScroll: true });
      if (task.mode === 'tap' || task.display === 'masked-phrases') panel.querySelector('.fluency-token.is-current, .fluency-phrase.is-current')?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  }
  function renderVocabularyCards() {
    const words = catalog[session.area].words || catalog.vocabulary.words;
    const study = el('section', 'vocabulary-study'); study.setAttribute('aria-label', '오늘의 단어 카드');
    const summary = el('div', 'vocabulary-study-summary');
    summary.append(el('strong', '', `오늘 익힐 단어 ${words.length}개`));
    const count = el('span', 'vocabulary-viewed-count'); count.id = 'vocabulary-viewed-count'; count.setAttribute('role', 'status');
    const updateCount = () => { count.textContent = `${viewedWords.size} / ${words.length} 뜻 확인`; };
    updateCount(); summary.append(count); study.append(summary);
    const grid = el('div', 'vocabulary-card-grid');
    const dialog = el('dialog', 'vocabulary-dialog'); dialog.id = 'vocabulary-word-dialog';
    dialog.setAttribute('aria-labelledby', 'vocabulary-word-title');
    dialog.setAttribute('aria-describedby', 'vocabulary-word-meaning');
    let opener = null;
    const close = () => { dialog.close(); opener?.focus({ preventScroll: true }); };
    dialog.addEventListener('close', () => opener?.focus({ preventScroll: true }));
    dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
    words.forEach((word, index) => {
      const card = button('vocabulary-card-' + index, '', () => {
        opener = card; viewedWords.add(index); updateCount(); updateCard();
        const detail = el('div', 'vocabulary-word-detail');
        const top = el('div', 'vocabulary-word-heading');
        top.append(el('span', 'vocabulary-word-pos', esc(word.pos)));
        const dismiss = button('vocabulary-word-close', '×', close, 'icon-button'); dismiss.setAttribute('aria-label', '단어 뜻 닫기');
        top.append(dismiss);
        detail.append(top, el('h2', '', `<span id="vocabulary-word-title">${esc(word.word)}</span>`));
        const meaning = el('p', 'vocabulary-word-meaning', esc(word.meaning)); meaning.id = 'vocabulary-word-meaning';
        const example = el('div', 'vocabulary-word-example');
        example.append(el('strong', '', '예문'), el('p', '', esc(word.example)));
        detail.append(meaning, example);
        if (word.contextNote) detail.append(el('p', 'tiny', esc(word.contextNote)));
        detail.append(button('vocabulary-word-done', '확인', close));
        dialog.replaceChildren(detail); dialog.showModal();
      }, 'vocabulary-card');
      card.setAttribute('aria-haspopup', 'dialog'); card.setAttribute('aria-controls', dialog.id);
      const updateCard = () => {
        const viewed = viewedWords.has(index);
        card.classList.toggle('is-viewed', viewed);
        card.setAttribute('aria-label', `${word.word}, ${viewed ? '확인한 단어, ' : ''}뜻 보기`);
        card.replaceChildren(el('strong', '', esc(word.word)), el('span', 'vocabulary-card-hint', viewed ? '✓ 확인함' : '뜻 보기'));
      };
      updateCard(); grid.append(card);
    });
    study.append(grid);
    const actions = el('div', 'activity-actions vocabulary-study-actions');
    actions.append(button('activity-main', returningToQuestion ? '문제로 돌아가기' : '다음', () => {
      clock(); vocabularyCardsOpen = false; save(); render();
    }));
    study.append(actions); panel.append(study, dialog);
  }
  function renderVocabularyPractice(task, entry) {
    const submitted = session.submitted[entry.key];
    const answers = session.answers[entry.key] || task.prompts.map(() => '');
    const card = el('section', 'card activity-question vocabulary-practice');
    card.append(el('h2', '', esc(task.question)), el('p', 'muted', '짧은 내용도 괜찮아요. 각 칸에 자유롭게 입력해 주세요.'));
    task.prompts.forEach((prompt, index) => {
      const label = el('label', '', `${esc(prompt.word)} · ${esc(prompt.meaning)}`); label.htmlFor = 'vocabulary-compose-' + index;
      const input = document.createElement('textarea'); input.id = label.htmlFor; input.rows = 3; input.maxLength = 500;
      input.value = answers[index]; input.disabled = !!submitted;
      input.oninput = () => {
        clock(); const next = (session.answers[entry.key] || task.prompts.map(() => '')).slice(); next[index] = input.value;
        engine.answer(session, next); save(); $('activity-main').disabled = !engine.canSubmit(session);
      };
      card.append(label, input);
    });
    const feedback = el('div', 'activity-feedback'); feedback.id = 'activity-feedback'; feedback.tabIndex = -1; feedback.setAttribute('role', 'status');
    if (submitted) feedback.textContent = '입력한 내용을 저장했어요. 어휘 정답률은 객관식 5문항으로만 계산해요.';
    card.append(feedback); panel.append(card);
  }
  function renderRead(task, entry) {
    if (task.stage) { renderStagedRead(task, entry); return; }
    const card = el('div', 'card activity-passage');
    card.append(el('h2', '', esc(task.title || session.title)));
    if (task.mode === 'auto') {
      card.append(el('p', 'muted', '한 문장씩 4초 동안 표시돼요. 마지막 문장까지 읽으면 퀴즈가 열려요.'), el('p', 'tiny', '<span id="activity-auto-count"></span>'));
      const text = el('p', 'activity-auto-text'); text.id = 'activity-auto-text'; card.append(text);
      card.append(button('activity-play', '자동 읽기 시작', () => {
        clock(); playing = !playing; last = performance.now(); updateRead(); save();
      }, 'btn secondary'));
      panel.append(card); updateRead();
    } else {
      if (task.mode === 'speed') card.append(el('p', 'activity-read-clock', '60초 안에 읽어 보세요. <strong id="activity-speed-time"></strong>'), el('p', 'tiny', '다 읽으면 바로 문제로 넘어갈 수 있어요. 60초가 지나면 글이 닫혀요.'));
      task.paragraphs.forEach((paragraph, index) => {
        const text = el('p', '', (paragraph.role ? `<strong class="reading-paragraph-label">${esc(paragraph.role)}</strong>` : '') + esc(paragraph.s.join(' ')));
        if (task.readingTrace) {
          text.dataset.readingParagraph = index;
          const observe = () => {
            clock(); if (!visible()) return;
            engine.observeParagraph(session, index);
            readingPointer = { key: entry.key, index, at: performance.now() };
          };
          text.onpointermove = observe; text.onpointerdown = observe;
          text.onpointerleave = () => { clock(); readingPointer = null; };
        }
        card.append(text);
      });
      panel.append(card); updateRead();
    }
  }
  function tap() {
    clock();
    if (!engine.tapRead(session)) return;
    const { task, entry } = engine.current(session);
    if (session.read[entry.key].position === task.units.length) {
      engine.finishRead(session);
      if (task.afterReadAuto) { advance(); return; }
    }
    updateRead(); progressHeader(); save();
    panel.querySelector('.fluency-token.is-current')?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  function readingNextLabel() {
    const next = session.queue[session.cursor + 1];
    const task = taskFor(session, next?.taskId);
    return task && task.kind !== 'read' ? '퀴즈 풀기' : '다음 Stage';
  }
  function nextVisibleTask() {
    for (const entry of session.queue.slice(session.cursor + 1)) {
      const task = taskFor(session, entry.taskId);
      if (task.kind !== 'read' || !(session.read[entry.key]?.done || session.read[entry.key]?.skipped)) return task;
    }
    return null;
  }
  function renderStagedRead(task, entry) {
    const read = session.read[entry.key];
    const card = el('section', 'card activity-passage fluency-reader');
    card.append(el('h2', '', esc(session.title)), el('p', 'muted', esc(task.instruction)));
    if (!read.started) {
      const preview = el('div', 'fluency-preview'); preview.setAttribute('aria-hidden', 'true');
      preview.textContent = task.mode === 'tap' ? '□  □  □  □' : task.mode === 'paced' ? '한 어절씩, 차근차근' : task.display === 'masked-phrases' ? '밑줄을 따라 읽어보세요' : '한 문단씩 읽어보세요';
      card.append(preview);
      card.append(el('p', 'tiny', task.mode === 'tap' ? `총 ${task.units.length}어절 · 내가 누르는 속도로 읽어요.` : `${task.unitLabel || (task.mode === 'paced' ? '어절' : '문단')}당 ${task.displayInterval / 1000}초 · 화면을 떠나면 멈춰요.`));
    } else {
      const p = document.createElement('progress'); p.id = 'fluency-stage-progress'; p.max = task.units.length; p.value = read.position; p.setAttribute('aria-label', `Stage ${task.stage} 읽기 진행률`);
      card.append(p, el('p', 'tiny', '<span id="fluency-stage-count"></span>'));
      if (task.mode === 'tap') {
        const grid = button('fluency-tap', '', tap, 'fluency-tap'); grid.setAttribute('aria-label', '다음 어절 읽기');
        task.units.forEach((word, i) => { const token = el('span', 'fluency-token'); token.dataset.index = i; token.setAttribute('aria-hidden', 'true'); token.style.setProperty('--token-size', Math.max(2, Math.min(12, word.length))); grid.append(token); });
        card.append(grid, el('p', 'fluency-live', '<span id="fluency-live" aria-live="polite"></span>'));
      } else {
        if (task.display === 'masked-phrases') {
          const lines = el('div', 'fluency-line-reader'); lines.id = 'fluency-line-reader';
          lines.setAttribute('aria-label', '구절을 따라 읽는 영역');
          task.units.forEach(phrase => {
            const line = el('span', 'fluency-phrase');
            line.style.setProperty('--phrase-size', Math.max(3, [...phrase].reduce((n, c) => n + (/\s/.test(c) ? .5 : 1), 0)));
            line.setAttribute('aria-hidden', 'true'); lines.append(line);
          });
          card.append(lines);
        } else {
          const text = el('p', 'fluency-auto-text' + (task.mode === 'continuous' ? ' continuous' : '')); text.id = 'fluency-text'; card.append(text);
        }
        card.append(button('fluency-play', '이어서 읽기', () => { clock(); playing = !playing; last = performance.now(); updateRead(); save(); }, 'btn secondary'));
      }
    }
    panel.append(card); updateRead();
  }
  function updateRead() {
    if (!active()) return false;
    const { task, entry } = engine.current(session);
    if (task.kind !== 'read') return false;
    const r = session.read[entry.key];
    const displayPosition = task.mode === 'auto' ? Math.min(task.sentences.length - 1, Math.floor(r.elapsedMs / AUTO_MS)) : task.mode === 'speed' ? Math.max(0, Math.ceil((SPEED_MS - r.elapsedMs) / 1000)) : r.position;
    const state = `${entry.key}:${displayPosition}:${r.done}:${r.skipped}:${playing}`;
    if (readViewState === state) return false;
    readViewState = state;
    if ($('activity-skip-read')) $('activity-skip-read').hidden = !!(r.done || r.skipped);
    if (task.stage) {
      if ($('fluency-stage-progress')) $('fluency-stage-progress').value = r.position;
      if ($('fluency-stage-count')) $('fluency-stage-count').textContent = `${r.position} / ${task.units.length}${task.unitLabel || (task.mode === 'continuous' ? '문단' : '어절')}${task.mode !== 'tap' ? ` · ${task.displayInterval / 1000}초 간격` : ''} · ${r.done ? '읽기 완료' : task.mode === 'tap' ? '읽기 영역을 눌러주세요' : playing ? '읽는 중' : '일시 정지'}`;
      if ($('fluency-tap')) {
        $('fluency-tap').disabled = r.done;
        panel.querySelectorAll('.fluency-token').forEach((token, i) => {
          const text = i < r.position ? task.units[i] : '';
          if (token.textContent !== text) token.textContent = text;
          if (token.classList.contains('is-read') !== (i < r.position)) token.classList.toggle('is-read', i < r.position);
          if (token.classList.contains('is-current') !== (i === r.position - 1)) token.classList.toggle('is-current', i === r.position - 1);
        });
        $('fluency-live').textContent = r.position ? task.units[r.position - 1] : '아직 읽지 않았어요.';
      }
      const lines = $('fluency-line-reader');
      if (lines && lines.dataset.position !== String(r.position)) {
        lines.dataset.position = r.position;
        [...lines.children].forEach((line, i) => {
          const current = !r.done && i === r.position;
          const text = current ? task.units[i] : '';
          if (line.textContent !== text) line.textContent = text;
          if (line.classList.contains('is-current') !== current) line.classList.toggle('is-current', current);
          if (line.classList.contains('is-read') !== (i < r.position)) line.classList.toggle('is-read', i < r.position);
          if (line.getAttribute('aria-hidden') !== String(!current)) line.setAttribute('aria-hidden', String(!current));
        });
        lines.querySelector('.is-current')?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }
      if ($('fluency-text')) $('fluency-text').textContent = task.units[Math.min(r.position, task.units.length - 1)];
      if ($('fluency-play')) { $('fluency-play').textContent = playing ? '일시 정지' : '이어서 읽기'; $('fluency-play').disabled = r.done; }
      if (r.done && $('activity-main')) { $('activity-main').disabled = false; $('activity-main').textContent = readingNextLabel(); }
      return true;
    }
    if (task.mode === 'auto' && $('activity-auto-text')) {
      const index = Math.min(task.sentences.length - 1, Math.floor((r?.elapsedMs || 0) / AUTO_MS));
      if (r) r.autoIndex = index;
      $('activity-auto-text').textContent = task.sentences[index];
      $('activity-auto-count').textContent = `${index + 1} / ${task.sentences.length}문장`;
      $('activity-play').textContent = playing ? '일시 정지' : (r?.elapsedMs || 0) ? '자동 읽기 계속' : '자동 읽기 시작';
    }
    if (task.mode === 'speed' && $('activity-speed-time')) $('activity-speed-time').textContent = `${Math.max(0, Math.ceil((SPEED_MS - (r?.elapsedMs || 0)) / 1000))}초 남음`;
    return true;
  }
  function answerLabel(task, answer) {
    if (task.kind === 'cloze') return Array.isArray(answer) ? task.blanks.map((_, index) => `${index + 1}. ${answer[index * 2] || '미응답'}`).join(' · ') : '미응답';
    if (task.kind === 'recall') return Array.isArray(answer) ? `${answer[0]} · 확신도: ${{ sure: '확실', maybe: '아마', unknown: '모름' }[answer[1]] || '미응답'}` : answer;
    if (task.kind === 'selection') {
      let offset = 0;
      return task.groups.map(group => `${group.label}: ${(answer || []).slice(offset, offset += group.capacity).map(id => task.sentences[id] || '미응답').join(' ')}`).join('\n');
    }
    if (task.kind === 'order') return (answer || []).map(id => task.quizType === 'sequence' ? task.paragraphs.find(p => p.id === id)?.text : `${task.paragraphs.findIndex(p => p.id === id) + 1}번 문단`).join(' → ');
    if (task.kind === 'relations') return task.links.map((link, index) => `${link.label}: ${link.options[answer?.[index]] ?? '미응답'}`).join('\n');
    return task.options[answer] ?? '미응답';
  }
  function renderRecall(card, task, entry, submitted) {
    const value = session.answers[entry.key] || ['', ''];
    const label = el('label', '', '기억한 개념'); label.htmlFor = 'reading-recall-answer';
    const input = document.createElement('input'); input.id = label.htmlFor; input.type = 'text'; input.maxLength = 200;
    input.autocomplete = 'off'; input.value = value[0]; input.disabled = !!submitted;
    const confidenceLabel = el('label', '', '이 답이 얼마나 확실한가요?'); confidenceLabel.htmlFor = 'reading-recall-confidence';
    const confidence = document.createElement('select'); confidence.id = confidenceLabel.htmlFor; confidence.disabled = !!submitted;
    Object.entries({ '': '확신도 선택', sure: '확실', maybe: '아마', unknown: '모름' }).forEach(([value, text]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = text; confidence.append(option);
    }); confidence.value = value[1];
    const update = () => { clock(); engine.answer(session, [input.value, confidence.value]); save(); $('activity-main').disabled = !engine.canSubmit(session); };
    input.oninput = update; confidence.onchange = update;
    card.append(el('p', 'muted', '앞서 읽은 개념을 떠올려 답을 쓰고 확신도를 고르세요.'), label, input, confidenceLabel, confidence);
  }
  function renderCloze(card, task, entry, submitted) {
    const value = session.answers[entry.key] || task.blanks.flatMap(() => ['', 'maybe']);
    card.append(el('p', 'muted', '앞서 읽은 글을 기억하며 다섯 빈칸을 채워 보세요.'));
    const passage = el('p', 'fluency-cloze-text');
    task.parts.forEach(part => {
      if (typeof part === 'string') { passage.append(document.createTextNode(part)); return; }
      const field = el('span', 'fluency-cloze-field');
      const input = document.createElement('input'); input.type = 'text'; input.id = 'fluency-cloze-answer-' + part;
      input.setAttribute('aria-label', `빈칸 ${part + 1}`); input.autocomplete = 'off'; input.maxLength = 200;
      input.value = value[part * 2]; input.disabled = !!submitted;
      const confidence = document.createElement('select'); confidence.id = 'fluency-cloze-confidence-' + part;
      confidence.setAttribute('aria-label', `빈칸 ${part + 1} 확신도`); confidence.disabled = !!submitted;
      [['sure', '확실'], ['maybe', '아마'], ['unknown', '모름']].forEach(([id, text]) => {
        const option = document.createElement('option'); option.value = id; option.textContent = text; confidence.append(option);
      }); confidence.value = value[part * 2 + 1];
      const update = () => {
        clock();
        const draft = (session.answers[entry.key] || task.blanks.flatMap(() => ['', 'maybe'])).slice();
        draft[part * 2] = input.value; draft[part * 2 + 1] = confidence.value;
        engine.answer(session, draft); save(); $('activity-main').disabled = !engine.canSubmit(session);
      };
      input.oninput = update; confidence.onchange = update;
      field.append(input, confidence); passage.append(field);
    });
    card.append(passage);
    if (submitted) {
      const blanks = engine.results(session).fluency.quizResults.find(item => item.taskId === task.id).blankResults;
      const list = el('ul', 'fluency-cloze-feedback');
      blanks.forEach((blank, index) => {
        const field = passage.querySelectorAll('.fluency-cloze-field')[index]; field.classList.add(blank.correct ? 'correct' : 'incorrect');
        list.append(el('li', '', `${blank.correct ? '✓ 정답' : '✕ 오답'} · 빈칸 ${index + 1}: ${esc(blank.answer)}${blank.correct ? '' : ` · 정답: ${esc(task.blanks[index].answer)}`} · 확신도: ${{sure:'확실',maybe:'아마',unknown:'모름'}[blank.confidence]}`));
      });
      card.append(el('p', '', `빈칸 ${blanks.length}개 중 ${blanks.filter(blank => blank.correct).length}개 정답`), list);
    }
  }
  function renderSentenceSelection(card, task, entry, submitted) {
    if (task.display === 'key-passage') { renderKeyPassage(card, task, entry, submitted); return; }
    if (task.display === 'sentence-roles') { renderSentenceRoles(card, task, entry, submitted); return; }
    const chosen = session.answers[entry.key] || task.answer.map(() => null);
    const assign = (position, id) => { clock(); const next = chosen.slice(); next[position] = id; engine.answer(session, next); selectedSentence = null; save(); render(false); };
    let offset = 0;
    task.groups.forEach(group => {
      const start = offset; offset += group.capacity;
      const section = el('section', 'reading-sentence-group');
      section.append(el('h3', '', esc(group.label)));
      if (group.hint) section.append(el('p', 'tiny', esc(group.hint)));
      if (task.selectionType === 'key') {
        group.ids.forEach(id => {
          const b = button('reading-key-' + id, task.sentences[id], () => assign(start, id), 'activity-paragraph');
          b.disabled = !!submitted; b.setAttribute('aria-pressed', String(chosen[start] === id));
          if (submitted && group.correct.includes(id)) b.append(el('small', '', '✓ 중심 문장'));
          section.append(b);
        });
      } else {
        const empty = chosen.slice(start, start + group.capacity).indexOf(null);
        const place = button('reading-outline-slot-' + start, `${group.label}에 문장 넣기 (${group.capacity - chosen.slice(start, start + group.capacity).filter(id => id === null).length}/${group.capacity})`, () => assign(start + empty, selectedSentence), 'btn secondary');
        place.disabled = !!submitted || empty < 0 || selectedSentence === null || chosen.includes(selectedSentence); section.append(place);
        chosen.slice(start, start + group.capacity).forEach((id, index) => {
          const row = el('div', 'reading-sentence-item'); row.append(el('p', '', id === null ? '문장을 선택하여 넣으세요.' : esc(task.sentences[id])));
          if (id !== null && !submitted) row.append(button('reading-outline-remove-' + (start + index), '빼기', () => assign(start + index, null), 'text-button'));
          if (submitted && id !== null) row.append(el('small', '', group.correct.includes(id) ? '✓ 제자리' : '✕ 다시 확인'));
          section.append(row);
        });
      }
      card.append(section);
    });
    if (task.selectionType === 'outline') {
      card.append(el('h3', '', '문장 리스트'));
      task.sentences.forEach((sentence, id) => {
        const b = button('reading-outline-sentence-' + id, sentence, () => { selectedSentence = selectedSentence === id ? null : id; render(false); }, 'activity-paragraph');
        b.disabled = !!submitted || chosen.includes(id); b.setAttribute('aria-pressed', String(selectedSentence === id)); card.append(b);
      });
    }
    if (!submitted) card.append(button('reading-selection-reset', '다시 고르기', () => { engine.answer(session, task.answer.map(() => null)); selectedSentence = null; save(); render(false); }, 'text-button'));
  }
  function renderKeyPassage(card, task, entry, submitted, readonly = false) {
    const chosen = session.answers[entry.key] || task.answer.map(() => null);
    const hit = task.groups.filter((group, index) => group.correct.includes(chosen[index])).length;
    const guide = el('p', 'reading-key-guide', submitted ? `핵심 문장 ${hit}/4 정답.` : `핵심 문장 ${chosen.filter(id => id !== null).length}/4개 선택 · 문단마다 한 문장을 터치하세요.`);
    if (submitted) {
      const legend = el('span', 'reading-key-legend');
      [['key-answer', '파랑 = 정답'], ['key-correct', '초록 = 맞게 고름'], ['key-incorrect', '빨강 = 잘못 고름']].forEach(([cls, text]) => legend.append(el('span', cls, text)));
      guide.append(legend);
    }
    card.append(guide);
    const passage = el('article', 'reading-role-passage reading-key-passage');
    passage.setAttribute('aria-label', '핵심 문장을 찾는 전체 지문');
    passage.append(el('h3', '', esc(session.title)));
    task.groups.forEach((group, index) => {
      const paragraph = el('p', 'reading-role-paragraph');
      paragraph.append(el('strong', 'reading-paragraph-label', esc(group.label)));
      group.ids.forEach(id => {
        const selected = chosen[index] === id, correct = group.correct.includes(id);
        const sentence = readonly ? el('span', 'reading-role-sentence', esc(task.sentences[id])) : button('reading-key-' + id, task.sentences[id], () => {
          clock(); const next = chosen.slice(); next[index] = selected ? null : id;
          engine.answer(session, next); save(); render(false);
        }, 'reading-role-sentence');
        if (!readonly) { sentence.disabled = !!submitted; sentence.setAttribute('aria-pressed', String(selected)); }
        if (submitted && (selected || correct)) {
          sentence.classList.add(selected ? correct ? 'key-correct' : 'key-incorrect' : 'key-answer');
          sentence.append(el('span', 'reading-role-badge', selected ? correct ? '✓ 맞게 고름' : '✕ 잘못 고름' : '정답'));
        }
        paragraph.append(sentence, document.createTextNode(' '));
      });
      passage.append(paragraph);
    });
    card.append(passage);
    if (!readonly && !submitted) card.append(button('reading-selection-reset', '다시 고르기', () => {
      engine.answer(session, task.answer.map(() => null)); save(); render(false);
    }, 'text-button'));
  }
  function renderReadingRecord(card, s = session) {
    const entry = s.queue.find(item => item.taskId === 'reading-passage');
    const read = entry && s.read[entry.key];
    if (!read) return;
    const paragraphs = taskFor(s, entry.taskId).paragraphs;
    const trace = read.trace;
    const tracked = trace?.paragraphMs.reduce((sum, value) => sum + value, 0) || 0;
    const coverage = read.elapsedMs > 0 ? Math.min(100, Math.round(tracked / read.elapsedMs * 100)) : 0;
    const characters = paragraphs.reduce((sum, paragraph) => sum + paragraph.s.join('').replace(/\s/g, '').length, 0);
    const speed = !read.skipped && read.elapsedMs >= 1000 ? Math.round(characters / (read.elapsedMs / 60000)) : null;
    const record = el('section', 'reading-record'); record.setAttribute('aria-label', '읽기 기록');
    record.append(el('h3', '', '읽기 기록'));
    if (read.skipped) record.append(el('p', 'tiny', '읽기 건너뜀 · 건너뛰기 전까지의 기록이에요.'));
    const metrics = el('dl', 'reading-record-metrics');
    [['읽은 시간', formatTime(read.elapsedMs)], ['읽기 속도', speed === null ? '측정 부족' : `${speed.toLocaleString()} 글자/분`], ['역행', trace ? `${trace.regressions}회` : '기록 없음'], ['체류 포착률', trace ? `${coverage}%` : '기록 없음']].forEach(([label, value]) => {
      const item = el('div'); item.append(el('dt', '', label), el('dd', '', value)); metrics.append(item);
    });
    record.append(metrics);
    const dwell = el('dl', 'reading-record-dwell');
    paragraphs.forEach((paragraph, index) => {
      const item = el('div'); item.append(el('dt', '', esc(paragraph.role || `문단 ${index + 1}`)), el('dd', '', trace ? `${(trace.paragraphMs[index] / 1000).toFixed(1)}초` : '기록 없음')); dwell.append(item);
    });
    record.append(dwell, el('p', 'tiny', '역행·체류는 포인터·터치 기준의 데모 대체 지표이며, 실제 시선 추적 결과가 아니에요.'));
    if (trace && tracked > 0 && coverage >= 30 && !read.skipped) {
      const rates = trace.paragraphMs.map((time, index) => time / Math.max(1, paragraphs[index].s.join('').replace(/\s/g, '').length));
      const slowest = rates.indexOf(Math.max(...rates));
      record.append(el('p', 'tiny', `글자 수 대비 가장 오래 머문 문단: ${esc(paragraphs[slowest].role)} · 병목 후보예요. 포인터 기록만으로 읽기 능력을 판단하지 않아요.`));
    } else record.append(el('p', 'tiny', '체류 기록이 부족해 병목 문단을 판단하지 않아요.'));
    card.append(record);
  }
  function renderSentenceRoles(card, task, entry, submitted) {
    card.classList.add('reading-role-activity');
    const chosen = session.answers[entry.key] || task.answer.map(() => null);
    const groups = task.groups.map((group, index) => ({ ...group, index,
      start: task.groups.slice(0, index).reduce((total, item) => total + item.capacity, 0) }));
    const saveChoices = next => { clock(); if (engine.answer(session, next)) { selectedSentence = null; save(); render(false); } };
    const remove = position => { const next = chosen.slice(); next[position] = null; saveChoices(next); };
    const roleFor = id => groups.find(group => chosen.slice(group.start, group.start + group.capacity).includes(id));
    const picker = el('section', 'reading-role-picker'); picker.setAttribute('aria-label', '문장 분류');
    picker.append(el('p', 'reading-role-instruction', selectedSentence === null ? '문장을 터치한 뒤 넣을 곳을 선택하세요.' : esc(task.sentences[selectedSentence])));
    const actions = el('div', 'reading-role-actions');
    groups.forEach(group => {
      const currentPosition = chosen.indexOf(selectedSentence);
      const currentInGroup = currentPosition >= group.start && currentPosition < group.start + group.capacity;
      const empty = chosen.slice(group.start, group.start + group.capacity).indexOf(null);
      const count = group.capacity - chosen.slice(group.start, group.start + group.capacity).filter(id => id === null).length;
      const classify = button('reading-role-' + group.index, `${group.label} (${count}/${group.capacity})`, () => {
        const next = chosen.slice();
        if (currentPosition >= 0) next[currentPosition] = null;
        const target = currentInGroup ? currentPosition : group.start + empty;
        next[target] = selectedSentence; saveChoices(next);
      }, 'reading-role-button role-' + group.index);
      classify.disabled = !!submitted || selectedSentence === null || (empty < 0 && !currentInGroup);
      actions.append(classify);
    });
    if (selectedSentence !== null && chosen.includes(selectedSentence) && !submitted) actions.append(button('reading-role-clear', '분류 해제', () => remove(chosen.indexOf(selectedSentence)), 'text-button'));
    picker.append(actions); card.append(picker);
    const passage = el('article', 'reading-role-passage'); passage.setAttribute('aria-label', '문장을 터치하여 분류하는 전체 지문');
    passage.append(el('h3', '', esc(session.title)));
    let sentenceId = 0;
    task.paragraphs.forEach(paragraph => {
      const text = el('p', 'reading-role-paragraph');
      paragraph.s.forEach(() => {
        const id = sentenceId++, role = roleFor(id);
        const sentence = button('reading-role-sentence-' + id, task.sentences[id], () => {
          selectedSentence = selectedSentence === id ? null : id; render(false);
        }, 'reading-role-sentence' + (role ? ' role-' + role.index : ''));
        sentence.disabled = !!submitted; sentence.setAttribute('aria-pressed', String(selectedSentence === id));
        if (role) sentence.append(el('span', 'reading-role-badge', role.label));
        if (submitted && role) sentence.append(el('span', 'reading-role-badge', role.correct.includes(id) ? '✓' : '✕'));
        text.append(sentence, document.createTextNode(' '));
      }); passage.append(text);
    }); card.append(passage);
    const placements = el('div', 'reading-role-groups'); placements.setAttribute('aria-label', '처음·중간·끝에 분류한 문장');
    groups.forEach(group => {
      const section = el('section', 'reading-role-group role-' + group.index);
      const count = chosen.slice(group.start, group.start + group.capacity).filter(id => id !== null).length;
      section.append(el('h3', '', `${group.label} <span class="tiny">${count}/${group.capacity}</span>`));
      if (group.hint) section.append(el('p', 'tiny', esc(group.hint)));
      chosen.slice(group.start, group.start + group.capacity).forEach((id, index) => {
        if (id === null) { section.append(el('p', 'reading-role-empty', '지문에서 문장을 선택하세요.')); return; }
        const row = el('div', 'reading-role-item'); row.append(el('p', '', esc(task.sentences[id])));
        if (submitted) row.append(el('small', '', group.correct.includes(id) ? '✓ 제자리' : '✕ 다시 확인'));
        else row.append(button('reading-role-remove-' + (group.start + index), group.label + '에서 빼기', () => remove(group.start + index), 'text-button'));
        section.append(row);
      }); placements.append(section);
    }); card.append(placements);
    if (!submitted) card.append(button('reading-selection-reset', '다시 고르기', () => saveChoices(task.answer.map(() => null)), 'text-button'));
  }
  function renderSummary(task, entry) {
    const submitted = session.submitted[entry.key];
    const card = el('section', 'card activity-question reading-summary');
    card.append(el('h2', '', esc(task.question)), el('p', 'muted', '처음·중간·끝의 중요한 내용을 연결하여 자기 글로 간추려 보세요.'));
    task.groups.forEach(group => card.append(el('h3', '', esc(group.label)), el('p', '', esc(group.text))));
    const label = el('label', '', '간추린 내용'); label.htmlFor = 'reading-summary-answer';
    const input = document.createElement('textarea'); input.id = label.htmlFor; input.rows = 7; input.maxLength = 10000;
    input.value = session.answers[entry.key] || ''; input.disabled = !!submitted;
    const meter = el('p', 'tiny'); meter.id = 'reading-summary-count';
    const updateMeter = () => { meter.textContent = `공백 제외 ${input.value.replace(/\s/g, '').length}자 · 40자 이상 · 가이드 150자`; };
    updateMeter(); input.oninput = () => { clock(); engine.answer(session, input.value); save(); updateMeter(); $('activity-main').disabled = !engine.canSubmit(session); };
    card.append(label, input, meter);
    const feedback = el('div', 'activity-feedback'); feedback.id = 'activity-feedback'; feedback.tabIndex = -1; feedback.setAttribute('role', 'status');
    if (submitted) appendWritingFeedback(feedback, task, submitted.answer);
    card.append(feedback); renderReadingReference(card);
  }
  function appendWritingFeedback(root, task, text) {
    const feedback = TrainingFeedback.generateWritingFeedback({ text, keywords: task.keywords });
    root.append(el('h3', '', '간추려 쓰기 · 규칙 기반 피드백'), el('p', '', `핵심 낱말 포함율 ${feedback.local.kw}% · 공백 제외 ${feedback.local.len}자 · ${feedback.local.sents}문장`), el('p', 'tiny', esc(feedback.note)), el('p', 'tiny', '작성한 내용은 저장하며 정답률에 포함하지 않아요.'));
  }
  function renderRelations(card, task, selected, submitted) {
    const choices = selected || task.links.map(() => null);
    if (!Number.isInteger(structureTarget) || structureTarget >= task.links.length) structureTarget = choices.findIndex(value => value === null);
    if (structureTarget < 0) structureTarget = 0;
    card.append(el('p', 'muted', '배치할 칸을 누른 뒤 문단 리스트에서 문단을 선택해 주세요. 연결선을 따라 문단의 관계를 살펴보세요.'));
    const map = el('div', 'reading-structure-map'); map.setAttribute('aria-label', '문단 관계 연결도');
    const slot = index => {
      const link = task.links[index], value = choices[index];
      const b = button('activity-structure-slot-' + index, '', () => { structureTarget = index; render(false); }, 'reading-structure-slot');
      b.disabled = !!submitted; b.setAttribute('aria-pressed', String(!submitted && structureTarget === index));
      b.setAttribute('aria-label', `${link.label} 칸: ${value === null ? '탭하여 선택' : link.options[value]}`);
      b.append(el('small', '', esc(link.label)), el('span', '', esc(value === null ? '탭하여 선택' : link.options[value])));
      if (submitted) b.append(el('small', '', value === task.answer[index] ? '✓ 정답' : '✕ 다시 확인'));
      return b;
    };
    map.append(slot(0));
    const branch = el('div', 'reading-map-lines split'); branch.setAttribute('aria-hidden', 'true'); map.append(branch);
    map.append(el('p', 'reading-map-relation', '질문에 대한 두 가지 답'));
    const pair = el('div', 'reading-map-pair'); pair.append(slot(1), slot(2)); map.append(pair);
    const merge = el('div', 'reading-map-lines merge'); merge.setAttribute('aria-hidden', 'true'); map.append(merge);
    map.append(el('p', 'reading-map-relation', '두 방법의 공통 과정과 쓰임 정리'), slot(3)); card.append(map);
    card.append(el('h3', '', '문단 리스트'));
    const list = el('div', 'reading-map-list');
    task.choiceOrder.forEach(value => {
      const b = button('activity-structure-choice-' + value, task.links[0].options[value], () => {
        clock(); const answer = choices.slice(); answer[structureTarget] = value;
        engine.answer(session, answer); structureTarget = answer.findIndex(item => item === null); save(); render(false);
      }, 'activity-paragraph');
      b.disabled = !!submitted || choices.includes(value); list.append(b);
    }); card.append(list);
    if (!submitted) card.append(button('activity-structure-reset', '구조 다시 고르기', () => { engine.answer(session, task.links.map(() => null)); structureTarget = 0; save(); render(false); }, 'text-button'));
    const source = el('details', 'reading-map-source'); source.append(el('summary', '', '지문 다시 보기'));
    task.paragraphs.forEach(p => source.append(el('p', '', esc(p.text)))); card.append(source);
  }
  function renderReadingReference(card) {
    const layout = el('div', 'reading-question-layout');
    if (!readingReference || readingReference.sessionId !== session.id) {
      const reference = el('details', 'card reading-reference'); reference.id = 'reading-reference'; reference.open = true;
      const toggle = el('summary', '', '지문 보기 · 펼치기/접기');
      toggle.onclick = event => { if (window.innerWidth >= 768) event.preventDefault(); };
      reference.append(toggle);
      const passage = el('section', 'reading-reference-text'); passage.setAttribute('aria-label', '독해 문제 지문');
      passage.tabIndex = 0;
      const keyEntry = session.queue.find(item => item.taskId === 'reading-key');
      const keyTask = keyEntry && taskFor(session, keyEntry.taskId);
      if (keyTask?.display === 'key-passage' && session.submitted[keyEntry.key]) {
        renderKeyPassage(passage, keyTask, keyEntry, session.submitted[keyEntry.key], true);
      } else {
        passage.append(el('h2', '', esc(baseCatalog.reading.tasks[0].title)));
        PKG.paragraphs.forEach((paragraph, index) => {
          const p = el('p', '', `<strong class="tiny">문단 ${index + 1} · ${esc(paragraph.role)}</strong><br>${esc(paragraph.s.join(' '))}`); passage.append(p);
        });
      }
      renderReadingRecord(passage); reference.append(passage);
      readingReference = { sessionId: session.id, element: reference }; readingReferenceScroll = 0;
    }
    const reference = readingReference.element;
    if (window.innerWidth >= 768) reference.open = true;
    const question = el('div', 'reading-question-column'); question.append(card);
    layout.append(reference, question); panel.append(layout);
    reference.querySelector('.reading-reference-text').scrollTop = readingReferenceScroll;
  }
  function renderQuestion(task, entry) {
    const selected = session.answers[entry.key], submitted = session.submitted[entry.key];
    const card = el('section', 'card activity-question'); card.setAttribute('aria-labelledby', 'activity-question-title');
    if (task.comprehensionType) card.append(el('p', 'reading-question-type ' + task.comprehensionType, `[${esc(task.typeLabel)}]`));
    card.append(el('h2', '', `<span id="activity-question-title">${esc(task.question)}</span>`));
    if (task.diagnostic) {
      const diagnostic = ReadingDiagnostic.results(catalog[session.area], session);
      if (diagnostic?.readingMs !== null) {
        const record = el('p', 'muted', diagnostic.skipped ? '지문 읽기를 건너뛰었어요. 핵심 문장을 골라 내용을 확인해 보세요.' : `읽은 시간 ${formatTime(diagnostic.readingMs)} · 각 문단의 핵심 문장을 확인해요.`);
        record.id = 'reading-diagnostic-record'; card.append(record);
      }
    }
    if (currentArea(session) === 'vocabulary') card.append(el('p', 'tiny', esc(catalog[session.area].note || catalog.vocabulary.note)));
    if (task.contentNote) card.append(el('p', 'tiny fixture-note', esc(task.contentNote)));
    if (task.kind === 'order') {
      const unit = task.quizType === 'sequence' ? '조각' : '문단';
      card.append(el('p', 'muted', `먼저 나오는 ${unit}부터 눌러 주세요.`));
      const chosen = selected || [];
      const order = el('div', 'activity-order-summary'); order.setAttribute('aria-live', 'polite');
      order.textContent = chosen.length ? `선택한 순서: ${answerLabel(task, chosen)}` : `아직 선택한 ${unit}이 없어요.`; card.append(order);
      if (currentArea(session) === 'reading') {
        const slots = el('ol', 'reading-order-slots'); slots.setAttribute('aria-label', '선택한 순서로 배치한 문단');
        task.answer.forEach((_, index) => {
          const paragraph = task.paragraphs.find(p => p.id === chosen[index]);
          slots.append(el('li', '', `<strong>문단 ${index + 1}</strong><span>${paragraph ? esc(paragraph.summary || paragraph.text) : '탭하여 선택'}</span>`));
        }); card.append(slots);
      }
      if (currentArea(session) === 'reading' && chosen.length && !task.paragraphs.some(p => p.summary)) {
        const arranged = el('ol', 'reading-selected-paragraphs'); arranged.setAttribute('aria-label', '선택한 순서로 배치한 문단');
        chosen.forEach(id => { const paragraph = task.paragraphs.find(p => p.id === id); arranged.append(el('li', '', esc(paragraph.text))); }); card.append(arranged);
      }
      if (currentArea(session) === 'reading') card.append(el('h3', '', '문단 리스트'));
      task.paragraphs.forEach((paragraph, index) => {
        const b = button(`activity-paragraph-${paragraph.id}`, '', () => { clock(); engine.answer(session, [...chosen, paragraph.id]); save(); render(false); }, 'activity-paragraph');
        b.dataset.paragraph = paragraph.id; b.disabled = !!submitted || chosen.includes(paragraph.id);
        b.innerHTML = `<strong>${index + 1}번 ${unit}${chosen.includes(paragraph.id) ? ` · ${chosen.indexOf(paragraph.id) + 1}번째로 선택` : ''}</strong><span>${esc(paragraph.summary || paragraph.text)}</span>`; card.append(b);
      });
      if (!submitted) card.append(button('activity-order-reset', '순서 다시 고르기', () => { engine.answer(session, []); save(); render(false); }, 'text-button'));
      if (task.paragraphs.some(p => p.summary)) {
        const source = el('details', 'reading-map-source'); source.append(el('summary', '', '문단 원문 다시 보기'));
        task.paragraphs.forEach(p => source.append(el('p', '', esc(p.text)))); card.append(source);
      }
    } else if (task.kind === 'relations') {
      renderRelations(card, task, selected, submitted);
    } else if (task.kind === 'recall') {
      renderRecall(card, task, entry, submitted);
    } else if (task.kind === 'cloze') {
      renderCloze(card, task, entry, submitted);
    } else if (task.kind === 'selection') {
      renderSentenceSelection(card, task, entry, submitted);
      if (task.diagnostic) renderReadingRecord(card);
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
      if (!submitted.correct && currentArea(session) === 'vocabulary' && session.retryPolicy !== 'none') feedback.append(el('p', '', '다음 두 문항 안에 이 문제를 다시 풀어요.'));
      feedback.append(el('p', task.comprehensionType ? 'reading-question-evidence' : '', task.comprehensionType
        ? `근거: 문장 ${task.evidenceSentences.join(', ')} — “${esc(task.source)}”`
        : esc(task.explanation || task.meaning || task.source)));
      if (task.kind === 'recall') {
        const confidence = selected[1];
        feedback.append(el('p', '', confidence === 'maybe' ? '확신도: 아마 · 점검 일치율 비교에서는 제외해요.' : confidence === 'sure' && !submitted.correct ? '확신도: 확실 → 오답 · 다시 확인해 보세요.' : confidence === 'unknown' && submitted.correct ? '확신도: 모름 → 정답 · 알고 있던 개념이에요.' : '확신도 판단과 실제 답이 일치해요.'));
      }
      if (task.kind === 'selection') {
        let offset = 0;
        const hit = task.groups.reduce((n, group) => n + selected.slice(offset, offset += group.capacity).filter(id => group.correct.includes(id)).length, 0);
        feedback.append(el('p', '', task.diagnostic ? `핵심 문장 ${hit}/${task.answer.length}개 정답` : `${hit}/${task.answer.length}개 문장이 제자리예요. 정답률에는 전체 배치를 한 활동으로 반영해요.`));
      }
      if (task.answerForm) feedback.append(el('p', 'tiny', `글에서는 ‘${esc(task.answerForm)}’로 쓰였어요.`));
    }
    card.append(feedback);
    if (currentArea(session) === 'reading' && task.kind === 'choice' && task.id.startsWith('reading-content-')) renderReadingReference(card);
    else panel.append(card);
  }
  function showReport(s) {
    pause(); TrainingUI.showActivity(areaOf(s), true); panel.replaceChildren();
    document.title = `${catalog[s.area].label}${s.reviewOf ? ' 오답 복습' : ''} 결과 · 읽는 힘`;
    const r = results(s), hero = el('section', 'card activity-result'); hero.id = 'activity-result';
    const scoreText = ['concept-v1', 'concept-v2'].includes(catalog[s.area].fluencyVersion) ? `첫 풀이 ${r.totalQuestions}개 채점 항목 중 ${r.correct}개 정답 · 오답 ${r.wrong}개` : ['readin-v2', 'readin-v3'].includes(catalog[s.area].readingVersion) ? `첫 풀이 ${r.totalQuestions}개 채점 활동 중 ${r.correct}개 정답 · 오답 ${r.wrong}개` : `첫 풀이 ${r.totalQuestions}문항 중 ${r.correct}문항 정답 · 오답 ${r.wrong}문항`;
    hero.append(el('p', 'home-eyebrow', `${esc(catalog[s.area].label)}${s.reviewOf ? ' · 오답 복습' : ''} 완료`), el('h1', '', esc(s.title)), el('strong', 'activity-score', `${r.accuracy}%`), el('p', 'muted', scoreText), el('p', 'muted', `학습 시간 ${formatTime(s.elapsedMs)}`));
    if (r.reviewAttempts) hero.append(el('p', 'muted', `추가 오답 복습 ${r.reviewAttempts}회 중 ${r.reviewCorrect}회 정답`));
    const reads = s.queue.filter(q => taskFor(s, q.taskId)?.kind === 'read');
    if (reads.length) {
      const list = el('div', 'activity-read-results');
      reads.forEach(q => { const task = taskFor(s, q.taskId); list.append(el('p', 'tiny', `${esc(task.label)}${s.read[q.key]?.skipped ? ' · 건너뜀' : ''} · ${formatTime(s.read[q.key]?.elapsedMs || 0)}`)); });
      hero.append(list);
    }
    panel.append(hero);
    if (r.comprehension) {
      const detail = el('section', 'card reading-comprehension-results'); detail.id = 'reading-comprehension-result';
      detail.append(el('h2', '', '이해도 확인' + (s.reviewOf ? ' · 오답 복습' : '')));
      const table = el('table', ''); table.setAttribute('aria-label', '이해도 확인 유형별 결과');
      const body = el('tbody', '');
      [['전체', r.comprehension], ['사실적 이해', r.comprehension.fact], ['추론적 이해', r.comprehension.inference]].forEach(([label, counts]) => {
        body.append(el('tr', '', `<th scope="row">${label}</th><td>${counts.correct} / ${counts.total}</td>`));
      }); table.append(body); detail.append(table); panel.append(detail);
    }
    if (r.areas) {
      const comparison = el('section', 'course-results'); comparison.setAttribute('aria-label', '영역별 결과 비교');
      Object.entries(r.areas).forEach(([area, value]) => {
        const card = el('div', 'card report-stat'); card.dataset.area = area;
        card.innerHTML = `<h2>${areaLabels[area]}</h2><strong>${value.accuracy}<small>%</small></strong><p>${value.correct} / ${value.total}문항 · ${formatTime(value.elapsedMs)}</p>`; comparison.append(card);
      }); panel.append(comparison);
      if (r.fluency) {
        const f = r.fluency, detail = el('section', 'card fluency-metrics'); detail.id = 'fluency-result';
        const skippedStages = f.stages.filter(stage => stage.skipped).length;
        const readingStatus = ['concept-v1', 'concept-v2'].includes(catalog[s.area].fluencyVersion) ? `읽기 ${f.completedStages.length} / ${f.stages.length}단계 완료${skippedStages ? ` · 건너뜀 ${skippedStages}단계` : ''}` : `완료 Stage ${f.completedStages.length} / ${f.stages.length}${skippedStages ? ` · 건너뛴 Stage ${skippedStages}` : ''}`;
        detail.innerHTML = `<h2>읽기 유창성 결과</h2><p>${f.accuracy}% · ${formatTime(f.elapsedMs)} · ${s.reviewOf && !f.stages.length ? '오답만 복습' : readingStatus}</p>`;
        if (s.reviewOf && !f.stages.length) detail.append(el('p', 'tiny', '오답 문항만 복습한 회차예요. 읽기 Stage는 다시 수행하지 않았어요.'));
        f.stages.forEach(stage => detail.append(el('p', '', `Stage ${stage.stage} · ${stage.skipped ? '건너뜀' : stage.complete ? '완료' : '미수행'} · ${formatTime(stage.elapsedMs)}${stage.wordsPerMinute !== null ? ` · 분당 ${stage.wordsPerMinute}어절` : ''}${stage.displayInterval ? ` · 표시 간격 ${stage.displayInterval / 1000}초` : ''}`)));
        detail.append(el('p', 'tiny', '읽기 속도는 화면 표시·탭 시간을 기준으로 계산해요. 실제 이해 능력이나 읽기 수준을 평가한 수치는 아니에요.'));
        const wrong = f.quizResults.filter(q => q.correct === false);
        const wrongCount = wrong.reduce((n, q) => n + (q.blankResults ? q.blankResults.filter(blank => !blank.correct).length : 1), 0);
        detail.append(el('p', '', `오답 ${wrongCount}${['concept-v1', 'concept-v2'].includes(catalog[s.area].fluencyVersion) ? '개' : '문항'} · ${wrong.length ? wrong.map(q => { const task = taskFor(s, q.taskId); return ['concept-v1', 'concept-v2'].includes(catalog[s.area].fluencyVersion) ? task.phase : task.label; }).join(', ') : '모두 맞혔어요.'}`));
        const blanks = f.quizResults.flatMap(q => q.blankResults || []);
        if (blanks.length) {
          const compared = blanks.filter(blank => blank.confidence !== 'maybe');
          const illusion = blanks.filter(blank => blank.confidence === 'sure' && !blank.correct).length;
          const under = blanks.filter(blank => blank.confidence === 'unknown' && blank.correct).length;
          detail.append(el('p', '', `확신도 점검 ${compared.length ? Math.round((compared.length - illusion - under) / compared.length * 100) + '%' : '비교 응답 없음'} · 착각 ${illusion} · 과소평가 ${under}`));
        }
        panel.append(detail);
      }
    }
    if (r.vocabulary) {
      const v = r.vocabulary, detail = el('section', 'card vocabulary-results'); detail.id = 'vocabulary-result';
      detail.append(el('h2', '', '어휘력 결과'), el('p', '', `첫 풀이 ${v.correct} / ${v.total}문항 · ${v.accuracy}% · 수행시간 ${formatTime(v.elapsedMs)}`));
      v.questions.forEach(item => {
        const task = taskFor(s, item.taskId);
        detail.append(el('p', 'tiny', `${item.correct ? '✓ 정답' : '✕ 오답'} · ${esc(task.label)} · ${esc(item.word)} · 응답 ${formatTime(item.responseMs)}`));
      });
      v.practice.forEach(item => {
        const task = taskFor(s, item.taskId);
        detail.append(el('h3', '', '낱말로 문장 만들기 · 점수 없는 연습'));
        item.answers.forEach((answer, index) => detail.append(el('p', 'vocabulary-saved-sentence', `<strong>${esc(task.prompts[index].word)}</strong> ${esc(answer)}`)));
        detail.append(el('p', 'tiny', '작성한 내용은 연습 기록으로 저장하며 정답률에 합산하지 않아요.'));
      });
      panel.append(detail);
    }
    if (r.diagnostic) {
      const detail = el('section', 'card'); detail.id = 'reading-diagnostic-result';
      detail.append(el('h2', '', '정밀검사 결과'), el('p', '', `핵심 문장 ${r.diagnostic.correct}/${r.diagnostic.total}개 정답`));
      if (r.diagnostic.readingMs !== null) detail.append(el('p', 'muted', `읽은 시간 ${formatTime(r.diagnostic.readingMs)}${r.diagnostic.skipped ? ' · 읽기 건너뜀' : ''}`));
      renderReadingRecord(detail, s);
      panel.append(detail);
    }
    const readingExtras = s.queue.filter(q => ['recall', 'selection', 'summary'].includes(taskFor(s, q.taskId)?.kind));
    if (readingExtras.length) {
      const detail = el('section', 'card reading-detail-results'); detail.id = 'reading-detail-result'; detail.append(el('h2', '', '내용 간추리기 결과'));
      const recalls = readingExtras.filter(q => taskFor(s, q.taskId).kind === 'recall');
      if (recalls.length) {
        const compared = recalls.filter(q => s.answers[q.key][1] !== 'maybe');
        const illusion = recalls.filter(q => s.answers[q.key][1] === 'sure' && !s.submitted[q.key].correct).length;
        const under = recalls.filter(q => s.answers[q.key][1] === 'unknown' && s.submitted[q.key].correct).length;
        detail.append(el('p', '', `개념 인출 ${recalls.filter(q => s.submitted[q.key].correct).length}/${recalls.length} · 확신도 점검 ${compared.length ? Math.round((compared.length - illusion - under) / compared.length * 100) + '%' : '비교 응답 없음'} · 착각 ${illusion} · 과소평가 ${under}`), el('p', 'tiny', '확실·모름 응답을 실제 정답과 비교해요. 아마 응답은 비교에서 제외해요.'));
      }
      readingExtras.forEach(q => {
        const task = taskFor(s, q.taskId), answer = s.submitted[q.key].answer;
        if (task.kind === 'summary') {
          detail.append(el('h3', '', '내가 간추린 내용'), el('p', 'reading-saved-summary', esc(answer))); appendWritingFeedback(detail, task, answer);
        } else if (task.kind === 'selection') {
          let offset = 0;
          const hit = task.groups.reduce((n, group) => n + answer.slice(offset, offset += group.capacity).filter(id => group.correct.includes(id)).length, 0);
          detail.append(el('p', '', `${esc(task.label)} ${hit}/${task.answer.length} · 전체 배치를 한 활동으로 채점해요.`));
        }
      }); panel.append(detail);
    }
    const review = el('section', 'card'); review.id = 'activity-review'; review.append(el('h2', '', '풀이 확인'));
    s.queue.filter(q => !q.retryOf && !['read', 'practice', 'summary'].includes(taskFor(s, q.taskId)?.kind)).forEach(q => {
      const task = taskFor(s, q.taskId), a = s.submitted[q.key];
      const details = el('details', 'activity-review-item');
      details.append(el('summary', '', `${a?.correct ? '✓ 정답' : '✕ 오답'} · ${task.kind === 'cloze' ? esc(task.phase) + ' · ' : ''}${esc(task.question)}`), el('p', '', `내 답: ${esc(answerLabel(task, a?.answer))}`), el('p', '', `정답: ${esc(answerLabel(task, task.answer))}`), el('p', 'muted', esc(task.source))); review.append(details);
    });
    panel.append(review);
    const actions = el('div', 'activity-actions');
    const reviewArea = ReadingFlow.currentArea(s.area, catalog);
    const availableIds = new Set(catalog[reviewArea].tasks.map(task => task.id));
    const wrongIds = s.queue.filter(q => !q.retryOf && s.submitted[q.key]?.correct === false && availableIds.has(q.taskId)).map(q => q.taskId);
    if (wrongIds.length) actions.append(button('activity-retry-wrong', '틀린 문제 다시 풀기', () => start(reviewArea, { reviewOf: s.id, taskIds: wrongIds })));
    if (r.areas && !s.reviewOf) {
      const weakest = Object.entries(r.areas).filter(([, value]) => value.accuracy < 80).sort((a, b) => a[1].accuracy - b[1].accuracy)[0];
      if (weakest) actions.append(button('activity-recommendation', `${areaLabels[weakest[0]]} 더 연습하기`, () => start(latestAreas[weakest[0]] || weakest[0]), 'btn secondary'));
    }
    actions.append(button('activity-retry-area', catalog[s.area].integrated ? '전체 과정 다시 학습' : '이 영역 다시 학습', () => start(catalog[s.area].integrated ? latestAreas.course : latestAreas[areaOf(s)] || s.area, { restart: true }), 'btn secondary'), button('activity-home', '홈으로', home, 'btn secondary'), button('activity-history', '전체 기록', history, 'text-button'));
    panel.append(actions); window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function decorateResume() {
    if (!active()) return;
    const p = engine.progress(session), task = engine.current(session).task;
    $('home-resume-title').textContent = session.title;
    $('home-resume-description').textContent = `${catalog[session.area].label}${catalog[session.area].legacyFlow ? ' · 이전 방식' : catalog[session.area].legacyTiming ? ' · 이전 속도' : catalog[session.area].legacyContent ? ' · 이전 문항 구성' : ''} · ${task.phase} · ${p.percent}% 완료 · ${formatTime(session.elapsedMs)}`;
    $('home-resume-progress').value = p.percent;
  }
  window.AreaTraining = { start, resume, pause, showReport, records, results, decorateResume, hasActive: active, getSession: () => session,
    currentArea: () => session ? currentArea(session) : null,
    getCurrent: () => engine.current(session),
    isCurrentCourse: () => session?.area === latestAreas.course,
    isCourse: () => !!session && !!catalog[session.area].integrated && !session.reviewOf,
    hasPreviousFlow: () => !!session && !!((catalog[session.area].trainingArea === 'reading' && session.area !== latestAreas.reading) || catalog[session.area].legacyFlow || catalog[session.area].legacyTiming || catalog[session.area].legacyContent || (window.FluencyConceptContent && (catalog[session.area].fluencyVersion === 'concept-v1' || session.area === fluencyAreas.fluency || session.area === readingAreas.course))),
    label: s => catalog[s.area].label,
    areaOf,
    completedAreas: s => s.reviewOf ? [] : catalog[s.area].integrated ? ['vocabulary', 'fluency', 'reading'] : [areaOf(s)],
    startFluency: () => start(latestAreas.fluency),
    startVocabulary: () => start(latestAreas.vocabulary),
    startReading: () => start(latestAreas.reading || 'reading'),
    startCourse: () => start(latestAreas.course) };
  document.addEventListener('visibilitychange', () => { pause(); last = performance.now(); });
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 768 && panel.contains(readingReference?.element)) readingReference.element.open = true;
  });
  window.addEventListener('pagehide', () => { clock(); save(); });
  window.addEventListener('beforeunload', () => { clock(); save(); });
  setInterval(() => {
    const advanced = clock();
    if (!visible()) return;
    const { task, entry } = engine.current(session), read = session.read[entry.key];
    if (task.stage && task.mode !== 'tap' && read?.started && playing && read.position === task.units.length) {
      engine.finishRead(session); playing = false; save();
      // Every automatic round leads to its own quiz; older sessions retain their saved flow.
      if (task.stage === 3 || !catalog[session.area].legacyFlow) { advance(); return; }
      updateRead(); progressHeader(); return;
    }
    if (task.kind === 'read' && ((task.mode === 'speed' && read?.elapsedMs >= SPEED_MS) || (task.mode === 'auto' && playing && read?.elapsedMs >= task.sentences.length * AUTO_MS))) { finishRead(); return; }
    if (!advanced) return;
    const displayChanged = updateRead(), now = performance.now();
    if (displayChanged || now - lastProgress >= 1000) progressHeader();
    if (now - lastSaved >= 1000) save();
  }, 100);
  if (loadedActivity.warning) showWarning(loadedActivity.warning);
  if (session?.status === 'completed' || session !== loadedActivity.session) save();
  TrainingUI.showHome(false);
})();
