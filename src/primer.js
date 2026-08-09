import {
  getKnownWords, getKnownSet, getCurrentAllWords, getCurrentFreq, getOriginalText,
  getHideHiragana, getHideKatakana, getNoSpoiler, setNoSpoiler,
  getHideShortSents, setHideShortSents,
  setCurrentAllWords, setCurrentFreq, setOriginalText, setHideHiragana, setHideKatakana,
  setSkipSessionSave, setVarMap,
  dbPut, dbGet, addKnownWord, removeKnownWord, getTokenizer,
  CONTENT_POS, isHiraganaOnly, isKatakanaOnly, escapeHtml, downloadTextFile,
  getWordImage, setWordImage, getWordImageFromDB,
  saveSession, findSentences
} from './state.js';
import { getDictRank, getDictMap, getDictName } from './dict.js';
import { createVirtualList } from './virtual.js';
import { buildQuizData } from './quizdata.js';

const PASTE_KEY = 'primerPasteText';

// --- DOM refs ---
const pasteTextarea = document.getElementById('pasteTextarea');
const extractBtn = document.getElementById('extractBtn');
const uploadBtn = document.getElementById('uploadBtn');
const quizBtn = document.getElementById('quizBtn');
const downloadBtn = document.getElementById('downloadBtn');
const pasteStatus = document.getElementById('pasteStatus');
const sortSelect = document.getElementById('sortSelect');
const hideHiraganaCheckbox = document.getElementById('hideHiraganaCheckbox');
const hideKatakanaCheckbox = document.getElementById('hideKatakanaCheckbox');
const noSpoilerCheckbox = document.getElementById('noSpoilerCheckbox');
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
const contextImageUrl = document.getElementById('contextImageUrl');
const contextWordImage = document.getElementById('contextWordImage');
const hideShortSentsCheckbox = document.getElementById('hideShortSentsCheckbox');
const downloadModal = document.getElementById('downloadModal');

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
    msg.textContent = 'All words are already in your known list or excluded by the current filter.';
  } else {
    msg.textContent = 'No new words to show. Paste some text above to get started.';
  }
  updateNewPercent();
}

function isFilteredOut(word) {
  return (getHideHiragana() && isHiraganaOnly(word)) || (getHideKatakana() && isKatakanaOnly(word));
}

