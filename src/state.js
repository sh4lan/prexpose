// --- State & Pure Utilities ---

export const STORAGE_KEY = 'primerKnownWords';
const DB_NAME = 'WordPrimer';
const DB_VERSION = 1;

// --- IndexedDB ---
export function dbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function dbGet(key) {
  return dbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(key);
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  }));
}

export function dbPut(key, value) {
  return dbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    const req = tx.objectStore('kv').put(value, key);
    req.onsuccess = () => { db.close(); resolve(); };
    req.onerror = () => { db.close(); reject(req.error); };
  }));
}

export function dbDelete(key) {
  return dbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    const req = tx.objectStore('kv').delete(key);
    req.onsuccess = () => { db.close(); resolve(); };
    req.onerror = () => { db.close(); reject(req.error); };
  }));
}

// --- State (getters & setters for cross-module use) ---
let _knownWords = new Map();
let _knownSet = new Set();
let _currentAllWords = [];
let _currentFreq = [];
let _originalText = '';
let _sortMode = 'count';
let _hideHiragana = localStorage.getItem('primerHideHiragana') === 'true';
let _hideKatakana = localStorage.getItem('primerHideKatakana') === 'true';
let _hideKnown = localStorage.getItem('primerHideKnown') !== 'false'; // default: hide known
// One-time migration from the old combined "hide kana-only" toggle.
if (localStorage.getItem('primerHideKana') === 'true') {
  _hideHiragana = _hideKatakana = true;
  localStorage.setItem('primerHideHiragana', 'true');
  localStorage.setItem('primerHideKatakana', 'true');
}
localStorage.removeItem('primerHideKana');
let _skipSessionSave = false;
let _tokenizer = null;
let _tokenizerLoading = false;

let _varMap = new Map(); // canonical word -> Set of surface forms (for current text matching)

export function getKnownWords() { return _knownWords; }
export function getKnownSet() { return _knownSet; }
export function getCurrentAllWords() { return _currentAllWords; }
export function getCurrentFreq() { return _currentFreq; }
export function getOriginalText() { return _originalText; }
export function getSortMode() { return _sortMode; }
export function getHideHiragana() { return _hideHiragana; }
export function getHideKatakana() { return _hideKatakana; }
export function getHideKnown() { return _hideKnown; }

export function setCurrentAllWords(v) { _currentAllWords = v; }
export function setCurrentFreq(v) { _currentFreq = v; }
export function setOriginalText(v) { _originalText = v; }
export function setSortMode(v) { _sortMode = v; }
export function setHideHiragana(v) { _hideHiragana = v; localStorage.setItem('primerHideHiragana', v); }
export function setHideKatakana(v) { _hideKatakana = v; localStorage.setItem('primerHideKatakana', v); }
export function setHideKnown(v) { _hideKnown = v; localStorage.setItem('primerHideKnown', v); }
export function getVarMap() { return _varMap; }
export function setVarMap(v) { _varMap = v; }
export function getSkipSessionSave() { return _skipSessionSave; }
export function setSkipSessionSave(v) { _skipSessionSave = v; }

export const CONTENT_POS = new Set([
  '名詞', '動詞', '形容詞', '副詞', '連体詞',
  '感動詞', '接頭詞'
]);

const allKanji = s => /^[㐀-䶿一-鿿豈-﫿]+$/.test(s);

// --- Personal-name list (JMnedict, one surface per line) ---
// Single shared promise so concurrent callers (e.g. a page-load warmup racing
// the first extract) get the same in-flight load instead of a premature null.
let _namesPromise = null;
export function getNames() {
  if (!_namesPromise) {
    _namesPromise = (async () => {
      try {
        const res = await fetch('names.txt');
        if (!res.ok) throw new Error('names.txt ' + res.status);
        // Bucket names by first character so each lookup scans a tiny slice
        // instead of the whole 2.9MB list (a Set of 340k strings is ~26MB).
        const buckets = new Map();
        for (const line of (await res.text()).split('\n')) {
          const n = line.trim();
          if (!n || n.startsWith('#')) continue; // header comments, one name per line
          const arr = buckets.get(n[0]);
          if (arr) arr.push(n); else buckets.set(n[0], [n]);
        }
        const joined = new Map();
        for (const [c, arr] of buckets) joined.set(c, '\n' + arr.join('\n') + '\n');
        return name => {
          const b = joined.get(name[0]);
          return b ? b.includes('\n' + name + '\n') : false;
        };
      } catch (err) {
        console.warn('Personal-name list unavailable; name merging disabled.', err);
        return null;
      }
    })();
  }
  return _namesPromise;
}

