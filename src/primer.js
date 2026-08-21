import {
  getKnownWords, getKnownSet, getCurrentAllWords, getCurrentFreq,
  getHideHiragana, getHideKatakana, getHideKnown,
  setCurrentAllWords, setCurrentFreq, setOriginalText, setHideHiragana, setHideKatakana, setHideKnown,
  setSkipSessionSave, setVarMap,
  dbPut, dbGet, addKnownWord, removeKnownWord, getTokenizer,
  CONTENT_POS, isHiraganaOnly, isKatakanaOnly, isKanaOnly, downloadTextFile,
  mergeSplitNouns, getNames, saveSession, findSentences, findSentenceContext
} from './state.js';
import { getDictRank, getDictMap, getDictName } from './dict.js';
import { createVirtualList } from './virtual.js';
import { setRange, fillDual, fillSingle, labelSingle, labelPair, sliderToLog } from './ranges.js';
import { detectSource, selectedText, selectedUnits } from './partial.js';

const PASTE_KEY = 'primerPasteText';

// --- DOM refs ---
const pasteTextarea = document.getElementById('pasteTextarea');
const extractBtn = document.getElementById('extractBtn');
const uploadBtn = document.getElementById('uploadBtn');
const downloadBtn = document.getElementById('downloadBtn');
const pasteStatus = document.getElementById('pasteStatus');
const sortSelectBtn = document.getElementById('sortSelectBtn');
const sortSelectMenu = document.getElementById('sortSelectMenu');
let _sortValue = 'count';
const hideKnownCheckbox = document.getElementById('hideKnownCheckbox');
const hideHiraganaCheckbox = document.getElementById('hideHiraganaCheckbox');
const hideKatakanaCheckbox = document.getElementById('hideKatakanaCheckbox');
const wordSection = document.getElementById('wordSection');
const wordList = document.getElementById('wordList');
const emptyState = document.getElementById('emptyState');
const restoreBtn = document.getElementById('restoreBtn');
const hasSavedBadge = document.getElementById('hasSavedBadge');
const newPct = document.getElementById('newPct');

// --- Flagged words (click a row to mark for later). In-memory only: resets
// on refresh, and a flagged word keeps its state while the virtualized rows
// scroll out of view and back. ---
const _flagged = new Set();
function isFlagged(word) { return _flagged.has(word); }
function toggleFlag(word) {
  if (!_flagged.delete(word)) _flagged.add(word);
}

// Upload modal
const uploadModal = document.getElementById('uploadModal');
const uploadDropZone = document.getElementById('uploadDropZone');
const uploadModalInput = document.getElementById('uploadModalInput');
const uploadModalStatus = document.getElementById('uploadModalStatus');

const contextModal = document.getElementById('contextModal');
const contextWordTitle = document.getElementById('contextWordTitle');
const contextSentences = document.getElementById('contextSentences');
const contextWordOcc = document.getElementById('contextWordOcc');
const contextWordRank = document.getElementById('contextWordRank');
const downloadModal = document.getElementById('downloadModal');

// Partial extract (structured sources: subtitles by time, mokuro by page)
const partialBtn = document.getElementById('partialBtn');
const partialModal = document.getElementById('partialModal');
const partialFormatLabel = document.getElementById('partialFormatLabel');
const partialTimeBlock = document.getElementById('partialTimeBlock');
const partialPageBlock = document.getElementById('partialPageBlock');
const partialRngMinTime = document.getElementById('partialRngMinTime');
const partialRngMaxTime = document.getElementById('partialRngMaxTime');
const partialRngMinPage = document.getElementById('partialRngMinPage');
const partialRngMaxPage = document.getElementById('partialRngMaxPage');
const partialFillTime = document.getElementById('partialFillTime');
const partialFillPage = document.getElementById('partialFillPage');
const partialValTime = document.getElementById('partialValTime');
const partialValPage = document.getElementById('partialValPage');
const partialPreview = document.getElementById('partialPreview');
const partialCount = document.getElementById('partialCount');
const partialExtractBtn = document.getElementById('partialExtractBtn');
const partialRuler = document.getElementById('partialRuler');

// Word-context (More) filters + context sub-view
const moreFiltersPanel = document.getElementById('moreFiltersPanel');
const moreFiltersBtn = document.getElementById('moreFiltersBtn');
const moreContextPanel = document.getElementById('moreContextPanel');
const moreContextBack = document.getElementById('moreContextBack');
const moreContextInfo = document.getElementById('moreContextInfo');
const moreContextLines = document.getElementById('moreContextLines');
const mMaxNew = document.getElementById('moreRngMaxNew');
const mMinLen = document.getElementById('moreRngMinLen');
const mMaxLen = document.getElementById('moreRngMaxLen');
const mMinDate = document.getElementById('moreRngMinDate');
const mMaxDate = document.getElementById('moreRngMaxDate');
const mValNew = document.getElementById('moreValNew');
const mValLen = document.getElementById('moreValLen');
const mValDate = document.getElementById('moreValDate');
const mFillNew = document.getElementById('moreFillNew');
const mFillLen = document.getElementById('moreFillLen');
const mFillDate = document.getElementById('moreFillDate');

// Word-list filters (occurrences / dictionary rank)
const listFiltersPanel = document.getElementById('listFiltersPanel');
const listFiltersBtn = document.getElementById('listFiltersBtn');
const listFiltersClose = document.getElementById('listFiltersClose');
const lMinOcc = document.getElementById('listRngMinOcc');
const lMaxOcc = document.getElementById('listRngMaxOcc');
const lMinRank = document.getElementById('listRngMinRank');
const lMaxRank = document.getElementById('listRngMaxRank');
const lValOcc = document.getElementById('listValOcc');
const lValRank = document.getElementById('listValRank');
const lFillOcc = document.getElementById('listFillOcc');
const lFillRank = document.getElementById('listFillRank');
const lRankBlock = document.getElementById('listRankBlock');

const wordListVirtual = createVirtualList(wordList, { renderRow: renderWordRow });

