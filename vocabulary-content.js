/* Reuse the public Artifact's exact vocabulary questions. Keep old catalogs for saved sessions. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VocabularyContent = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const CURRENT_AREAS = Object.freeze({ vocabulary: 'vocabularyReadinV1', course: 'courseVocabularyReadinV1' });
  const WORDS = ['증발하다', '증발하다', '역할', '방법', '굳다'];
  const TYPES = ['meaning', 'context', 'context', 'synonym', 'usage'];
  const EXPLANATIONS = [
    '‘증발하다’는 액체가 기체로 변하는 것을 말해요. 바닷물의 물이 증발하면 소금이 남아요.',
    '햇볕에 말리면 물이 증발하고 소금이 남아요. 따라서 문맥에 맞는 말은 ‘증발하고’예요.',
    '‘역할’은 맡아서 하는 일을 뜻해요. 소금은 음식이 오래 보관되게 하는 역할을 해요.',
    '‘방법’과 ‘방식’은 어떤 일을 해 나가는 수단이나 형식을 나타내는 비슷한 말이에요.',
    '‘굳다’는 부드러운 것이 단단해지는 것을 말해요. 햇볕을 받은 얼음에는 ‘녹았어요’가 알맞아요.'
  ];
  function extend(catalog, pkg, currentCourse) {
    if (pkg.vquiz.length !== 5 || !catalog[currentCourse]?.integrated) throw new TypeError('원본 어휘 5문항과 현재 전체 과정이 필요합니다.');
    const vocabulary = {
      label: '어휘력', trainingArea: 'vocabulary', metrics: true, passageId: 'salt-original-v1',
      vocabularyVersion: 'readin-original-v1',
      retryVocabulary: false,
      note: '뜻·문맥·비슷한 말·낱말 쓰임을 확인해요.',
      uniqueWordCount: pkg.vocab.length,
      words: catalog.vocabulary.words.map(word => ({ ...word,
        ...(word.word === '녹다' ? { contextNote: '이 예문에서는 소금이 물에 풀어져 섞인다는 뜻으로 쓰였어요.' } : {})
      })),
      tasks: [
        ...pkg.vquiz.map((question, index) => ({
          id: 'salt-vocabulary-original-' + (index + 1), kind: 'choice', trainingArea: 'vocabulary',
          label: question.k, title: question.k, phase: '활용 문제', quizType: TYPES[index],
          question: question.q, options: question.o.slice(), answer: question.a,
          word: WORDS[index], explanation: EXPLANATIONS[index], source: EXPLANATIONS[index],
          sourceRef: 'vquiz.' + index
        })),
        {
          id: 'salt-vocabulary-compose', kind: 'practice', trainingArea: 'vocabulary',
          label: '낱말로 문장 만들기', title: '낱말로 문장 만들기', phase: '어휘 적용 연습',
          question: '각 칸에 자유롭게 써 보세요.',
          prompts: pkg.compose.map(word => {
            const original = pkg.vocab.find(item => item.word === word);
            return { word, meaning: original.meaning };
          }), sourceRef: 'compose',
          source: '각 칸에 내용이 있으면 저장하는 자유 입력 연습입니다. 정답률에 포함하지 않습니다.'
        }
      ]
    };
    // Replace only the vocabulary segment. Fluency and reading task objects stay identical.
    const course = { ...catalog[currentCourse], ...{
      vocabularyVersion: vocabulary.vocabularyVersion, words: vocabulary.words, note: vocabulary.note,
      retryVocabulary: vocabulary.retryVocabulary,
      tasks: [...vocabulary.tasks, ...catalog[currentCourse].tasks.filter(task => task.trainingArea !== 'vocabulary')]
    } };
    return { ...catalog, [CURRENT_AREAS.vocabulary]: vocabulary, [CURRENT_AREAS.course]: course };
  }
  return Object.freeze({ extend, CURRENT_AREAS });
});
