/* Local-only persistence. Values read from storage are always treated as untrusted. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TrainingStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const VERSION = 1;
  const PACKAGE_ID = 'salt-v1';
  const SESSION_KEY = 'trainingSession';
  const HISTORY_KEY = 'trainingHistory';
  const MAX_TEXT = 100000;
  const CONFIDENCE = ['', 'sure', 'maybe', 'unknown'];
  const MODES = ['full', 'area', 'mistakes'];
  const MISTAKE_LIMITS = { vocab: 5, concept: 5, reading: 7, key: 4, outline: 17 };
  const PARAGRAPH_RANGES = [[0, 2], [3, 8], [9, 12], [13, 16]];
  const OUTLINE_SENTENCES = [0, 3, 9, 13, 15];
  const WARNINGS = {
    unavailable: '브라우저 저장소를 사용할 수 없어 새로고침 후 학습을 복원할 수 없습니다.',
    quota: '브라우저 저장 공간이 부족해 최신 학습 내용을 저장하지 못했습니다.',
    write: '학습 내용을 저장하지 못했습니다. 이 화면을 닫기 전에 저장 상태를 확인해 주세요.',
    session: '저장된 학습 정보가 손상되었거나 지원하지 않는 버전이어서 복원하지 못했습니다.',
    repaired: '저장된 학습 정보 일부를 복구했습니다. 확인할 수 없는 제출 상태는 해제했습니다.',
    history: '이전 기록 일부가 손상되었거나 지원하지 않는 버전입니다. 확인 가능한 기록만 표시합니다.',
    invalid: '학습 정보가 올바르지 않아 저장하지 않았습니다.'
  };

  function isObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function owns(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function text(value, limit, fallback) {
    return typeof value === 'string' && value.length <= limit ? value : fallback;
  }

  function identity(value) {
    return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : null;
  }

  function integer(value, min, max, fallback) {
    return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
  }

  function duration(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : 0;
  }

  function isoDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const canonical = date.toISOString();
    return canonical === value || canonical === value.replace('Z', '.000Z') ? canonical : null;
  }

  function fixedArray(value, length, normalize) {
    const source = Array.isArray(value) ? value : [];
    return Array.from({ length }, (_, index) => normalize(source[index]));
  }

  function sentenceIndices(value, limit) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(item => integer(item, 0, 16, null) !== null))].slice(0, limit);
  }

  function completeKeySelection(indices) {
    return Array.isArray(indices) && indices.length === 4 && indices.every(index => Number.isInteger(index)) && PARAGRAPH_RANGES.every(([min, max]) => indices.filter(index => index >= min && index <= max).length === 1);
  }

  // Result objects contain metrics, feedback and answers only. Strip dangerous keys,
  // unsupported values and excessive nesting, never interpret their string contents.
  function safeJson(value, depth, seen) {
    if (depth > 12) return null;
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.slice(0, MAX_TEXT);
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (!Array.isArray(value) && !isObject(value)) return null;
    if (seen.has(value)) return null;
    seen.add(value);
    let result;
    if (Array.isArray(value)) {
      result = value.slice(0, 500).map(item => safeJson(item, depth + 1, seen));
    } else {
      result = {};
      Object.keys(value).slice(0, 200).forEach(key => {
        if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
          result[key] = safeJson(value[key], depth + 1, seen);
        }
      });
    }
    seen.delete(value);
    return result;
  }

  function resultsObject(value) {
    if (!isObject(value)) return null;
    const result = safeJson(value, 0, new Set());
    return Object.keys(result).length ? result : null;
  }

  function makeId() {
    try {
      if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    } catch (_) { /* A random local fallback also works when crypto is unavailable. */ }
    return 'session-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function requiredSteps(mode, value) {
    if (mode === 'mistakes') return [];
    if (mode !== 'area') return [1, 2, 3, 4];
    const steps = Array.isArray(value) ? [...new Set(value.filter(step => integer(step, 1, 4, null) !== null))].sort() : [];
    return steps.length ? steps : [1];
  }

  function createSession(options) {
    const input = isObject(options) ? options : {};
    const mode = MODES.includes(input.mode) ? input.mode : 'full';
    const steps = requiredSteps(mode, input.requiredSteps);
    return {
      version: VERSION,
      packageId: PACKAGE_ID,
      id: identity(input.id) || makeId(),
      title: text(input.title, 256, '소금은 어디에서 올까'),
      mode,
      reviewOf: identity(input.reviewOf),
      requiredSteps: steps,
      currentStep: mode === 'mistakes' ? 5 : steps[0],
      currentQuestion: null,
      status: 'active',
      startedAt: isoDate(input.startedAt) || new Date().toISOString(),
      completedAt: null,
      elapsedMs: 0,
      stepMs: [0, 0, 0, 0],
      draft: {
        vocab: Array(5).fill(null),
        compose: ['', ''],
        blanks: Array(5).fill(''),
        confidence: Array(5).fill(''),
        key: [],
        readingAnswers: Array(7).fill(null),
        slots: [[], [], []],
        selectedSentence: null,
        essay: ''
      },
      submitted: { vocab: false, concept: false, reading: false, outline: false, writing: false },
      phase: { concept: 'read', reading: 'read' },
      metrics: { readingMs: 0, dwell: [0, 0, 0, 0], reg: 0, maxP: -1 },
      mistakes: normalizeMistakes(input.mistakes),
      mistakeAnswers: {},
      mistakeSubmitted: false,
      results: null
    };
  }

  function normalizeMistakes(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.filter(item => {
      if (!isObject(item) || !owns(MISTAKE_LIMITS, item.type)) return false;
      if (integer(item.index, 0, MISTAKE_LIMITS[item.type] - 1, null) === null) return false;
      if (item.type === 'outline' && !OUTLINE_SENTENCES.includes(item.index)) return false;
      const key = item.type + '-' + item.index;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(item => ({ type: item.type, index: item.index }));
  }

  function normalizeSession(value) {
    if (!isObject(value) || value.version !== VERSION || value.packageId !== PACKAGE_ID) return null;
    if (!identity(value.id) || !isoDate(value.startedAt) || !MODES.includes(value.mode)) return null;
    const session = createSession(value);
    const draft = isObject(value.draft) ? value.draft : {};
    session.draft.vocab = fixedArray(draft.vocab, 5, item => integer(item, 0, 4, null));
    session.draft.compose = fixedArray(draft.compose, 2, item => text(item, 10000, ''));
    session.draft.blanks = fixedArray(draft.blanks, 5, item => text(item, 1000, ''));
    session.draft.confidence = fixedArray(draft.confidence, 5, item => CONFIDENCE.includes(item) ? item : '');
    session.draft.key = sentenceIndices(draft.key, 4);
    session.draft.readingAnswers = fixedArray(draft.readingAnswers, 7, item => integer(item, 0, 4, null));
    const used = new Set();
    session.draft.slots = fixedArray(draft.slots, 3, item => sentenceIndices(item, 17)).map((slot, index) => {
      const retained = [];
      for (const sentence of slot) {
        if (retained.length >= [1, 2, 2][index]) break;
        if (used.has(sentence)) continue;
        used.add(sentence);
        retained.push(sentence);
      }
      return retained;
    });
    const selected = integer(draft.selectedSentence, 0, 16, null);
    session.draft.selectedSentence = used.has(selected) ? null : selected;
    session.draft.essay = text(draft.essay, MAX_TEXT, '');
    session.elapsedMs = duration(value.elapsedMs);
    session.stepMs = fixedArray(value.stepMs, 4, duration);
    session.currentQuestion = text(value.currentQuestion, 128, null);

    const phase = isObject(value.phase) ? value.phase : {};
    session.phase.concept = phase.concept === 'fill' ? 'fill' : 'read';
    session.phase.reading = ['read', 'key', 'quiz'].includes(phase.reading) ? phase.reading : 'read';
    const keyComplete = completeKeySelection(draft.key) && completeKeySelection(session.draft.key);
    if (session.phase.reading === 'quiz' && !keyComplete) session.phase.reading = 'key';
    const submitted = isObject(value.submitted) ? value.submitted : {};
    const answers = session.draft;
    session.submitted.vocab = submitted.vocab === true && answers.vocab.every(item => item !== null) && answers.compose.every(item => item.trim());
    session.submitted.concept = submitted.concept === true && answers.blanks.every(item => item.trim()) && answers.confidence.every(item => item !== '');
    session.submitted.reading = submitted.reading === true && keyComplete && answers.readingAnswers.every(item => item !== null);
    session.submitted.outline = submitted.outline === true && answers.slots.every((slot, index) => slot.length === [1, 2, 2][index]);
    session.submitted.writing = submitted.writing === true && session.submitted.outline && answers.essay.replace(/\s/g, '').length >= 40;
    if (session.submitted.concept) session.phase.concept = 'fill';
    if (session.submitted.reading) session.phase.reading = 'quiz';

    const metrics = isObject(value.metrics) ? value.metrics : {};
    session.metrics = {
      readingMs: duration(metrics.readingMs),
      dwell: fixedArray(metrics.dwell, 4, duration),
      reg: integer(metrics.reg, 0, Number.MAX_SAFE_INTEGER, 0),
      maxP: integer(metrics.maxP, -1, 3, -1)
    };
    session.mistakes = normalizeMistakes(value.mistakes);
    const mistakeAnswers = isObject(value.mistakeAnswers) ? value.mistakeAnswers : {};
    session.mistakes.forEach(item => {
      const key = item.type + '-' + item.index;
      if (!owns(mistakeAnswers, key)) return;
      let answer = item.type === 'concept'
        ? text(mistakeAnswers[key], 1000, null)
        : integer(mistakeAnswers[key], 0, item.type === 'key' ? 16 : item.type === 'outline' ? 2 : 4, null);
      if (item.type === 'key') {
        const [min, max] = PARAGRAPH_RANGES[item.index];
        answer = integer(answer, min, max, null);
      }
      if (answer !== null) session.mistakeAnswers[key] = answer;
    });
    const allMistakesValid = Array.isArray(value.mistakes) && value.mistakes.length === session.mistakes.length;
    session.mistakeSubmitted = value.mistakeSubmitted === true && allMistakesValid && session.mistakes.length > 0 && session.mistakes.every(item => {
      const key = item.type + '-' + item.index;
      return owns(session.mistakeAnswers, key) && (item.type !== 'concept' || session.mistakeAnswers[key].trim() !== '');
    });
    session.results = resultsObject(value.results);
    const stepDone = { 1: session.submitted.vocab, 2: session.submitted.concept, 3: session.submitted.reading, 4: session.submitted.writing };
    const completedAt = isoDate(value.completedAt);
    const canComplete = session.mode === 'mistakes' ? session.mistakeSubmitted : session.requiredSteps.every(step => stepDone[step]);
    if (value.status === 'completed' && canComplete && completedAt && completedAt >= session.startedAt && session.results) {
      session.status = 'completed';
      session.completedAt = completedAt;
    }
    if (session.mode === 'mistakes') {
      session.currentStep = 5;
    } else if (session.status === 'completed') {
      session.currentStep = session.requiredSteps.includes(value.currentStep) ? value.currentStep : 5;
    } else {
      const requestedStep = integer(value.currentStep, 1, 5, session.requiredSteps[0]);
      if (requestedStep === 5 && canComplete) session.currentStep = 5;
      else if (session.requiredSteps.includes(requestedStep)) session.currentStep = session.requiredSteps.find(step => step < requestedStep && !stepDone[step]) || requestedStep;
      else session.currentStep = session.requiredSteps.find(step => !stepDone[step]) || session.requiredSteps[0];
    }
    // A previously completed payload with missing answers cannot retain old scores.
    if (value.status === 'completed' && session.status !== 'completed') session.results = null;
    return session;
  }

  function equivalent(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => equivalent(item, b[index]));
    if (!isObject(a) || !isObject(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => owns(b, key) && equivalent(a[key], b[key]));
  }

  function storageOrDefault(storage) {
    const target = storage === undefined ? root.localStorage : storage;
    if (!target || typeof target.getItem !== 'function' || typeof target.setItem !== 'function' || typeof target.removeItem !== 'function') throw new Error('StorageUnavailable');
    return target;
  }

  function writeWarning(error) {
    return error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22 || error.code === 1014)
      ? WARNINGS.quota
      : error && (error.name === 'SecurityError' || error.message === 'StorageUnavailable') ? WARNINGS.unavailable : WARNINGS.write;
  }

  function loadSession(storage) {
    let raw;
    try { raw = storageOrDefault(storage).getItem(SESSION_KEY); }
    catch (_) { return { session: null, warning: WARNINGS.unavailable }; }
    if (raw === null) return { session: null, warning: null };
    try {
      const parsed = JSON.parse(raw);
      const session = normalizeSession(parsed);
      return { session, warning: !session ? WARNINGS.session : equivalent(parsed, session) ? null : WARNINGS.repaired };
    } catch (_) { return { session: null, warning: WARNINGS.session }; }
  }

  function saveSession(storage, value) {
    try {
      const session = normalizeSession(value);
      if (!session) return { ok: false, warning: WARNINGS.invalid };
      storageOrDefault(storage).setItem(SESSION_KEY, JSON.stringify(session));
      return { ok: true, warning: equivalent(value, session) ? null : WARNINGS.repaired };
    } catch (error) { return { ok: false, warning: writeWarning(error) }; }
  }

  function normalizeRecord(value) {
    if (!isObject(value) || value.version !== VERSION) return null;
    const session = normalizeSession(value.session);
    if (!session || session.status !== 'completed' || value.id !== session.id) return null;
    const results = resultsObject(value.results);
    if (!results) return null;
    return {
      version: VERSION,
      id: session.id,
      packageId: session.packageId,
      title: session.title,
      mode: session.mode,
      reviewOf: session.reviewOf,
      completedAt: session.completedAt,
      totalTime: session.elapsedMs,
      results,
      session
    };
  }

  function loadHistory(storage) {
    let raw;
    try { raw = storageOrDefault(storage).getItem(HISTORY_KEY); }
    catch (_) { return { records: [], warning: WARNINGS.unavailable }; }
    if (raw === null) return { records: [], warning: null };
    try {
      const values = JSON.parse(raw);
      if (!Array.isArray(values)) return { records: [], warning: WARNINGS.history };
      const unique = new Map();
      let repaired = false;
      values.forEach(value => {
        const record = normalizeRecord(value);
        if (!record) { repaired = true; return; }
        if (!equivalent(record, value) || unique.has(record.id)) repaired = true;
        const previous = unique.get(record.id);
        if (!previous || record.completedAt >= previous.completedAt) unique.set(record.id, record);
      });
      const records = [...unique.values()].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
      return { records, warning: repaired ? WARNINGS.history : null };
    } catch (_) { return { records: [], warning: WARNINGS.history }; }
  }

  function upsertHistory(storage, value) {
    try {
      const record = normalizeRecord(value);
      if (!record) return { ok: false, warning: WARNINGS.invalid };
      const target = storageOrDefault(storage);
      const loaded = loadHistory(target);
      if (loaded.warning === WARNINGS.unavailable) return { ok: false, warning: loaded.warning };
      const records = loaded.records.filter(item => item.id !== record.id);
      records.push(record);
      records.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
      target.setItem(HISTORY_KEY, JSON.stringify(records));
      return { ok: true, warning: loaded.warning };
    } catch (error) { return { ok: false, warning: writeWarning(error) }; }
  }

  function clearSession(storage) {
    try {
      storageOrDefault(storage).removeItem(SESSION_KEY);
      return { ok: true, warning: null };
    } catch (error) { return { ok: false, warning: writeWarning(error) }; }
  }

  return Object.freeze({ createSession, normalizeSession, loadSession, saveSession, loadHistory, upsertHistory, clearSession });
});