// --- Render helpers ---
export function renderStats() {
  const el = document.getElementById('knownCount');
  if (el) el.textContent = getKnownSet().size;
  const el2 = document.getElementById('libraryKnownCount');
  if (el2) el2.textContent = getKnownSet().size;
}

export function updatePrimerUI() {
  const hasWords = Number(wordList.dataset.vcount || 0) > 0;
  wordSection.classList.toggle('hidden', !hasWords);
  emptyState.classList.toggle('hidden', hasWords);
  const msg = emptyState.querySelector('p');
  if (!hasWords && getCurrentAllWords().length > 0) {
    msg.textContent = getHideKnown()
      ? 'All words are already in your known list or excluded by the current filter.'
      : 'All words are excluded by the current filter.';
  } else {
    msg.textContent = getHideKnown()
      ? 'No new words to show. Paste some text above to get started.'
      : 'No words to show. Paste some text above to get started.';
  }
  updateNewPercent();
}

function isFilteredOut(word) {
  const hideH = getHideHiragana(), hideK = getHideKatakana();
  if (hideH && isHiraganaOnly(word)) return true;
  if (hideK && isKatakanaOnly(word)) return true;
  // Both kana types hidden: drop every pure-kana word, including mixed-kana
  // ones like よーし that match neither single check.
  if (hideH && hideK && isKanaOnly(word)) return true;
  return false;
}

// --- Word-list filters (occurrences / dictionary rank) ---
// Applies in the same three places
// as the kana filters: applyFilters, updateNewPercent, and getVisible.
const LIST_FILTER_KEY = 'primerListFilters';
let _listFilters = { minOcc: null, maxOcc: null, minRank: null, maxRank: null };

function listRangeOut(e) {
  const r = getDictRank(e.word);
  if (_listFilters.minOcc != null && e.count < _listFilters.minOcc) return true;
  if (_listFilters.maxOcc != null && e.count > _listFilters.maxOcc) return true;
  // A word with no dict rank behaves like infinite rank: it passes a min-rank
  // filter and is excluded by a max-rank filter.
  if (_listFilters.minRank != null) { if (r != null && r < _listFilters.minRank) return true; }
  if (_listFilters.maxRank != null) { if (r == null || r > _listFilters.maxRank) return true; }
  return false;
}

function loadListFilters() {
  try { return JSON.parse(localStorage.getItem(LIST_FILTER_KEY)) || null; } catch { return null; }
}
// Only groups the user has manually moved are remembered (see _moreTouched).
let _listTouched = new Set(); // 'occ' | 'rank'
function touchList(g) { _listTouched.add(g); listFiltersBtn.classList.add('btn--active'); }
function saveListFilters() {
  const data = { touched: [..._listTouched] };
  if (_listTouched.has('occ')) { data.minOcc = lMinOcc.value; data.maxOcc = lMaxOcc.value; }
  if (_listTouched.has('rank')) { data.minRank = lMinRank.value; data.maxRank = lMaxRank.value; }
  try { localStorage.setItem(LIST_FILTER_KEY, JSON.stringify(data)); } catch {}
}

function rankFromListSlider(el, side) {
  const v = Number(el.value), lo = Number(el.min), hi = Number(el.max);
  if (side === 'min' && v <= lo) return null;
  if (side === 'max' && v >= hi) return null;
  return sliderToLog(v, lo, hi);
}

function readListFilters() {
  const val = e => Number(e.value);
  _listFilters.minOcc = val(lMinOcc) <= Number(lMinOcc.min) ? null : val(lMinOcc);
  _listFilters.maxOcc = val(lMaxOcc) >= Number(lMaxOcc.max) ? null : val(lMaxOcc);
  _listFilters.minRank = rankFromListSlider(lMinRank, 'min');
  _listFilters.maxRank = rankFromListSlider(lMaxRank, 'max');
}

// Display a rank-slider coordinate as its log-scaled rank.
function fmtListRankSlider(v) {
  const r = sliderToLog(v, Number(lMinRank.min), Number(lMaxRank.max));
  return r <= 0 ? '0' : r.toLocaleString();
}

function updateListLabels() {
  lValOcc.textContent = labelPair(lMinOcc, lMaxOcc);
  lValRank.textContent = labelPair(lMinRank, lMaxRank, fmtListRankSlider);
}

// (Re)range the sliders to the current extraction + dict. Saved values are
// re-clamped to the new range.
function setupListFilters() {
  const freq = getCurrentFreq();
  const maxOcc = Math.max(...freq.map(e => e.count), 1);
  let rankMax = 1;
  for (const e of freq) { const r = getDictRank(e.word); if (r != null && r > rankMax) rankMax = r; }
  const saved = loadListFilters();
  const touched = new Set(saved?.touched || []);
  _listTouched = touched;
  const within = (v, lo, hi) => v != null && !Number.isNaN(v) && v >= lo && v <= hi;
  const pick = (group, key, fallback, lo, hi) => (touched.has(group) && within(+saved[key], lo, hi) ? +saved[key] : fallback);

  setRange(lMinOcc, 1, maxOcc, pick('occ', 'minOcc', 1, 1, maxOcc));
  setRange(lMaxOcc, 1, maxOcc, pick('occ', 'maxOcc', maxOcc, 1, maxOcc));
  setRange(lMinRank, 0, rankMax, pick('rank', 'minRank', 0, 0, rankMax));
  setRange(lMaxRank, 0, rankMax, pick('rank', 'maxRank', rankMax, 0, rankMax));
  lRankBlock.classList.toggle('hidden', !getDictMap());
  readListFilters();
  updateListLabels();
  fillDual(lMinOcc, lMaxOcc, lFillOcc);
  fillDual(lMinRank, lMaxRank, lFillRank);
  listFiltersBtn.classList.toggle('btn--active', _listTouched.size > 0);
}

function closeListFilters() { listFiltersPanel.classList.add('hidden'); }

function wireListDual(minEl, maxEl, fillEl, group) {
  const apply = () => {
    if (Number(minEl.value) > Number(maxEl.value)) {
      if (document.activeElement === minEl) maxEl.value = minEl.value;
      else minEl.value = maxEl.value;
    }
    touchList(group);
    fillDual(minEl, maxEl, fillEl);
    readListFilters();
    updateListLabels();
    saveListFilters();
    applyFilters();
  };
  minEl.addEventListener('input', apply);
  maxEl.addEventListener('input', apply);
}

