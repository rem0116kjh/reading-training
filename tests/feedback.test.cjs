'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const feedback = require('../feedback.js');

test('Korean stems and spaced concepts preserve existing rule matching', () => {
  const result = feedback.generateWritingFeedback({
    text: '물이 증발하고 소금이 굳어요. 중심문장을 골라요!',
    keywords: ['증발하다', '굳다', '중심 문장', '역할']
  });
  assert.deepEqual(result.found, [
    {k: '증발하다', on: true}, {k: '굳다', on: true},
    {k: '중심 문장', on: true}, {k: '역할', on: false}
  ]);
  assert.equal(result.local.kw, 75);
  assert.equal(result.local.sents, 2);
  assert.equal(result.local.len, '물이증발하고소금이굳어요.중심문장을골라요!'.length);
});

test('empty writing and empty keyword lists produce finite zero metrics', () => {
  assert.deepEqual(feedback.generateWritingFeedback().local, {kw: 0, len: 0, sents: 0});
  const result = feedback.generateWritingFeedback({text: ' \n\t ', keywords: ['소금']});
  assert.deepEqual(result.local, {kw: 0, len: 0, sents: 0});
  assert.deepEqual(result.found, [{k: '소금', on: false}]);
});

test('fallback checks are explicitly not semantic or AI scores', () => {
  const result = feedback.generateWritingFeedback({text: '역할 역할 역할。', keywords: ['역할']});
  assert.equal(result.provider, 'rule-based');
  assert.equal(result.ai, null);
  assert.equal(result.local.kw, 100);
  assert.equal(result.local.sents, 1);
  assert.match(result.note, /의미·문법·글의 완성도를 평가하지 않습니다/);
  const composed = feedback.generateVocabularyFeedback({
    words: ['굳다', '역할'], sentences: ['굳굳굳', '소금이 있어요.']
  });
  assert.equal(composed[0].contains, true);
  assert.equal(composed[1].contains, false);
  assert.equal(composed[0].score, null);
  assert.equal(composed[1].score, null);
  assert.ok(composed.every(item => item.feedback.startsWith('규칙 기반:')));
});

test('missing answers stay missing instead of becoming a positive match', () => {
  assert.deepEqual(feedback.generateVocabularyFeedback({words: ['굳다']}), [{
    word: '굳다', contains: false, score: null,
    feedback: '규칙 기반: 낱말 포함 여부만 확인했어요.'
  }]);
  assert.equal(feedback.generateVocabularyFeedback({words: [''], sentences: ['아무 글']})[0].contains, false);
});

test('standalone browser script exposes the same synchronous interface', () => {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../feedback.js'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.TrainingFeedback.generateWritingFeedback, 'function');
  assert.equal(typeof sandbox.TrainingFeedback.generateVocabularyFeedback, 'function');
  assert.equal(sandbox.TrainingFeedback.generateWritingFeedback().provider, 'rule-based');
});