// Share of pasted occurrences not yet known, weighted by count. Respects the
// kana filters so "42% new" matches exactly what the list is showing.
function updateNewPercent() {
  if (!newPct) return;
  const freq = getCurrentFreq();
  let total = 0, known = 0;
  for (const { word, count } of freq) {
    if (isFilteredOut(word)) continue;
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
export async function extractFromPaste(text) {
  text = text.replace(/^﻿/, '').trim();
  if (!text) { pasteStatus.textContent = 'No text to process.'; return; }

  setOriginalText(text);
  pasteStatus.textContent = 'Tokenizing...';

  try {
    const tokenizer = await getTokenizer();
    const lines = text.split('\n');
    const wordMap = new Map();
    const varMap = new Map();
    let totalTokens = 0;

    for (let i = 0; i < lines.length; i += 20) {
      const chunk = lines.slice(i, i + 20).join('\n');
      const tokens = tokenizer.tokenize(chunk);
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
      if (quizBtn) quizBtn.classList.add('hidden');
      return;
    }

    setCurrentAllWords(entries.map(e => e.word));
    setCurrentFreq(entries);
    setVarMap(varMap);

    // Persist the extraction for the quiz page (separate page, no shared memory).
    sessionStorage.setItem('primerQuizData', JSON.stringify({ words: entries.map(e => e.word), freq: entries, text }));

    // Build the quiz cache in the background so quiz.html opens instantly.
    // Idle yields control back to the UI while tokenizing.
    buildQuizData({ text, freq: entries }).then(cache => {
      try {
        sessionStorage.setItem('primerQuizCache', JSON.stringify({
          sentences: cache.sentences,
          sentenceWords: cache.sentenceWords,
          sentenceLen: cache.sentenceLen,
          byWord: [...cache.byWord.entries()],
        }));
      } catch { /* storage full — quiz will build on open */ }
    }).catch(() => {});

    // Save session for sentence lookup (all extracted words, not just new)
    saveSession(text, wordMap, varMap).catch(() => {});

    applyFilters();
    pasteStatus.textContent = `Extracted ${entries.length} unique words (${totalTokens} total).`;
    if (quizBtn) quizBtn.classList.remove('hidden');
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
  let entries = getCurrentFreq().slice().filter(e => !getKnownSet().has(e.word));
  if (getHideHiragana() || getHideKatakana()) entries = entries.filter(e => !isFilteredOut(e.word));

  const mode = sortOverride || sortSelect.value || 'count';
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
  if (getCurrentAllWords().length > 0) applyFilters();
  else updatePrimerUI();
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

// --- Context modal ---
let _contextWord = '';

const contextWordOcc = document.getElementById('contextWordOcc');
const contextWordRank = document.getElementById('contextWordRank');

function formatRelTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
  if (diff < 2592000000) return Math.floor(diff / 86400000) + 'd';
  return Math.floor(diff / 2592000000) + 'mo';
}

export async function openContextModal(word) {
  _contextWord = word;
  contextWordTitle.textContent = word;
  contextSentences.innerHTML = '<p class="no-context-msg">Loading...</p>';

  // Show occurrences (left) and rank (right)
  const freq = getCurrentFreq().find(e => e.word === word);
  contextWordOcc.textContent = freq ? `×${freq.count}` : '';
  const rankVal = getDictRank(word);
  contextWordRank.textContent = rankVal ? `#${rankVal}` : '';

  await renderSentences(word);

  // Load image
  let saved = getWordImage(word);
  if (!saved) saved = await getWordImageFromDB(word);
  if (saved) {
    contextImageUrl.value = saved;
    contextWordImage.src = saved;
    contextWordImage.classList.remove('hidden');
  } else {
    contextImageUrl.value = '';
    contextWordImage.classList.add('hidden');
  }
  contextModal.classList.remove('hidden');
}

async function renderSentences(word) {
  contextSentences.innerHTML = '<p class="no-context-msg">Loading...</p>';
  const sentences = await findSentences(word);
  contextSentences.innerHTML = '';
  if (!sentences.length) {
    contextSentences.innerHTML = '<p class="no-context-msg">No sentences found containing this word.</p>';
    return;
  }
  for (const { text, ts } of sentences) {
    const d = document.createElement('div');
    d.className = 'sentence-item';
    const textSpan = document.createElement('span');
    textSpan.textContent = text;
    d.appendChild(textSpan);
    const timeSpan = document.createElement('span');
    timeSpan.className = 'sentence-time';
    timeSpan.textContent = formatRelTime(ts);
    d.appendChild(timeSpan);
    contextSentences.appendChild(d);
  }
}

function closeContextModal() { contextModal.classList.add('hidden'); }

// Auto-save image URL on blur
contextImageUrl.addEventListener('blur', () => {
  const url = contextImageUrl.value.trim();
  setWordImage(_contextWord, url);
  if (url) {
    contextWordImage.src = url;
    contextWordImage.classList.remove('hidden');
  } else {
    contextWordImage.classList.add('hidden');
  }
});

// --- Download modal ---
export function openDownloadModal() { downloadModal.classList.remove('hidden'); }
function closeDownloadModal() { downloadModal.classList.add('hidden'); }

function getVisible() {
  return getCurrentFreq().filter(e => !getKnownSet().has(e.word)).filter(e => !isFilteredOut(e.word));
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
    const s = findSentences(word); const str = s.join(' | ');
    rows.push(`"${word}","${count}","${str.replace(/"/g, '""')}"`);
  }
  downloadTextFile(BOM + rows.join('\n'), 'words-with-sentences.csv'); closeDownloadModal();
}

// --- Restore ---
async function checkSavedText() {
  try { if (await dbGet('lastText') && hasSavedBadge) hasSavedBadge.classList.remove('hidden'); } catch {}
}
restoreBtn.addEventListener('click', async () => {
  try { const s = await dbGet('lastText'); if (s) { pasteTextarea.value = s; pasteStatus.textContent = 'Restored last text.'; } } catch {}
});

// --- Event handlers ---
extractBtn.addEventListener('click', () => {
  const text = pasteTextarea.value;
  sessionStorage.setItem(PASTE_KEY, text);
  extractFromPaste(text);
});

sortSelect.addEventListener('change', () => {
  applyFilters(sortSelect.value);
});

hideHiraganaCheckbox.addEventListener('change', () => { setHideHiragana(hideHiraganaCheckbox.checked); if (getCurrentAllWords().length) applyFilters(); });
hideKatakanaCheckbox.addEventListener('change', () => { setHideKatakana(hideKatakanaCheckbox.checked); if (getCurrentAllWords().length) applyFilters(); });
if (noSpoilerCheckbox) {
  noSpoilerCheckbox.addEventListener('change', () => {
    setNoSpoiler(noSpoilerCheckbox.checked);
    if (_contextWord) renderSentences(_contextWord);
  });
}
if (hideShortSentsCheckbox) {
  hideShortSentsCheckbox.addEventListener('change', () => {
    setHideShortSents(hideShortSentsCheckbox.checked);
    if (_contextWord) renderSentences(_contextWord);
  });
}
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
    const text = extractTextFromFile(file, e.target.result);
    if (!text.trim()) { uploadModalStatus.textContent = 'No text could be extracted.'; return; }
    pasteTextarea.value = text;
    sessionStorage.setItem(PASTE_KEY, text);
    uploadModalStatus.textContent = `Loaded "${file.name}" (${text.split('\n').length} lines).`;
    closeUploadModal();
    extractFromPaste(text);
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
    if (!contextModal.classList.contains('hidden')) closeContextModal();
    if (!downloadModal.classList.contains('hidden')) closeDownloadModal();
  }
});

// --- Init ---
export function initPrimer() {
  hideHiraganaCheckbox.checked = getHideHiragana();
  hideKatakanaCheckbox.checked = getHideKatakana();
  if (noSpoilerCheckbox) noSpoilerCheckbox.checked = getNoSpoiler();
  if (hideShortSentsCheckbox) hideShortSentsCheckbox.checked = getHideShortSents();
  updatePrimerUI();
  checkSavedText();

  // Clear any stale extraction state
  sessionStorage.removeItem('primerExtractionState');

  // Restore paste text from sessionStorage
  const saved = sessionStorage.getItem(PASTE_KEY);
  if (saved) pasteTextarea.value = saved;

  // Auto-save paste text on input
  pasteTextarea.addEventListener('input', () => {
    sessionStorage.setItem(PASTE_KEY, pasteTextarea.value);
  });

  // Auto-extract on restore from sessions
  if (sessionStorage.getItem('primerAutoExtract') === 'true') {
    sessionStorage.removeItem('primerAutoExtract');
    setSkipSessionSave(true);
    const text = pasteTextarea.value;
    if (text.trim()) setTimeout(() => extractFromPaste(text), 100);
  }
}
