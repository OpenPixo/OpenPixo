import { execFile } from 'node:child_process';

/** One process as Toolhelp saw it, with the OS creation time when it could be read. */
export type WindowsTreeProcess = { pid: number; ppid: number; startedAtMs: number | null };

/** Creation times and `Date.now()` come from the same clock; this only absorbs rounding. */
const SPAWN_CLOCK_MARGIN_MS = 1_000;
/** A process holding the root's PID that started later than this after the spawn is someone else. */
const ROOT_CREATION_WINDOW_MS = 5_000;

/**
 * The processes stopping `rootPid` may touch, leaves first.
 *
 * Windows keeps a process's parent PID after the parent exits, and reuses PIDs. A parent-PID walk
 * alone therefore reaches unrelated processes: the root may have exited and its PID been given to
 * someone else, and a long-lived process whose own parent exited long ago (the daemon's sidecar
 * supervisor, whose launcher exits right after starting it) "belongs" to whichever process later
 * receives that launcher's PID. Stopping such a tree killed the supervisor, and the daemon followed
 * it out without a word (2026-11-15).
 *
 * So a process is selected only when it was created after the caller spawned the root, a link is
 * followed only from an older parent to a newer child, and the caller and its ancestors are never
 * selected. A process whose creation time cannot be read is left alone.
 */
export function selectWindowsTreeToStop(
  processes: readonly WindowsTreeProcess[],
  rootPid: number,
  options: { spawnedAtMs: number; callerPid: number },
): WindowsTreeProcess[] {
  const byPid = new Map(processes.map(entry => [entry.pid, entry]));
  const notBefore = options.spawnedAtMs - SPAWN_CLOCK_MARGIN_MS;
  const known = (value: number | null): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

  const protectedPids = new Set<number>();
  for (let current = byPid.get(options.callerPid); current && !protectedPids.has(current.pid);) {
    protectedPids.add(current.pid);
    const parent = byPid.get(current.ppid);
    if (!parent || !known(parent.startedAtMs) || !known(current.startedAtMs) || parent.startedAtMs > current.startedAtMs) break;
    current = parent;
  }

  const eligible = (entry: WindowsTreeProcess, parent: WindowsTreeProcess | undefined): boolean =>
    known(entry.startedAtMs) && entry.startedAtMs >= notBefore && !protectedPids.has(entry.pid)
    && (!parent || !known(parent.startedAtMs) || entry.startedAtMs >= parent.startedAtMs);

  const root = byPid.get(rootPid);
  // A root that exited still leaves its own children, which name its PID as their parent and were
  // created after the spawn. If its PID now belongs to another process, our root's children were
  // all created before that process existed; the newcomer's children are its own.
  // `spawn` creates the process before it returns, so our root started right after `spawnedAtMs`.
  const rootSelected = root !== undefined && eligible(root, undefined)
    && root.startedAtMs! <= options.spawnedAtMs + ROOT_CREATION_WINDOW_MS;
  const impostorStartedAt = root !== undefined && !rootSelected ? root.startedAtMs : null;
  const selected: WindowsTreeProcess[] = rootSelected ? [root] : [];
  const visited = new Set<number>([rootPid]);
  const parents: Array<WindowsTreeProcess | undefined> = [rootSelected ? root : undefined];
  const parentPids = [rootPid];
  for (let index = 0; index < parentPids.length; index++) {
    const parentPid = parentPids[index]!;
    const parent = parents[index];
    for (const entry of processes) {
      if (entry.ppid !== parentPid || visited.has(entry.pid) || !eligible(entry, parent)) continue;
      if (index === 0 && root !== undefined && !rootSelected
        && (!known(impostorStartedAt) || entry.startedAtMs! >= impostorStartedAt)) continue;
      visited.add(entry.pid);
      selected.push(entry);
      parentPids.push(entry.pid);
      parents.push(entry);
    }
  }
  return selected.reverse();
}

