import { getTokenizer, splitSentences, CONTENT_POS } from './state.js';

// Tokenizes each sentence and returns the word->sentences transpose.
// Shared by the main view (background build) and quiz.html.
export async function buildQuizData({ text, freq }) {
  const sentences = splitSentences(text);
  const sentenceLen = sentences.map(s => [...s].length);
  const freqSet = new Set(freq.map(e => e.word));
  const tokenizer = await getTokenizer();

  const sentenceWords = [];
  const byWord = new Map();
  for (const s of sentences) {
    const words = new Set();
    for (const t of tokenizer.tokenize(s)) {
      if (!CONTENT_POS.has(t.pos)) continue;
      const w = (t.pos === '動詞' || t.pos === '形容詞')
        ? (t.basic_form || t.surface_form).trim()
        : t.surface_form.trim();
      if (w && freqSet.has(w)) words.add(w);
    }
    sentenceWords.push([...words]);
    for (const w of words) {
      if (!byWord.has(w)) byWord.set(w, []);
      byWord.get(w).push(sentenceWords.length - 1);
    }
  }

  return { sentences, sentenceLen, sentenceWords, byWord };
}
