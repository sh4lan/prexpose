// Range-slider helpers for the word-context and word-list filter popups.
// They build dual/single range sliders with a filled track.

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

// Dictionary rank is log-scaled on the slider so low ranks (e.g. 3k) are easy
// to hit when the max is large (e.g. 100k). The slider coordinate stays
// linear (min..max); these two convert between a coordinate and its rank.
// The slider's floor (min) maps to 0 = "no lower bound"; the first usable
// step is rank 1, and rank grows geometrically to the ceiling.
export function sliderToLog(v, lo, hi) {
  if (v <= lo) return 0;
  if (v >= hi) return hi;
  const t = (v - lo) / (hi - lo);
  return Math.round(Math.pow(hi, t));
}

export function logToSlider(r, lo, hi) {
  if (r <= 1) return lo;
  if (r >= hi) return hi;
  const t = Math.log(r) / Math.log(hi);
  return lo + t * (hi - lo);
}
