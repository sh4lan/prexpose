import { getSessionList, getSessionText, deleteSession, getKnownWords, loadKnownWords } from './state.js';
import { createVirtualList } from './virtual.js';

const sessionList = document.getElementById('sessionList');
const sessionEmpty = document.getElementById('sessionEmpty');

function sessionCharCount(session) {
  return session.charCount ?? (session.sentences ? session.sentences.join('').length : 0);
}

// Words added to the known list whose timestamp falls in this session's active
// window: from the session's creation until the next (newer) session was saved.
function knownAddedBetween(startMs, endMs) {
  let n = 0;
  for (const t of getKnownWords().values()) {
    const ms = new Date(t).getTime();
    if (ms >= startMs && ms < endMs) n++;
  }
  return n;
}

function formatRelTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 2592000000) return Math.floor(diff / 86400000) + 'd ago';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderRow(session) {
  const item = document.createElement('div');
  item.className = 'word-item';

  const textSpan = document.createElement('span');
  textSpan.className = 'word-text';
  textSpan.textContent = `${sessionCharCount(session).toLocaleString()} chars · ${session.knownAdded} known`;

  const dateSpan = document.createElement('span');
  dateSpan.className = 'word-date';
  dateSpan.textContent = formatRelTime(session.ts);

  const restoreBtn = document.createElement('button');
  restoreBtn.className = 'btn btn-text';
  restoreBtn.textContent = 'Restore';
  restoreBtn.addEventListener('click', async () => {
    const text = await getSessionText(session.id);
    if (text) {
      sessionStorage.setItem('primerPasteText', text);
      sessionStorage.setItem('primerAutoExtract', 'true');
      window.location.href = 'index.html';
    }
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn-text btn-text-danger';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', async () => {
    await deleteSession(session.id);
    render();
  });

  const actions = document.createElement('div');
  actions.className = 'word-actions';
  actions.appendChild(dateSpan);
  actions.appendChild(restoreBtn);
  actions.appendChild(delBtn);

  item.appendChild(textSpan);
  item.appendChild(actions);
  return item;
}

const sessionListVirtual = createVirtualList(sessionList, { renderRow });

async function render() {
  const sessions = await getSessionList(); // newest first
  const now = Date.now();
  const rows = sessions.map((s, i) => ({
    ...s,
    knownAdded: knownAddedBetween(s.ts, i === 0 ? now : sessions[i - 1].ts),
  }));

  if (!rows.length) {
    sessionList.classList.add('hidden');
    sessionEmpty.classList.remove('hidden');
  } else {
    sessionList.classList.remove('hidden');
    sessionEmpty.classList.add('hidden');
  }
  sessionListVirtual.setItems(rows);
}

loadKnownWords();
render();
