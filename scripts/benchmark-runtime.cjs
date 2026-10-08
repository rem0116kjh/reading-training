/* Deterministic runtime work counts in jsdom; these are not device FPS or load timings. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { JSDOM } = require('jsdom');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...source.matchAll(/<script\s+src="([^"]+)"\s*><\/script>/g)].map(match => match[1].split('?')[0]);
const dom = new JSDOM(source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''), {
  url: 'https://benchmark.test/', runScripts: 'outside-only', pretendToBeVisual: true
});
const { window } = dom, timers = [];
let clock = 0, writes = {}, formatters = 0;
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; };
window.setInterval = (callback, delay) => { timers.push({ callback, delay, last: clock }); return timers.length; };
Object.defineProperty(window.performance, 'now', { value: () => clock });
const setItem = window.Storage.prototype.setItem;
window.Storage.prototype.setItem = function (key, value) {
  writes[key] = (writes[key] || 0) + 1;
  return setItem.call(this, key, value);
};
const DateTimeFormat = window.Intl.DateTimeFormat;
window.Intl.DateTimeFormat = function (...args) { formatters++; return new DateTimeFormat(...args); };
const context = dom.getInternalVMContext();
for (const name of scripts) vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context, { filename: name });
const observer = new window.MutationObserver(() => {});
observer.observe(window.document.body, { subtree: true, childList: true, attributes: true, characterData: true });
const click = id => window.document.getElementById(id).click();
function advance(ms) {
  const end = clock + ms;
  while (clock < end) {
    clock = Math.min(end, clock + 100);
    for (const timer of timers) if (clock - timer.last >= timer.delay) { timer.last = clock; timer.callback(); }
  }
}
const measurements = [];
function measure(name, action) {
  observer.takeRecords(); writes = {}; formatters = 0;
  const started = performance.now(); action();
  measurements.push({ name, elapsedMs: +(performance.now() - started).toFixed(2),
    storageWrites: { ...writes }, domMutations: observer.takeRecords().length, dateFormatters: formatters });
}
try {
  measure('home-30s', () => advance(30000));
  window.AreaTraining.startFluency();
  measure('before-reading-start-30s', () => advance(30000));
  click('activity-main');
  measure('tap-reading-10s', () => advance(10000));
  click('activity-skip-read'); click('activity-main');
  measure('paced-reading-10s', () => advance(10000));
  click('menu-button');
  measure('menu-paused-10s', () => advance(10000));
  click('menu-close'); click('activity-skip-read');
  const { task } = window.AreaTraining.getCurrent();
  task.blanks.forEach((blank, index) => {
    const input = window.document.getElementById('fluency-cloze-answer-' + index);
    input.value = blank.answer; input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  click('activity-main'); click('activity-main');
  const completed = JSON.parse(JSON.stringify(window.AreaTraining.getSession()));
  const records = Array.from({ length: 200 }, (_, index) => ({ ...completed, id: 'benchmark-' + index }));
  window.localStorage.setItem('areaTrainingHistory.v1', JSON.stringify(records));
  measure('home-with-200-records', () => window.TrainingUI.showHome(false));
  console.log(JSON.stringify({ source: root, scope: 'synthetic jsdom work counts', measurements }, null, 2));
} finally { observer.disconnect(); dom.window.close(); }
