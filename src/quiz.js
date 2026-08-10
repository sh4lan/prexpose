import {
  getCurrentFreq, getOriginalText, getKnownSet,
  addKnownWord, removeKnownWord,
  setCurrentAllWords, setCurrentFreq, setOriginalText,
  loadKnownWords, isHiraganaOnly, isKatakanaOnly,
} from './state.js';
import { getDictRank, getDictMap, loadDictFromDB } from './dict.js';
import { buildQuizData } from './quizdata.js';
import { setRange, pct, fillDual, fillSingle, labelSingle, labelPair } from './ranges.js';

const FILTER_KEY = 'primerQuizFilters';

// --- DOM refs ---
const quizSentenceEl = document.getElementById('quizSentence');
const quizProgress = document.getElementById('quizProgress');
const quizSentPos = document.getElementById('quizSentPos');
const quizNavStrip = document.getElementById('quizNavStrip');
const quizPrevSentBtn = document.getElementById('quizPrevSentBtn');
const quizNextSentBtn = document.getElementById('quizNextSentBtn');
const quizAddKnownBtn = document.getElementById('quizAddKnownBtn');
const quizContextBtn = document.getElementById('quizContextBtn');
const quizFiltersBtn = document.getElementById('quizFiltersBtn');

const filtersPanel = document.getElementById('quizFiltersPanel');
const contextModal = document.getElementById('quizContextModal');
const contextPanel = document.getElementById('quizContextPanel');
const hideHiraganaCheckbox = document.getElementById('quizHideHiraganaCheckbox');
const hideKatakanaCheckbox = document.getElementById('quizHideKatakanaCheckbox');

const fMaxNew = document.getElementById('rngMaxNew');
const fMinLen = document.getElementById('rngMinLen');
const fMaxLen = document.getElementById('rngMaxLen');
const fMinOcc = document.getElementById('rngMinOcc');
const fMaxOcc = document.getElementById('rngMaxOcc');
const fMinRank = document.getElementById('rngMinRank');
const fMaxRank = document.getElementById('rngMaxRank');
const valMaxNew = document.getElementById('valMaxNew');
const valLen = document.getElementById('valLen');
const valOcc = document.getElementById('valOcc');
const valRank = document.getElementById('valRank');
const fillMaxNew = document.getElementById('fillMaxNew');
const fillLen = document.getElementById('fillLen');
const fillOcc = document.getElementById('fillOcc');
const fillRank = document.getElementById('fillRank');

// --- Cache (built once, then reused across pool rebuilds) ---
let sentences = [];
let sentenceWords = [];
let sentenceLen = [];
let byWord = new Map();
let freq = [];

// --- Pool ---
let newCount = [];
let pool = [];
let curWord = 0;
let curSent = 0;
const quizAdded = new Set(); // words marked known during this quiz session

function kanaHidden(word) {
  return (hideHiraganaCheckbox.checked && isHiraganaOnly(word)) ||
         (hideKatakanaCheckbox.checked && isKatakanaOnly(word));
}

// A slider at an extreme means "no filter": min at its floor or max at its
// ceiling means unconstrained. Words with no dict rank behave like infinite
// rank — they pass a min-rank filter and are excluded by a max-rank filter.
function readFilters() {
  const val = e => Number(e.value);
  return {
    maxNew: val(fMaxNew) >= Number(fMaxNew.max) ? null : val(fMaxNew),
    minLen: val(fMinLen) <= Number(fMinLen.min) ? null : val(fMinLen),
    maxLen: val(fMaxLen) >= Number(fMaxLen.max) ? null : val(fMaxLen),
    minOcc: val(fMinOcc) <= Number(fMinOcc.min) ? null : val(fMinOcc),
    maxOcc: val(fMaxOcc) >= Number(fMaxOcc.max) ? null : val(fMaxOcc),
    minRank: val(fMinRank) <= Number(fMinRank.min) ? null : val(fMinRank),
    maxRank: val(fMaxRank) >= Number(fMaxRank.max) ? null : val(fMaxRank),
  };
}

