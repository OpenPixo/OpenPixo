import path from 'node:path';

/** Isolate fake CLIs while retaining the OS tools used to reap their processes. */
export function isolatedAgentPath(binDir: string): string {
  if (process.platform !== 'win32') {
    return [binDir, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(path.delimiter);
  }
  const system32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  // Process-tree verification launches powershell.exe. Removing it from PATH
  // turns a provider retry into "process enumeration unavailable".
  return [binDir, system32, path.join(system32, 'WindowsPowerShell', 'v1.0')].join(path.delimiter);
}
