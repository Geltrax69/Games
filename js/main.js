// Entry point / bootstrap.
// IMPORTANT: error capture is installed BEFORE the game is imported/instantiated
// so the headless verification harness can observe any failure during init.

window.__consoleErrors = window.__consoleErrors || [];

window.addEventListener('error', (e) => {
  const msg = String(e.message || e.error || 'unknown error');
  if (!__isBenign(msg)) window.__consoleErrors.push(msg);
});

window.addEventListener('unhandledrejection', (e) => {
  const msg = 'promise:' + String(e.reason);
  if (!__isBenign(msg)) window.__consoleErrors.push(msg);
});

// Known-benign messages that are NOT game errors: pointer lock requires a
// trusted user gesture, which does not exist under headless/synthetic clicks.
// These come from the browser / vendored controls, not from game logic.
//
// Keep this list TIGHT: match only the specific pointer-lock gesture-rejection
// wording, not any message that merely mentions "pointer lock", so a future
// regression surfacing through a pointer-lock code path is still reported to
// the harness. Revisit whenever pointer-lock handling changes.
const __benignPatterns = [
  /user gesture is required to request Pointer Lock/i,
  /request(?:ed)? Pointer Lock without .*user gesture/i,
  /pointer lock (?:was )?denied/i,
  /Unable to use Pointer Lock/i,
];
function __isBenign(msg) {
  return __benignPatterns.some((re) => re.test(msg));
}

// Patch console.error so logged errors also land in the capture array,
// while still forwarding to the real console.
const __origConsoleError = console.error.bind(console);
console.error = (...args) => {
  try {
    const msg = args.map((a) => (a && a.stack) ? a.stack : String(a)).join(' ');
    if (!__isBenign(msg)) window.__consoleErrors.push(msg);
  } catch (_) {
    window.__consoleErrors.push('console.error');
  }
  __origConsoleError(...args);
};

// Import after the handlers above are in place. A dynamic import means a module
// load / parse failure is still captured by the 'error' / 'unhandledrejection'
// listeners above rather than being lost.
import('./core/Game.js')
  .then(({ Game }) => {
    const game = new Game({ container: document.getElementById('game-container') });
    window.__GAME__ = game;
    game.start();
  })
  .catch((err) => {
    window.__consoleErrors.push('bootstrap:' + String(err && err.stack ? err.stack : err));
    console.error('Failed to bootstrap game:', err);
  });
