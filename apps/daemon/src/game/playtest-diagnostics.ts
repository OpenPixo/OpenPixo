import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { GAME_PLAYTEST_LIMITS } from '@openpixo/contracts';

/**
 * The .NET (mono) build of Godot reports its own C# tooling at startup, as an
 * `ERROR:` line, even when the project has no C#: "ERROR: .NET Sdk not found.
 * The required version is '9.0.7'." and the `.NET:` module lines. For a project
 * without C# that is not the game's error, and counting it failed every check and
 * playtest of a GDScript game on a machine without the .NET SDK.
 */
const GODOT_DOTNET_ERROR = /^\s*ERROR:\s*\.NET(?:\s+Sdk not found\b|:)/i;

export interface GodotErrorCollectorOptions {
  /** False for a project without C#: the .NET build's tooling errors are not the game's. */
  projectUsesCSharp?: boolean;
}

/** Scan the entire stream even after the persisted log fills; retain bounded, ANSI-free error lines. */
export function createGodotErrorCollector(options: GodotErrorCollectorOptions = {}) {
  const usesCSharp = options.projectUsesCSharp ?? true;
  let tail = '';
  const errors: string[] = [];
  const line = (text: string) => {
    if (errors.length >= GAME_PLAYTEST_LIMITS.pageErrors || !/^\s*(?:SCRIPT ERROR|ERROR):/.test(text)) return;
    if (!usesCSharp && GODOT_DOTNET_ERROR.test(text)) return;
    errors.push(text.slice(0, GAME_PLAYTEST_LIMITS.messageLength));
  };
  return {
    append(chunk: Buffer | string) {
      const lines = (tail + chunk.toString()).replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/);
      tail = lines.pop() ?? '';
      for (const text of lines) line(text);
      if (tail.length > 8192) { line(tail); tail = ''; }
    },
    finish() { line(tail); tail = ''; return [...errors]; },
  };
}

/**
 * Whether a Godot project has C#: a `.csproj` or `.sln` in its folder (Godot
 * writes one when C# is added) or the C# feature in `project.godot`. Read at run
 * time, not from the stored engine profile, which may predate the first script.
 */
export async function godotProjectUsesCSharp(projectDir: string): Promise<boolean> {
  const entries = await readdir(projectDir).catch(() => [] as string[]);
  if (entries.some(name => /\.(?:csproj|sln)$/i.test(name))) return true;
  const settings = await readFile(path.join(projectDir, 'project.godot'), 'utf8').catch(() => '');
  return /"C#"/.test(settings) || /^\[dotnet\]/m.test(settings);
}
