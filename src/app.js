import { loadKnownWords } from './state.js';
import { loadDictFromDB, onDictChange } from './dict.js';
import { initPrimer, renderStats, renderDictUI, reprime } from './primer.js';

// --- Init ---
loadKnownWords();
initPrimer();
renderStats();
renderDictUI();

loadDictFromDB().then(() => {
  renderStats();
  renderDictUI();
  reprime();
});
