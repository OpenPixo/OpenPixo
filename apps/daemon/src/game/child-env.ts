/**
 * A child process environment: `base` with `additions` on top. Windows variable
 * names ignore case, so an addition replaces `Path` as well as `PATH` and
 * `Appdata` as well as `APPDATA`; a child never receives two spellings of one
 * variable, of which it would read whichever came first.
 */
export function withEnv(base: NodeJS.ProcessEnv, additions: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const added = Object.fromEntries(Object.entries(additions).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const names = new Set(Object.keys(added).map(name => name.toUpperCase()));
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(base)) {
    if (!(process.platform === 'win32' ? names.has(name.toUpperCase()) : Object.hasOwn(added, name))) env[name] = value;
  }
  return { ...env, ...added };
}
