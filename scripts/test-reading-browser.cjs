/* Run against a local preview with Playwright and an installed Chrome.
 * NODE_PATH can point to the Codex bundled node_modules; no app dependency is added.
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BASE = process.env.QA_BASE_URL || 'http://127.0.0.1:4173/';
const OUT = path.resolve(process.env.QA_ARTIFACT_DIR || 'docs/reading-comprehension');
const ANSWERS = [1, 2, 1, 2, 1, 1, 1];
const ANSWER_TEXT = ['소금', '염전', '햇볕에 말린다', '암염 광산', '맛을 내고 음식을 오래 보관한다',
  '물이 잘 증발해야 소금이 남기 때문에', '그곳은 아주 오래전에 바다였다'];
const evidence = { url: BASE, runs: [], consoleErrors: [], failedRequests: [] };
fs.mkdirSync(OUT, { recursive: true });

async function current(page) {
  return page.evaluate(() => {
    return AreaTraining.getCurrent();
  });
}
const result = page => page.evaluate(() => AreaTraining.results(AreaTraining.getSession()));
const session = page => page.evaluate(() => AreaTraining.getSession());
const main = page => page.locator('#activity-main').click();

async function solve(page, wrong = false) {
  const { task } = await current(page);
  if (task.kind === 'read') {
    if (task.stage) await page.locator('#activity-skip-read').click();
    else { await page.locator('.activity-passage').scrollIntoViewIfNeeded(); await main(page); }
    return task;
  }
  if (task.kind === 'order') {
    for (const id of task.answer) await page.locator(`[data-paragraph="${id}"]`).click();
  } else if (task.kind === 'relations') {
    for (let i = 0; i < task.answer.length; i++) {
      await page.locator('#activity-structure-slot-' + i).click();
      await page.locator('#activity-structure-choice-' + task.answer[i]).click();
    }
  } else if (task.kind === 'recall') {
    await page.locator('#reading-recall-answer').fill(task.answer);
    await page.locator('#reading-recall-confidence').selectOption('sure');
  } else if (task.kind === 'selection') {
    if (task.display === 'sentence-roles') {
      let offset = 0;
      for (let group = 0; group < task.groups.length; group++) {
        for (let i = 0; i < task.groups[group].capacity; i++) {
          await page.locator('#reading-role-sentence-' + task.answer[offset++]).click();
          await page.locator('#reading-role-' + group).click();
        }
      }
    } else if (task.selectionType === 'key') {
      for (const id of task.answer) await page.locator('#reading-key-' + id).click();
    } else {
      let offset = 0;
      for (const group of task.groups) {
        const start = offset;
        for (let i = 0; i < group.capacity; i++) {
          await page.locator('#reading-outline-sentence-' + task.answer[offset++]).click();
          await page.locator('#reading-outline-slot-' + start).click();
        }
      }
    }
  } else if (task.kind === 'summary') {
    await page.locator('#reading-summary-answer').fill(task.source);
  } else if (task.kind === 'practice') {
    for (let i = 0; i < task.prompts.length; i++) await page.locator('#vocabulary-compose-' + i).fill('소금이 굳었어요. 소금은 중요한 역할을 해요.');
  } else if (task.kind === 'cloze') {
    for (let i = 0; i < task.blanks.length; i++) {
      await page.locator('#fluency-cloze-answer-' + i).fill(task.blanks[i].answer);
      await page.locator(`#fluency-cloze-${i}-sure`).check();
    }
  } else {
    const answer = task.comprehensionType ? ANSWERS[task.questionNumber - 1] : task.answer;
    if (task.comprehensionType) assert.equal(task.options[answer], ANSWER_TEXT[task.questionNumber - 1]);
    await page.locator('#activity-option-' + (wrong ? (answer + 1) % task.options.length : answer)).check();
  }
  await main(page);
  await main(page);
  return task;
}

async function finish(page, wrongIds = []) {
  const seen = [];
  for (let i = 0; i < 100 && (await session(page)).status === 'active'; i++) {
    const { task } = await current(page);
    seen.push(await solve(page, wrongIds.includes(task.id)));
  }
  assert.equal((await session(page)).status, 'completed');
  return seen;
}

async function open(browser, viewport, name) {
  const context = await browser.newContext({ viewport, isMobile: viewport.width < 768, hasTouch: viewport.width < 768 });
  const page = await context.newPage();
  page.on('pageerror', error => evidence.consoleErrors.push({ name, error: String(error) }));
  page.on('console', message => { if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) evidence.consoleErrors.push({ name, error: message.text(), location: message.location() }); });
  page.on('requestfailed', request => evidence.failedRequests.push({ name, url: request.url(), error: request.failure().errorText }));
  page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) evidence.failedRequests.push({ name, url: response.url(), status: response.status() }); });
  await page.goto(BASE); await page.locator('#home-full-start').waitFor();
  // Reading-only QA sets up its fixture through the retained area API.
  await page.evaluate(() => AreaTraining.startReading());
  await page.locator('.activity-passage').waitFor();
  // Finish the real reading activity rather than using its skip control.
  await page.locator('.activity-passage p').last().scrollIntoViewIfNeeded();
  await main(page);
  while (!(await current(page)).task.comprehensionType) await solve(page);
  return { page, context };
}

async function layout(page, width) {
  const geometry = await page.evaluate(() => {
    const passage = document.querySelector('.reading-reference-text'), reference = document.querySelector('#reading-reference');
    const question = document.querySelector('.reading-question-column');
    const bounds = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, right: r.right }; };
    return { reference: bounds(reference), question: bounds(question), paragraphs: passage.querySelectorAll('.reading-role-paragraph').length || passage.querySelectorAll('p').length,
      overflow: document.documentElement.scrollWidth > innerWidth, independentScroll: getComputedStyle(passage).overflowY,
      clientHeight: passage.clientHeight, scrollHeight: passage.scrollHeight, open: reference.open };
  });
  assert.equal(geometry.paragraphs, 4); assert.equal(geometry.overflow, false);
  assert.equal(geometry.independentScroll, 'auto');
  assert.ok(geometry.scrollHeight > geometry.clientHeight);
  if (width >= 768) { assert.ok(geometry.reference.right <= geometry.question.x); assert.equal(geometry.open, true); }
  else assert.ok(geometry.question.y > geometry.reference.y);
  return geometry;
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.QA_HEADED });
  evidence.browser = await browser.version();
  try {
    const { page, context } = await open(browser, { width: 1440, height: 1000 }, 'desktop');
    const geometry = await layout(page, 1440);
    console.log('Desktop geometry:', JSON.stringify(geometry));
    await page.screenshot({ path: path.join(OUT, 'desktop-question.png'), fullPage: true });
    await page.locator('.reading-reference-text').focus(); await page.keyboard.press('End');
    console.log('Passage focus:', await page.locator('.reading-reference-text').evaluate(node => ({ active: document.activeElement === node, scroll: node.scrollTop })));
    // Keyboard scrolling is animated; capture its final position before testing preservation.
    await page.waitForFunction(() => {
      const passage = document.querySelector('.reading-reference-text');
      return passage.scrollTop === passage.scrollHeight - passage.clientHeight;
    });
    const referenceTop = await page.locator('.reading-reference-text').evaluate(node => node.scrollTop);
    assert.ok(referenceTop > 0, 'passage scrolls through keyboard navigation');
    await page.evaluate(() => { window.__readingReferenceBefore = document.querySelector('#reading-reference'); });
    const seen = [];
    for (let i = 0; i < 4; i++) {
      const { task } = await current(page); seen.push(task);
      assert.equal(task.questionNumber, i + 1);
      assert.match(await page.locator('.activity-header').innerText(), new RegExp(`${i + 1} / 7문항`));
      await solve(page);
      assert.equal(await page.evaluate(() => window.__readingReferenceBefore === document.querySelector('#reading-reference')), true);
      assert.equal(await page.locator('.reading-reference-text').evaluate(node => node.scrollTop), referenceTop);
    }
    const beforeReload = await session(page);
    await page.reload(); await page.locator('#home-continue').click();
    assert.equal((await current(page)).task.id, 'reading-content-5');
    assert.deepEqual((await session(page)).answers, beforeReload.answers);
    // Save an unsubmitted fifth choice and reload again.
    await page.locator('#activity-option-1').check(); await page.reload(); await page.locator('#home-continue').click();
    assert.equal(await page.locator('#activity-option-1').isChecked(), true);
    assert.equal((await current(page)).task.id, 'reading-content-5');
    for (let i = 4; i < 7; i++) {
      const { task } = await current(page); seen.push(task);
      assert.equal(task.questionNumber, i + 1);
      assert.equal(await page.locator('.reading-question-type').innerText(), i < 5 ? '[사실적 이해]' : '[추론적 이해]');
      await solve(page, i === 5);
    }
    const remaining = await finish(page);
    assert.deepEqual(remaining.map(t => t.id), ['reading-outline', 'reading-summary']);
    assert.equal(seen.length, 7); assert.equal(new Set(seen.map(t => t.id)).size, 7);
    assert.equal(seen.filter(t => t.comprehensionType === 'fact').length, 5);
    assert.equal(seen.filter(t => t.comprehensionType === 'inference').length, 2);
    const score = await result(page), original = await page.evaluate(() => AreaTraining.records()[0]);
    assert.deepEqual(score.comprehension, { correct: 6, total: 7, answered: 7,
      fact: { correct: 5, total: 5, answered: 5 }, inference: { correct: 1, total: 2, answered: 2 } });
    assert.equal(score.totalQuestions, 9); assert.equal(score.wrong, 1);
    assert.deepEqual(await page.locator('#reading-comprehension-result td').allTextContents(), ['6 / 7', '5 / 5', '1 / 2']);
    await page.screenshot({ path: path.join(OUT, 'desktop-result.png'), fullPage: true });
    await page.locator('#activity-retry-wrong').click();
    assert.deepEqual((await session(page)).taskIds, ['reading-content-6']);
    assert.equal(await page.locator('#reading-reference').isVisible(), true);
    await page.locator('#activity-option-1').check(); await page.reload(); await page.locator('#home-continue').click();
    assert.equal(await page.locator('#activity-option-1').isChecked(), true);
    await finish(page);
    assert.equal((await result(page)).comprehension.correct, 1);
    assert.deepEqual(await page.evaluate(id => AreaTraining.records().find(r => r.id === id), original.id), original);
    await page.screenshot({ path: path.join(OUT, 'wrong-review-result.png'), fullPage: true });
    evidence.runs.push({ name: 'desktop', geometry, questions: seen.map(t => ({ id: t.id, type: t.typeLabel, answer: t.options[t.answer] })),
      resumeAt: 'reading-content-5', score, reviewTaskIds: ['reading-content-6'], originalUnchanged: true });
    await context.close();

    for (const width of [375, 320, 768]) {
      const { page, context } = await open(browser, { width, height: 900 }, 'width-' + width);
      const geometry = await layout(page, width);
      await page.screenshot({ path: path.join(OUT, `question-${width}.png`), fullPage: true });
      if (width < 768) {
        await page.locator('#reading-reference summary').click();
        assert.equal(await page.locator('.reading-reference-text').isVisible(), false);
        await solve(page);
        assert.equal(await page.locator('.reading-reference-text').isVisible(), false);
        await page.locator('#reading-reference summary').click();
        assert.equal(await page.locator('.reading-reference-text').isVisible(), true);
        await page.locator('.reading-reference-text').evaluate(node => { node.scrollTop = 100; });
        const scroll = await page.locator('.reading-reference-text').evaluate(node => node.scrollTop);
        await solve(page); assert.equal(await page.locator('.reading-reference-text').evaluate(node => node.scrollTop), scroll);
        await page.reload(); await page.locator('#home-continue').click();
        assert.equal((await current(page)).task.id, 'reading-content-3');
      }
      const seen = await finish(page);
      assert.equal((await result(page)).comprehension.correct, 7);
      assert.equal((await result(page)).comprehension.fact.correct, 5);
      assert.equal((await result(page)).comprehension.inference.correct, 2);
      assert.equal((await result(page)).accuracy, 100);
      await page.screenshot({ path: path.join(OUT, `result-${width}.png`), fullPage: true });
      evidence.runs.push({ name: 'width-' + width, geometry, completed: true, score: await result(page), remainingTasks: seen.map(t => t.id) });
      await context.close();
    }
    assert.deepEqual(evidence.consoleErrors, []); assert.deepEqual(evidence.failedRequests, []);
    evidence.passed = true;
    fs.writeFileSync(path.join(OUT, 'browser-results.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ passed: true, browser: evidence.browser, runs: evidence.runs.map(r => r.name), artifactDir: OUT }));
  } finally { await browser.close(); }
})().catch(error => { evidence.passed = false; evidence.error = String(error.stack || error); fs.writeFileSync(path.join(OUT, 'browser-results.json'), JSON.stringify(evidence, null, 2)); console.error(error); process.exitCode = 1; });
