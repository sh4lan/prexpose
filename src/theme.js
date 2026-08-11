// Theme system: a set of named themes, each mapping to a class on <html> that
// overrides the CSS variables in styles.css. 'light' is the no-class default.
// Theme state lives in localStorage['primerTheme'].

export const THEMES = [
  { id: 'light', label: 'Light' },
  { id: 'red', label: 'Red' },
  { id: 'dark', label: 'Dark' },
  { id: 'nord', label: 'Nord' },
  { id: 'sepia', label: 'Sepia' },
];

const CLASSES = THEMES.filter(t => t.id !== 'light').map(t => t.id);

export function getTheme() {
  const t = localStorage.getItem('primerTheme');
  return THEMES.some(x => x.id === t) ? t : 'light';
}

export function applyTheme(id) {
  for (const c of CLASSES) document.documentElement.classList.remove(c);
  if (id !== 'light') document.documentElement.classList.add(id);
}

export function setTheme(id) {
  localStorage.setItem('primerTheme', id);
  applyTheme(id);
}

export function initTheme() {
  applyTheme(getTheme());
}