function saveFilters() {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify({
      maxNew: fMaxNew.value, minLen: fMinLen.value, maxLen: fMaxLen.value,
      minOcc: fMinOcc.value, maxOcc: fMaxOcc.value,
      minRank: fMinRank.value, maxRank: fMaxRank.value,
      hideHira: hideHiraganaCheckbox.checked, hideKata: hideKatakanaCheckbox.checked,
    }));
  } catch { /* storage unavailable */ }
}

// --- Pool ---
function buildPool() {
  const f = readFilters();
  const known = getKnownSet();
  newCount = sentences.map((_, i) => {
    let n = 0;
    for (const w of sentenceWords[i]) if (!known.has(w) && !kanaHidden(w)) n++;
    return n;
  });

  pool = [];
  for (const { word, count } of freq) {
    // Words added to known during this quiz stay in the pool (marked) so you
    // can undo them; words already known before opening are skipped.
    const added = quizAdded.has(word);
    if (!added && (known.has(word) || kanaHidden(word))) continue;
    if (f.minOcc != null && count < f.minOcc) continue;
    if (f.maxOcc != null && count > f.maxOcc) continue;
    if (f.minRank != null) { const r = getDictRank(word); if (r != null && r < f.minRank) continue; }
    if (f.maxRank != null) { const r = getDictRank(word); if (r == null || r > f.maxRank) continue; }

    let sents = (byWord.get(word) || []).filter(i =>
      (f.minLen == null || sentenceLen[i] >= f.minLen) &&
      (f.maxLen == null || sentenceLen[i] <= f.maxLen) &&
      (f.maxNew == null || newCount[i] <= f.maxNew)
    );
    // Keep added words around for undo even if no sentence matches the filters.
    if (!sents.length && added) sents = byWord.get(word) || [];
    if (!sents.length) continue;
    // Prefer sentences closest to n+1 (fewest new words), then longest.
    sents.sort((a, b) => (newCount[a] - newCount[b]) || (sentenceLen[b] - sentenceLen[a]));
    pool.push({ word, count, sents, added });
  }
}

// --- Filter sliders (helpers live in ranges.js) ---
function updateLabels() {
  valMaxNew.textContent = labelSingle(fMaxNew);
  valLen.textContent = labelPair(fMinLen, fMaxLen);
  valOcc.textContent = labelPair(fMinOcc, fMaxOcc);
  valRank.textContent = labelPair(fMinRank, fMaxRank);
}

function setupFilters() {
  const lenMin = Math.min(...sentenceLen);
  const lenMax = Math.max(...sentenceLen);
  const maxOcc = Math.max(...freq.map(e => e.count), 1);
  const maxNew = Math.max(...sentenceWords.map(a => a.length), 1);
  let rankMax = 1;
  for (const e of freq) { const r = getDictRank(e.word); if (r != null && r > rankMax) rankMax = r; }

  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(FILTER_KEY)); } catch { /* ignore */ }
  const within = (v, lo, hi) => v != null && v >= lo && v <= hi;

  const maxNewV = within(saved?.maxNew, 1, maxNew) ? Number(saved.maxNew) : maxNew;
  const minLenV = within(saved?.minLen, lenMin, lenMax) ? Number(saved.minLen) : lenMin;
  const maxLenV = within(saved?.maxLen, lenMin, lenMax) ? Number(saved.maxLen) : lenMax;
  const minOccV = within(saved?.minOcc, 1, maxOcc) ? Number(saved.minOcc) : 1;
  const maxOccV = within(saved?.maxOcc, 1, maxOcc) ? Number(saved.maxOcc) : maxOcc;
  const minRankV = within(saved?.minRank, 0, rankMax) ? Number(saved.minRank) : 0;
  const maxRankV = within(saved?.maxRank, 0, rankMax) ? Number(saved.maxRank) : rankMax;

  setRange(fMaxNew, 1, maxNew, maxNewV);
  setRange(fMinLen, lenMin, lenMax, minLenV);
  setRange(fMaxLen, lenMin, lenMax, maxLenV);
  setRange(fMinOcc, 1, maxOcc, minOccV);
  setRange(fMaxOcc, 1, maxOcc, maxOccV);
  setRange(fMinRank, 0, rankMax, minRankV);
  setRange(fMaxRank, 0, rankMax, maxRankV);
  hideHiraganaCheckbox.checked = !!saved?.hideHira;
  hideKatakanaCheckbox.checked = !!saved?.hideKata;
  document.getElementById('rankBlock').classList.toggle('hidden', !getDictMap());

  updateLabels();
  fillSingle(fMaxNew, fillMaxNew);
  fillDual(fMinLen, fMaxLen, fillLen);
  fillDual(fMinOcc, fMaxOcc, fillOcc);
  fillDual(fMinRank, fMaxRank, fillRank);
}