// Toolhelp works for our child processes even when WMI/taskkill is unavailable
// in a restricted Windows runtime.
const SNAPSHOT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class ProcessParents {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Auto)]
 public struct Entry {
  public uint size, usage, pid; public UIntPtr heap; public uint module, threads, parent;
  public int priority; public uint flags;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string exe;
 }
 [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
 [DllImport("kernel32.dll", CharSet=CharSet.Auto)] static extern bool Process32First(IntPtr h,ref Entry e);
 [DllImport("kernel32.dll", CharSet=CharSet.Auto)] static extern bool Process32Next(IntPtr h,ref Entry e);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 public static void Print() {
  var handle=CreateToolhelp32Snapshot(2,0);
  if(handle==new IntPtr(-1)) throw new System.ComponentModel.Win32Exception();
  try {
   var entry=new Entry(); entry.size=(uint)Marshal.SizeOf(entry);
   if(!Process32First(handle,ref entry)) throw new System.ComponentModel.Win32Exception();
   do {
    string started="-";
    try { using(var process=Process.GetProcessById((int)entry.pid)) started=new DateTimeOffset(process.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds().ToString(); } catch {}
    Console.WriteLine(entry.pid+" "+entry.parent+" "+started);
   } while(Process32Next(handle,ref entry));
  } finally { CloseHandle(handle); }
 }
}
'@
[ProcessParents]::Print()
`;

/** Stops exactly the listed generations: a PID whose creation time changed since the snapshot is skipped. */
function stopScript(targets: readonly WindowsTreeProcess[]): string {
  const list = targets.map(target => `${target.pid}:${target.startedAtMs}`).join(' ');
  return String.raw`
$ErrorActionPreference = 'Stop'
$failed = @()
foreach ($target in '${list}'.Split(' ')) {
  $pid0, $expected = $target.Split(':')
  try { $process = Get-Process -Id ([int]$pid0) -ErrorAction Stop } catch { continue }
  try { $started = ([DateTimeOffset]$process.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds() } catch { continue }
  if ($started -ne [long]$expected) { continue }
  # A process can exit between the check and the kill; only one still running is a failure.
  try { $process.Kill() } catch {}
  try { $stopped = $process.WaitForExit(2000) } catch { $stopped = $true }
  if (-not $stopped) { $failed += @("$pid0 $($process.ProcessName)") }
}
if ($failed) { throw "Processes did not stop: $failed" }
# A caught lookup error (a process that already exited) would otherwise become the exit status.
exit 0
`;
}

function powershell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

/** @internal Parse the snapshot script's `pid ppid startedAtMs|-` lines. */
export function parseWindowsTreeSnapshot(stdout: string): WindowsTreeProcess[] {
  return stdout.split(/\r?\n/u).flatMap(line => {
    const [pid, ppid, started] = line.trim().split(' ');
    const entry = { pid: Number(pid), ppid: Number(ppid), startedAtMs: started && started !== '-' ? Number(started) : null };
    return Number.isSafeInteger(entry.pid) && entry.pid > 0 && Number.isSafeInteger(entry.ppid) ? [entry] : [];
  });
}

/**
 * Force-stop a Windows child tree the caller spawned at `spawnedAtMs` (taken before `spawn`),
 * without depending on WMI permissions. See `selectWindowsTreeToStop` for what is never touched.
 */
export async function forceStopWindowsProcessTree(pid: number, options: { spawnedAtMs: number }): Promise<void> {
  if (process.platform !== 'win32' || !Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) throw new Error('Expected an owned Windows child pid');
  if (!Number.isFinite(options.spawnedAtMs) || options.spawnedAtMs <= 0) throw new Error('Expected the time the child was spawned');
  const targets = selectWindowsTreeToStop(parseWindowsTreeSnapshot(await powershell(SNAPSHOT)), pid,
    { spawnedAtMs: options.spawnedAtMs, callerPid: process.pid });
  if (targets.length) await powershell(stopScript(targets));
}
