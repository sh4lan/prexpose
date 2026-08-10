// Range-slider helpers shared by quiz.js (quiz filters) and primer.js
// (word-context filters). Both views build dual/single range sliders with a
// filled track; keep these here so the two never drift.

export function setRange(input, min, max, value) {
  input.min = min;
  input.max = max;
  input.value = value;
}

export function pct(v, lo, hi) {
  return hi === lo ? 0 : ((v - lo) / (hi - lo)) * 100;
}

export function fillDual(minEl, maxEl, fillEl) {
  const lo = Number(minEl.min), hi = Number(maxEl.max);
  fillEl.style.left = pct(Number(minEl.value), lo, hi) + '%';
  fillEl.style.right = (100 - pct(Number(maxEl.value), lo, hi)) + '%';
}

export function fillSingle(el, fillEl) {
  const lo = Number(el.min), hi = Number(el.max);
  fillEl.style.left = '0%';
  fillEl.style.right = (100 - pct(Number(el.value), lo, hi)) + '%';
}

export function labelSingle(el) {
  return Number(el.value) >= Number(el.max) ? 'any' : String(el.value);
}

// fmt is optional: pass it to render a date range (e.g. "Aug 3 — Aug 9")
// instead of raw slider values.
export function labelPair(minEl, maxEl, fmt) {
  if (Number(minEl.value) <= Number(minEl.min) && Number(maxEl.value) >= Number(maxEl.max)) return 'any';
  const lo = fmt ? fmt(Number(minEl.value)) : minEl.value;
  const hi = fmt ? fmt(Number(maxEl.value)) : maxEl.value;
  return `${lo} — ${hi}`;
}
