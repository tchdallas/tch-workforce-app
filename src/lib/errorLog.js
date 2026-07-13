// A small ring buffer of the most recent console errors/warnings and uncaught
// errors, so a bug report can carry "what the app was complaining about" without
// asking the person to open dev tools. Initialized once at app startup.
const BUFFER = [];
const MAX = 25;

function stringify(a) {
  if (a instanceof Error) return a.stack || a.message || String(a);
  if (typeof a === 'object' && a !== null) {
    try { return JSON.stringify(a); } catch { return String(a); }
  }
  return String(a);
}

function push(level, parts) {
  try {
    const msg = parts.map(stringify).join(' ').slice(0, 600);
    if (!msg.trim()) return;
    BUFFER.push({ level, msg, at: new Date().toISOString() });
    if (BUFFER.length > MAX) BUFFER.shift();
  } catch {
    /* never let logging throw */
  }
}

let installed = false;
export function initErrorLog() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  console.error = (...args) => { push('error', args); origError(...args); };
  console.warn = (...args) => { push('warn', args); origWarn(...args); };
  window.addEventListener('error', (e) => {
    push('error', [e.message + (e.filename ? ` @ ${e.filename}:${e.lineno || 0}` : '')]);
  });
  window.addEventListener('unhandledrejection', (e) => {
    push('error', ['Unhandled promise rejection: ' + stringify(e.reason)]);
  });
}

// newest last; a shallow copy so callers can't mutate the buffer
export function getRecentErrors() {
  return BUFFER.slice();
}
