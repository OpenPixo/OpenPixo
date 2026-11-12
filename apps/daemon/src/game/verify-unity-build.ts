import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** Conservative bounded discovery: one class and one public parameterless static Build* method
 * in an Editor source file, calling BuildPipeline.BuildPlayer. Never invent a Unity build method. */
export function discoverUnityBuild(projectDir: string): { method: string; file: string } | null {
  const matches: Array<{ method: string; file: string }> = [];
  let inspected = 0;
  const visit = (relative: string, depth: number) => {
    if (depth > 4 || inspected >= 100) return;
    let entries;
    try { entries = readdirSync(path.join(projectDir, relative), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || inspected >= 100) continue;
      const file = path.join(relative, entry.name);
      if (entry.isDirectory()) { visit(file, depth + 1); continue; }
      if (!entry.isFile() || !/\.cs$/i.test(entry.name)) continue;
      inspected++;
      if (statSync(path.join(projectDir, file)).size > 256 * 1024) continue;
      const source = readFileSync(path.join(projectDir, file), 'utf8')
        .replace(/@"(?:""|[^"])*"|\$?"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, ' ');
      const classes = [...source.matchAll(/\bclass\s+([A-Za-z_]\w*)/g)];
      const namespaces = [...source.matchAll(/\bnamespace\s+([\w.]+)/g)];
      if (classes.length !== 1 || namespaces.length > 1) continue;
      for (const method of source.matchAll(/\bpublic\s+static\s+void\s+(Build(?:Windows|Game|Player)?)\s*\(\s*\)\s*\{/g)) {
        const start = method.index! + method[0].length;
        let balance = 1, end = start;
        for (; end < source.length && balance; end++) { if (source[end] === '{') balance++; if (source[end] === '}') balance--; }
        if (balance || !/\bBuildPipeline\s*\.\s*BuildPlayer\s*\(/.test(source.slice(start, end))) continue;
        matches.push({ method: [namespaces[0]?.[1], classes[0]![1], method[1]].filter(Boolean).join('.'), file: file.split(path.sep).join('/') });
      }
    }
  };
  visit('Assets/Editor', 0);
  return matches.length === 1 ? matches[0]! : null;
}
