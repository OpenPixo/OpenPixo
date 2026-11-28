import { describe, expect, it, vi } from "vitest";

// Review 2.6: `diagnostics:export-to-file` opened a native Save dialog and
// wrote the daemon's diagnostics bundle for any sender. It now answers only
// the sender its owner authorizes (the main window's top frame).
const { handle, showSaveDialog } = vi.hoisted(() => ({
  handle: vi.fn(),
  showSaveDialog: vi.fn(async () => ({ canceled: true as const, filePath: undefined })),
}));

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  dialog: { showSaveDialog },
  ipcMain: { handle, removeHandler: vi.fn() },
  shell: { showItemInFolder: vi.fn() },
}));

import { DESKTOP_DIAGNOSTICS_IPC_CHANNEL, registerDesktopDiagnosticsIpc } from "../../src/main/diagnostics.js";

describe("diagnostics export sender", () => {
  it("refuses an unauthorized sender before any dialog or daemon read", async () => {
    const discoverDaemonBaseUrl = vi.fn(async () => "http://127.0.0.1:1");
    const authorize = vi.fn((event: { sender: { id: number } }) => event.sender.id === 1);
    registerDesktopDiagnosticsIpc({ discoverDaemonBaseUrl }, authorize as never);
    const [channel, handler] = handle.mock.calls[0] as unknown as [string, (event: unknown) => Promise<unknown>];
    expect(channel).toBe(DESKTOP_DIAGNOSTICS_IPC_CHANNEL);

    const refused = await handler({ sender: { id: 2 } });
    expect(refused).toMatchObject({ ok: false, cancelled: false });
    expect(showSaveDialog).not.toHaveBeenCalled();
    expect(discoverDaemonBaseUrl).not.toHaveBeenCalled();

    await expect(handler({ sender: { id: 1 } })).resolves.toEqual({ ok: false, cancelled: true });
    expect(showSaveDialog).toHaveBeenCalledTimes(1);
  });
});
