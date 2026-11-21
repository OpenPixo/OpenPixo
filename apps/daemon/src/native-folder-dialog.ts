export interface NativeFolderDialogCommand {
  command: string;
  args: string[];
}

function errorCode(error: unknown): unknown {
  return error && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function hardLinuxFolderDialogFailure(error: unknown, stderrText: string): string | null {
  const code = errorCode(error);
  if (code === 'ENOENT') return 'zenity is not installed';
  if (/cannot open display/i.test(stderrText)) return stderrText;
  if (/no such file or directory/i.test(stderrText) && /zenity/i.test(stderrText)) return stderrText;
  return null;
}

/**
 * The PowerShell step that hands a chosen path back to the daemon.
 *
 * Windows PowerShell 5.1 encodes a piped stdout in the console's OEM code
 * page (GBK on Chinese Windows, 437 on English), never UTF-8, so a non-ASCII
 * folder name printed as text arrives garbled. The path therefore leaves as
 * base64 of its UTF-8 bytes, which is plain ASCII in every code page, and
 * `parseFolderDialogStdout` decodes it.
 */
export function windowsFolderDialogOutputStep(pathExpression: string): string {
  return `[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes(${pathExpression}))`;
}

const WINDOWS_FOLDER_DIALOG_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms;',
  '$owner = New-Object System.Windows.Forms.Form;',
  "$owner.Text = 'OpenPixo';",
  '$owner.TopMost = $true;',
  '$owner.ShowInTaskbar = $true;',
  "$owner.StartPosition = 'CenterScreen';",
  '$owner.Width = 1;',
  '$owner.Height = 1;',
  '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;',
  "$dialog.Description = 'Select a code folder to link';",
  '$dialog.ShowNewFolderButton = $true;',
  'try {',
  `  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { ${windowsFolderDialogOutputStep('$dialog.SelectedPath')} }`,
  '} finally {',
  '  $owner.Dispose();',
  '}',
].join(' ');

export function buildWindowsFolderDialogCommand(): NativeFolderDialogCommand {
  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-Sta', '-Command', WINDOWS_FOLDER_DIALOG_SCRIPT],
  };
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Decodes the Windows picker's output (see `windowsFolderDialogOutputStep`). */
export function parseFolderDialogStdout(error: unknown, stdout: string): string | null {
  if (error) {
    return null;
  }

  const encoded = stdout.trim();
  if (!encoded || encoded.length % 4 !== 0 || !BASE64_RE.test(encoded)) return null;
  const selectedPath = Buffer.from(encoded, 'base64').toString('utf8');
  return selectedPath.length > 0 ? selectedPath : null;
}

export function parseLinuxFolderDialogResult(error: unknown, stdout: string, stderr: string): string | null {
  if (error) {
    const stderrText = stderr.trim();
    const code = errorCode(error);
    const hardFailure = hardLinuxFolderDialogFailure(error, stderrText);
    if (hardFailure) {
      throw new Error(`Could not open folder picker: ${hardFailure}`);
    }
    if (code === 1) return null;
    throw new Error(`Could not open folder picker: ${stderrText || errorMessage(error)}`);
  }

  const selectedPath = stdout.trim();
  return selectedPath.length > 0 ? selectedPath : null;
}
