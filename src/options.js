// Options view: theme, dictionary, import/export.
import { loadKnownWords, getKnownSet, addKnownWord, downloadTextFile } from './state.js';
import { loadDictFromDB, getDictMap, getDictName, loadDictionary, unloadDictionary } from './dict.js';
import { THEMES, getTheme, setTheme } from './theme.js';

const themeOptions = document.getElementById('themeOptions');
const dictStatus = document.getElementById('dictStatus');
const uploadDictBtn = document.getElementById('uploadDictBtn');
const removeDictBtn = document.getElementById('removeDictBtn');
const dictFileInput = document.getElementById('dictFileInput');
const importBtn = document.getElementById('importBtn');
const exportBtn = document.getElementById('exportBtn');
const libraryFileInput = document.getElementById('libraryFileInput');

// --- Theme ---
function renderThemeOptions() {
  themeOptions.innerHTML = '';
  const current = getTheme();
  for (const t of THEMES) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'theme-option' + (t.id === current ? ' theme-option--active' : '');
    row.dataset.theme = t.id;

    const swatch = document.createElement('span');
    swatch.className = 'theme-swatch';
    swatch.dataset.theme = t.id;

    const label = document.createElement('span');
    label.className = 'theme-option-label';
    label.textContent = t.label;

    const check = document.createElement('span');
    check.className = 'theme-check';
    check.textContent = t.id === current ? '✓' : '';

    row.appendChild(swatch);
    row.appendChild(label);
    row.appendChild(check);
    row.addEventListener('click', () => {
      setTheme(t.id);
      renderThemeOptions();
    });
    themeOptions.appendChild(row);
  }
}

// --- Dictionary ---
function renderDictStatus() {
  const map = getDictMap();
  if (map) {
    dictStatus.textContent = `Loaded: ${getDictName()} (${map.size.toLocaleString()} entries)`;
    removeDictBtn.classList.remove('hidden');
  } else {
    dictStatus.textContent = 'No dictionary loaded.';
    removeDictBtn.classList.add('hidden');
  }
}

uploadDictBtn.addEventListener('click', () => dictFileInput.click());
dictFileInput.addEventListener('change', () => {
  if (dictFileInput.files.length) {
    loadDictionary(dictFileInput.files[0]).then(() => { renderDictStatus(); });
    dictFileInput.value = '';
  }
});
removeDictBtn.addEventListener('click', () => {
  unloadDictionary();
  renderDictStatus();
});

// --- Import/Export ---
function importKnownWords(text) {
  text = text.replace(/^﻿/, '');
  const words = text.split(/\r?\n/).map(w => w.trim()).filter(Boolean).map(w => w.normalize('NFC'));
  if (!words.length) { alert('No words found.'); return; }
  let added = 0;
  for (const w of words) {
    if (!getKnownSet().has(w)) { addKnownWord(w); added++; }
  }
  if (added) alert(`Added ${added} word${added === 1 ? '' : 's'}.`);
  else alert('No new words to add.');
}

function exportKnownWords() {
  if (!getKnownSet().size) { alert('No known words.'); return; }
  downloadTextFile([...getKnownSet()].sort().join('\n'), 'known-words.txt');
}

importBtn.addEventListener('click', () => libraryFileInput.click());
libraryFileInput.addEventListener('change', () => {
  if (!libraryFileInput.files.length) return;
  const reader = new FileReader();
  reader.onload = (e) => importKnownWords(e.target.result);
  reader.readAsText(libraryFileInput.files[0], 'UTF-8');
  libraryFileInput.value = '';
});
exportBtn.addEventListener('click', exportKnownWords);

// --- Init ---
loadKnownWords();
renderThemeOptions();
renderDictStatus();
loadDictFromDB().then(() => { renderDictStatus(); });
