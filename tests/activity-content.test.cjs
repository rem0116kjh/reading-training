'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createCatalog } = require('../activity-content.js');

const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const pkg = JSON.parse(JSON.stringify(vm.runInNewContext(source.slice(0, source.indexOf('const SENT =')) + '\nPKG;')));

test('fluency has three reading activities, each followed by one unchanged quiz', () => {
  const { tasks } = createCatalog(pkg).fluency;
  assert.equal(tasks.length, 6);
  assert.deepEqual(tasks.filter(task => task.kind === 'read').map(task => task.mode), ['normal', 'speed', 'auto']);
  [pkg.vquiz[1], pkg.questions[2], pkg.questions[6]].forEach((question, index) => {
    assert.deepEqual([tasks[index * 2 + 1].question, tasks[index * 2 + 1].options, tasks[index * 2 + 1].answer], [question.q, question.o, question.a]);
  });
});

test('vocabulary provides 16 meaning and 16 sentence choices from only the ten existing words', () => {
  const { tasks, uniqueWordCount } = createCatalog(pkg).vocabulary;
  assert.equal(tasks.length, 32);
  assert.equal(uniqueWordCount, 10);
  for (const phase of ['뜻 맞추기', '단어 맞추기']) {
    const questions = tasks.filter(task => task.phase === phase);
    assert.equal(questions.length, 16);
    assert.equal(new Set(questions.map(task => task.word)).size, 10);
    assert.equal(questions.filter(task => task.review).length, 6);
    questions.forEach(task => {
      const original = pkg.vocab.find(word => word.word === task.word);
      assert.equal(task.meaning, original.meaning);
      assert.equal(task.options.length, 4);
      assert.equal(new Set(task.options).size, 4);
      assert.equal(task.options[task.answer], phase === '뜻 맞추기' ? original.meaning : original.word);
      assert.ok(task.options.every(option => pkg.vocab.some(word => (phase === '뜻 맞추기' ? word.meaning : word.word) === option)));
    });
  }
});

test('sentence questions use actual passage sentences and mask the correct inflected expression', () => {
  const sentences = pkg.paragraphs.flatMap(paragraph => paragraph.s);
  createCatalog(pkg).vocabulary.tasks.filter(task => task.phase === '단어 맞추기').forEach(task => {
    assert.ok(sentences.includes(task.sourceSentence));
    assert.equal(task.maskedSentence.replace('(    )', task.answerForm), task.sourceSentence);
    assert.equal(task.maskedSentence.includes(task.answerForm), false);
    assert.ok(task.question.includes(task.maskedSentence));
  });
});

test('reading has one passage, one order, one structure and four original content questions', () => {
  const { tasks } = createCatalog(pkg).reading;
  assert.equal(tasks.length, 7);
  assert.equal(tasks.filter(task => task.kind === 'read').length, 1);
  assert.deepEqual(tasks[0].paragraphs, pkg.paragraphs);
  const order = tasks.find(task => task.kind === 'order');
  assert.notDeepEqual(order.paragraphs.map(paragraph => paragraph.id), order.answer);
  assert.deepEqual(order.answer.map(id => order.paragraphs.find(paragraph => paragraph.id === id).text), pkg.paragraphs.map(paragraph => paragraph.s.join(' ')));
  const structure = tasks.find(task => task.id === 'reading-structure');
  assert.equal(structure.options[structure.answer], pkg.paragraphs.map(paragraph => paragraph.role).join(' → '));
  tasks.slice(3).forEach((task, index) => {
    assert.deepEqual([task.question, task.options, task.answer], [pkg.questions[index].q, pkg.questions[index].o, pkg.questions[index].a]);
  });
});

test('catalog creation is deterministic, has unique ids, and does not mutate source data', () => {
  const before = JSON.stringify(pkg);
  const first = createCatalog(pkg);
  assert.deepEqual(first, createCatalog(pkg));
  const tasks = Object.values(first).flatMap(area => area.tasks);
  assert.equal(new Set(tasks.map(task => task.id)).size, tasks.length);
  first.fluency.tasks[0].paragraphs[0].s[0] = 'changed';
  first.fluency.tasks[1].options[0] = 'changed';
  assert.equal(JSON.stringify(pkg), before);
});

test('standalone script exposes ActivityContent without a module loader', () => {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../activity-content.js'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.ActivityContent.createCatalog, 'function');
  assert.equal(sandbox.ActivityContent.createCatalog(pkg).vocabulary.tasks.length, 32);
});
