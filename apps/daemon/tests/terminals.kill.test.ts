import { describe, expect, it, vi } from 'vitest';

import { killPty } from '../src/terminals.js';

describe('killPty', () => {
  // node-pty's Windows backend throws when handed a signal, which used to mark
  // the session exited while its shell kept the project folder as its cwd.
  it('sends no signal on Windows', () => {
    const pty = { kill: vi.fn() };
    killPty(pty, 'SIGTERM', 'win32');
    expect(pty.kill).toHaveBeenCalledWith();
  });

  it('passes the signal through elsewhere', () => {
    const pty = { kill: vi.fn() };
    killPty(pty, 'SIGTERM', 'linux');
    expect(pty.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
