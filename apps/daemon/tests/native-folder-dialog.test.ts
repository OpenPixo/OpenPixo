import { execFile } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  buildWindowsFolderDialogCommand,
  parseLinuxFolderDialogResult,
  parseFolderDialogStdout,
  windowsFolderDialogOutputStep,
} from '../src/native-folder-dialog.js';

function dialogError(message: string, code: string | number): Error & { code: string | number } {
  const err = new Error(message) as Error & { code: string | number };
  err.code = code;
  return err;
}

describe('native folder dialog helpers', () => {
  it('builds the Windows folder picker command with STA mode', () => {
    const command = buildWindowsFolderDialogCommand();

    expect(command.command).toBe('powershell.exe');
    expect(command.args).toContain('-NoProfile');
    expect(command.args).toContain('-Sta');
    expect(command.args).toContain('-Command');
  });

  it('creates a topmost owner form for the Windows dialog', () => {
    const script = buildWindowsFolderDialogCommand().args[3] ?? '';

    expect(script).toContain('$owner = New-Object System.Windows.Forms.Form;');
    expect(script).toContain('$owner.TopMost = $true;');
    expect(script).toContain('$owner.ShowInTaskbar = $true;');
    expect(script).toContain("$owner.StartPosition = 'CenterScreen';");
  });

  it('passes the owner form into the Windows folder picker', () => {
    const script = buildWindowsFolderDialogCommand().args[3] ?? '';

    expect(script).toContain('$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;');
    expect(script).toContain('$dialog.ShowNewFolderButton = $true;');
    expect(script).toContain('$dialog.ShowDialog($owner)');
    expect(script).toContain('$owner.Dispose();');
  });

  it('parses a selected folder path from stdout', () => {
    const stdout = `${Buffer.from('C:\\Users\\Ada\\Project', 'utf8').toString('base64')}\r\n`;
    expect(parseFolderDialogStdout(null, stdout)).toBe('C:\\Users\\Ada\\Project');
  });

  it('returns null when the dialog is cancelled', () => {
    expect(parseFolderDialogStdout(null, '\r\n')).toBeNull();
  });

  it('returns null when the native dialog command fails', () => {
    const stdout = Buffer.from('C:\\Users\\Ada\\Project', 'utf8').toString('base64');
    expect(parseFolderDialogStdout(new Error('cancelled'), stdout)).toBeNull();
  });

  it('returns null for output that is not the encoded path', () => {
    expect(parseFolderDialogStdout(null, 'C:\\Users\\Ada\\Project\r\n')).toBeNull();
  });

  // PowerShell 5.1 writes a piped stdout in the console's OEM code page (GBK on
  // Chinese Windows), so a folder named 游戏 used to reach the daemon as
  // "��Ϸ" and either failed to save or created a junk folder.
  it.runIf(process.platform === 'win32')(
    'keeps a Chinese folder name intact through the real PowerShell output step',
    async () => {
      const chinese = String.fromCharCode(0x6e38, 0x620f, 0x9879, 0x76ee);
      const codes = [...`D:\\${chinese}\\觸 sprites`].map((c) => `0x${c.charCodeAt(0).toString(16)}`).join(',');
      const script = `$selected = [string]::new([char[]]@(${codes})); ${windowsFolderDialogOutputStep('$selected')}`;
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile('powershell.exe', ['-NoProfile', '-Command', script], { timeout: 60_000 }, (err, out) =>
          err ? reject(err) : resolve(out),
        );
      });
      expect(parseFolderDialogStdout(null, stdout)).toBe(`D:\\${chinese}\\觸 sprites`);
    },
    60_000,
  );

  it('emits the selected path through the encoded output step', () => {
    const script = buildWindowsFolderDialogCommand().args[3] ?? '';
    expect(script).toContain(windowsFolderDialogOutputStep('$dialog.SelectedPath'));
  });

  it('parses a selected Linux folder path from stdout', () => {
    expect(parseLinuxFolderDialogResult(null, '/home/ada/project\n', '')).toBe('/home/ada/project');
  });

  it('keeps Linux cancel quiet even when zenity emits GTK warnings on stderr', () => {
    const err = dialogError('Command failed: zenity', 1);

    expect(parseLinuxFolderDialogResult(err, '', '(zenity:123): Gtk-WARNING **: Theme parsing error\n')).toBeNull();
  });

  it('throws for Linux folder picker display failures', () => {
    const err = dialogError('Command failed: zenity', 1);

    expect(() => parseLinuxFolderDialogResult(err, '', 'Gtk-WARNING **: cannot open display: :99')).toThrow(
      'Could not open folder picker: Gtk-WARNING **: cannot open display: :99',
    );
  });

  it('throws a stable message when zenity is missing', () => {
    const err = dialogError('spawn zenity ENOENT', 'ENOENT');

    expect(() => parseLinuxFolderDialogResult(err, '', '')).toThrow(
      'Could not open folder picker: zenity is not installed',
    );
  });
});
