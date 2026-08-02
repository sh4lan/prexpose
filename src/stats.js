// Stats view: cumulative known-words-over-time chart plus summary tiles.
import { loadKnownWords, getKnownWords, getSessionList } from './state.js';

const chartEl = document.getElementById('chart');
const chartEmpty = document.getElementById('chartEmpty');
const tableBody = document.getElementById('statsTableBody');
const kpiKnown = document.getElementById('kpiKnown');
const kpiSessions = document.getElementById('kpiSessions');
const kpiChars = document.getElementById('kpiChars');
const filters = document.getElementById('chartFilters');

const H = 240, PAD_L = 46, PAD_R = 14, PAD_T = 14, PAD_B = 26;

let state = { days: [], totals: [], byDay: new Map() };
let rangeDays = null; // null = all time

// --- Date helpers (local days) ---
function toDayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function dayKeyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function fmtDay(key) {
  return dayKeyToDate(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function fmtDayFull(key) {
  return dayKeyToDate(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtMonth(key) {
  return dayKeyToDate(key + '-01').toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}
function niceCeil(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * mag) return m * mag;
  return 10 * mag;
}

// --- Data ---
function buildSeries(wordsMap) {
  const byDay = new Map();
  for (const ts of wordsMap.values()) {
    const key = toDayKey(new Date(ts));
    byDay.set(key, (byDay.get(key) || 0) + 1);
  }
  const keys = [...byDay.keys()].sort();
  if (!keys.length) return { days: [], totals: [], byDay };

  const start = dayKeyToDate(keys[0]);
  const end = new Date();
  end.setHours(0, 0, 0, 0);

  const days = [];
  const totals = [];
  let running = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = toDayKey(d);
    running += byDay.get(key) || 0;
    days.push(key);
    totals.push(running);
  }
  return { days, totals, byDay };
}

function visible() {
  const { days, totals } = state;
  if (!rangeDays || days.length <= rangeDays) return { days, totals };
  const start = days.length - rangeDays;
  return { days: days.slice(start), totals: totals.slice(start) };
}

// --- Chart ---
function renderChart() {
  const { days, totals } = visible();
  if (!days.length) {
    chartEl.innerHTML = '';
    chartEmpty.classList.remove('hidden');
    tableBody.innerHTML = '';
    return;
  }
  chartEmpty.classList.add('hidden');

  const W = Math.max(chartEl.clientWidth, 280);
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const n = days.length;
  const maxV = niceCeil(totals[totals.length - 1]);

  const x = (i) => PAD_L + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v) => PAD_T + (1 - v / maxV) * plotH;

  // Step-after polyline points
  const pts = [];
  const area = [];
  for (let i = 0; i < n; i++) {
    const px = x(i), py = y(totals[i]);
    pts.push(`${px},${py}`);
    area.push(`${px},${py}`);
    if (i < n - 1) {
      const nx = x(i + 1);
      pts.push(`${nx},${py}`);
      area.push(`${nx},${py}`);
    }
  }
  area.push(`${x(n - 1)},${y(0)}`);
  area.push(`${x(0)},${y(0)}`);

  const yTicks = 4;
  const tickStep = maxV / yTicks;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', H);
  svg.classList.add('stats-chart');

  // Gridlines + y labels
  for (let k = 0; k <= yTicks; k++) {
    const v = Math.round(k * tickStep);
    const gy = y(v);
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', PAD_L);
    line.setAttribute('x2', W - PAD_R);
    line.setAttribute('y1', gy);
    line.setAttribute('y2', gy);
    line.setAttribute('class', 'chart-grid');
    svg.appendChild(line);
    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', PAD_L - 6);
    text.setAttribute('y', gy + 3);
    text.setAttribute('text-anchor', 'end');
    text.setAttribute('class', 'chart-axis-label');
    text.textContent = v.toLocaleString();
    svg.appendChild(text);
  }

  // X labels (~5, always including the last)
  const xCount = 5;
  for (let k = 0; k < xCount; k++) {
    const i = Math.min(n - 1, Math.round((k * (n - 1)) / (xCount - 1)));
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', x(i));
    t.setAttribute('y', H - 8);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('class', 'chart-axis-label');
    t.textContent = fmtDay(days[i]);
    svg.appendChild(t);
  }

  // Area fill
  const areaPath = document.createElementNS(ns, 'path');
  areaPath.setAttribute('d', 'M' + area.join(' L') + ' Z');
  areaPath.setAttribute('class', 'chart-area');
  svg.appendChild(areaPath);

  // Line
  const linePath = document.createElementNS(ns, 'path');
  linePath.setAttribute('d', 'M' + pts.join(' L'));
  linePath.setAttribute('class', 'chart-line');
  svg.appendChild(linePath);

  // End marker
  const lastX = x(n - 1), lastY = y(totals[n - 1]);
  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('cx', lastX);
  dot.setAttribute('cy', lastY);
  dot.setAttribute('r', 4.5);
  dot.setAttribute('class', 'chart-dot');
  svg.appendChild(dot);

  // End value label
  const val = document.createElementNS(ns, 'text');
  val.setAttribute('x', Math.min(lastX + 8, W - 2));
  val.setAttribute('y', lastY - 8);
  val.setAttribute('text-anchor', 'start');
  val.setAttribute('class', 'chart-end-label');
  val.textContent = totals[n - 1].toLocaleString();
  svg.appendChild(val);

  // Crosshair (hidden until hover)
  const crosshair = document.createElementNS(ns, 'line');
  crosshair.setAttribute('x1', 0);
  crosshair.setAttribute('x2', 0);
  crosshair.setAttribute('y1', PAD_T);
  crosshair.setAttribute('y2', H - PAD_B);
  crosshair.setAttribute('class', 'chart-crosshair');
  crosshair.style.display = 'none';
  svg.appendChild(crosshair);

  // Hover layer
  const hit = document.createElementNS(ns, 'rect');
  hit.setAttribute('x', PAD_L);
  hit.setAttribute('y', PAD_T);
  hit.setAttribute('width', plotW);
  hit.setAttribute('height', plotH);
  hit.setAttribute('fill', 'transparent');
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.style.display = 'none';

  hit.addEventListener('pointermove', (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const t = Math.max(0, Math.min(n - 1, Math.round(((px - PAD_L) / plotW) * (n - 1))));
    const hx = x(t);
    crosshair.setAttribute('x1', hx);
    crosshair.setAttribute('x2', hx);
    crosshair.style.display = '';
    tip.textContent = `${fmtDayFull(days[t])} · ${totals[t].toLocaleString()} known`;
    tip.style.display = 'block';
    tip.style.left = Math.min(hx + 10, W - 150) + 'px';
    tip.style.top = '8px';
  });
  hit.addEventListener('pointerleave', () => {
    crosshair.style.display = 'none';
    tip.style.display = 'none';
  });

  svg.appendChild(hit);
  chartEl.innerHTML = '';
  chartEl.appendChild(svg);
  chartEl.appendChild(tip);
  renderTable(days, totals);
}

// --- Table ---
function renderTable(days, totals) {
  const byDay = state.byDay;
  const rows = [];
  if (days.length <= 120) {
    for (let i = 0; i < days.length; i++) {
      rows.push({ label: fmtDayFull(days[i]), added: byDay.get(days[i]) || 0, total: totals[i] });
    }
  } else {
    let cur = null, added = 0;
    for (let i = 0; i < days.length; i++) {
      const mKey = days[i].slice(0, 7);
      if (cur && mKey !== cur) { rows.push({ label: fmtMonth(cur), added, total: totals[i - 1] }); added = 0; }
      cur = mKey;
      added += byDay.get(days[i]) || 0;
    }
    if (cur) rows.push({ label: fmtMonth(cur), added, total: totals[days.length - 1] });
  }

  const frag = document.createDocumentFragment();
  for (const r of rows) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td'); td1.textContent = r.label;
    const td2 = document.createElement('td'); td2.textContent = r.added.toLocaleString();
    const td3 = document.createElement('td'); td3.textContent = r.total.toLocaleString();
    tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
    frag.appendChild(tr);
  }
  tableBody.innerHTML = '';
  tableBody.appendChild(frag);
}

// --- Init ---
function init() {
  loadKnownWords();
  const words = getKnownWords();
  state = buildSeries(words);

  kpiKnown.textContent = words.size.toLocaleString();

  getSessionList().then((sessions) => {
    kpiSessions.textContent = sessions.length.toLocaleString();
    const chars = sessions.reduce((sum, s) => {
      return sum + (s.charCount ?? (s.sentences ? s.sentences.join('').length : 0));
    }, 0);
    kpiChars.textContent = chars.toLocaleString();
    renderChart();
  });

  filters.addEventListener('click', (e) => {
    const btn = e.target.closest('.range-btn');
    if (!btn) return;
    for (const b of filters.querySelectorAll('.range-btn')) b.classList.remove('range-btn--active');
    btn.classList.add('range-btn--active');
    rangeDays = btn.dataset.range ? Number(btn.dataset.range) : null;
    renderChart();
  });

  const ro = new ResizeObserver(() => renderChart());
  ro.observe(chartEl);
}

init();
