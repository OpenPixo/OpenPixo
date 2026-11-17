// Path scrubbing for error reports. Defense in depth: the daemon's usage-event
// rule already drops any property that is not a count, so stack frames never
// leave the machine; this keeps paths out of anything built locally too.

// Rewrite absolute filesystem paths in exception stack traces. Packaged
// builds expose `file:///Applications/OpenPixo.app/Contents/Resources/…`
// which leaks both the install root and the user's home dir in homebrew /
// custom installs. Reduce to the repo-relative tail.
//
// Used by error-tracking.ts and the iframe error bridge.
export function scrubFilePath(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  // file:///abs/path/.../apps/web/src/foo.tsx → app://apps/web/src/foo.tsx
  // /Users/<user>/.../apps/web/src/foo.tsx    → app://apps/web/src/foo.tsx
  //
  // The prefix uses `[^()\n]*?` (non-greedy, no parens/newlines) so paths
  // that contain spaces — most notably the packaged macOS layout
  // `/Applications/OpenPixo.app/Contents/Resources/...` — get fully
  // rewritten instead of partially leaking the install directory. The
  // tail stops at whitespace or a closing paren so stack frames of shape
  // `at fn (file:///.../foo.tsx:1:2)` lose only the path portion.
  return value.replace(
    /(?:file:\/\/)?[^()\n]*?\/((?:apps|packages|tools)\/[^\s)]+)/g,
    'app://$1',
  );
}

// Used by error-tracking.ts on the exceptions it builds.
export function scrubExceptionList(
  list: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return list.map((entry) => {
    const next = { ...entry };
    const stack = next.stacktrace as
      | { frames?: Array<Record<string, unknown>> }
      | undefined;
    if (stack?.frames && Array.isArray(stack.frames)) {
      next.stacktrace = {
        ...stack,
        frames: stack.frames.map((frame) => ({
          ...frame,
          filename: scrubFilePath(frame.filename),
          abs_path: scrubFilePath(frame.abs_path),
        })),
      };
    }
    if (typeof next.mechanism === 'object' && next.mechanism !== null) {
      // Mechanism source URL can also be a file:// — same scrub.
      const mech = next.mechanism as Record<string, unknown>;
      if (typeof mech.source === 'string') {
        mech.source = scrubFilePath(mech.source);
      }
    }
    return next;
  });
}
