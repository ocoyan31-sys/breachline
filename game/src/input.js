// Keyboard/mouse state plus pointer lock. Keys are tracked by e.code in a Set; mouse
// movement accumulates into deltas the game drains once per step via takeLook().
// Left button = firing, right button = scoping (sniper). Context menu is suppressed.

export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const state = { keys, firing: false, scoping: false, locked: false };
  let lookX = 0, lookY = 0;
  const _look = { x: 0, y: 0 };

  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); state.firing = false; state.scoping = false; });

  window.addEventListener('mousemove', (e) => {
    if (!state.locked) return;
    lookX += e.movementX || 0;
    lookY += e.movementY || 0;
  });
  window.addEventListener('mousedown', (e) => {
    if (!state.locked) return;
    if (e.button === 0) state.firing = true;
    if (e.button === 2) state.scoping = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.firing = false;
    if (e.button === 2) state.scoping = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) { keys.clear(); state.firing = false; state.scoping = false; }
    if (onLockChange) onLockChange(state.locked);
  });

  return {
    state,
    // Drain the accumulated mouse delta (reused object — copy it if you keep it).
    takeLook() {
      _look.x = lookX; _look.y = lookY;
      lookX = 0; lookY = 0;
      return _look;
    },
    requestLock() { canvas.requestPointerLock(); },
    exitLock() { if (document.pointerLockElement) document.exitPointerLock(); },
    // Aliases matching the starter shell's naming.
    request() { canvas.requestPointerLock(); },
    release() { if (document.pointerLockElement) document.exitPointerLock(); },
  };
}
