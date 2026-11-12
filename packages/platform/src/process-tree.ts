import { execFile } from 'node:child_process';

// Toolhelp works for our child processes even when WMI/taskkill is unavailable
// in a restricted Windows runtime. Enumerate first, stop leaves before parents.
const STOP_TREE = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class ChildProcessTree {
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
 public static void Stop(uint root) {
  var children=new Dictionary<uint,List<uint>>();
  var handle=CreateToolhelp32Snapshot(2,0);
  if(handle==new IntPtr(-1)) throw new System.ComponentModel.Win32Exception();
  try {
   var entry=new Entry(); entry.size=(uint)Marshal.SizeOf(entry);
   if(!Process32First(handle,ref entry)) throw new System.ComponentModel.Win32Exception();
   do {
    if(!children.ContainsKey(entry.parent)) children[entry.parent]=new List<uint>();
    children[entry.parent].Add(entry.pid);
   } while(Process32Next(handle,ref entry));
  } finally { CloseHandle(handle); }
  var pids=new List<uint>{root}; var seen=new HashSet<uint>{root};
  for(int i=0;i<pids.Count;i++) if(children.ContainsKey(pids[i]))
   foreach(var child in children[pids[i]]) if(seen.Add(child)) pids.Add(child);
  pids.Reverse();
  foreach(var pid in pids) {
   try { using(var process=Process.GetProcessById((int)pid)) {
     if(!process.HasExited) { process.Kill(); if(!process.WaitForExit(2000)) throw new Exception("Process did not stop"); }
   }} catch(ArgumentException) {} // It exited after the snapshot.
  }
 }
}
'@
`;

/** Force-stop an owned Windows child tree without depending on WMI permissions. */
export async function forceStopWindowsProcessTree(pid: number): Promise<void> {
  if (process.platform !== 'win32' || !Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) throw new Error('Expected an owned Windows child pid');
  await new Promise<void>((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${STOP_TREE}\n[ChildProcessTree]::Stop(${pid})`],
      { windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 }, error => error ? reject(error) : resolve());
  });
}