function rebuild() { buildPool(); startQuiz(); }

function wireDual(minEl, maxEl, fillEl) {
  const apply = () => {
    if (Number(minEl.value) > Number(maxEl.value)) {
      if (document.activeElement === minEl) maxEl.value = minEl.value;
      else minEl.value = maxEl.value;
    }
    fillDual(minEl, maxEl, fillEl);
    updateLabels();
    saveFilters();
    rebuild();
  };
  minEl.addEventListener('input', apply);
  maxEl.addEventListener('input', apply);
}

function wireFilters() {
  fMaxNew.addEventListener('input', () => { fillSingle(fMaxNew, fillMaxNew); updateLabels(); saveFilters(); rebuild(); });
  wireDual(fMinLen, fMaxLen, fillLen);
  wireDual(fMinOcc, fMaxOcc, fillOcc);
  wireDual(fMinRank, fMaxRank, fillRank);
  for (const el of [hideHiraganaCheckbox, hideKatakanaCheckbox]) {
    el.addEventListener('change', () => { saveFilters(); rebuild(); });
  }
  quizFiltersBtn.addEventListener('click', () => filtersPanel.classList.remove('hidden'));
  filtersPanel.querySelector('.quiz-filters-close').addEventListener('click', () => filtersPanel.classList.add('hidden'));
  filtersPanel.querySelector('.quiz-filters-backdrop').addEventListener('click', () => filtersPanel.classList.add('hidden'));
  document.getElementById('quizFiltersReset').addEventListener('click', () => {
    localStorage.removeItem(FILTER_KEY);
    setupFilters();
    rebuild();
  });
}

// --- Navigator: full row of clickable word blocks, scrolled sideways ---
function renderNav() {
  const strip = quizNavStrip;
  // Rebuilding children clamps scrollLeft to 0, so preserve the current scroll
  // position to avoid the strip jumping when a word is selected.
  const prevScroll = strip.scrollLeft;
  strip.innerHTML = '';
  if (!pool.length) { updateEdgeFade(); return; }

  const known = getKnownSet();
  const frag = document.createDocumentFragment();
  for (let i = 0; i < pool.length; i++) {
    const w = pool[i];
    const el = document.createElement('button');
    el.className = 'quiz-nav-block'
      + (i === curWord ? ' quiz-nav-block--current' : '')
      + (known.has(w.word) ? ' quiz-nav-block--added' : '');

    // Flashcard-cell layout: the word is the hero; occ and rank are small
    // corner badges (rank top-left, occ bottom-right). No dict rank just
    // leaves that corner empty — no hollow text line.
    const r = getDictRank(w.word);
    const rankSpan = document.createElement('span');
    rankSpan.className = 'quiz-nav-rank';
    rankSpan.textContent = r != null ? `#${r}` : '';
    el.appendChild(rankSpan);

    const wordSpan = document.createElement('span');
    wordSpan.className = 'quiz-nav-word';
    wordSpan.textContent = w.word;
    el.appendChild(wordSpan);

    const occSpan = document.createElement('span');
    occSpan.className = 'quiz-nav-occ';
    occSpan.textContent = w.count > 0 ? `×${w.count}` : '';
    el.appendChild(occSpan);

    el.title = [w.count > 0 ? `×${w.count}` : '', r != null ? `#${r}` : ''].filter(Boolean).join(' ') || w.word;
    el.addEventListener('click', () => { curWord = i; curSent = 0; render(); });
    frag.appendChild(el);
  }
  strip.appendChild(frag);
  strip.scrollLeft = Math.min(prevScroll, strip.scrollWidth - strip.clientWidth);
  updateEdgeFade();
}

