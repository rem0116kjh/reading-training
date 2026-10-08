/* Remove paragraph ordering, structure questions and relation maps from current learning while keeping completed records readable. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReadingFlow = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const REMOVED_TASKS = new Set(['reading-order', 'reading-structure', 'reading-relations']);
  const areaWithoutOrder = area => area + 'NoOrderV1';
  const areaWithoutStructure = area => area.replace(/NoOrderV1$/, '') + 'NoStructureV2';
  function currentArea(area, catalog) {
    const nextArea = areaWithoutStructure(area);
    return catalog[nextArea] ? nextArea : area;
  }
  function extend(catalog, areas) {
    const retained = { ...catalog };
    // These seven-question catalogs existed before comprehension became a separate module.
    if (!retained.readingReadinV3) retained.readingReadinV3 = { ...catalog[areas.reading], readingVersion: 'readin-v3' };
    if (!retained.courseReadingReadinV3 && catalog.courseReadingReadinV2) {
      const questions = catalog[areas.reading].tasks.filter(task => task.id.startsWith('reading-content-'));
      retained.courseReadingReadinV3 = { ...catalog.courseReadingReadinV2, readingVersion: 'readin-v3',
        tasks: catalog.courseReadingReadinV2.tasks.flatMap(task => task.id === 'reading-content-1' ? questions : task.id.startsWith('reading-content-') ? [] : [task]) };
    }
    const currentAreas = { ...areas };
    for (const area of new Set([areas.reading, areas.course, 'readingReadinV3', 'courseReadingReadinV3'])) {
      const definition = retained[area];
      if (!definition?.tasks.some(task => task.id === 'reading-order')) continue;
      const nextArea = areaWithoutOrder(area);
      retained[nextArea] = { ...definition, readingFlowVersion: 'no-order-v1',
        tasks: definition.tasks.filter(task => task.id !== 'reading-order') };

    }
    for (const [area, definition] of Object.entries(retained)) {
      if (!definition.tasks.some(task => REMOVED_TASKS.has(task.id))) continue;
      const nextArea = areaWithoutStructure(area);
      retained[nextArea] = { ...definition, trainingArea: definition.trainingArea || (definition.integrated ? undefined : 'reading'), readingFlowVersion: 'no-structure-v2',
        tasks: definition.tasks.filter(task => !REMOVED_TASKS.has(task.id)) };
    }
    for (const key of ['reading', 'course']) currentAreas[key] = currentArea(areas[key], retained);
    return { catalog: retained, currentAreas };
  }
  function migrate(session, catalog, engine) {
    if (!session || session.status !== 'active' || !session.taskIds.some(id => REMOVED_TASKS.has(id))) return session;
    const area = currentArea(session.area, catalog);
    if (area === session.area) return session;
    const taskIds = session.taskIds.filter(id => !REMOVED_TASKS.has(id));
    if (!taskIds.length) {
      // A review containing only removed activities continues with passage comprehension.
      const questions = catalog[area].tasks.filter(task => task.id.startsWith('reading-content-')).map(task => task.id);
      if (!questions.length) return session;
      const next = engine.newSession(area, { id: session.id, startedAt: session.startedAt, reviewOf: session.reviewOf, taskIds: questions });
      next.elapsedMs = session.elapsedMs;
      if (next.metrics && session.metrics) next.metrics.areaMs = { ...session.metrics.areaMs };
      return engine.normalize(next) || session;
    }
    const next = JSON.parse(JSON.stringify(session));
    next.area = area; next.taskIds = taskIds;
    const entries = session.queue.filter(entry => !REMOVED_TASKS.has(entry.taskId));
    const keys = new Map(entries.map(entry => [entry.key, entry.retryOf ? entry.key : 'base-' + (taskIds.indexOf(entry.taskId) + 1)]));
    next.queue = entries.map(entry => ({ ...entry, key: keys.get(entry.key), retryOf: entry.retryOf ? keys.get(entry.retryOf) : null }));
    for (const field of ['answers', 'submitted', 'read']) {
      next[field] = Object.fromEntries(Object.entries(next[field]).filter(([key]) => keys.has(key)).map(([key, value]) => [keys.get(key), value]));
    }
    if (next.metrics) next.metrics.responseMs = Object.fromEntries(Object.entries(next.metrics.responseMs).filter(([key]) => keys.has(key)).map(([key, value]) => [keys.get(key), value]));
    const following = session.queue.slice(session.cursor).find(entry => keys.has(entry.key));
    next.cursor = following ? next.queue.findIndex(entry => entry.key === keys.get(following.key)) : next.queue.length - 1;
    return engine.normalize(next) || session;
  }
  return Object.freeze({ extend, migrate, currentArea });
});
