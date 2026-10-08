/* Source/built-page journeys and responsive unified home in isolated Chrome contexts. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BASE = process.env.QA_BASE_URL || 'http://127.0.0.1:4173/';
const OUT = path.resolve(process.env.QA_ARTIFACT_DIR || 'docs/optimization');
const evidence = { base: BASE, layouts: [], journeys: [], errors: [], requestFailures: [] };
fs.mkdirSync(OUT, { recursive: true });
const current = page => page.evaluate(() => AreaTraining.getCurrent());
const session = page => page.evaluate(() => AreaTraining.getSession());
const main = page => page.locator('#activity-main').click();
async function solve(page) {
  if (await page.locator('.vocabulary-study').count()) await main(page);
  const { task } = await current(page);
  if (task.kind === 'read') { await page.locator('#activity-skip-read').click(); return; }
  if (task.kind === 'practice') {
    for (let i = 0; i < task.prompts.length; i++) await page.locator('#vocabulary-compose-' + i).fill('소금을 만들 때 햇볕이 중요한 역할을 해요.');
  } else if (task.kind === 'cloze') {
    for (let i = 0; i < task.blanks.length; i++) await page.locator('#fluency-cloze-answer-' + i).fill(task.blanks[i].answer);
  } else if (task.kind === 'selection') {
    let offset = 0;
    for (let group = 0; group < task.groups.length; group++) {
      for (let i = 0; i < task.groups[group].capacity; i++) {
        const id = task.answer[offset++];
        if (task.display === 'sentence-roles') {
          await page.locator('#reading-role-sentence-' + id).click(); await page.locator('#reading-role-' + group).click();
        } else if (task.selectionType === 'key') await page.locator('#reading-key-' + id).click();
        else {
          await page.locator('#reading-outline-sentence-' + id).click();
          await page.locator('#reading-outline-slot-' + (offset - i - 1)).click();
        }
      }
    }
  } else if (task.kind === 'summary') await page.locator('#reading-summary-answer').fill(task.source);
  else if (task.kind === 'recall') {
    await page.locator('#reading-recall-answer').fill(task.answer); await page.locator('#reading-recall-confidence').selectOption('sure');
  } else {
    assert.equal(task.kind, 'choice'); await page.locator('#activity-option-' + task.answer).check();
  }
  await main(page); await main(page);
}
async function finish(page, resumeStages = false) {
  let count = 0;
  const stages = [], labels = ['1단계 · 어휘력', '2단계 · 지문 1', '3단계 · 지문 2'];
  while ((await session(page)).status === 'active' && count++ < 100) {
    const area = await page.evaluate(() => AreaTraining.currentArea());
    if (resumeStages && stages.at(-1) !== area) {
      stages.push(area);
      assert.equal(await page.locator('.course-steps [aria-current="step"]').innerText(), labels[stages.length - 1]);
      await page.locator('#activity-home').click();
      assert.equal(await page.locator('#course-status').innerText(), `${stages.length}단계 진행 중`);
      const saved = await session(page);
      await page.reload();
      await page.locator('#home-full-start').focus(); await page.keyboard.press('Enter');
      const resumed = await session(page);
      assert.equal(resumed.id, saved.id); assert.equal(resumed.cursor, saved.cursor);
      assert.deepEqual(resumed.answers, saved.answers); assert.deepEqual(resumed.submitted, saved.submitted);
      for (const [key, read] of Object.entries(saved.read)) {
        for (const field of ['position', 'started', 'done', 'skipped']) assert.equal(resumed.read[key][field], read[field]);
      }
      assert.equal(await page.locator('#confirm-dialog').evaluate(node => node.open), false);
    }
    await solve(page);
  }
  assert.equal((await session(page)).status, 'completed');
  assert.equal((await page.evaluate(() => AreaTraining.results(AreaTraining.getSession()))).accuracy, 100);
  if (resumeStages) assert.deepEqual(stages, ['vocabulary', 'fluency', 'reading']);
  return stages;
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  evidence.browser = await browser.version();
  async function open(url, width) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', error => evidence.errors.push({ url, error: String(error) }));
    page.on('requestfailed', request => evidence.requestFailures.push({ url: request.url(), error: request.failure().errorText }));
    await page.goto(url); await page.locator('#home-panel').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => !!window.AreaTraining), true);
    await page.evaluate(() => document.fonts.ready);
    return { context, page };
  }
  try {
    for (const width of [320, 768, 1440]) {
      let sourceGeometry;
      for (const [name, url] of [['source', BASE], ['built', new URL('dist/index.html', BASE).href]]) {
        const { context, page } = await open(url, width);
        assert.equal(await page.locator('.course-start-card').count(), 1);
        assert.equal(await page.locator('#start-fluency, #start-vocabulary, #start-reading, #home-first-start').count(), 0);
        assert.deepEqual(await page.locator('.course-stage-list h3').allTextContents(), ['어휘력', '지문 1', '지문 2']);
        assert.match(await page.locator('#home-full-start').innerText(), /맞춤형 훈련 시작/);
        const geometry = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth,
          cards: [...document.querySelectorAll('.course-start-card')].map(node => {
            const { x, y, width, height } = node.getBoundingClientRect();
            return { x, y, width, height, font: getComputedStyle(node).fontFamily };
          }) }));
        assert.equal(geometry.overflow, false);
        if (name === 'source') sourceGeometry = geometry;
        else assert.deepEqual(geometry, sourceGeometry, 'built home matches the source at every width');
        evidence.layouts.push({ name, width, ...geometry });
        await page.screenshot({ path: path.join(OUT, `home-${name}-${width}.png`), fullPage: true });
        await context.close();
      }
    }
    for (const [name, url] of [['source', BASE], ['built', new URL('dist/index.html', BASE).href]]) {
      const { context, page } = await open(url, 390);
      await page.evaluate(() => AreaTraining.startFluency()); await main(page); await main(page);
      assert.equal((await session(page)).read[(await current(page)).entry.key].position, 1);
      await page.locator('#activity-skip-read').click(); await main(page);
      await page.waitForFunction(() => { const { entry } = AreaTraining.getCurrent(); return AreaTraining.getSession().read[entry.key].position >= 3; });
      const displayed = await page.locator('.fluency-phrase.is-current').innerText();
      const paced = await current(page), position = (await session(page)).read[paced.entry.key].position;
      assert.equal(displayed, paced.task.units[position]);
      await page.locator('#menu-button').click();
      const paused = (await session(page)).elapsedMs;
      await page.waitForTimeout(1300); assert.equal((await session(page)).elapsedMs, paused);
      await page.locator('#menu-close').click(); await page.locator('#fluency-play').click();
      await page.locator('#activity-skip-read').click();
      await page.locator('#fluency-cloze-answer-0').fill((await current(page)).task.blanks[0].answer);
      await page.reload(); await page.locator('#home-continue').click();
      assert.equal(await page.locator('#fluency-cloze-answer-0').inputValue(), (await current(page)).task.blanks[0].answer);
      await finish(page);
      const fluency = await session(page);
      await page.locator('#activity-home').click(); await page.locator('#home-full-start').click();
      const stages = await finish(page, true);
      const result = await page.evaluate(() => AreaTraining.results(AreaTraining.getSession()));
      assert.equal((await page.evaluate(() => AreaTraining.records())).length, 2);
      assert.equal(await page.evaluate(id => AreaTraining.records().find(record => record.id === id).session.id, fluency.id), fluency.id);
      await page.screenshot({ path: path.join(OUT, `course-${name}-390.png`), fullPage: true });
      evidence.journeys.push({ name, fluencyScore: 100, fullCourseScore: result.accuracy, questions: result.totalQuestions,
        stages, reloadedEachStage: true, keyboardResume: true, draftReloaded: true, menuPaused: true, completedRecords: 2 });
      await page.locator('#activity-home').click();
      assert.equal(await page.locator('#today-progress').evaluate(node => node.value), 3);
      await page.locator('#home-full-start').click();
      assert.equal(await page.evaluate(() => AreaTraining.currentArea()), 'vocabulary');
      assert.equal((await page.evaluate(() => AreaTraining.records())).length, 2);
      await context.close();
    }
    assert.deepEqual(evidence.errors, []);
    assert.deepEqual(evidence.requestFailures, []);
    evidence.passed = true;
    console.log(JSON.stringify({ passed: true, layouts: evidence.layouts.length, journeys: evidence.journeys }));
  } finally {
    fs.writeFileSync(path.join(OUT, 'optimization-browser-results.json'), JSON.stringify(evidence, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
