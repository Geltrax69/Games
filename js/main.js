// Entry point / bootstrap.
// Error capture and a visible readiness promise are installed before any game
// module or model is loaded so verification can observe the complete startup.

window.__consoleErrors = window.__consoleErrors || [];

window.addEventListener('error', (event) => {
  const message = String(event.message || event.error || 'unknown error');
  if (!__isBenign(message)) window.__consoleErrors.push(message);
});

window.addEventListener('unhandledrejection', (event) => {
  const message = `promise:${String(event.reason)}`;
  if (!__isBenign(message)) window.__consoleErrors.push(message);
});

const __benignPatterns = [
  /user gesture is required to request Pointer Lock/i,
  /request(?:ed)? Pointer Lock without .*user gesture/i,
  /pointer lock (?:was )?denied/i,
  /Unable to use Pointer Lock/i,
];
function __isBenign(message) {
  return __benignPatterns.some((pattern) => pattern.test(message));
}

const __originalConsoleError = console.error.bind(console);
console.error = (...args) => {
  try {
    const message = args.map((arg) => (arg && arg.stack) ? arg.stack : String(arg)).join(' ');
    if (!__isBenign(message)) window.__consoleErrors.push(message);
  } catch (_) {
    window.__consoleErrors.push('console.error');
  }
  __originalConsoleError(...args);
};

const bootstrap = {
  state: 'LOADING',
  loaded: 0,
  total: 2,
  current: 'Preparing local character assets',
  fallbacks: [],
  assets: { zombie: 'pending', human: 'pending' },
  assetDetails: {
    zombie: { status: 'pending', source: 'zombie-hazmat.glb' },
    human: { status: 'pending', source: 'male-base-mesh.glb' },
  },
  error: null,
};
window.__BOOTSTRAP__ = bootstrap;

let resolveReady;
let rejectReady;
window.__GAME_READY__ = new Promise((resolve, reject) => {
  resolveReady = resolve;
  rejectReady = reject;
});
// Keep a fatal bootstrap rejection from becoming a second unhandled error while
// still allowing verification callers to await the original promise.
window.__GAME_READY__.catch(() => {});

function updateLoading(progress) {
  if (progress) {
    bootstrap.loaded = progress.loaded;
    bootstrap.total = progress.total;
    bootstrap.current = progress.phase === 'fallback'
      ? `${progress.label} will use the built-in fallback`
      : `${progress.phase === 'loaded' ? 'Prepared' : 'Loading'} ${progress.label}`;
  }
  const detail = document.getElementById('loading-detail');
  const fill = document.getElementById('loading-fill');
  if (detail) detail.textContent = bootstrap.current;
  if (fill) fill.style.width = `${Math.round((bootstrap.loaded / Math.max(1, bootstrap.total)) * 100)}%`;
}

updateLoading();

Promise.all([
  import('./assets/ModelLibrary.js'),
  import('./core/Game.js'),
])
  .then(async ([modelLibrary, gameModule]) => {
    const result = await modelLibrary.preloadCharacterAssets(updateLoading);
    bootstrap.fallbacks = result.fallbacks;
    bootstrap.assets = modelLibrary.characterAssetStatus();
    bootstrap.assetDetails = modelLibrary.characterAssetDetails();
    bootstrap.state = 'CONSTRUCTING';
    bootstrap.current = result.fallbacks.length
      ? `Building the world (fallback: ${result.fallbacks.join(', ')})`
      : 'Building the world';
    updateLoading();

    const game = new gameModule.Game({ container: document.getElementById('game-container') });
    window.__GAME__ = game;
    game.start();

    bootstrap.state = 'READY';
    bootstrap.current = result.fallbacks.length
      ? `Ready with ${result.fallbacks.length} procedural fallback(s)`
      : 'Ready';
    bootstrap.loaded = bootstrap.total;
    updateLoading();
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) loadingScreen.classList.add('hidden');
    resolveReady(game);
  })
  .catch((error) => {
    bootstrap.state = 'LOAD_ERROR';
    bootstrap.error = String(error && error.stack ? error.stack : error);
    bootstrap.current = 'The game could not initialize. Reload to try again.';
    const title = document.getElementById('loading-title');
    if (title) title.textContent = 'UNABLE TO START';
    updateLoading();
    rejectReady(error);
    console.error('Failed to bootstrap game:', error);
  });