function wireListFilters() {
  listFiltersBtn.addEventListener('click', () => { setupListFilters(); listFiltersPanel.classList.remove('hidden'); });
  listFiltersClose.addEventListener('click', closeListFilters);
  listFiltersPanel.querySelector('.modal-backdrop').addEventListener('click', closeListFilters);
  wireListDual(lMinOcc, lMaxOcc, lFillOcc, 'occ');
  wireListDual(lMinRank, lMaxRank, lFillRank, 'rank');
  document.getElementById('listFiltersReset').addEventListener('click', () => {
    _listTouched.clear();
    localStorage.removeItem(LIST_FILTER_KEY);
    setupListFilters();
    applyFilters();
  });
}

// Share of pasted occurrences not yet known, weighted by count. Respects the
// kana + list filters so "42% new" matches exactly what the list is showing.
function updateNewPercent() {
  if (!newPct) return;
  const freq = getCurrentFreq();
  let total = 0, known = 0;
  for (const { word, count } of freq) {
    if (isFilteredOut(word) || listRangeOut({ word, count })) continue;
    total += count;
    if (getKnownSet().has(word)) known += count;
  }
  newPct.textContent = total ? `${Math.round(((total - known) / total) * 100)}% new` : '';
}

export function renderDictUI() {
  const el = document.getElementById('dictBar');
  if (!el) return;
  if (getDictMap()) {
    el.textContent = `${getDictName()} (${getDictMap().size.toLocaleString()} entries)`;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

// --- Extract ---
export async function extractFromPaste(text, sourceName) {
  text = text.replace(/^﻿/, '').trim();
  if (!text) { pasteStatus.textContent = 'No text to process.'; return; }

  setOriginalText(text);
  pasteStatus.textContent = 'Tokenizing...';

  try {
    const [tokenizer, hasName] = await Promise.all([getTokenizer(), getNames()]);
    const lines = text.split('\n');
    const wordMap = new Map();
    const varMap = new Map();
    let totalTokens = 0;

    for (let i = 0; i < lines.length; i += 20) {
      const chunk = lines.slice(i, i + 20).join('\n');
      const tokens = mergeSplitNouns(tokenizer.tokenize(chunk), hasName);
      totalTokens += tokens.length;
      for (const t of tokens) {
        if (!CONTENT_POS.has(t.pos)) continue;
        const word = (t.pos === '動詞' || t.pos === '形容詞')
          ? (t.basic_form || t.surface_form).trim()
          : t.surface_form.trim();
        if (!word || /^[^　-鿿豈-﫿a-zA-Z]+$/.test(word)) continue;
        wordMap.set(word, (wordMap.get(word) || 0) + 1);
        const sf = t.surface_form.trim();
        if (sf !== word && !varMap.has(word)) varMap.set(word, new Set());
        if (sf !== word) varMap.get(word).add(sf);
      }
      await new Promise(r => setTimeout(r, 0));
    }

    const entries = [...wordMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([word, count]) => ({ word, count }));

    if (!entries.length) {
      pasteStatus.textContent = 'No words could be extracted.';
      return;
    }

    setCurrentAllWords(entries.map(e => e.word));
    setCurrentFreq(entries);
    setVarMap(varMap);

    // Save session for sentence lookup (all extracted words, not just new)
    saveSession(text, wordMap, varMap, sourceName).catch(() => {});

    setupListFilters();
    applyFilters();
    pasteStatus.textContent = `Extracted ${entries.length} unique words (${totalTokens} total).`;
    downloadBtn.classList.remove('hidden');

    dbPut('lastText', text).catch(() => {});
    if (hasSavedBadge) hasSavedBadge.classList.remove('hidden');
  } catch (err) {
    console.error(err);
    pasteStatus.textContent = err.message || 'Failed to tokenize text.';
  }
}

// --- Subtitle ---
function extractTextFromSRT(text) {
  return text.replace(/^\d+\s*\n\d{2}:\d{2}:\d{2}[,\.]\d{3}.*?-->.*?\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*\n/gm, '')
    .replace(/<[^>]+>/g, '').replace(/\{\\[^}]+}/g, '').replace(/&nbsp;/g, ' ')
    .split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}
function extractTextFromASS(text) {
  const lines = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('Dialogue:')) continue;
    const parts = t.split(',');
    if (parts.length >= 10) lines.push(parts.slice(9).join(',').replace(/\{[^}]+\}/g, '').replace(/\\N/gi, '\n').trim());
  }
  return lines.filter(Boolean).join('\n');
}
function extractTextFromFile(file, text) {
  const n = file.name.toLowerCase();
  if (n.endsWith('.srt')) return extractTextFromSRT(text);
  if (n.endsWith('.ssa') || n.endsWith('.ass')) return extractTextFromASS(text);
  return text;
}

// --- Filter ---
export function applyFilters(sortOverride) {
  let entries = getCurrentFreq().slice();
  if (getHideKnown()) entries = entries.filter(e => !getKnownSet().has(e.word));
  if (getHideHiragana() || getHideKatakana()) entries = entries.filter(e => !isFilteredOut(e.word));
  entries = entries.filter(e => !listRangeOut(e));

  const mode = sortOverride || _sortValue || 'count';
  if (mode === 'rank' && getDictMap()) {
    entries.sort((a, b) => {
      const ra = getDictRank(a.word), rb = getDictRank(b.word);
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1; if (rb != null) return 1;
      return b.count - a.count;
    });
  } else if (mode === 'chrono') {
    entries.sort((a, b) => {
      const km = getKnownWords();
      const ta = km.has(a.word) ? km.get(a.word) : null;
      const tb = km.has(b.word) ? km.get(b.word) : null;
      if (ta && tb) return new Date(tb) - new Date(ta);
      if (ta) return 1; if (tb) return -1;
      return b.count - a.count;
    });
  } else {
    entries.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (!getDictMap()) return 0;
      const ra = getDictRank(a.word), rb = getDictRank(b.word);
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1; if (rb != null) return 1;
      return 0;
    });
  }
  renderWordList(entries);
  updatePrimerUI();
}

