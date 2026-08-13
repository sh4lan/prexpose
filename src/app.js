import { loadKnownWords, getTokenizer, getNames } from './state.js';
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

// Preload the tokenizer (~17MB from CDN) and the JMnedict name list in the
// background once the page is interactive, so the first Extract is instant.
// Both are cached in memory for the rest of this page's lifetime.
const warmup = () => {
  getTokenizer().catch(() => {});
  getNames().catch(() => {});
};
if ('requestIdleCallback' in window) {
  requestIdleCallback(warmup, { timeout: 4000 });
} else {
  setTimeout(warmup, 0);
}
