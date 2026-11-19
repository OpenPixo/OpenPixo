import Phaser from 'phaser';

/**
 * Keyboard and gamepad actions. Change a binding here: KEYS uses KeyboardEvent.code
 * values and BUTTONS the standard gamepad layout (0 A, 1 B, 2 X, 3 Y, 5 RB, 9 Start,
 * 12-15 the D-pad). Mouse clicks and the wheel are handled by the scenes.
 */
export type Action = 'advance' | 'log' | 'auto' | 'skip' | 'pause' | 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back';

export const KEYS: Record<Action, string[]> = {
  advance: ['Enter', 'NumpadEnter', 'Space'],
  log: ['KeyL'],
  auto: ['KeyA'],
  skip: ['ControlLeft', 'ControlRight'],
  pause: ['Escape'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  confirm: ['Enter', 'NumpadEnter', 'Space'],
  back: ['Escape', 'Backspace'],
};

export const BUTTONS: Record<Action, number[]> = {
  advance: [0], log: [3], auto: [2], skip: [5], pause: [9],
  up: [12], down: [13], left: [14], right: [15], confirm: [0], back: [1],
};

/** Calls `onAction` for every action a key or button press means, while the scene runs. */
export function listen(scene: Phaser.Scene, onAction: (action: Action) => void): void {
  const fire = (matches: (action: Action) => boolean) => {
    for (const action of Object.keys(KEYS) as Action[]) if (matches(action)) onAction(action);
  };
  scene.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
    if (!event.repeat) fire(action => KEYS[action].includes(event.code));
  });
  scene.input.gamepad?.on('down', (_pad: Phaser.Input.Gamepad.Gamepad, button: Phaser.Input.Gamepad.Button) => {
    fire(action => BUTTONS[action].includes(button.index));
  });
}

const held = new Set<string>();
window.addEventListener('keydown', event => held.add(event.code));
window.addEventListener('keyup', event => held.delete(event.code));
window.addEventListener('blur', () => held.clear());

/** Whether an action's key or button is held down now (skip is held, not pressed). */
export function isHeld(scene: Phaser.Scene, action: Action): boolean {
  if (KEYS[action].some(code => held.has(code))) return true;
  const pads = scene.input.gamepad?.gamepads ?? [];
  return pads.some(pad => pad && BUTTONS[action].some(index => pad.buttons[index]?.pressed));
}