export function reprime() {
  if (getCurrentAllWords().length > 0) { setupListFilters(); applyFilters(); }
  else { setupListFilters(); updatePrimerUI(); }
}

// --- Render word list ---
function renderWordRow({ word, count }) {
  const ks = getKnownSet();
  const item = document.createElement('div');
  item.className = 'word-item';
  if (ks.has(word)) item.classList.add('word-item--added');
  if (isFlagged(word)) item.classList.add('word-item--flagged');

  const label = document.createElement('span');
  label.className = 'word-label';
  const span = document.createElement('span');
  span.className = 'word-text';
  span.textContent = word;
  label.appendChild(span);
  if (count > 0) {
    const b = document.createElement('span');
    b.className = 'word-freq'; b.textContent = `×${count}`; label.appendChild(b);
  }

  const right = document.createElement('div');
  right.className = 'word-right';
  const rv = getDictRank(word);
  if (rv != null) {
    const r = document.createElement('span');
    r.className = 'word-rank'; r.textContent = `#${rv}`; right.appendChild(r);
  }

  const actions = document.createElement('div');
  actions.className = 'word-actions';

  const addBtn = document.createElement('button');
  if (ks.has(word)) { addBtn.className = 'btn btn-undo-text'; addBtn.textContent = 'Undo'; }
  else { addBtn.className = 'btn btn-add'; addBtn.textContent = 'Add'; }
  addBtn.addEventListener('click', () => {
    if (getKnownSet().has(word)) { removeKnownWord(word); item.classList.remove('word-item--added'); addBtn.className = 'btn btn-add'; addBtn.textContent = 'Add'; }
    else { addKnownWord(word); item.classList.add('word-item--added'); addBtn.className = 'btn btn-undo-text'; addBtn.textContent = 'Undo'; }
    renderStats();
    updateNewPercent();
  });

  const moreBtn = document.createElement('button');
  moreBtn.className = 'btn btn-text';
  moreBtn.textContent = 'More';
  moreBtn.addEventListener('click', () => openContextModal(word));

  actions.appendChild(addBtn);
  actions.appendChild(moreBtn);
  right.appendChild(actions);
  item.appendChild(label);
  item.appendChild(right);

  item.addEventListener('click', (e) => {
    if (e.target.closest('button, a, input, select, textarea')) return;
    toggleFlag(word);
    item.classList.toggle('word-item--flagged');
  });
  return item;
}

function renderWordList(entries) {
  wordListVirtual.setItems(entries);
  updatePrimerUI();
}

// --- Context modal (More) ---
function formatRelTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
  if (diff < 2592000000) return Math.floor(diff / 86400000) + 'd';
  return Math.floor(diff / 2592000000) + 'mo';
}

// Matched sentences for the current word, plus a per-sentence tokenization
// cache (text -> content words) so the "new words per sentence" filter doesn't
// re-tokenize on every change.
let _sentData = [];          // { text, ts, len }
let _sentWords = new Map();  // text -> [content words]
let _sentCounting = false;

function sentenceNewCount(text) {
  const words = _sentWords.get(text);
  if (!words) return null;
  const known = getKnownSet();
  let n = 0;
  for (const w of words) if (!known.has(w) && !isFilteredOut(w)) n++;
  return n;
}

function readMoreFilters() {
  const val = e => Number(e.value);
  return {
    maxNew: val(mMaxNew) >= Number(mMaxNew.max) ? null : val(mMaxNew),
    minLen: val(mMinLen) <= Number(mMinLen.min) ? null : val(mMinLen),
    maxLen: val(mMaxLen) >= Number(mMaxLen.max) ? null : val(mMaxLen),
    minDate: val(mMinDate) <= Number(mMinDate.min) ? null : val(mMinDate),
    maxDate: val(mMaxDate) >= Number(mMaxDate.max) ? null : val(mMaxDate),
  };
}

