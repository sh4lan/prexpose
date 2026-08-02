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
let _hideKanaOnly = localStorage.getItem('primerHideKana') === 'true';
let _noSpoiler = localStorage.getItem('primerNoSpoiler') === 'true';
let _hideShortSents = localStorage.getItem('primerHideShortSents') !== 'false';
let _currentSessionId = null;
let _skipSessionSave = false;
let _tokenizer = null;
let _tokenizerLoading = false;

let _wordImages = new Map(); // word -> url string
let _varMap = new Map(); // canonical word -> Set of surface forms (for current text matching)

export function getKnownWords() { return _knownWords; }
export function getKnownSet() { return _knownSet; }
export function getCurrentAllWords() { return _currentAllWords; }
export function getCurrentFreq() { return _currentFreq; }
export function getOriginalText() { return _originalText; }
export function getSortMode() { return _sortMode; }
export function getHideKanaOnly() { return _hideKanaOnly; }

export function setCurrentAllWords(v) { _currentAllWords = v; }
export function setCurrentFreq(v) { _currentFreq = v; }
export function setOriginalText(v) { _originalText = v; }
export function setSortMode(v) { _sortMode = v; }
export function setHideKanaOnly(v) { _hideKanaOnly = v; }
export function getNoSpoiler() { return _noSpoiler; }
export function setNoSpoiler(v) { _noSpoiler = v; localStorage.setItem('primerNoSpoiler', v); }
export function getCurrentSessionId() { return _currentSessionId; }
export function setCurrentSessionId(v) { _currentSessionId = v; }
export function getHideShortSents() { return _hideShortSents; }
export function setHideShortSents(v) { _hideShortSents = v; localStorage.setItem('primerHideShortSents', v); }
export function isShortSentence(s) { return [...s].length <= 3; }
export function getVarMap() { return _varMap; }
export function setVarMap(v) { _varMap = v; }
export function getSkipSessionSave() { return _skipSessionSave; }
export function setSkipSessionSave(v) { _skipSessionSave = v; }

export const CONTENT_POS = new Set([
  '名詞', '動詞', '形容詞', '副詞', '連体詞',
  '感動詞', '接頭詞'
]);

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
export function isKanaOnly(word) {
  return [...word].every(ch => {
    const cp = ch.codePointAt(0);
    return (cp >= 0x3040 && cp <= 0x309F) ||
           (cp >= 0x30A0 && cp <= 0x30FF) ||
           cp === 0x30FC;
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

// --- Word image URLs ---
export function getWordImage(word) { return _wordImages.get(word) || ''; }
export function setWordImage(word, url) {
  if (url) _wordImages.set(word, url);
  else _wordImages.delete(word);
  dbPut('img:' + word, url || '').catch(() => {});
}
export async function getWordImageFromDB(word) {
  try {
    const url = await dbGet('img:' + word);
    if (url) { _wordImages.set(word, url); return url; }
  } catch {}
  return '';
}

// --- Session sentence storage ---
export function splitSentences(text) {
  return text.split(/。|！|？|\.\s|\!\s|\?\s|\n/).map(s => s.trim()).filter(s => s.length > 0);
}

export async function saveSession(text, wordMap, varMap) {
  if (_skipSessionSave) { _skipSessionSave = false; return null; }
  const now = Date.now();
  const sessionId = now.toString(36) + Math.random().toString(36).slice(2, 4);
  _currentSessionId = sessionId;

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

  const data = { sentences: sents, wordIndices, ts: now, charCount, words: [...wordMap.keys()] };
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
    if (_noSpoiler && sid === _currentSessionId) continue;
    const indices = data.wordIndices[word];
    if (!indices) continue;
    for (const idx of indices) {
      if (idx >= data.sentences.length) continue;
      const text = data.sentences[idx];
      if (_hideShortSents && isShortSentence(text)) continue;
      const existing = results.get(text);
      if (!existing || data.ts > existing.ts) results.set(text, { text, ts: data.ts });
    }
  }

  // Also add from current text in memory
  if (_originalText && !(_noSpoiler && _currentSessionId)) {
    const now = Date.now();
    const currentSents = splitSentences(_originalText);
    const forms = [word];
    const vm = _varMap;
    if (vm && vm.has(word)) for (const sf of vm.get(word)) forms.push(sf);
    for (const s of currentSents) {
      if (_hideShortSents && isShortSentence(s)) continue;
      let matched = false;
      for (const f of forms) { if (s.includes(f)) { matched = true; break; } }
      if (!matched) continue;
      const existing = results.get(s);
      if (!existing || now > existing.ts) results.set(s, { text: s, ts: now });
    }
  }

  return [...results.values()].sort((a, b) => b.ts - a.ts);
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
