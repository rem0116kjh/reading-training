/* Rule checks only: these results do not assess meaning, grammar or writing quality. */
(function (root, factory) {
  'use strict';
  const feedback = factory();
  if (typeof module === 'object' && module.exports) module.exports = feedback;
  else root.TrainingFeedback = feedback;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const asText = value => typeof value === 'string' ? value : '';
  const stem = word => word.endsWith('하다') ? word.slice(0, -2) :
    word.endsWith('다') ? word.slice(0, -1) : word;
  const percent = (count, total) => total ? Math.round(count / total * 100) : 0;

  function generateWritingFeedback({text = '', keywords = []} = {}) {
    const writing = asText(text).trim();
    const terms = Array.isArray(keywords) ? keywords.filter(k => typeof k === 'string' && k.trim()) : [];
    const found = terms.map(k => {
      const base = stem(k);
      return {k, on: Boolean(base) && (writing.includes(base.replace(/\s+/g, '')) || writing.includes(base))};
    });
    return {
      provider: 'rule-based',
      local: {
        kw: percent(found.filter(item => item.on).length, found.length),
        len: writing.replace(/\s/g, '').length,
        sents: writing.split(/[.!?。]\s*/).filter(sentence => sentence.trim()).length
      },
      found,
      ai: null,
      note: '규칙 기반 지표입니다. 낱말 포함 여부와 글자·문장 수만 확인하며, 의미·문법·글의 완성도를 평가하지 않습니다.'
    };
  }

  function generateVocabularyFeedback({words = [], sentences = []} = {}) {
    const terms = Array.isArray(words) ? words : [];
    const writing = Array.isArray(sentences) ? sentences : [];
    return terms.map((value, index) => {
      const word = asText(value);
      const base = stem(word);
      return {
        word,
        contains: Boolean(base) && asText(writing[index]).includes(base),
        score: null,
        feedback: '규칙 기반: 낱말 포함 여부만 확인했어요.'
      };
    });
  }

  return Object.freeze({generateWritingFeedback, generateVocabularyFeedback});
});