// Dim the strip's edge(s) when there's more content off-screen, instead of
// showing ellipsis. No mask when the strip fits (or is at a hard edge).
function updateEdgeFade() {
  const el = quizNavStrip;
  const max = el.scrollWidth - el.clientWidth;
  if (max <= 0) {
    el.style.maskImage = '';
    el.style.webkitMaskImage = '';
    return;
  }
  const left = el.scrollLeft > 2 ? 28 : 0;
  const right = el.scrollLeft < max - 2 ? 28 : 0;
  const grad = `linear-gradient(to right, transparent 0, #000 ${left}px, #000 calc(100% - ${right}px), transparent 100%)`;
  el.style.maskImage = grad;
  el.style.webkitMaskImage = grad;
}

// Side-scroll the strip without a scrollbar (wheel, arrows, and drag).
function scrollStrip(dx) {
  if (!quizNavStrip.scrollWidth) return;
  const w = quizNavStrip.clientWidth;
  const d = Math.max(1, Math.round(w * 0.7));
  const target = dx < 0 ? quizNavStrip.scrollLeft - d : quizNavStrip.scrollLeft + d;
  quizNavStrip.scrollTo({ left: target, behavior: 'smooth' });
}

function wireNavScrolling() {
  quizNavStrip.addEventListener('scroll', updateEdgeFade, { passive: true });
  window.addEventListener('resize', () => { if (!pool.length) return; updateEdgeFade(); }, { passive: true });

  quizNavStrip.addEventListener('wheel', (e) => {
    if (quizNavStrip.scrollWidth <= quizNavStrip.clientWidth + 1) return;
    // Use whichever axis the gesture is on: a horizontal two-finger swipe OR a
    // vertical wheel/trackpad scroll both move the horizontal strip. Without
    // this, horizontal gestures fell through to the browser's native 1:1 scroll.
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    e.preventDefault();
    // Touchpads emit many small deltas, so a vertical two-finger scroll over
    // the strip needs a strong boost to feel responsive. Mouse-wheel notches
    // already move a lot, so boost those less.
    const gain = Math.abs(d) < 24 ? 6 : 1.8;
    quizNavStrip.scrollLeft += d * gain;
    updateEdgeFade();
  }, { passive: false });

  const DRAG_GAIN = 3.5; // dragging scrolls further than the pointer moves
  let dragging = false, startX = 0, startScroll = 0;
  quizNavStrip.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.quiz-nav-block')) return;
    dragging = true;
    startX = e.clientX;
    startScroll = quizNavStrip.scrollLeft;
    quizNavStrip.style.cursor = 'grabbing';
    e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    quizNavStrip.scrollLeft = startScroll - (e.clientX - startX) * DRAG_GAIN;
  });
  window.addEventListener('pointerup', () => {
    dragging = false;
    quizNavStrip.style.cursor = '';
  });

  window.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'ArrowRight') { if (e.shiftKey) scrollStrip(1); else nextWord(); }
    else if (e.key === 'ArrowLeft') { if (e.shiftKey) scrollStrip(-1); else prevWord(); }
  });
}

// --- Render ---
function render() {
  if (!pool.length) {
    showEmpty('No words match the current filters.');
    return;
  }

  const w = pool[curWord];
  quizSentenceEl.textContent = sentences[w.sents[curSent]];
  quizProgress.textContent = `${curWord + 1}/${pool.length}`;
  quizSentPos.textContent = `sentence ${curSent + 1}/${w.sents.length}`;

  const isKnown = getKnownSet().has(w.word);
  quizAddKnownBtn.classList.remove('hidden');
  quizAddKnownBtn.textContent = isKnown ? 'Undo' : 'Add to known';
  quizAddKnownBtn.classList.toggle('btn-add', !isKnown);
  quizAddKnownBtn.classList.toggle('btn-undo-text', isKnown);
  quizPrevSentBtn.disabled = curSent === 0;
  quizNextSentBtn.disabled = curSent === w.sents.length - 1;
  renderNav();
}

function showEmpty(msg) {
  quizSentenceEl.textContent = msg;
  quizProgress.textContent = '';
  quizSentPos.textContent = '';
  quizAddKnownBtn.classList.add('hidden');
  quizPrevSentBtn.disabled = true;
  quizNextSentBtn.disabled = true;
  renderNav();
}

