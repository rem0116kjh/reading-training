/*
 * Independent, data-driven practice sessions. Existing trainingSession/history
 * keys and the original full-course engine are intentionally left untouched.
 *
 * const engine = ActivityEngine.create(ActivityContent.createCatalog(PKG));
 * All action methods mutate the supplied session. answer/finishRead/skipRead/next/
 * previous return whether the action was accepted. submit returns
 * {ok, correct, warning?}; it grades only, and next performs navigation.
 * finishRead marks a passage as read; skipRead records an explicit skip.
 * next moves to the following activity in either case.
 * Submitted answers are immutable, including when revisiting a prior item.
 * normalize returns a clean validated copy or null, never repaired completion.
 * Storage methods report warnings instead of throwing or clearing stored data.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ActivityEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SESSION_KEY = 'areaTrainingSession.v1';
  const HISTORY_KEY = 'areaTrainingHistory.v1';
  const MAX_ENTRIES = 2048;
  const MAX_HISTORY = 200;
  const MAX_DURATION = 366 * 24 * 60 * 60 * 1000;
  const OWN = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const duration = value => Number.isFinite(value) && value >= 0 && value <= MAX_DURATION;
  const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 160 && value !== '__proto__' && value !== 'constructor' && value !== 'prototype';
  const cloneAnswer = value => Array.isArray(value) ? value.slice() : value;
  const equal = (a, b) => Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;
  const warning = '저장된 학습 정보를 확인할 수 없어요. 기존 데이터는 삭제하지 않았어요.';

  function create(catalog) {
    if (!object(catalog)) throw new TypeError('활동 목록이 필요합니다.');
    const areas = Object.create(null);
    for (const [area, definition] of Object.entries(catalog)) {
      if (!identity(area) || !object(definition) || !Array.isArray(definition.tasks) || !definition.tasks.length) throw new TypeError('영역별 활동 목록이 올바르지 않습니다.');
      const tasks = new Map();
      for (const task of definition.tasks) {
        if (!object(task) || !identity(task.id) || tasks.has(task.id) || !['read', 'choice', 'order', 'practice', 'relations', 'recall', 'cloze', 'selection', 'summary'].includes(task.kind)) throw new TypeError('활동 ID와 유형을 확인해주세요.');
        if (task.kind === 'practice' && (!Array.isArray(task.prompts) || !task.prompts.length || task.prompts.some(prompt => typeof prompt.word !== 'string' || !prompt.word.trim()))) throw new TypeError('어휘 적용 연습의 낱말을 확인해주세요.');
        if (task.kind === 'choice' && (!Array.isArray(task.options || task.choices) || !Number.isInteger(task.answer) || task.answer < 0 || task.answer >= (task.options || task.choices).length)) throw new TypeError('선택형 활동의 정답을 확인해주세요.');
        if (task.kind === 'order' && (!Array.isArray(task.answer) || task.answer.length < 2 || new Set(task.answer).size !== task.answer.length || task.answer.some(x => !Number.isInteger(x) && !identity(x)))) throw new TypeError('순서형 활동의 정답을 확인해주세요.');
        if (task.kind === 'relations' && (!Array.isArray(task.links) || !task.links.length || !Array.isArray(task.answer) || task.answer.length !== task.links.length || task.links.some((link, index) => !object(link) || typeof link.label !== 'string' || !Array.isArray(link.options) || link.options.length < 2 || link.options.some(option => typeof option !== 'string' || !option.trim()) || !Number.isInteger(task.answer[index]) || task.answer[index] < 0 || task.answer[index] >= link.options.length))) throw new TypeError('문단 연결 활동의 관계와 정답을 확인해주세요.');
        if (task.kind === 'recall' && (typeof task.answer !== 'string' || !task.answer.trim() || !Array.isArray(task.accepted) || task.accepted.some(text => typeof text !== 'string'))) throw new TypeError('인출 활동의 정답을 확인해주세요.');
        if (task.kind === 'cloze' && (!Array.isArray(task.blanks) || !task.blanks.length || task.blanks.length > 20 || task.blanks.some(blank => !object(blank) || typeof blank.answer !== 'string' || !blank.answer.trim() || !Array.isArray(blank.accepted) || blank.accepted.some(text => typeof text !== 'string')) || !Array.isArray(task.parts) || task.parts.some(part => typeof part !== 'string' && (!Number.isInteger(part) || part < 0 || part >= task.blanks.length)) || !equal(task.parts.filter(part => typeof part === 'number').slice().sort((a, b) => a - b), task.blanks.map((_, i) => i)) || !Array.isArray(task.answer) || task.answer.length !== task.blanks.length * 2 || task.blanks.some((blank, i) => task.answer[i * 2] !== blank.answer || !['sure', 'maybe', 'unknown'].includes(task.answer[i * 2 + 1])))) throw new TypeError('빈칸 글과 정답을 확인해주세요.');
        if (task.kind === 'selection' && (!Array.isArray(task.sentences) || !Array.isArray(task.groups) || !task.groups.length || !Array.isArray(task.answer) || task.groups.reduce((n, group) => n + group.capacity, 0) !== task.answer.length || new Set(task.answer).size !== task.answer.length || task.groups.some(group => !object(group) || !Number.isInteger(group.capacity) || group.capacity < 1 || !Array.isArray(group.ids) || !Array.isArray(group.correct) || group.correct.length !== group.capacity || group.ids.some(id => !Number.isInteger(id) || id < 0 || id >= task.sentences.length) || group.correct.some(id => !group.ids.includes(id))))) throw new TypeError('문장 선택 활동의 목록과 정답을 확인해주세요.');
        if (OWN(task, 'readingTrace') && (typeof task.readingTrace !== 'boolean' || (task.readingTrace && (task.kind !== 'read' || !Array.isArray(task.paragraphs) || !task.paragraphs.length)))) throw new TypeError('읽기 기록을 위한 문단 목록을 확인해주세요.');
        if (task.stage && (task.kind !== 'read' || ![1, 2, 3].includes(task.stage) || !['tap', 'paced', 'continuous'].includes(task.mode) || !Array.isArray(task.units) || !task.units.length || task.units.some(unit => typeof unit !== 'string' || !unit.trim()) || (task.mode !== 'tap' && (!Number.isFinite(task.displayInterval) || task.displayInterval < 100)))) throw new TypeError('유창성 단계의 표시 데이터를 확인해주세요.');
        tasks.set(task.id, task);
      }
      areas[area] = { definition, tasks };
    }

    const taskArea = (session, task) => task.trainingArea || session.area;
    const validParagraph = (task, index) => task.readingTrace === true && Number.isInteger(index) && index >= 0 && index < task.paragraphs.length;
    const emptyTrace = task => ({ paragraphMs: task.paragraphs.map(() => 0), regressions: 0, lastParagraph: null });
    const scored = task => !['read', 'practice', 'summary'].includes(task.kind);
    const repeats = (session, task) => scored(task) && taskArea(session, task) === 'vocabulary' && session.retryPolicy !== 'none';
    const practiceDraft = (task, value) => Array.isArray(value) && value.length === task.prompts.length && value.every(text => typeof text === 'string' && text.length <= 500);
    const relationDraft = (task, value, partial) => Array.isArray(value) && value.length === task.links.length && task.links.every((link, index) => (partial && value[index] === null) || (Number.isInteger(value[index]) && value[index] >= 0 && value[index] < link.options.length)) && (!task.uniqueChoices || new Set(value.filter(x => x !== null)).size === value.filter(x => x !== null).length);
    const recallDraft = value => Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && value[0].length <= 200 && ['', 'sure', 'maybe', 'unknown'].includes(value[1]);
    const clozeDraft = (task, value) => Array.isArray(value) && value.length === task.blanks.length * 2 && task.blanks.every((_, i) => recallDraft(value.slice(i * 2, i * 2 + 2)));
    function selectionDraft(task, value, partial) {
      if (!Array.isArray(value) || value.length !== task.answer.length || new Set(value.filter(x => x !== null)).size !== value.filter(x => x !== null).length) return false;
      let offset = 0;
      return task.groups.every(group => value.slice(offset, offset += group.capacity).every(id => (partial && id === null) || (Number.isInteger(id) && group.ids.includes(id))));
    }
    const normalizeText = text => text.replace(/\s/g, '').toLowerCase();
    const clozeResults = (task, value) => task.blanks.map((blank, index) => ({
      answer: value[index * 2], confidence: value[index * 2 + 1],
      correct: [blank.answer, ...blank.accepted].some(text => normalizeText(text) === normalizeText(value[index * 2]))
    }));
    const questionCount = task => task.kind === 'cloze' ? task.blanks.length : 1;
    const correctCount = (task, value) => task.kind === 'cloze' ? clozeResults(task, value).filter(blank => blank.correct).length : Number(correctAnswer(task, value));
    function correctAnswer(task, value) {
      if (!scored(task)) return null;
      if (task.kind === 'recall') return [task.answer, ...task.accepted].some(text => normalizeText(text) === normalizeText(value[0]));
      if (task.kind === 'cloze') return clozeResults(task, value).every(blank => blank.correct);
      if (task.kind === 'selection') {
        let offset = 0;
        return task.groups.every(group => value.slice(offset, offset += group.capacity).every(id => group.correct.includes(id)));
      }
      return equal(value, task.answer);
    }

    function validAnswer(task, value) {
      if (task.kind === 'practice') return practiceDraft(task, value) && value.every(text => text.trim().length > 0);
      if (task.kind === 'choice') return Number.isInteger(value) && value >= 0 && value < (task.options || task.choices).length;
      if (task.kind === 'order') return Array.isArray(value) && value.length === task.answer.length && new Set(value).size === value.length && value.every(x => task.answer.includes(x));
      if (task.kind === 'relations') return relationDraft(task, value, false);
      if (task.kind === 'recall') return recallDraft(value) && !!value[0].trim() && value[1] !== '';
      if (task.kind === 'cloze') return clozeDraft(task, value) && task.blanks.every((_, i) => !!value[i * 2].trim() && value[i * 2 + 1] !== '');
      if (task.kind === 'selection') return selectionDraft(task, value, false);
      if (task.kind === 'summary') return typeof value === 'string' && value.length <= 10000 && value.replace(/\s/g, '').length >= 40;
      return false;
    }

    function validDraft(task, value) {
      if (task.kind === 'practice') return practiceDraft(task, value);
      if (task.kind === 'order') return Array.isArray(value) && value.length <= task.answer.length && new Set(value).size === value.length && value.every(x => task.answer.includes(x));
      if (task.kind === 'relations') return relationDraft(task, value, true);
      if (task.kind === 'recall') return recallDraft(value);
      if (task.kind === 'cloze') return clozeDraft(task, value);
      if (task.kind === 'selection') return selectionDraft(task, value, true);
      if (task.kind === 'summary') return typeof value === 'string' && value.length <= 10000;
      return validAnswer(task, value);
    }

    function ready(session, entry) {
      const task = areas[session.area].tasks.get(entry.taskId);
      return task.kind === 'read' ? !!(session.read[entry.key]?.done || session.read[entry.key]?.skipped) : OWN(session.submitted, entry.key);
    }

    function newSession(area, options = {}) {
      if (!OWN(areas, area)) throw new TypeError('알 수 없는 훈련 영역입니다.');
      const definition = areas[area].definition;
      const available = definition.tasks.map(task => task.id);
      const requested = options.taskIds === undefined ? available : options.taskIds;
      if (!Array.isArray(requested) || !requested.length || new Set(requested).size !== requested.length || requested.some(id => !available.includes(id))) throw new TypeError('재학습 활동 목록이 올바르지 않습니다.');
      const taskIds = available.filter(id => requested.includes(id));
      const startedAt = options.startedAt || new Date().toISOString();
      const id = options.id || (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'practice-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
      if (!identity(id) || !date(startedAt) || (options.reviewOf != null && !identity(options.reviewOf))) throw new TypeError('학습 식별 정보가 올바르지 않습니다.');
      const queue = taskIds.map((taskId, index) => ({ key: 'base-' + (index + 1), taskId, retryOf: null }));
      const read = {};
      queue.forEach(entry => {
        const task = areas[area].tasks.get(entry.taskId);
        if (task.kind === 'read') read[entry.key] = { done: false, elapsedMs: 0, autoIndex: 0,
          ...(task.readingTrace ? { trace: emptyTrace(task) } : {}),
          ...(task.stage ? { started: false, position: 0, displayInterval: task.displayInterval, tapIntervals: [], lastTapMs: 0 } : {}) };
      });
      return { version: 1, id, area, title: definition.title || '소금은 어디에서 올까', startedAt, completedAt: null, status: 'active', elapsedMs: 0, cursor: 0, queue, answers: {}, submitted: {}, read, reviewOf: options.reviewOf || null, taskIds,
        ...(definition.retryVocabulary === false ? { retryPolicy: 'none' } : definition.tasks.some(task => task.kind === 'practice') ? { retryPolicy: 'before-practice' } : {}),
        ...(definition.metrics ? { passageId: definition.passageId, metrics: { responseMs: {}, areaMs: { vocabulary: 0, fluency: 0, reading: 0 } } } : {}) };
    }

    function current(session) {
      if (!session || !OWN(areas, session.area)) return null;
      const entry = session.queue?.[session.cursor];
      return entry ? { entry, task: areas[session.area].tasks.get(entry.taskId) } : null;
    }

    function answer(session, value) {
      const item = current(session);
      if (!item || session.status !== 'active' || OWN(session.submitted, item.entry.key) || !validDraft(item.task, value)) return false;
      session.answers[item.entry.key] = cloneAnswer(value);
      return true;
    }

    function retryPosition(session, index) {
      const usual = Math.min(index + 2, session.queue.length);
      if (session.retryPolicy !== 'before-practice') return usual;
      const practice = session.queue.findIndex((entry, i) => i > index && areas[session.area].tasks.get(entry.taskId).kind === 'practice');
      return practice < 0 ? usual : Math.min(usual, practice);
    }

    function submit(session) {
      const item = current(session);
      if (!item || item.task.kind === 'read') return { ok: false, correct: false, warning: '먼저 글을 읽어주세요.' };
      if (OWN(session.submitted, item.entry.key)) return { ok: true, correct: session.submitted[item.entry.key].correct };
      if (session.status !== 'active') return { ok: false, correct: false, warning: '이미 완료된 훈련이에요.' };
      const value = session.answers[item.entry.key];
      if (!validAnswer(item.task, value)) return { ok: false, correct: false, warning: item.task.kind === 'practice' ? '각 칸에 내용을 입력해 주세요.' : '답을 선택해주세요.' };
      const correct = correctAnswer(item.task, value);
      const retry = repeats(session, item.task) && !correct;
      if (retry && session.queue.length >= MAX_ENTRIES) return { ok: false, correct: false, warning: '복습 문항이 많아졌어요. 현재 답을 다시 확인해주세요.' };
      session.submitted[item.entry.key] = { correct, answer: cloneAnswer(value) };
      if (retry) {
        const retryCount = session.queue.filter(entry => entry.retryOf !== null).length;
        session.queue.splice(retryPosition(session, session.cursor), 0, { key: 'retry-' + (retryCount + 1), taskId: item.entry.taskId, retryOf: item.entry.key });
      }
      return { ok: true, correct };
    }

    function finishRead(session) {
      const item = current(session);
      if (!item || session.status !== 'active' || item.task.kind !== 'read') return false;
      if (session.read[item.entry.key].skipped) return false;
      if (item.task.stage && session.read[item.entry.key].position !== item.task.units.length) return false;
      session.read[item.entry.key].done = true;
      return true;
    }

    function skipRead(session) {
      const item = current(session);
      if (!item || session.status !== 'active' || item.task.kind !== 'read') return false;
      const read = session.read[item.entry.key];
      if (read.done || read.skipped) return false;
      read.skipped = true;
      return true;
    }

    function startRead(session) {
      const item = current(session);
      if (!item?.task.stage || session.status !== 'active' || session.read[item.entry.key].done || session.read[item.entry.key].skipped) return false;
      session.read[item.entry.key].started = true;
      return true;
    }

    function tapRead(session) {
      const item = current(session);
      if (!item || item.task.mode !== 'tap' || session.status !== 'active') return false;
      const read = session.read[item.entry.key];
      if (!read.started || read.done || read.skipped || read.position >= item.task.units.length) return false;
      read.tapIntervals.push(Math.max(0, read.elapsedMs - read.lastTapMs));
      read.lastTapMs = read.elapsedMs;
      read.position += 1;
      return true;
    }

    function observeParagraph(session, index) {
      const item = current(session);
      if (!item || session.status !== 'active' || !validParagraph(item.task, index)) return false;
      const read = session.read[item.entry.key];
      if (read.done || read.skipped || (item.task.stage && !read.started)) return false;
      const trace = read.trace || (read.trace = emptyTrace(item.task));
      if (trace.lastParagraph !== null && index < trace.lastParagraph) trace.regressions += 1;
      trace.lastParagraph = index;
      return true;
    }

    function next(session) {
      const item = current(session);
      if (!item || session.status !== 'active' || !ready(session, item.entry)) return false;
      if (session.cursor < session.queue.length - 1) session.cursor += 1;
      else {
        if (!session.queue.every(entry => ready(session, entry))) return false;
        session.status = 'completed';
        session.completedAt = new Date(Math.max(Date.now(), Date.parse(session.startedAt))).toISOString();
      }
      return true;
    }

    function previous(session) {
      if (!session || session.status !== 'active' || session.cursor <= 0) return false;
      session.cursor -= 1;
      return true;
    }

    function tick(session, ms, { answering = true, paragraphIndex = null } = {}) {
      if (!session || session.status !== 'active' || !Number.isFinite(ms) || ms <= 0) return false;
      const item = current(session);
      if (item?.task.kind === 'read' && session.read[item.entry.key].skipped) return false;
      if (item?.task.stage && (!session.read[item.entry.key].started || session.read[item.entry.key].done)) return false;
      let delta = Math.min(ms, MAX_DURATION - session.elapsedMs);
      if (item?.task.stage && item.task.mode !== 'tap') delta = Math.min(delta, item.task.units.length * item.task.displayInterval - session.read[item.entry.key].elapsedMs);
      if (delta <= 0) return false;
      session.elapsedMs += delta;
      if (item?.task.kind === 'read' && !session.read[item.entry.key].done) {
        const read = session.read[item.entry.key];
        read.elapsedMs += delta;
        if (validParagraph(item.task, paragraphIndex)) {
          const trace = read.trace || (read.trace = emptyTrace(item.task));
          trace.paragraphMs[paragraphIndex] += delta;
        }
        if (item.task.stage && item.task.mode !== 'tap') read.position = Math.min(item.task.units.length, Math.floor(read.elapsedMs / item.task.displayInterval));
      }
      if (session.metrics && item) {
        session.metrics.areaMs[taskArea(session, item.task)] += delta;
        if (answering && scored(item.task) && !OWN(session.submitted, item.entry.key)) session.metrics.responseMs[item.entry.key] = (session.metrics.responseMs[item.entry.key] || 0) + delta;
      }
      return true;
    }

    function progress(session) {
      let completed = 0, baseCompleted = 0, baseTotal = 0, partial = 0;
      for (const entry of session.queue) {
        const task = areas[session.area].tasks.get(entry.taskId);
        const done = ready(session, entry);
        if (done) completed++;
        if (entry.retryOf === null) { baseTotal++; if (done) baseCompleted++; }
        if (task.stage && !done) partial += session.read[entry.key].position / task.units.length;
      }
      const percent = Math.round((completed + partial) / session.queue.length * 100);
      return { completed, total: session.queue.length, percent: completed < session.queue.length ? Math.min(99, percent) : 100, baseCompleted, baseTotal };
    }

    function results(session) {
      const questions = session.queue.filter(entry => entry.retryOf === null && scored(areas[session.area].tasks.get(entry.taskId)));
      const attempted = questions.filter(entry => OWN(session.submitted, entry.key));
      const totalQuestions = questions.reduce((n, entry) => n + questionCount(areas[session.area].tasks.get(entry.taskId)), 0);
      const answered = attempted.reduce((n, entry) => n + questionCount(areas[session.area].tasks.get(entry.taskId)), 0);
      const correct = attempted.reduce((n, entry) => n + correctCount(areas[session.area].tasks.get(entry.taskId), session.submitted[entry.key].answer), 0);
      const wrong = answered - correct;
      const retries = session.queue.filter(entry => entry.retryOf !== null && OWN(session.submitted, entry.key));
      const mistakes = attempted.filter(entry => !correctAnswer(areas[session.area].tasks.get(entry.taskId), session.submitted[entry.key].answer)).map(entry => entry.taskId);
      const result = { correct, totalQuestions, wrong, accuracy: totalQuestions ? Math.round(correct / totalQuestions * 100) : 0, answered, mistakes, reviewAttempts: retries.length, reviewCorrect: retries.filter(entry => correctAnswer(areas[session.area].tasks.get(entry.taskId), session.submitted[entry.key].answer)).length, elapsedMs: session.elapsedMs };
      if (session.metrics) {
        result.areas = {};
        for (const area of ['vocabulary', 'fluency', 'reading']) {
          const entries = questions.filter(q => taskArea(session, areas[session.area].tasks.get(q.taskId)) === area);
          if (!entries.length) continue;
          const total = entries.reduce((n, q) => n + questionCount(areas[session.area].tasks.get(q.taskId)), 0);
          const hit = entries.reduce((n, q) => n + (session.submitted[q.key] ? correctCount(areas[session.area].tasks.get(q.taskId), session.submitted[q.key].answer) : 0), 0);
          result.areas[area] = { correct: hit, total, accuracy: Math.round(hit / total * 100), elapsedMs: session.metrics.areaMs[area] };
        }
        if (result.areas.fluency) {
          const stages = session.queue.filter(q => areas[session.area].tasks.get(q.taskId).stage).map(q => {
            const task = areas[session.area].tasks.get(q.taskId), read = session.read[q.key];
            const wordCount = task.units.join(' ').split(/\s+/).length;
            return { stage: task.stage, elapsedMs: read.elapsedMs, complete: read.done, displayInterval: read.displayInterval,
              ...(read.skipped ? { skipped: true } : {}),
              unitsRead: read.position, wordsPerMinute: read.done && read.elapsedMs > 0 ? Math.round(wordCount * 60000 / read.elapsedMs) : null };
          });
          const tapEntry = session.queue.find(q => areas[session.area].tasks.get(q.taskId).mode === 'tap');
          result.fluency = { ...result.areas.fluency, passageId: session.passageId, stages, completedStages: stages.filter(s => s.complete).map(s => s.stage),
            tapIntervals: tapEntry ? session.read[tapEntry.key].tapIntervals.slice() : [],
            quizResults: questions.filter(q => taskArea(session, areas[session.area].tasks.get(q.taskId)) === 'fluency').map(q => ({ taskId: q.taskId, type: areas[session.area].tasks.get(q.taskId).quizType, correct: session.submitted[q.key]?.correct ?? null, answer: cloneAnswer(session.answers[q.key]), responseMs: session.metrics.responseMs[q.key] || 0,
              ...(areas[session.area].tasks.get(q.taskId).kind === 'cloze' && session.submitted[q.key] ? { blankResults: clozeResults(areas[session.area].tasks.get(q.taskId), session.submitted[q.key].answer) } : {}) })) };
        }
      }
      if (areas[session.area].definition.vocabularyVersion) {
        const entries = questions.filter(q => taskArea(session, areas[session.area].tasks.get(q.taskId)) === 'vocabulary');
        const practices = session.queue.filter(q => areas[session.area].tasks.get(q.taskId).kind === 'practice');
        if (entries.length || practices.length) {
          const hit = entries.filter(q => session.submitted[q.key]?.correct).length;
          result.vocabulary = {
            correct: hit, total: entries.length, accuracy: entries.length ? Math.round(hit / entries.length * 100) : 0,
            elapsedMs: session.metrics.areaMs.vocabulary,
            questions: entries.map(q => {
              const task = areas[session.area].tasks.get(q.taskId);
              return { taskId: q.taskId, sourceRef: task.sourceRef, type: task.quizType, word: task.word,
                answer: session.answers[q.key] ?? null, correct: session.submitted[q.key]?.correct ?? null,
                responseMs: session.metrics.responseMs[q.key] || 0 };
            }),
            practice: practices.map(q => ({ taskId: q.taskId, completed: OWN(session.submitted, q.key),
              answers: cloneAnswer(session.answers[q.key] || areas[session.area].tasks.get(q.taskId).prompts.map(() => '')) }))
          };
        }
      }
      return result;
    }

    function normalize(raw) {
      try {
        if (!object(raw) || raw.version !== 1 || !identity(raw.id) || !OWN(areas, raw.area) || !date(raw.startedAt) || !['active', 'completed'].includes(raw.status) || !duration(raw.elapsedMs) || (raw.reviewOf != null && !identity(raw.reviewOf))) return null;
        if (!Array.isArray(raw.taskIds) || !raw.taskIds.length || !Array.isArray(raw.queue) || raw.queue.length < raw.taskIds.length || raw.queue.length > MAX_ENTRIES || !object(raw.answers) || !object(raw.submitted) || !object(raw.read)) return null;
        const session = newSession(raw.area, { id: raw.id, startedAt: raw.startedAt, taskIds: raw.taskIds, reviewOf: raw.reviewOf });
        if (raw.retryPolicy !== undefined && !['before-practice', 'none'].includes(raw.retryPolicy)) return null;
        if (raw.retryPolicy === 'none' && areas[raw.area].definition.retryVocabulary !== false) return null;
        // Older records retain their original queue and completed answers.
        if (raw.retryPolicy === undefined) delete session.retryPolicy;
        else session.retryPolicy = raw.retryPolicy;
        if (!equal(session.taskIds, raw.taskIds) || (!session.reviewOf && !equal(session.taskIds, areas[raw.area].definition.tasks.map(task => task.id)))) return null;
        session.elapsedMs = raw.elapsedMs;
        const keys = new Set();
        const retryChildren = new Map();
        for (const entry of raw.queue) {
          if (!object(entry) || !identity(entry.key) || keys.has(entry.key) || !areas[raw.area].tasks.has(entry.taskId) || !session.taskIds.includes(entry.taskId) || (entry.retryOf !== null && !identity(entry.retryOf))) return null;
          keys.add(entry.key);
          if (entry.retryOf !== null) {
            if (!repeats(session, areas[raw.area].tasks.get(entry.taskId)) || retryChildren.has(entry.retryOf)) return null;
            retryChildren.set(entry.retryOf, entry);
          }
        }
        if (Object.keys(raw.answers).some(key => !keys.has(key)) || Object.keys(raw.submitted).some(key => !keys.has(key)) || Object.keys(raw.read).some(key => !keys.has(key))) return null;

        // Reconstruct the only possible queue from immutable submissions. This
        // catches omitted retries, injected tasks, reordering, and skipped work.
        let gap = false;
        let retryNumber = 0;
        for (let i = 0; i < session.queue.length; i++) {
          if (session.queue.length > MAX_ENTRIES) return null;
          const entry = session.queue[i];
          const task = areas[raw.area].tasks.get(entry.taskId);
          if (task.kind === 'read') {
            const value = raw.read[entry.key];
            const maxIndex = Math.max(0, (task.sentences?.length || 1) - 1);
            if (!object(value) || typeof value.done !== 'boolean' || !duration(value.elapsedMs) || value.elapsedMs > raw.elapsedMs + 1 || !Number.isInteger(value.autoIndex) || value.autoIndex < 0 || value.autoIndex > maxIndex || OWN(raw.answers, entry.key) || OWN(raw.submitted, entry.key)) return null;
            if (OWN(value, 'skipped') && (typeof value.skipped !== 'boolean' || (value.skipped && value.done))) return null;
            if (gap && (value.done || value.skipped)) return null;
            session.read[entry.key] = { done: value.done, elapsedMs: value.elapsedMs, autoIndex: value.autoIndex,
              ...(OWN(value, 'skipped') ? { skipped: value.skipped } : {}) };
            if (OWN(value, 'trace')) {
              const trace = value.trace;
              if (!task.readingTrace || !object(trace) || !Array.isArray(trace.paragraphMs) || trace.paragraphMs.length !== task.paragraphs.length || trace.paragraphMs.some(ms => !duration(ms)) || trace.paragraphMs.reduce((sum, ms) => sum + ms, 0) > value.elapsedMs + 1 || !Number.isSafeInteger(trace.regressions) || trace.regressions < 0 || (trace.lastParagraph !== null && !validParagraph(task, trace.lastParagraph)) || (trace.lastParagraph === null && trace.regressions !== 0) || (gap && (trace.lastParagraph !== null || trace.regressions || trace.paragraphMs.some(ms => ms > 0)))) return null;
              session.read[entry.key].trace = { paragraphMs: trace.paragraphMs.slice(), regressions: trace.regressions, lastParagraph: trace.lastParagraph };
            }
            if (task.stage) {
              if (typeof value.started !== 'boolean' || !Number.isInteger(value.position) || value.position < 0 || value.position > task.units.length || value.displayInterval !== task.displayInterval || !Array.isArray(value.tapIntervals) || value.tapIntervals.some(v => !duration(v)) || !duration(value.lastTapMs)) return null;
              if ((!value.started && (value.position || value.elapsedMs || value.done)) || (value.done && value.position !== task.units.length) || (gap && (value.started || value.elapsedMs))) return null;
              if (task.mode === 'tap') {
                if (value.tapIntervals.length !== value.position || Math.abs(value.tapIntervals.reduce((n, v) => n + v, 0) - value.lastTapMs) > 1 || value.lastTapMs > value.elapsedMs + 1) return null;
              } else if (value.tapIntervals.length || value.lastTapMs || value.elapsedMs > task.units.length * task.displayInterval || value.position !== Math.min(task.units.length, Math.floor(value.elapsedMs / task.displayInterval))) return null;
              Object.assign(session.read[entry.key], { started: value.started, position: value.position, displayInterval: value.displayInterval, tapIntervals: value.tapIntervals.slice(), lastTapMs: value.lastTapMs });
            }
            if (!value.done && !value.skipped) gap = true;
          } else {
            if (OWN(raw.read, entry.key)) return null;
            if (OWN(raw.answers, entry.key)) {
              if (!validDraft(task, raw.answers[entry.key])) return null;
              session.answers[entry.key] = cloneAnswer(raw.answers[entry.key]);
            }
            if (OWN(raw.submitted, entry.key)) {
              const submitted = raw.submitted[entry.key];
              if (gap || !object(submitted) || !validAnswer(task, submitted.answer) || !equal(submitted.answer, raw.answers[entry.key])) return null;
              const correct = correctAnswer(task, submitted.answer);
              // Never retain a forged supplied correctness flag.
              session.submitted[entry.key] = { correct, answer: cloneAnswer(submitted.answer) };
              if (repeats(session, task) && !correct) {
                const child = retryChildren.get(entry.key);
                retryNumber += 1;
                if (!child || child.taskId !== entry.taskId || child.key !== 'retry-' + retryNumber) return null;
                session.queue.splice(retryPosition(session, i), 0, { key: child.key, taskId: child.taskId, retryOf: entry.key });
              } else if (retryChildren.has(entry.key)) return null;
            } else {
              gap = true;
              if (retryChildren.has(entry.key)) return null;
            }
          }
        }
        if (session.queue.length !== raw.queue.length || session.queue.some((entry, index) => entry.key !== raw.queue[index].key || entry.taskId !== raw.queue[index].taskId || entry.retryOf !== raw.queue[index].retryOf)) return null;
        // Reading and total clocks group fractional performance.now() deltas
        // differently. Permit sub-millisecond rounding, never material drift.
        if (Object.values(session.read).reduce((total, value) => total + value.elapsedMs, 0) > session.elapsedMs + 1) return null;
        const firstPending = session.queue.findIndex(entry => !ready(session, entry));
        const lastAccessible = firstPending < 0 ? session.queue.length - 1 : firstPending;
        if (!Number.isInteger(raw.cursor) || raw.cursor < 0 || raw.cursor > lastAccessible) return null;
        session.cursor = raw.cursor;
        if (session.metrics) {
          if (raw.passageId !== session.passageId || !object(raw.metrics) || !object(raw.metrics.areaMs) || !object(raw.metrics.responseMs)) return null;
          if (Object.keys(raw.metrics.areaMs).length !== 3 || ['vocabulary', 'fluency', 'reading'].some(area => !duration(raw.metrics.areaMs[area]))) return null;
          if (Math.abs(Object.values(raw.metrics.areaMs).reduce((n, ms) => n + ms, 0) - session.elapsedMs) > 1) return null;
          for (const [key, ms] of Object.entries(raw.metrics.responseMs)) {
            const index = session.queue.findIndex(q => q.key === key);
            if (!duration(ms) || index < 0 || index > lastAccessible || !scored(areas[raw.area].tasks.get(session.queue[index].taskId))) return null;
          }
          if (Object.values(raw.metrics.responseMs).reduce((n, ms) => n + ms, 0) + Object.values(session.read).reduce((n, r) => n + r.elapsedMs, 0) > session.elapsedMs + 1) return null;
          session.metrics = { responseMs: { ...raw.metrics.responseMs }, areaMs: { ...raw.metrics.areaMs } };
        }
        if (raw.status === 'completed') {
          if (firstPending !== -1 || raw.cursor !== session.queue.length - 1 || !date(raw.completedAt) || Date.parse(raw.completedAt) < Date.parse(raw.startedAt)) return null;
          session.status = 'completed';
          session.completedAt = raw.completedAt;
        } else if (raw.completedAt !== null) return null;
        return session;
      } catch (_) {
        return null;
      }
    }

    function load(storage) {
      try {
        const raw = storage.getItem(SESSION_KEY);
        if (raw === null) return { session: null, warning: null };
        if (typeof raw !== 'string' || raw.length > 5000000) return { session: null, warning };
        let session = normalize(JSON.parse(raw));
        if (session?.status === 'active' && !session.retryPolicy) {
          const tasks = areas[session.area].tasks;
          const practices = session.queue.filter(entry => tasks.get(entry.taskId).kind === 'practice');
          if (practices.length && practices.every(entry => !OWN(session.submitted, entry.key))) {
            const next = JSON.parse(JSON.stringify(session)), currentKey = session.queue[session.cursor].key;
            next.retryPolicy = 'before-practice';
            // Move only pending practice behind its area's pending quizzes;
            // stable entry keys keep drafts, submitted answers and time intact.
            for (const practice of practices) {
              const index = next.queue.findIndex(entry => entry.key === practice.key);
              const area = taskArea(next, tasks.get(practice.taskId));
              let end = index;
              while (end + 1 < next.queue.length && taskArea(next, tasks.get(next.queue[end + 1].taskId)) === area) end++;
              if (end > index) next.queue.splice(end, 0, next.queue.splice(index, 1)[0]);
            }
            const cursor = next.queue.findIndex(entry => entry.key === currentKey);
            const pending = next.queue.findIndex(entry => !ready(next, entry));
            next.cursor = pending < 0 ? cursor : Math.min(cursor, pending);
            session = normalize(next) || session;
          }
        }
        return { session, warning: session ? null : warning };
      } catch (_) {
        return { session: null, warning };
      }
    }

    function save(storage, session) {
      const safe = normalize(session);
      if (!safe) return { ok: false, warning: '현재 학습 정보를 저장할 수 없어요. 활동과 답안을 확인해주세요.' };
      try {
        const text = JSON.stringify(safe);
        if (storage.getItem(SESSION_KEY) !== text) storage.setItem(SESSION_KEY, text);
        return { ok: true, warning: null };
      } catch (_) {
        return { ok: false, warning: '자동 저장에 실패했어요. 저장 공간을 확인하고 이 창을 유지해주세요.' };
      }
    }

    function loadHistory(storage) {
      try {
        const text = storage.getItem(HISTORY_KEY);
        if (text === null) return { records: [], warning: null };
        if (typeof text !== 'string' || text.length > 20000000) return { records: [], warning };
        const raw = JSON.parse(text);
        if (!Array.isArray(raw) || raw.length > MAX_HISTORY) return { records: [], warning };
        const records = [];
        const ids = new Set();
        let invalid = false;
        for (const value of raw) {
          const record = normalize(value);
          if (!record || record.status !== 'completed' || ids.has(record.id)) invalid = true;
          else { records.push(record); ids.add(record.id); }
        }
        records.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
        return { records, warning: invalid ? warning : null };
      } catch (_) {
        return { records: [], warning };
      }
    }

    function saveCompleted(storage, session) {
      const safe = normalize(session);
      if (!safe || safe.status !== 'completed') return { ok: false, warning: '모든 활동을 마친 뒤 완료 기록을 저장할 수 있어요.' };
      const loaded = loadHistory(storage);
      if (loaded.warning) return { ok: false, warning: '이전 기록을 확인할 수 없어 덮어쓰지 않았어요. 현재 학습 결과는 이 창에서 확인할 수 있어요.' };
      const records = [safe, ...loaded.records.filter(record => record.id !== safe.id)].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
      if (records.length > MAX_HISTORY) return { ok: false, warning: '학습 기록 보관 한도에 도달했어요. 이전 기록은 유지했으니 현재 결과 화면을 유지해주세요.' };
      try {
        const text = JSON.stringify(records);
        if (storage.getItem(HISTORY_KEY) !== text) storage.setItem(HISTORY_KEY, text);
        return { ok: true, warning: null };
      } catch (_) {
        return { ok: false, warning: '완료 기록을 저장하지 못했어요. 저장 공간을 확인하고 이 창을 유지해주세요.' };
      }
    }

    const canSubmit = session => { const item = current(session); return !!item && validAnswer(item.task, session.answers[item.entry.key]); };
    return { newSession, normalize, load, save, loadHistory, saveCompleted, current, answer, submit, canSubmit, next, previous, finishRead, skipRead, startRead, tapRead, observeParagraph, tick, results, progress };
  }

  return { create, SESSION_KEY, HISTORY_KEY };
});
