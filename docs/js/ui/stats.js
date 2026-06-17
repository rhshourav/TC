const STORAGE_KEY_TC = 'tokencrush-stats';

function loadStats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TC);
    return raw ? JSON.parse(raw) : { filesCompressed: 0, sessions: 0 };
  } catch { return { filesCompressed: 0, sessions: 0 }; }
}

function saveStats(stats) {
  try { localStorage.setItem(STORAGE_KEY_TC, JSON.stringify(stats)); } catch {}
}

export function initStats() {
  const stats = loadStats();
  stats.sessions++;
  saveStats(stats);
  renderStats(stats);
}

export function trackFileCompressed(count) {
  const stats = loadStats();
  stats.filesCompressed += count;
  saveStats(stats);
  renderStats(stats);
}

function renderStats(stats) {
  const el = document.getElementById('statsDisplay');
  if (!el) return;
  const vc = document.getElementById('visitorCount');
  const fc = document.getElementById('filesCompressedCount');
  if (vc) vc.textContent = '—';
  if (fc) fc.textContent = stats.filesCompressed.toLocaleString();
}
