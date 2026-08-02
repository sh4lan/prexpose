import { loadKnownWords, getKnownWords, removeKnownWord, formatDate } from './state.js';
import { createVirtualList } from './virtual.js';

const libraryList = document.getElementById('libraryList');
const libraryEmpty = document.getElementById('libraryEmpty');

// --- Render ---
function renderRow({ word, ts }) {
  const item = document.createElement('div');
  item.className = 'word-item';
  const textSpan = document.createElement('span');
  textSpan.className = 'word-text';
  textSpan.textContent = word;

  const dateSpan = document.createElement('span');
  dateSpan.className = 'word-date';
  dateSpan.textContent = formatDate(ts);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn btn-text btn-text-danger';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', () => {
    removeKnownWord(word);
    renderLibrary();
  });

  const actions = document.createElement('div');
  actions.className = 'word-actions';
  actions.appendChild(dateSpan);
  actions.appendChild(removeBtn);
  item.appendChild(textSpan);
  item.appendChild(actions);
  return item;
}

const libraryListVirtual = createVirtualList(libraryList, { renderRow });

function renderLibrary() {
  const entries = [...getKnownWords().entries()]
    .map(([w, t]) => ({ word: w, ts: new Date(t) }))
    .sort((a, b) => b.ts - a.ts);

  if (!entries.length) {
    libraryList.classList.add('hidden');
    libraryEmpty.classList.remove('hidden');
  } else {
    libraryList.classList.remove('hidden');
    libraryEmpty.classList.add('hidden');
  }
  libraryListVirtual.setItems(entries);
}

// --- Init ---
loadKnownWords();
renderLibrary();