function fmtDate(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'today';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const MORE_FILTER_KEY = 'primerMoreFilters';

function loadMoreFilters() {
  try { return JSON.parse(localStorage.getItem(MORE_FILTER_KEY)) || null; } catch { return null; }
}

// Only groups the user has manually moved are remembered. Saving snapshots
// every slider, so without this an untouched group's current (per-word) range
// would leak into other words via the shared blob.
let _moreTouched = new Set(); // 'maxNew' | 'len' | 'date'
function touchMore(g) { _moreTouched.add(g); moreFiltersBtn.classList.add('btn--active'); }

function saveMoreFilters() {
  const data = { touched: [..._moreTouched] };
  if (_moreTouched.has('maxNew')) data.maxNew = mMaxNew.value;
  if (_moreTouched.has('len')) { data.minLen = mMinLen.value; data.maxLen = mMaxLen.value; }
  if (_moreTouched.has('date')) { data.minDate = mMinDate.value; data.maxDate = mMaxDate.value; }
  try { localStorage.setItem(MORE_FILTER_KEY, JSON.stringify(data)); } catch {}
}

function updateMoreLabels() {
  mValNew.textContent = labelSingle(mMaxNew);
  mValLen.textContent = labelPair(mMinLen, mMaxLen);
  mValDate.textContent = labelPair(mMinDate, mMaxDate, fmtDate);
}

function setupMoreFilters() {
  const lens = _sentData.map(s => s.len);
  const tss = _sentData.map(s => s.ts);
  const maxNew = Math.max(..._sentData.map(s => _sentWords.get(s.text)?.length || 0), 1);
  const saved = loadMoreFilters();
  const touched = new Set(saved?.touched || []);
  _moreTouched = touched;
  const within = (v, lo, hi) => v != null && !Number.isNaN(v) && v >= lo && v <= hi;
  // group is the touched-set key ('len', 'date'); key is the saved field name.
  const pick = (group, key, fallback, lo, hi) => (touched.has(group) && within(+saved[key], lo, hi) ? +saved[key] : fallback);

  setRange(mMaxNew, 0, maxNew, pick('maxNew', 'maxNew', maxNew, 0, maxNew));
  const lenLo = Math.min(...lens), lenHi = Math.max(...lens);
  setRange(mMinLen, lenLo, lenHi, pick('len', 'minLen', lenLo, lenLo, lenHi));
  setRange(mMaxLen, lenLo, lenHi, pick('len', 'maxLen', lenHi, lenLo, lenHi));
  const tsLo = Math.min(...tss), tsHi = Math.max(...tss);
  setRange(mMinDate, tsLo, tsHi, pick('date', 'minDate', tsLo, tsLo, tsHi));
  setRange(mMaxDate, tsLo, tsHi, pick('date', 'maxDate', tsHi, tsLo, tsHi));
  updateMoreLabels();
  fillSingle(mMaxNew, mFillNew);
  fillDual(mMinLen, mMaxLen, mFillLen);
  fillDual(mMinDate, mMaxDate, mFillDate);
  moreFiltersBtn.classList.toggle('btn--active', _moreTouched.size > 0);
}

function applyMoreFilters() {
  const f = readMoreFilters();
  const out = _sentData.filter(s =>
    (f.minLen == null || s.len >= f.minLen) &&
    (f.maxLen == null || s.len <= f.maxLen) &&
    (f.minDate == null || s.ts >= f.minDate) &&
    (f.maxDate == null || s.ts <= f.maxDate)
  ).filter(s => {
    if (f.maxNew == null) return true;
    const n = sentenceNewCount(s.text);
    return n == null || n <= f.maxNew; // unknown count (still counting) passes
  });
  renderSentenceList(out);
}

function renderSentenceList(list) {
  contextSentences.innerHTML = '';
  if (!list.length) {
    contextSentences.innerHTML = '<p class="no-context-msg">No sentences match the current filters.</p>';
    return;
  }
  for (const s of list) {
    const row = document.createElement('div');
    row.className = 'sentence-item sentence-item--clickable';
    const txt = document.createElement('span');
    txt.className = 'sentence-text';
    txt.textContent = s.text;
    row.appendChild(txt);

    const meta = document.createElement('span');
    meta.className = 'sentence-meta';
    if (!_sentCounting) {
      const n = sentenceNewCount(s.text);
      if (n != null) {
        const chip = document.createElement('span');
        chip.className = 'sentence-new';
        chip.textContent = `${n} new`;
        meta.appendChild(chip);
      }
    }
    const time = document.createElement('span');
    time.className = 'sentence-time';
    time.textContent = formatRelTime(s.ts);
    meta.appendChild(time);
    const link = document.createElement('span');
    link.className = 'sentence-context-link';
    link.textContent = 'Context';
    meta.appendChild(link);
    row.appendChild(meta);

    row.addEventListener('click', () => openMoreContext(s.text));
    contextSentences.appendChild(row);
  }
}

async function countSentenceWords(texts) {
  const [tokenizer, hasName] = await Promise.all([getTokenizer(), getNames()]);
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (_sentWords.has(text)) continue;
    const words = [];
    for (const tok of mergeSplitNouns(tokenizer.tokenize(text), hasName)) {
      if (!CONTENT_POS.has(tok.pos)) continue;
      const w = (tok.pos === '動詞' || tok.pos === '形容詞')
        ? (tok.basic_form || tok.surface_form).trim()
        : tok.surface_form.trim();
      if (w) words.push(w);
    }
    _sentWords.set(text, words);
    if (i % 15 === 0) await new Promise(r => setTimeout(r, 0)); // keep UI responsive
  }
}

export async function openContextModal(word) {
  contextWordTitle.textContent = word;
  contextSentences.innerHTML = '<p class="no-context-msg">Loading...</p>';
  showMoreList();

  // Show occurrences (left) and rank (right)
  const freq = getCurrentFreq().find(e => e.word === word);
  contextWordOcc.textContent = freq ? `×${freq.count}` : '';
  const rankVal = getDictRank(word);
  contextWordRank.textContent = rankVal ? `#${rankVal}` : '';

  const sentences = await findSentences(word);
  if (!sentences.length) {
    contextSentences.innerHTML = '<p class="no-context-msg">No sentences found containing this word.</p>';
    moreFiltersBtn.classList.add('hidden');
    contextModal.classList.remove('hidden');
    return;
  }

  moreFiltersBtn.classList.remove('hidden');
  _sentData = sentences.map(s => ({ text: s.text, ts: s.ts, len: [...s.text].length }));
  setupMoreFilters();
  applyMoreFilters();

  // Tokenize every matched sentence in the background to derive the
  // "new words per sentence" counts, then tighten filters once ready.
  _sentCounting = true;
  countSentenceWords(_sentData.map(s => s.text)).then(() => {
    _sentCounting = false;
    setupMoreFilters();
    applyMoreFilters();
  }).catch(() => { _sentCounting = false; applyMoreFilters(); });

  contextModal.classList.remove('hidden');
}

async function openMoreContext(text) {
  const ctx = await findSentenceContext(text);
  moreContextLines.innerHTML = '';
  if (!ctx) {
    moreContextLines.innerHTML = '<p class="no-context-msg">Source text is no longer available.</p>';
    showMoreContext();
    return;
  }
  const { sentences, index } = ctx;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < sentences.length; i++) {
    const d = document.createElement('div');
    d.className = 'context-line' + (i === index ? ' context-line--current' : '');
    d.textContent = sentences[i];
    frag.appendChild(d);
  }
  moreContextLines.appendChild(frag);
  moreContextInfo.textContent = `${index + 1}/${sentences.length}`;
  showMoreContext();
  const cur = moreContextLines.children[index];
  if (cur) moreContextLines.scrollTop = Math.max(0, cur.offsetTop);
}

function showMoreList() {
  moreContextPanel.classList.add('hidden');
  contextSentences.classList.remove('hidden');
  moreFiltersBtn.classList.remove('hidden');
}

function showMoreContext() {
  contextSentences.classList.add('hidden');
  moreContextPanel.classList.remove('hidden');
  moreFiltersBtn.classList.add('hidden');
}