// --- Context popup ---
function renderContext(sIdx) {
  contextPanel.innerHTML = '';
  sentences.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'context-line' + (i === sIdx ? ' context-line--current' : '');
    d.textContent = s;
    contextPanel.appendChild(d);
  });
  const cur = contextPanel.children[sIdx];
  if (cur) {
    // Scroll the current sentence to the top of the popup so you see the
    // context that led up to it.
    contextPanel.scrollTop = Math.max(0, cur.offsetTop);
  }
}

function toggleContext() {
  if (contextModal.classList.contains('hidden')) {
    if (!pool.length) return;
    contextModal.classList.remove('hidden');
    renderContext(pool[curWord].sents[curSent]);
  } else {
    contextModal.classList.add('hidden');
  }
}

// --- Navigation ---
function startQuiz() {
  curWord = 0; curSent = 0;
  quizNavStrip.scrollLeft = 0; // fresh pool -> start at the left edge
  render();
}

function nextWord() {
  if (curWord >= pool.length - 1) return;
  curWord++; curSent = 0; render();
}

function prevWord() {
  if (curWord <= 0) return;
  curWord--; curSent = 0; render();
}

function nextSentence() {
  if (!pool.length) return;
  if (curSent < pool[curWord].sents.length - 1) curSent++;
  else if (curWord < pool.length - 1) { curWord++; curSent = 0; }
  else return;
  render();
}

function prevSentence() {
  if (!pool.length) return;
  if (curSent > 0) curSent--;
  else if (curWord > 0) { curWord--; curSent = pool[curWord].sents.length - 1; }
  else return;
  render();
}

// --- Init ---
async function init() {
  loadKnownWords();
  await loadDictFromDB();
  wireFilters();
  wireNavScrolling();

  let data = null;
  try { data = JSON.parse(sessionStorage.getItem('primerQuizData')); } catch { /* corrupt */ }
  if (!data || !Array.isArray(data.freq) || !data.freq.length || typeof data.text !== 'string') {
    showEmpty('Extract some words on the main page first.');
    return;
  }

  setCurrentAllWords(data.words);
  setCurrentFreq(data.freq);
  setOriginalText(data.text);
  sessionStorage.setItem('primerPasteText', data.text);
  sessionStorage.setItem('primerAutoExtract', 'true');

  quizSentenceEl.textContent = 'Building quiz...';
  try {
    // Use a cache prebuilt on the main view if available, else build here.
    const cached = JSON.parse(sessionStorage.getItem('primerQuizCache') || 'null');
    if (cached && cached.sentences && cached.byWord) {
      sentences = cached.sentences;
      sentenceWords = cached.sentenceWords;
      sentenceLen = cached.sentenceLen;
      byWord = new Map(cached.byWord);
      freq = getCurrentFreq();
    } else {
      ({ sentences, sentenceWords, sentenceLen, byWord } = await buildQuizData(data));
      freq = getCurrentFreq();
    }
    sessionStorage.removeItem('primerQuizCache');
    setupFilters();
    buildPool();
    startQuiz();
  } catch (err) {
    console.error(err);
    showEmpty('Failed to build quiz: ' + (err.message || err));
  }
}

// --- Events ---
quizPrevSentBtn.addEventListener('click', prevSentence);
quizNextSentBtn.addEventListener('click', nextSentence);
quizContextBtn.addEventListener('click', toggleContext);
contextModal.querySelector('.modal-backdrop').addEventListener('click', () => contextModal.classList.add('hidden'));
contextModal.querySelector('.modal-close').addEventListener('click', () => contextModal.classList.add('hidden'));

quizAddKnownBtn.addEventListener('click', () => {
  if (!pool.length) return;
  const word = pool[curWord].word;
  if (quizAdded.has(word)) {
    removeKnownWord(word);
    quizAdded.delete(word);
  } else {
    addKnownWord(word);
    quizAdded.add(word);
  }
  buildPool();
  render(); // stay on the same word so you can undo right away
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!filtersPanel.classList.contains('hidden')) { filtersPanel.classList.add('hidden'); return; }
    if (!contextModal.classList.contains('hidden')) { contextModal.classList.add('hidden'); return; }
    window.location.href = 'index.html';
    return;
  }
});

init();