// Content POS that can be part of a split proper noun. kuromoji tags some name
// kanji as verbs or prefixes (小 + 依 → 小依, where 依 is the verb reading 依る),
// so merging only 名詞 runs misses names like 小依.
const NAME_PARTS = new Set(['名詞', '動詞', '接頭詞', '形容詞']);

// kuromoji's IPADIC splits proper nouns it doesn't know into their kanji parts
// (乃愛 → 乃 + 愛, 山田太郎 → 山田 + 太郎), so runs of consecutive pure-kanji
// content tokens are merged back into one — but only when the run is actually a
// known personal name (via getNames), so phrases like 今日午後 are left alone.
export function mergeSplitNouns(tokens, hasName) {
  if (!hasName) return tokens;
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (NAME_PARTS.has(t.pos) && allKanji(t.surface_form)) {
      let run = t.surface_form;
      let best = -1;
      let j = i + 1;
      while (j < tokens.length && NAME_PARTS.has(tokens[j].pos) && allKanji(tokens[j].surface_form)) {
        run += tokens[j].surface_form;
        if (hasName(run)) best = j;
        j++;
      }
      if (best > i) {
        let surf = '';
        for (let k = i; k <= best; k++) surf += tokens[k].surface_form;
        out.push({ ...t, pos: '名詞', surface_form: surf }); // a name is a noun
        i = best + 1;
        continue;
      }
    }
    out.push(t);
    i++;
  }
  return out;
}

// --- Theme ---
export { getTheme, setTheme } from './theme.js';

// --- Kuromoji XHR patch ---
const _origOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url) {
  if (typeof url === 'string' && /^https:\/[a-z]/.test(url) && url.indexOf('kuromoji') !== -1) {
    arguments[1] = url.replace(/^https:\//, 'https://');
  }
  return _origOpen.apply(this, arguments);
};

// --- Known words storage ---
export function loadKnownWords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (!arr.length) return;
    _knownWords = new Map();
    _knownSet = new Set();
    if (typeof arr[0] === 'string') {
      const now = new Date().toISOString();
      for (const w of arr) {
        const word = w.trim();
        if (!word || _knownSet.has(word)) continue;
        _knownSet.add(word);
        _knownWords.set(word, now);
      }
      saveKnownWords();
    } else {
      for (const entry of arr) {
        const word = entry.w?.trim();
        if (!word || _knownSet.has(word)) continue;
        _knownSet.add(word);
        _knownWords.set(word, entry.t || new Date().toISOString());
      }
    }
  } catch { _knownWords = new Map(); _knownSet = new Set(); }
}

export function saveKnownWords() {
  const arr = [..._knownWords.entries()]
    .map(([w, t]) => ({ w, t }))
    .sort((a, b) => a.w.localeCompare(b.w));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
}

export function addKnownWord(word) {
  const cleaned = word.trim();
  if (!cleaned || _knownSet.has(cleaned)) return false;
  _knownSet.add(cleaned);
  _knownWords.set(cleaned, new Date().toISOString());
  saveKnownWords();
  return true;
}

export function removeKnownWord(word) {
  const cleaned = word.trim();
  _knownSet.delete(cleaned);
  _knownWords.delete(cleaned);
  saveKnownWords();
}

export function clearAllKnown() {
  _knownSet.clear();
  _knownWords.clear();
  saveKnownWords();
}

// --- Tokenizer ---
export async function getTokenizer() {
  if (_tokenizer) return _tokenizer;
  if (_tokenizerLoading) {
    while (_tokenizerLoading) await new Promise(r => setTimeout(r, 100));
    if (!_tokenizer) throw new Error('Tokenizer failed to load.');
    return _tokenizer;
  }
  _tokenizerLoading = true;
  return new Promise((resolve, reject) => {
    kuromoji.builder({
      dicPath: 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/'
    }).build((err, tokenizer) => {
      _tokenizerLoading = false;
      if (err) { reject(err); return; }
      _tokenizer = tokenizer;
      resolve(tokenizer);
    });
  });
}

// --- Utilities ---
export function isHiraganaOnly(word) {
  return [...word].every(ch => {
    const cp = ch.codePointAt(0);
    return cp >= 0x3040 && cp <= 0x309F;
  });
}

export function isKatakanaOnly(word) {
  return [...word].every(ch => {
    const cp = ch.codePointAt(0);
    return cp >= 0x30A0 && cp <= 0x30FF;
  });
}

