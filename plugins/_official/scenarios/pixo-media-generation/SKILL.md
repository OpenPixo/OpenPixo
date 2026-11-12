---
name: pixo-media-generation
description: Default reference pipeline for image, video, and audio projects — selects the corresponding media capability and saves the generated output in the project workspace.
pixo:
  scenario: media-generation
  mode: scenario
---

# pixo-media-generation (scenario)

This scenario plugin is the bundled default for projects whose
`metadata.kind` is `image`, `video`, or `audio`. The web client and the
daemon both look up `defaultScenarioPluginIdForKind(kind)` from
`@openpixo/contracts` and, when no other plugin is applied, bind
this scenario at project / run creation time.

## Default pipeline

```jsonc
{
  "stages": [
    { "id": "plan",      "atoms": ["todo-write"] },
    { "id": "generate",  "atoms": ["media-image", "media-video", "media-audio"] }
  ]
}
```

The `generate` stage lists all three media atoms even though a single
run only calls one of them. Picking the right atom is the agent's job:

- `metadata.kind === 'image'` → `media-image`
- `metadata.kind === 'video'` → `media-video`
- `metadata.kind === 'audio'` → `media-audio`

If the user picks this plugin manually without a media-typed project,
prefer `media-image` and explain the assumption in the first reply.

## Atom call shape

Every media atom takes the same kernel of inputs and returns a media
artifact reference:

- `prompt` — the rendered `useCase.query` after input substitution.
- `aspect` — one of `1:1` / `16:9` / `9:16` / `4:3` / `3:4`. Default
  `16:9`. The contracts `MediaAspect` union enumerates the legal
  values.
- `provider` — left blank by default so the daemon picks the user's
  configured provider for this media kind
  (see Settings → Media providers).
  Only set this when the user names a provider explicitly.

After the media atom returns:

1. Save the binary into `<cwd>/media/<timestamp>.<ext>`.
2. Report the saved file path so the user can open and review the output.

## Replace, do not extend

Workflows that need a different default for media work
should ship a sibling scenario plugin and add the right mapping in
`@openpixo/contracts/scenario-defaults`, not patch this manifest.