function closeContextModal() { contextModal.classList.add('hidden'); }

function wireMoreFilters() {
  moreFiltersBtn.addEventListener('click', () => moreFiltersPanel.classList.remove('hidden'));
  moreFiltersPanel.querySelector('.quiz-filters-close').addEventListener('click', () => moreFiltersPanel.classList.add('hidden'));
  moreFiltersPanel.querySelector('.quiz-filters-backdrop').addEventListener('click', () => moreFiltersPanel.classList.add('hidden'));
  mMaxNew.addEventListener('input', () => { touchMore('maxNew'); fillSingle(mMaxNew, mFillNew); updateMoreLabels(); applyMoreFilters(); saveMoreFilters(); });
  wireDual(mMinLen, mMaxLen, mFillLen, 'len');
  wireDual(mMinDate, mMaxDate, mFillDate, 'date');
  moreContextBack.addEventListener('click', showMoreList);
  document.getElementById('moreFiltersReset').addEventListener('click', () => { _moreTouched.clear(); localStorage.removeItem(MORE_FILTER_KEY); setupMoreFilters(); applyMoreFilters(); });
}

function wireDual(minEl, maxEl, fillEl, group) {
  const apply = () => {
    if (Number(minEl.value) > Number(maxEl.value)) {
      if (document.activeElement === minEl) maxEl.value = minEl.value;
      else minEl.value = maxEl.value;
    }
    touchMore(group);
    fillDual(minEl, maxEl, fillEl);
    updateMoreLabels();
    applyMoreFilters();
    saveMoreFilters();
  };
  minEl.addEventListener('input', apply);
  maxEl.addEventListener('input', apply);
}

// --- Download modal ---
export function openDownloadModal() { downloadModal.classList.remove('hidden'); }
function closeDownloadModal() { downloadModal.classList.add('hidden'); }

function getVisible() {
  let e = getCurrentFreq()
    .filter(ee => !isFilteredOut(ee.word))
    .filter(ee => !listRangeOut(ee));
  if (getHideKnown()) e = e.filter(ee => !getKnownSet().has(ee.word));
  return e;
}
function downloadWeighted() {
  const e = getVisible(); const l = [];
  for (const { word, count } of e) for (let i = 0; i < count; i++) l.push(word);
  downloadTextFile(l.join('\n'), 'weighted-words.txt'); closeDownloadModal();
}
function downloadUnique() {
  const e = getVisible(); const l = [];
  for (const { word, count } of e) for (let i = 0; i < count; i++) l.push(word);
  const s = new Set(); const d = [];
  for (const w of l) { if (!s.has(w)) { s.add(w); d.push(w); } }
  downloadTextFile(d.join('\n'), 'unique-words.txt'); closeDownloadModal();
}
function downloadCSV() {
  const e = getVisible(); const BOM = '﻿'; const rows = ['word,count,sentences'];
  for (const { word, count } of e) {
    const s = findSentences(word); const str = s.map(x => x.text).join(' | ');
    rows.push(`"${word}","${count}","${str.replace(/"/g, '""')}"`);
  }
  downloadTextFile(BOM + rows.join('\n'), 'words-with-sentences.csv'); closeDownloadModal();
}

// --- Partial extract (structured sources: subtitles by time, mokuro by page) ---
// The source is the raw content of the last recognized upload, else the pasted
// textarea value. Editing the textarea drops the stored upload source.
let _partialSource = null;
let _partialSourceName = null;
let _partialModalSource = null; // source being edited in the open modal

function getPartialSource() {
  if (_partialSource) return _partialSource;
  return detectSource(pasteTextarea.value);
}

function updatePartialVisibility() {
  partialBtn.classList.toggle('hidden', !getPartialSource());
}

