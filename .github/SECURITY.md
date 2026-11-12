# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Email
**support@openpixo.com** with the subject line `Security:` and include:

- what you found and what an attacker could do with it,
- the steps or a proof of concept to reproduce it,
- the OpenPixo version (Help → About, or `pixo --version`) and your Windows version,
- whether you have shared it with anyone else.

We will confirm that we received your report, keep you updated while we work
on it, and credit you in the release notes if you would like that. Please give
us a reasonable chance to ship a fix before you disclose the problem publicly.

## What is in scope

- The OpenPixo desktop app, its local daemon and the `pixo` command line.
- OpenPixo's hosted services: accounts, credits, hosted generation, public game
  links and multiplayer rooms.
- The installer and the automatic updater.

Problems in Codex, Claude Code, OpenCode or a model provider belong with that
project, unless OpenPixo makes them worse.

## Supported versions

Security fixes go into the latest Stable release, and the app updates itself.
Please check that you can reproduce the problem on the current version from
[openpixo.com/download](https://openpixo.com/download).
