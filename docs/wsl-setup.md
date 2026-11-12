# WSL2 Setup Guide

Use this guide when your coding-agent CLIs run inside WSL2. In that setup,
install and run OpenPixo from WSL as well so the agent CLI, `pixo` command,
daemon, Node modules, and credentials all come from the same Linux environment.

For native Windows PowerShell setup, use
[`docs/windows-troubleshooting.md`](windows-troubleshooting.md) instead.

## Recommended shape

- Clone OpenPixo inside WSL2.
- Install Node `~24` and the repo-pinned pnpm (`10.33.2`) inside WSL2.
- Put a WSL-native `pixo` wrapper on `PATH`.
- Start the daemon from WSL with `pixo --no-open`.
- Install MCP entries from the same WSL shell.

Do not assume the Windows desktop app's daemon is the right daemon for WSL
agent clients. WSL2 networking and Windows credential stores can make that path
ambiguous. A WSL-started daemon keeps the MCP clients and OpenPixo in the
same environment.

## 1. Install from source in WSL

```bash
git clone (upstream link removed) ~/tools/openpixo
cd ~/tools/openpixo

node --version   # should print v24.x.x
corepack enable
corepack pnpm --version   # should print 10.33.2
pnpm install
```

If you use `mise`, trust and install the repo toolchain before `pnpm install`:

```bash
mise trust
mise install
```

## 2. Make the `pixo` command available

The source checkout exposes `pixo` through pnpm. Create a WSL-native wrapper
to use that checkout from other working directories. The binary name is
defined by [ADR 0008](adr/0008-cli-binary-pixo.md).

Check what your shell resolves:

```bash
type -a pixo
```

If `pixo` is unavailable, create a wrapper in `~/.local/bin`
and make sure that directory is on `PATH`:

```bash
mkdir -p ~/.local/bin

cat > ~/.local/bin/pixo <<'EOF'
#!/usr/bin/env bash
repo="$HOME/tools/openpixo"
cd "$repo" || exit 127

if command -v mise >/dev/null 2>&1; then
  exec mise exec -- pnpm exec pixo "$@"
fi

exec corepack pnpm exec pixo "$@"
EOF

chmod +x ~/.local/bin/pixo
export PATH="$HOME/.local/bin:$PATH"
hash -r
type -a pixo
```

Expected first result:

```text
pixo is /home/<user>/.local/bin/pixo
```

Use the WSL-native wrapper so Node, dependencies, and credentials come from
the same Linux environment as your agent CLI.

## 3. Start the daemon from WSL

Run the daemon from the same WSL environment that your agent CLIs use:

```bash
cd ~/tools/openpixo
pixo --no-open
```

In another WSL terminal, verify it is reachable:

```bash
curl -sSf http://127.0.0.1:7456/api/health && echo "OpenPixo daemon is reachable"
```

Expected output includes `{"ok":true,...}` followed by the echo line.

Do not probe the root URL (`curl http://127.0.0.1:7456`) for this check. The
root path serves the web UI only after the web package has been built, so on a
fresh source install it returns 404 even though the daemon is healthy. The MCP
integrations below do not need the web build. If you also want the browser UI
at `http://127.0.0.1:7456`, build it once and restart the daemon:

```bash
cd ~/tools/openpixo
pnpm --filter @openpixo/web build
```

Leave the daemon terminal running while using MCP integrations.

## 4. Install MCP entries

From WSL, run the installer for each agent CLI you use:

```bash
pixo mcp install claude
pixo mcp install opencode
pixo mcp install codex
pixo mcp install antigravity
pixo mcp install copilot
```

The installer writes to the agent config locations for the current WSL user,
for example `~/.claude.json`, `~/.config/opencode/opencode.json`,
`~/.codex/config.toml`, `~/.gemini/antigravity/mcp_config.json`, and
`~/.copilot/mcp-config.json`.

## Native module mismatch after changing Node versions

If dependencies were installed under Node 22 and OpenPixo later runs under
Node 24, native modules such as `better-sqlite3` can fail with a
`NODE_MODULE_VERSION` mismatch.

Reinstall under the active Node 24 runtime:

```bash
cd ~/tools/openpixo
rm -rf node_modules
pnpm store prune
pnpm install
```

Then verify the native module loads:

```bash
pnpm --filter @openpixo/daemon exec node -e "require('better-sqlite3')"
```

## Codex config parse failures

If Codex fails before MCP install or a direct `codex` run with:

```text
invalid type: map, expected a boolean
in `features`
```

check `~/.codex/config.toml` for nested feature tables such as:

```toml
[features.multi_agent_v2]
hide_spawn_agent_metadata = false
max_concurrent_threads_per_session = 10000
enabled = false
```

Current Codex CLI versions expect `[features]` values to be booleans. Remove or
comment out the nested `[features.*]` block, then retry the command.

OpenPixo also normalizes this shape before daemon-launched Codex runs, but
manual cleanup may still be needed when Codex itself is invoked directly before
OpenPixo gets a chance to patch the config.