function fmtTime(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${m}:${p(ss)}`;
}

// Dense time ruler under the time slider: minor ticks plus a few readable
// major labels (e.g. every 5 min for a 24 min episode).
function renderPartialRuler(total) {
  partialRuler.innerHTML = '';
  if (!(total > 0)) return;
  const majors = [60, 120, 300, 600, 900, 1800, 3600];
  let major = majors[0];
  for (const s of majors) { if (s * 6 >= total) { major = s; break; } }
  const minor = Math.max(10, Math.round(major / 5));
  const frag = document.createDocumentFragment();
  for (let t = minor; t < total; t += minor) {
    const m = document.createElement('span');
    m.className = 'dual-ruler-minor';
    m.style.left = (t / total) * 100 + '%';
    frag.appendChild(m);
  }
  for (let t = major; t < total; t += major) {
    const s = document.createElement('span');
    s.className = 'dual-ruler-major';
    s.textContent = fmtTime(t);
    s.style.left = (t / total) * 100 + '%';
    frag.appendChild(s);
  }
  partialRuler.appendChild(frag);
}

function openPartialModal() {
  const src = getPartialSource();
  if (!src) return;
  _partialModalSource = src;
  const isSubs = src.kind === 'subs';
  partialTimeBlock.classList.toggle('hidden', !isSubs);
  partialPageBlock.classList.toggle('hidden', isSubs);
  if (isSubs) {
    const total = src.cues.reduce((m, c) => Math.max(m, c.end), 0);
    setRange(partialRngMinTime, 0, total, 0);
    setRange(partialRngMaxTime, 0, total, total);
    partialFormatLabel.textContent = `${src.subtype.toUpperCase()} · ${src.cues.length} cues`;
    renderPartialRuler(total);
  } else {
    const n = src.pages.length;
    setRange(partialRngMinPage, 1, n, 1);
    setRange(partialRngMaxPage, 1, n, n);
    partialFormatLabel.textContent = src.subtype === 'mokuro_text' ? 'Mokuro text' : 'Mokuro';
    renderPartialRuler(0);
  }
  updatePartialLabels();
  fillPartial();
  renderPartialPreview();
  partialModal.classList.remove('hidden');
}

function closePartialModal() { partialModal.classList.add('hidden'); }

function updatePartialLabels() {
  partialValTime.textContent = labelPair(partialRngMinTime, partialRngMaxTime, fmtTime);
  partialValPage.textContent = labelPair(partialRngMinPage, partialRngMaxPage);
}

function fillPartial() {
  fillDual(partialRngMinTime, partialRngMaxTime, partialFillTime);
  fillDual(partialRngMinPage, partialRngMaxPage, partialFillPage);
}

// Keep min <= max (the dragged thumb wins, like the filter popups).
function partialRange(loEl, hiEl) {
  if (Number(loEl.value) > Number(hiEl.value)) {
    if (document.activeElement === loEl) hiEl.value = loEl.value;
    else loEl.value = hiEl.value;
  }
  return [Number(loEl.value), Number(hiEl.value)];
}

// Preview shows what's at the cut boundaries (first + last selected unit) —
// enough to verify where the cut lands without rendering the whole selection.
function renderPartialPreview() {
  const src = _partialModalSource;
  if (!src) return;
  const isSubs = src.kind === 'subs';
  const [lo, hi] = isSubs ? partialRange(partialRngMinTime, partialRngMaxTime)
                          : partialRange(partialRngMinPage, partialRngMaxPage);
  const units = selectedUnits(src, lo, hi);

  partialPreview.textContent = '';
  if (!units.length) {
    partialPreview.textContent = 'Nothing in this range.';
    partialCount.textContent = '0 selected';
    return;
  }

  const frag = document.createDocumentFragment();
  const boundary = units.length === 1 ? [units[0]] : [units[0], units[units.length - 1]];
  for (const u of boundary) {
    if (isSubs) {
      const d = document.createElement('div');
      d.className = 'partial-cue';
      const t = document.createElement('span');
      t.className = 'partial-cue-time'; t.textContent = fmtTime(u.start);
      const x = document.createElement('span');
      x.className = 'partial-cue-text'; x.textContent = u.text;
      d.appendChild(t); d.appendChild(x);
      frag.appendChild(d);
    } else {
      const d = document.createElement('div');
      d.className = 'partial-page';
      const h = document.createElement('div');
      h.className = 'partial-page-head'; h.textContent = `Page ${u.n}`;
      const b = document.createElement('pre');
      b.className = 'partial-page-text'; b.textContent = u.text;
      d.appendChild(h); d.appendChild(b);
      frag.appendChild(d);
    }
  }
  if (units.length > 2) {
    const note = document.createElement('div');
    note.className = 'partial-note';
    note.textContent = `… ${units.length - 2} more in between`;
    frag.appendChild(note);
  }
  partialPreview.appendChild(frag);

  const chars = units.reduce((m, u) => m + u.text.length, 0);
  const unit = isSubs ? 'cue' : 'page';
  partialCount.textContent = `${units.length} ${unit}${units.length === 1 ? '' : 's'} · ${chars.toLocaleString()} chars`;
}

function selectedPartialText() {
  const src = _partialModalSource;
  if (!src) return '';
  const lo = src.kind === 'subs' ? Number(partialRngMinTime.value) : Number(partialRngMinPage.value);
  const hi = src.kind === 'subs' ? Number(partialRngMaxTime.value) : Number(partialRngMaxPage.value);
  return selectedText(src, lo, hi);
}

function wirePartial() {
  partialBtn.addEventListener('click', openPartialModal);
  partialModal.querySelector('.modal-backdrop').addEventListener('click', closePartialModal);
  partialModal.querySelector('.modal-close').addEventListener('click', closePartialModal);
  const wireRange = (minEl, maxEl) => {
    const onInput = () => {
      partialRange(minEl, maxEl);
      updatePartialLabels();
      fillPartial();
      renderPartialPreview();
    };
    minEl.addEventListener('input', onInput);
    maxEl.addEventListener('input', onInput);
  };
  wireRange(partialRngMinTime, partialRngMaxTime);
  wireRange(partialRngMinPage, partialRngMaxPage);
  partialExtractBtn.addEventListener('click', () => {
    const text = selectedPartialText();
    if (!text.trim()) { partialCount.textContent = 'Nothing selected in this range.'; return; }
    extractFromPaste(text, _partialSourceName);
    partialModal.classList.add('hidden');
  });
}

// --- QoL: press the slider track to jump the nearest thumb there and keep
// holding to scrub. Wired once for every .dual-range in the app; the thumbs
// themselves still drag natively (their input is the pointer target).
function wireTrackScrub() {
  document.querySelectorAll('.dual-range').forEach(container => {
    const els = [...container.querySelectorAll('input[type="range"]')];
    if (!els.length) return;
    const valueAt = (clientX) => {
      const r = container.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      const lo = +els[0].min, hi = +els[0].max;
      return Math.round(lo + frac * (hi - lo));
    };
    const nearest = (v) => els.reduce((a, b) =>
      Math.abs(v - +a.value) <= Math.abs(v - +b.value) ? a : b);
    const move = (el, clientX) => {
      const v = valueAt(clientX);
      el.value = Math.max(+el.min, Math.min(+el.max, v));
      el.dispatchEvent(new Event('input'));
    };
    let active = null;
    container.addEventListener('pointerdown', (e) => {
      if (e.target.closest('input[type="range"]')) return; // native thumb drag
      e.preventDefault();
      active = nearest(valueAt(e.clientX));
      move(active, e.clientX);
      container.setPointerCapture(e.pointerId);
    });
    container.addEventListener('pointermove', (e) => {
      if (!active) return;
      move(active, e.clientX);
    });
    const stop = (e) => {
      if (!active) return;
      active = null;
      if (container.hasPointerCapture && container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
    };
    container.addEventListener('pointerup', stop);
    container.addEventListener('pointercancel', stop);
  });
}

// --- Restore ---
async function checkSavedText() {
  try { if (await dbGet('lastText') && hasSavedBadge) hasSavedBadge.classList.remove('hidden'); } catch {}
}
restoreBtn.addEventListener('click', async () => {
  try {
    const s = await dbGet('lastText');
    if (s) {
      pasteTextarea.value = s;
      pasteStatus.textContent = 'Restored last text.';
      _partialSource = null;
      updatePartialVisibility();
    }
  } catch {}
});

// --- Event handlers ---
extractBtn.addEventListener('click', () => {
  const text = pasteTextarea.value;
  sessionStorage.setItem(PASTE_KEY, text);
  extractFromPaste(text);
});

// Custom sort dropdown (native <select> menus can't be themed — the open
// popup's highlight stays the browser's blue). State lives in _sortValue.
function setSortMenu(open) {
  sortSelectMenu.classList.toggle('hidden', !open);
  sortSelectBtn.setAttribute('aria-expanded', String(open));
}

sortSelectBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setSortMenu(sortSelectMenu.classList.contains('hidden'));
});

sortSelectMenu.querySelectorAll('.custom-select-option').forEach(opt => {
  opt.addEventListener('click', (e) => {
    e.stopPropagation();
    _sortValue = opt.dataset.value;
    sortSelectBtn.textContent = opt.textContent;
    for (const o of sortSelectMenu.querySelectorAll('.custom-select-option')) {
      o.setAttribute('aria-selected', String(o === opt));
    }
    setSortMenu(false);
    applyFilters(_sortValue);
  });
});

document.addEventListener('click', () => setSortMenu(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !sortSelectMenu.classList.contains('hidden')) setSortMenu(false);
});

hideKnownCheckbox.addEventListener('change', () => { setHideKnown(hideKnownCheckbox.checked); if (getCurrentAllWords().length) applyFilters(); });
hideHiraganaCheckbox.addEventListener('change', () => { setHideHiragana(hideHiraganaCheckbox.checked); if (getCurrentAllWords().length) applyFilters(); });
hideKatakanaCheckbox.addEventListener('change', () => { setHideKatakana(hideKatakanaCheckbox.checked); if (getCurrentAllWords().length) applyFilters(); });
downloadBtn.addEventListener('click', openDownloadModal);

// Upload modal
uploadBtn.addEventListener('click', () => { uploadModal.classList.remove('hidden'); uploadModalStatus.textContent = ''; });

function closeUploadModal() { uploadModal.classList.add('hidden'); }
uploadModal.querySelector('.modal-backdrop').addEventListener('click', closeUploadModal);
uploadModal.querySelector('.modal-close').addEventListener('click', closeUploadModal);

uploadDropZone.addEventListener('click', () => uploadModalInput.click());
uploadDropZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadDropZone.classList.add('drag-over'); });
uploadDropZone.addEventListener('dragleave', () => { uploadDropZone.classList.remove('drag-over'); });
uploadDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadDropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length > 0) handleUploadFile(e.dataTransfer.files[0]);
});

uploadModalInput.addEventListener('change', () => {
  if (uploadModalInput.files.length > 0) { handleUploadFile(uploadModalInput.files[0]); uploadModalInput.value = ''; }
});

function handleUploadFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const raw = e.target.result;
    const text = extractTextFromFile(file, raw);
    if (!text.trim()) { uploadModalStatus.textContent = 'No text could be extracted.'; return; }
    pasteTextarea.value = text;
    sessionStorage.setItem(PASTE_KEY, text);
    // Keep the raw file for Partial: uploads strip subtitle timestamps from
    // the textarea, so the structured source lives here instead.
    _partialSource = detectSource(raw, file.name);
    _partialSourceName = _partialSource ? file.name : null;
    uploadModalStatus.textContent = `Loaded "${file.name}" (${text.split('\n').length} lines).`;
    closeUploadModal();
    extractFromPaste(text, file.name);
    updatePartialVisibility();
  };
  reader.readAsText(file, 'UTF-8');
}

contextModal.querySelector('.modal-backdrop').addEventListener('click', closeContextModal);
contextModal.querySelector('.modal-close').addEventListener('click', closeContextModal);
downloadModal.querySelector('.modal-backdrop').addEventListener('click', closeDownloadModal);
downloadModal.querySelector('.modal-close').addEventListener('click', closeDownloadModal);
downloadModal.querySelectorAll('.download-option').forEach(opt => {
  opt.querySelector('.download-btn').addEventListener('click', () => {
    const f = opt.dataset.format;
    if (f === 'weighted') downloadWeighted();
    else if (f === 'unique') downloadUnique();
    else if (f === 'csv') downloadCSV();
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!partialModal.classList.contains('hidden')) { closePartialModal(); return; }
    if (!listFiltersPanel.classList.contains('hidden')) { closeListFilters(); return; }
    if (!moreFiltersPanel.classList.contains('hidden')) { moreFiltersPanel.classList.add('hidden'); return; }
    if (!contextModal.classList.contains('hidden') && !moreContextPanel.classList.contains('hidden')) { showMoreList(); return; }
    if (!contextModal.classList.contains('hidden')) closeContextModal();
    if (!downloadModal.classList.contains('hidden')) closeDownloadModal();
  }
});

// --- Init ---
export function initPrimer() {
  hideKnownCheckbox.checked = getHideKnown();
  hideHiraganaCheckbox.checked = getHideHiragana();
  hideKatakanaCheckbox.checked = getHideKatakana();
  wireMoreFilters();
  wireListFilters();
  wirePartial();
  wireTrackScrub();
  setupListFilters();
  updatePrimerUI();
  checkSavedText();

  // Clear any stale extraction state
  sessionStorage.removeItem('primerExtractionState');

  // Restore paste text from sessionStorage
  const saved = sessionStorage.getItem(PASTE_KEY);
  if (saved) pasteTextarea.value = saved;
  updatePartialVisibility();

  // Auto-save paste text on input; the structured source is re-derived from
  // the textarea once the user edits (upload raw no longer applies).
  pasteTextarea.addEventListener('input', () => {
    sessionStorage.setItem(PASTE_KEY, pasteTextarea.value);
    _partialSource = null;
    updatePartialVisibility();
  });

  // Auto-extract on restore from sessions
  if (sessionStorage.getItem('primerAutoExtract') === 'true') {
    sessionStorage.removeItem('primerAutoExtract');
    setSkipSessionSave(true);
    const text = pasteTextarea.value;
    if (text.trim()) setTimeout(() => extractFromPaste(text), 100);
  }
}
