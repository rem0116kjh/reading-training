/*
 * Independent, data-driven practice sessions. Existing trainingSession/history
 * keys and the original full-course engine are intentionally left untouched.
 *
 * const engine = ActivityEngine.create(ActivityContent.createCatalog(PKG));
 * All action methods mutate the supplied session. answer/finishRead/next/
 * previous return whether the action was accepted. submit returns
 * {ok, correct, warning?}; it grades only, and next performs navigation.
 * finishRead marks a passage as read; next moves to its question.
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
        if (!object(task) || !identity(task.id) || tasks.has(task.id) || !['read', 'choice', 'order'].includes(task.kind)) throw new TypeError('활동 ID와 유형을 확인해주세요.');
        if (task.kind === 'choice' && (!Array.isArray(task.options || task.choices) || !Number.isInteger(task.answer) || task.answer < 0 || task.answer >= (task.options || task.choices).length)) throw new TypeError('선택형 활동의 정답을 확인해주세요.');
        if (task.kind === 'order' && (!Array.isArray(task.answer) || task.answer.length < 2 || new Set(task.answer).size !== task.answer.length || task.answer.some(x => !Number.isInteger(x) && !identity(x)))) throw new TypeError('순서형 활동의 정답을 확인해주세요.');
        tasks.set(task.id, task);
      }
      areas[area] = { definition, tasks };
    }

    function validAnswer(task, value) {
      if (task.kind === 'choice') return Number.isInteger(value) && value >= 0 && value < (task.options || task.choices).length;
      if (task.kind === 'order') return Array.isArray(value) && value.length === task.answer.length && new Set(value).size === value.length && value.every(x => task.answer.includes(x));
      return false;
    }

    function validDraft(task, value) {
      if (task.kind === 'order') return Array.isArray(value) && value.length <= task.answer.length && new Set(value).size === value.length && value.every(x => task.answer.includes(x));
      return validAnswer(task, value);
    }

    function ready(session, entry) {
      const task = areas[session.area].tasks.get(entry.taskId);
      return task.kind === 'read' ? !!session.read[entry.key]?.done : OWN(session.submitted, entry.key);
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
        if (areas[area].tasks.get(entry.taskId).kind === 'read') read[entry.key] = { done: false, elapsedMs: 0, autoIndex: 0 };
      });
      return { version: 1, id, area, title: '소금은 어디에서 올까', startedAt, completedAt: null, status: 'active', elapsedMs: 0, cursor: 0, queue, answers: {}, submitted: {}, read, reviewOf: options.reviewOf || null, taskIds };
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

    function submit(session) {
      const item = current(session);
      if (!item || item.task.kind === 'read') return { ok: false, correct: false, warning: '먼저 글을 읽어주세요.' };
      if (OWN(session.submitted, item.entry.key)) return { ok: true, correct: session.submitted[item.entry.key].correct };
      if (session.status !== 'active') return { ok: false, correct: false, warning: '이미 완료된 훈련이에요.' };
      const value = session.answers[item.entry.key];
      if (!validAnswer(item.task, value)) return { ok: false, correct: false, warning: '답을 선택해주세요.' };
      const correct = equal(value, item.task.answer);
      const retry = session.area === 'vocabulary' && !correct;
      if (retry && session.queue.length >= MAX_ENTRIES) return { ok: false, correct: false, warning: '복습 문항이 많아졌어요. 현재 답을 다시 확인해주세요.' };
      session.submitted[item.entry.key] = { correct, answer: cloneAnswer(value) };
      if (retry) {
        const retryCount = session.queue.filter(entry => entry.retryOf !== null).length;
        session.queue.splice(Math.min(session.cursor + 2, session.queue.length), 0, { key: 'retry-' + (retryCount + 1), taskId: item.entry.taskId, retryOf: item.entry.key });
      }
      return { ok: true, correct };
    }

    function finishRead(session) {
      const item = current(session);
      if (!item || session.status !== 'active' || item.task.kind !== 'read') return false;
      session.read[item.entry.key].done = true;
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

    function tick(session, ms) {
      if (!session || session.status !== 'active' || !Number.isFinite(ms) || ms <= 0) return false;
      const delta = Math.min(ms, MAX_DURATION - session.elapsedMs);
      if (delta <= 0) return false;
      session.elapsedMs += delta;
      const item = current(session);
      if (item?.task.kind === 'read' && !session.read[item.entry.key].done) session.read[item.entry.key].elapsedMs += delta;
      return true;
    }

    function progress(session) {
      const completed = session.queue.filter(entry => ready(session, entry)).length;
      const baseEntries = session.queue.filter(entry => entry.retryOf === null);
      const baseCompleted = baseEntries.filter(entry => ready(session, entry)).length;
      return { completed, total: session.queue.length, percent: Math.round(completed / session.queue.length * 100), baseCompleted, baseTotal: baseEntries.length };
    }

    function results(session) {
      const questions = session.queue.filter(entry => entry.retryOf === null && areas[session.area].tasks.get(entry.taskId).kind !== 'read');
      const attempted = questions.filter(entry => OWN(session.submitted, entry.key));
      const correct = attempted.filter(entry => equal(session.submitted[entry.key].answer, areas[session.area].tasks.get(entry.taskId).answer)).length;
      const wrong = attempted.length - correct;
      const retries = session.queue.filter(entry => entry.retryOf !== null && OWN(session.submitted, entry.key));
      const mistakes = attempted.filter(entry => !equal(session.submitted[entry.key].answer, areas[session.area].tasks.get(entry.taskId).answer)).map(entry => entry.taskId);
      return { correct, totalQuestions: questions.length, wrong, accuracy: questions.length ? Math.round(correct / questions.length * 100) : 0, answered: attempted.length, mistakes, reviewAttempts: retries.length, reviewCorrect: retries.filter(entry => equal(session.submitted[entry.key].answer, areas[session.area].tasks.get(entry.taskId).answer)).length, elapsedMs: session.elapsedMs };
    }

    function normalize(raw) {
      try {
        if (!object(raw) || raw.version !== 1 || !identity(raw.id) || !OWN(areas, raw.area) || !date(raw.startedAt) || !['active', 'completed'].includes(raw.status) || !duration(raw.elapsedMs) || (raw.reviewOf != null && !identity(raw.reviewOf))) return null;
        if (!Array.isArray(raw.taskIds) || !raw.taskIds.length || !Array.isArray(raw.queue) || raw.queue.length < raw.taskIds.length || raw.queue.length > MAX_ENTRIES || !object(raw.answers) || !object(raw.submitted) || !object(raw.read)) return null;
        const session = newSession(raw.area, { id: raw.id, startedAt: raw.startedAt, taskIds: raw.taskIds, reviewOf: raw.reviewOf });
        if (!equal(session.taskIds, raw.taskIds) || (!session.reviewOf && !equal(session.taskIds, areas[raw.area].definition.tasks.map(task => task.id)))) return null;
        session.elapsedMs = raw.elapsedMs;
        const keys = new Set();
        const retryChildren = new Map();
        for (const entry of raw.queue) {
          if (!object(entry) || !identity(entry.key) || keys.has(entry.key) || !areas[raw.area].tasks.has(entry.taskId) || !session.taskIds.includes(entry.taskId) || (entry.retryOf !== null && !identity(entry.retryOf))) return null;
          keys.add(entry.key);
          if (entry.retryOf !== null) {
            if (raw.area !== 'vocabulary' || retryChildren.has(entry.retryOf)) return null;
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
            if (gap && value.done) return null;
            session.read[entry.key] = { done: value.done, elapsedMs: value.elapsedMs, autoIndex: value.autoIndex };
            if (!value.done) gap = true;
          } else {
            if (OWN(raw.read, entry.key)) return null;
            if (OWN(raw.answers, entry.key)) {
              if (!validDraft(task, raw.answers[entry.key])) return null;
              session.answers[entry.key] = cloneAnswer(raw.answers[entry.key]);
            }
            if (OWN(raw.submitted, entry.key)) {
              const submitted = raw.submitted[entry.key];
              if (gap || !object(submitted) || !validAnswer(task, submitted.answer) || !equal(submitted.answer, raw.answers[entry.key])) return null;
              const correct = equal(submitted.answer, task.answer);
              // Never retain a forged supplied correctness flag.
              session.submitted[entry.key] = { correct, answer: cloneAnswer(submitted.answer) };
              if (raw.area === 'vocabulary' && !correct) {
                const child = retryChildren.get(entry.key);
                retryNumber += 1;
                if (!child || child.taskId !== entry.taskId || child.key !== 'retry-' + retryNumber) return null;
                session.queue.splice(Math.min(i + 2, session.queue.length), 0, { key: child.key, taskId: child.taskId, retryOf: entry.key });
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
        const session = normalize(JSON.parse(raw));
        return { session, warning: session ? null : warning };
      } catch (_) {
        return { session: null, warning };
      }
    }

    function save(storage, session) {
      const safe = normalize(session);
      if (!safe) return { ok: false, warning: '현재 학습 정보를 저장할 수 없어요. 활동과 답안을 확인해주세요.' };
      try {
        storage.setItem(SESSION_KEY, JSON.stringify(safe));
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
        storage.setItem(HISTORY_KEY, JSON.stringify(records));
        return { ok: true, warning: null };
      } catch (_) {
        return { ok: false, warning: '완료 기록을 저장하지 못했어요. 저장 공간을 확인하고 이 창을 유지해주세요.' };
      }
    }

    return { newSession, normalize, load, save, loadHistory, saveCompleted, current, answer, submit, next, previous, finishRead, tick, results, progress };
  }

  return { create, SESSION_KEY, HISTORY_KEY };
});