// Pure kana (hiragana, katakana, or the long-vowel mark ー), no kanji.
// Used to drop mixed-kana words like よーし when BOTH kana filters are on.
export function isKanaOnly(word) {
  return [...word].every(ch => {
    const cp = ch.codePointAt(0);
    return (cp >= 0x3040 && cp <= 0x309F) || (cp >= 0x30A0 && cp <= 0x30FF);
  });
}

export function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function downloadTextFile(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function formatDate(date) {
  const now = new Date();
  const diff = now - date;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// --- Session sentence storage ---
export function splitSentences(text) {
  return text.split(/。|！|？|\.\s|\!\s|\?\s|\n/).map(s => s.trim()).filter(s => s.length > 0).map(s => s.replace(/[…。\.]+$/, ''));
}

export async function saveSession(text, wordMap, varMap, sourceName) {
  if (_skipSessionSave) { _skipSessionSave = false; return null; }
  const now = Date.now();
  const sessionId = now.toString(36) + Math.random().toString(36).slice(2, 4);

  const sents = splitSentences(text);
  const charCount = sents.join('').length;

  const wordIndices = {};
  for (const word of wordMap.keys()) {
    const indices = [];
    const forms = [word];
    // Also include surface form variants for flexible matching
    if (varMap && varMap.has(word)) {
      for (const sf of varMap.get(word)) forms.push(sf);
    }
    for (let i = 0; i < sents.length; i++) {
      for (const f of forms) {
        if (sents[i].includes(f)) { indices.push(i); break; }
      }
    }
    if (indices.length) wordIndices[word] = indices;
  }

  const data = { sentences: sents, wordIndices, ts: now, charCount, words: [...wordMap.keys()], source: sourceName || null };
  await dbPut('session:' + sessionId, data);
  // Keep a list of session IDs
  const list = await dbGet('sessionList') || [];
  list.push(sessionId);
  await dbPut('sessionList', list);
  return sessionId;
}

export async function findSentences(word) {
  let results = new Map(); // text -> {text, ts} (keeps newest ts)
  const list = await dbGet('sessionList') || [];

  for (const sid of list) {
    const data = await dbGet('session:' + sid);
    if (!data) continue;
    const indices = data.wordIndices[word];
    if (!indices) continue;
    for (const idx of indices) {
      if (idx >= data.sentences.length) continue;
      const text = data.sentences[idx];
      const existing = results.get(text);
      if (!existing || data.ts > existing.ts) results.set(text, { text, ts: data.ts });
    }
  }

  // Also add from current text in memory
  if (_originalText) {
    const now = Date.now();
    const currentSents = splitSentences(_originalText);
    const forms = [word];
    const vm = _varMap;
    if (vm && vm.has(word)) for (const sf of vm.get(word)) forms.push(sf);
    for (const s of currentSents) {
      let matched = false;
      for (const f of forms) { if (s.includes(f)) { matched = true; break; } }
      if (!matched) continue;
      const existing = results.get(s);
      if (!existing || now > existing.ts) results.set(s, { text: s, ts: now });
    }
  }

  return [...results.values()].sort((a, b) => b.ts - a.ts);
}

// Locate a sentence in its source (current text first, then saved sessions)
// so the word-context view can show the surrounding sentences with it
// highlighted. Returns { sentences, index, ts } or null.
export async function findSentenceContext(sentenceText) {
  if (_originalText) {
    const sents = splitSentences(_originalText);
    const i = sents.findIndex(s => s === sentenceText);
    if (i !== -1) return { sentences: sents, index: i, ts: Date.now(), current: true };
  }
  const list = await dbGet('sessionList') || [];
  for (const sid of list) {
    const data = await dbGet('session:' + sid);
    if (!data || !Array.isArray(data.sentences)) continue;
    const i = data.sentences.findIndex(s => s === sentenceText);
    if (i !== -1) return { sentences: data.sentences, index: i, ts: data.ts };
  }
  return null;
}

export async function getSessionList() {
  const list = await dbGet('sessionList') || [];
  const sessions = [];
  for (const sid of list) {
    const data = await dbGet('session:' + sid);
    if (data) sessions.push({ id: sid, ...data });
  }
  return sessions.sort((a, b) => b.ts - a.ts);
}

export async function getSessionText(sid) {
  const data = await dbGet('session:' + sid);
  return data ? data.sentences.join('\n') : null;
}

export async function deleteSession(sid) {
  await dbDelete('session:' + sid);
  const list = await dbGet('sessionList') || [];
  await dbPut('sessionList', list.filter(id => id !== sid));
}
