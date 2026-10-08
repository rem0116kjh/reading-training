(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ActivityContent = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PASSAGE_TITLE = '소금은 어디에서 올까';
  const VERB_FORMS = { '녹다': '녹아', '굳다': '굳어요', '증발하다': '증발하면' };

  function createCatalog(pkg) {
    if (!pkg || !Array.isArray(pkg.vocab) || pkg.vocab.length < 4 ||
        !Array.isArray(pkg.paragraphs) || pkg.paragraphs.length !== 4 ||
        !Array.isArray(pkg.questions) || pkg.questions.length < 7 ||
        !Array.isArray(pkg.vquiz) || pkg.vquiz.length < 2) {
      throw new TypeError('기존 소금 지문과 어휘·문제 데이터가 필요합니다.');
    }
    const sentences = pkg.paragraphs.flatMap(paragraph => paragraph.s);
    const title = pkg.title || PASSAGE_TITLE;
    const passage = () => pkg.paragraphs.map(paragraph => ({
      role: paragraph.role, s: paragraph.s.slice()
    }));
    const read = (id, mode, label, phase) => ({
      id, kind: 'read', mode, label, phase, title,
      paragraphs: passage(), sentences: sentences.slice(), source: title
    });
    const originalChoice = (id, question, label, phase, sourceRef) => ({
      id, kind: 'choice', label, phase, title: label,
      question: question.q, options: question.o.slice(), answer: question.a,
      source: question.ev ? question.ev.map(index => sentences[index]).join(' ') : title,
      sourceRef
    });

    const fluency = {
      label: '읽기 유창성',
      tasks: [
        read('fluency-normal-read', 'normal', '글을 읽고 빈칸 맞추기', '활동 1 · 빈칸 맞추기'),
        originalChoice('fluency-normal-quiz', pkg.vquiz[1], '빈칸 맞추기', '활동 1 · 빈칸 맞추기', 'vquiz.1'),
        read('fluency-speed-read', 'speed', '빠르게 읽고 내용 맞추기', '활동 2 · 빠르게 읽기'),
        originalChoice('fluency-speed-quiz', pkg.questions[2], '내용 맞추기', '활동 2 · 빠르게 읽기', 'questions.2'),
        read('fluency-auto-read', 'auto', '자동으로 표시되는 글 읽기', '활동 3 · 자동 읽기'),
        originalChoice('fluency-auto-quiz', pkg.questions[6], '읽은 내용 확인하기', '활동 3 · 자동 읽기', 'questions.6')
      ]
    };

    // The source contains ten distinct words. The final six questions in each
    // phase deliberately review those same words; no extra content is invented.
    function vocabularyChoice(kind, number) {
      const index = number % pkg.vocab.length;
      const word = pkg.vocab[index];
      const answer = number % 4;
      const field = kind === 'meaning' ? 'meaning' : 'word';
      const distractors = [1, 2, 3].map(offset => pkg.vocab[(index + offset) % pkg.vocab.length][field]);
      const options = distractors.slice();
      options.splice(answer, 0, word[field]);
      const sourceSentence = sentences[word.s];
      const form = VERB_FORMS[word.word] || word.word;
      if (typeof sourceSentence !== 'string' || !sourceSentence.includes(form)) {
        throw new TypeError('원문에서 어휘 표현을 찾을 수 없습니다: ' + word.word);
      }
      const maskedSentence = sourceSentence.replace(form, '(    )');
      const phase = kind === 'meaning' ? '뜻 맞추기' : '단어 맞추기';
      return {
        id: 'vocabulary-' + kind + '-' + (number + 1), kind: 'choice',
        label: phase, phase, title: phase,
        question: kind === 'meaning'
          ? '‘' + word.word + '’의 뜻으로 알맞은 것은 무엇인가요?'
          : '빈칸에 들어갈 낱말을 고르세요.' + (word.pos === '동사' ? ' 동사는 기본형으로 제시해요.' : '') + '\n' + maskedSentence,
        options, answer, word: word.word, meaning: word.meaning,
        source: sourceSentence, sourceSentence, sourceRef: 'vocab.' + index,
        review: number >= pkg.vocab.length, questionNumber: number + 1,
        ...(kind === 'sentence' ? { maskedSentence, answerForm: form } : {})
      };
    }
    const vocabulary = {
      label: '어휘력',
      note: '기존 어휘 10개를 사용하며, 각 단계의 마지막 6문항은 복습이에요.',
      uniqueWordCount: pkg.vocab.length,
      words: pkg.vocab.map(word => ({
        word: word.word, meaning: word.meaning, pos: word.pos,
        example: sentences[word.s]
      })),
      tasks: [
        ...Array.from({ length: 16 }, (_, number) => vocabularyChoice('meaning', number)),
        ...Array.from({ length: 16 }, (_, number) => vocabularyChoice('sentence', number))
      ]
    };

    const roles = pkg.paragraphs.map(paragraph => paragraph.role);
    const roleSequence = order => order.map(index => roles[index]).join(' → ');
    const reading = {
      label: '독해력',
      tasks: [
        read('reading-passage', 'normal', '글 읽기', '글 읽기'),
        {
          id: 'reading-order', kind: 'order', label: '문단 순서 맞추기',
          phase: '문단 순서', title: '문단 순서 맞추기',
          question: '글의 흐름에 맞게 문단의 순서를 정해보세요.',
          paragraphs: [2, 0, 3, 1].map(index => ({ id: index, text: pkg.paragraphs[index].s.join(' ') })),
          answer: [0, 1, 2, 3], source: sentences.join(' '), sourceRef: 'paragraphs'
        },
        {
          id: 'reading-structure', kind: 'choice', label: '문단 구조 맞추기',
          phase: '문단 구조', title: '문단 구조 맞추기',
          question: '이 글의 문단 구조로 알맞은 것은 무엇인가요?',
          options: [roleSequence([0, 2, 1, 3]), roleSequence([0, 1, 2, 3]), roleSequence([1, 0, 3, 2]), roleSequence([3, 1, 2, 0])],
          answer: 1, source: roleSequence([0, 1, 2, 3]), sourceRef: 'paragraphs.role'
        },
        ...pkg.questions.slice(0, 4).map((question, index) => originalChoice(
          'reading-content-' + (index + 1), question, '문단 내용 맞추기', '문단 내용', 'questions.' + index
        ))
      ]
    };
    return { fluency, vocabulary, reading };
  }

  return Object.freeze({ createCatalog });
});
