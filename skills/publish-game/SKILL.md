---
name: publish-game
en_name: Publish a web game
zh_name: 发布网页游戏
description: "Put a web game on a public link anyone can play with pixo publish, update it, read refusals and report the link. Only when the creator asks. Not for Godot, Unity or Unreal builds, Steam or itch.io."
en_description: "Put a web game on a public link anyone can play with pixo publish, update it, read refusals and report the link. Only when the creator asks. Not for Godot, Unity or Unreal builds, Steam or itch.io."
zh_description: "在创作者要求时用 pixo publish 把网页游戏放到任何人都能玩的公开链接上，更新链接、解读拒绝原因并汇报链接；不用于 Godot、Unity、Unreal 构建，也不用于 Steam 或 itch.io。"
triggers:
  - publish my game
  - publish the game
  - share my game
  - public link
  - pixo publish
  - 发布游戏
  - 分享游戏
  - 公开链接
license: Apache-2.0
pixo:
  mode: utility
  engines:
    - phaser
    - threejs
    - web-generic
  category: game-development
---

# Publish a web game

`pixo publish` puts a web game (Phaser, Three.js, or another Vite or static build) on a public link. Anyone with the link can play. There is no gallery, no listing and no sign-in for players.

**Publish only when the creator asks in this conversation.** Finishing a feature, a passing check or a request to "share" a screenshot is not a request to publish. Publishing puts their work in front of strangers, and it can use their daily publish limit.

## Quick path

1. Confirm the game runs and builds: `pixo game verify --steps build --json`.
2. Run `pixo publish --json`. It builds the game, uploads the output and waits. Publishing again updates the same link and keeps its URL.
3. Report the link from `game.url`, plus the title if you set one. Tell the creator that anyone with the link can play it.

Add `--project <id>` when `PIXO_PROJECT_ID` is absent, `--title <text>` to name the game, and `--no-build` to upload the existing build output as it is.

Other commands:

| Command | Use |
| --- | --- |
| `pixo publish status --json` | The link, version, state and plays this month |
| `pixo publish remove --json` | Take the link down. Only when the creator asks; a later publish gets a new URL |

## The first publish on an account

The account must accept the sharing rules once. **That agreement belongs to the creator, and an agent token cannot give it.** When you see `SHARE_TERMS_REQUIRED`, do not look for a way around it. Give the creator the `termsUrl` from `pixo publish status --json` when it is not empty, and ask them to tick the box in the Share dialog or run `pixo publish --accept-terms` in their own terminal. Then publish when they say it is done.

## Reading errors

With `--json`, a failed publish prints `error.code`, `error.message` and, when files are refused, `refusedFiles`. The exit code is 1.

| Code | What it means | What to do |
| --- | --- | --- |
| `ACCOUNT_SIGNED_OUT` | No OpenPixo account in this app | Ask the creator to sign in; `pixo account login` is theirs to run |
| `ACCOUNT_NOT_CONFIGURED` | This build has no OpenPixo cloud | Say so. Do not retry |
| `PUBLISH_PAUSED` | Public links are not open yet | Say so. Do not retry |
| `SHARE_TERMS_REQUIRED` | The sharing rules are not accepted | See above |
| `PUBLISH_REFUSED` | Files broke the upload rules | Fix each path in `refusedFiles`, rebuild and publish again |
| `PUBLISH_QUOTA` | Over the games or daily publish limit | Report the message. Do not retry today, and never remove a game to make room unless asked |
| `PUBLISH_BUILD_FAILED` | The project's build failed | Fix the errors in the message |
| `PUBLISH_NO_OUTPUT` | No build folder with a root `index.html` | Check the build config's output folder; `dist` and `build` are found automatically |
| `PUBLISH_UPLOAD_FAILED`, `PUBLISH_UPLOAD_REJECTED`, `PUBLISH_FILES_CHANGED`, `CLOUD_UNAVAILABLE` | The upload or the cloud failed. The link still shows the previous version | Publish again once, then report it |

A refusal saying only web games can be published means the project is Godot, Unity, Unreal or unknown. Do not try to publish a native export this way. See the `web-export-and-itch` skill for a Godot web export.

## What gets refused

- A build with no root `index.html`.
- Any file type outside the allowed game formats: web files, images, audio, video, fonts, data and 3D formats. Source maps are allowed. Dotfiles are left out without an error.
- A page containing a password box. Remove the login form; players do not sign in.
- Publishing needs a subscription (`PUBLISH_PLAN_REQUIRED`). Tell the user; do not retry.
- Over the limits, which the cloud may change: 100 to 500 MB in total by plan, 50 MB per file, 2,000 files, 10 to 50 live games by plan, 30 publishes per account per day.
- Links that point outside the build folder.

Games run in a strict sandbox. They can only talk to their own origin, so calls to outside servers, forms, popups and top-level navigation fail. Load assets from the game's own files, and test for this when a game uses outside services. A template's Vite build with base `/` works as it is, because every game has its own subdomain. Do not change `base` for publishing.

## Live rooms and online features

For friends playing together on the link, use the `multiplayer-networking` skill, which adds `pixo rooms`. For leaderboards, saves, async battles and racing ghosts, the same skill adds `pixo online`. Publishing a game adds neither, and a game that already has them needs no change to publish: the same code uses the hosted backend on the link. Online features are included in the creator's plan. `pixo online status --json` shows this month's use after publishing.

## Done when

- [ ] The creator asked for this publish.
- [ ] `pixo publish` exited 0 and you reported `game.url`.
- [ ] Report anything you could not check. A successful upload does not prove the game plays on the link; say so unless you or the creator opened it.
