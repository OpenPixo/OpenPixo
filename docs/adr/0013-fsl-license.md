# ADR 0013: License OpenPixo under FSL-1.1-ALv2

Date: 2026-11-19. Status: accepted by the repository owner's explicit instruction.

Amends the licensing rule that ADR 0005 and ADR 0006 keep in force. Their
attribution requirements still apply.

## Context

OpenPixo inherited Apache-2.0 from OpenDesign. Apache-2.0 lets anyone take the
app and sell it, or run it as a competing service. OpenPixo is funded by
hosted credits, so a rebranded copy that resells the same workflow competes
directly with the project that builds it.

The source should stay public: users and agents read it, and developers can
see how it works.

## Decision

- From the version after 1.0.8, the repository root is licensed under the
  Functional Source License, Version 1.1, ALv2 Future License
  (`FSL-1.1-ALv2`, root `LICENSE`). Anyone may use, change and share it for any
  purpose except a Competing Use, and each version becomes Apache-2.0 two years
  after it is released.
- Versions up to and including 1.0.8 stay Apache-2.0. They cannot be relicensed.
- Content that ends up in users' games stays Apache-2.0: `skills/`, `plugins/`,
  `prompt-templates/`, `design-templates/`, `game-templates/` and `game-sdk/`,
  unless a file or component's own license says otherwise. A game built with
  OpenPixo must be free to ship without any FSL question.
- The OpenDesign code stays Apache-2.0. Its license text and copyright line are
  kept unchanged in `LICENSE-APACHE`, and `NOTICE` keeps the upstream
  attribution and pinned commit. Apache-2.0 section 4 allows OpenPixo's
  modifications and the work as a whole to carry the FSL.
- Bundled third-party components keep their own licenses.
- The licensor is "OpenPixo contributors". When the OpenPixo legal entity
  exists, the copyright line in `LICENSE` and `NOTICE` should name it.

## Consequences

- OpenPixo is source-available, not OSI open source, until each version's
  two-year date.
- `package.json` uses the SPDX identifier `FSL-1.1-ALv2`.
- The Windows installer ships `LICENSE`, `LICENSE-APACHE` and `NOTICE`.
- Outside contributions to FSL-covered code are accepted under the FSL. Any
  future relicensing of contributed code needs the contributors' consent or a
  contributor agreement.
