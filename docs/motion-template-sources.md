# Retired motion templates: source provenance

> Historical record: the four Motion examples described below were removed in
> the game-only catalogue reduction ([ADR 0012](adr/0012-slim-core.md)). This
> document preserves their source attribution and former implementation notes;
> its publication, dependency and export descriptions are not current operating
> instructions. Current retained resources are listed in
> [`design-templates/AGENTS.md`](../design-templates/AGENTS.md).

Four official HTML examples formerly populated the Motion design Home entry
and Community category. Each was a remake of a viral motion post, rebuilt in
code. The sections below describe that retired catalogue.

## Selection

The templates come from
[awesome-opus-5.5-video](https://github.com/zhuyansen/awesome-opus-5.5-video)
(1,483 cases, `updated_at` `2026-10-11T05:17:47.827Z`; view counts checked
`2026-10-05`) and one Douyin post, confirmed with the product lead: two of the
most-viewed motion posts with like and save rates above 1%, one product promo,
one illustrated explainer, and the Douyin tech reel. The library's top-10%
view threshold is 255,312.

| Template | Original post | Views | Likes | Saves | Rank (all / category) |
| --- | --- | ---: | ---: | ---: | --- |
| Motion Designer Showreel | [@stephanlivera](https://x.com/stephanlivera/status/2103315922098470926) | 2,246,353 | 17,030 | 13,027 | 9 / 1 Motion |
| One-Shape UI Motion | [@twoclipping](https://x.com/twoclipping/status/2103273003555402193) | 1,034,374 | 12,100 | 20,060 | 28 / 7 Motion |
| Product Promo | [@achxvi](https://x.com/achxvi/status/2103918792845963545) | 1,124,063 | 9,015 | 8,065 | 22 / 5 Motion |
| The Future Is Already Here | [Douyin](https://www.douyin.com/video/7690393045783346918) | — | 6,439 | 2,164 | — |

Douyin does not publish play counts; its figures were read on 2026-10-12.
## Template content

Each `example.html` uses its original as the reference for layout, palette,
type and motion. Story adaptations have their own timing; visual fidelity still
requires playback review. On-screen copy is English. The showreel uses product branding; the product promo uses the fictional Pennyflow brand. Every soundtrack is original.

| Template | Length | Differences from the original |
| --- | --- | --- |
| Motion Designer Showreel | 15 s | Signs as OpenPixo with its mark in the OpenPixo palette; fonts are the closest open equivalents |
| One-Shape UI Motion | 14 s | 1440×1440 square kept at scale on a 1920×1080 stage |
| Product Promo | 15 s | Fictional brand Pennyflow; the mascot is a girl instead of the original's boy; product art is simplified isometric halftone |
| The Future Is Already Here | 20 s | 20 s highlight cut of the 62 s original, in English |

The "Use" prompt is the creator's published prompt where one exists (showreel
and UI motion; the UI motion prompt is condensed to its visual brief). The other retained originals publish no prompt; their prompts describe the template film.

## Fonts

All fonts are SIL Open Font License families from the
[Google Fonts repository](https://github.com/google/fonts), subset to the glyphs
the template draws and bundled with their license files: Archivo, Instrument
Serif, JetBrains Mono, Geist, Unbounded, Inter, Fraunces and Short Stack.
Plugin previews allow same-origin fonts and map relative `url()` references in
inline styles to the plugin asset route, so the gallery, covers and Remix render
the bundled fonts.

## Gallery publication

`pixo.json` points to `example.html`; source and referenced assets ship
with the official plugin. Each template also bundles `assets/cover.jpg`, declared
as `pixo.preview.poster`, so a fresh branch checkout has a Home and Community
cover before CDN previews are published. Cards prefer published baked previews
when present, then this bundled still; detail previews retain the live HTML.
Refresh the bundled cover from the baker's poster when changing the film's look.
The existing pre-merge preview workflow validates
rendering. After merge, `bake-plugin-previews.yml` uploads content-addressed
posters and clips to R2 and opens the rolling preview-manifest PR. Each
template signals preview-ready within the baker's 15-second budget. Verify the
release's four preview entries and remote resources before release acceptance.

## Local dependencies and export

GSAP 3.12.5 and Three.js 0.160.0 are vendored; no runtime script CDN is used.
Every SKILL names each asset so the frozen-package scanner carries it.
Three.js exceeds the 256 KiB side-file limit: the gallery and Remix use
`assets/three.min.js`, and the frozen reference carries an identical gzip copy
with decompression instructions in the SKILL. This was its packaging arrangement:

The retired `motion-future` package stored both `assets/three.min.js` and a
deterministic gzip copy. Those assets and their packaging command are no longer
part of the current tree; their historical source is available before commit
`9e2ad047`.

`motion-future` keeps its scenes inline in `example.html`, with the copy in one
`CFG` block. `assets/three-addons.js` carries the readable three.js examples it
needs (RoomEnvironment, FontLoader, TextGeometry; MIT), and
`assets/unbounded-black-glyphs.js` holds Unbounded Black outlines for the 3D
type, so the hero word can be any Latin text.

The package regression checks that referenced scripts, fonts, licenses and the
soundtrack restore byte-for-byte. The browser regression seeks each film with
callbacks suppressed, forward and backward, and requires identical canvas
output at each timestamp, including hidden layers.

## Audio

Every template carries an original procedural soundtrack in
`assets/soundtrack.mp3`, timed to its beats. No audio from the original posts is
used and no audio-generation model was involved. HTML preview sound starts with
the film; when the browser blocks autoplay, the first click or key press turns
it on, and Sound off mutes it. Sound follows the master timeline. The desktop
export path mixes the timed local audio into the MP4 with FFmpeg and fades each
track out where it stops, so a remake made shorter than its music ends cleanly.
Make-same keeps the template's soundtrack by default, because the music is part
of the look being remade. A brief that asks for no music removes it, and an
audio file the user supplies replaces it. Any other music request keeps the
score, because OpenPixo cannot generate music yet. A film longer than its
music is silent after the music ends. When a music request cannot be met, the
reply says so in one short sentence.

The product promo uses music only: the girl's synthetic speech effect is
removed, and the percussion is reduced to a sparse pulse without hi-hats,
claps or off-beat fills.
