---
name: game-localization
en_name: Game localization
zh_name: 游戏本地化
description: "Localize existing Godot 4, Unity 6 or Phaser 3 game text, runtime language switching, fonts and layout. Use for game string tables or CJK font issues; not a general document translation or a requirement to add unrequested locales."
zh_description: "为既有 Godot 4、Unity 6 或 Phaser 3 游戏处理文本本地化、运行时语言切换、字体与布局；适用于游戏字符串表和中文字形问题，不用于通用文档翻译，也不强加未要求的语言。"
triggers:
  - game localization
  - translate game UI
  - CJK game fonts
  - Unity Localization
  - 游戏本地化
  - 游戏中英文切换
license: Apache-2.0
pixo:
  mode: utility
  engines:
    - godot
    - unity
    - phaser
  category: game-development
  example_prompt: Add English and Simplified Chinese to the sample platformer's score HUD and restart message, with a saved language preference and verified font coverage.
  example_prompt_i18n:
    zh-CN: 给示例平台游戏的分数 HUD 和重开提示加入英文与简体中文，保存语言偏好并验证字体覆盖。
---

# Game localization

The requested languages, project conventions, engine version and existing libraries for localization and settings take precedence. English and Simplified Chinese below are a small example, not a mandatory locale set. A single missing label does not require replacing the whole localization system.

## Quick path

1. Inspect the affected text owners, supported locales, lookup path, fonts and settings loader.
2. Extract stable semantic keys with whole messages and named placeholders; preserve mechanics, storage IDs and input action names.
3. Add matching translations in the requested locales and the project's fallback; validate keys and placeholders.
4. Refresh existing labels on language change, keep focus and progress, and persist the locale through the settings owner.
5. Run `pixo game verify --steps check --json` for Godot, `--steps check,build` for Unity or `--steps build` for Phaser; test longest text, font coverage and restart persistence.

Add `--project <id>` when `PIXO_PROJECT_ID` is absent. Include only screens in scope; inspect pause, restart and error text when those paths are affected.

## Choose the mechanism

| Project | Use | Boundary |
| --- | --- | --- |
| Existing localization library | Its keys, plural rules and change notification | Extend it rather than add a competing lookup |
| Godot 4.3 | Imported translations, `tr()` and `TranslationServer.set_locale()` | Godot locale example `zh_CN`; normalize browser-style input at the boundary |
| Unity 6 | `com.unity.localization` String Tables and `LocalizedString`, with TextMeshPro | Unity locale example `zh-Hans`; match the code in Available Locales |
| Small Phaser 3 game | Typed tables or existing i18n library; refresh `Text` values | Browser locale example `zh-CN`; Phaser does not translate UI automatically |
| Languages with complex plurals or right-to-left text | Existing plural, context and shaping facilities | English examples of singular and plural forms do not model every language |

## Godot 4.3: dynamic text refresh

Create a UTF-8 CSV using the project's translation import convention, then register its generated translation resources in Project Settings → Localization → Translations. Set the project's fallback locale there.

```csv
keys,en,zh_CN
hud.coins_one,{count} coin,{count} 枚金币
hud.coins_other,{count} coins,{count} 枚金币
```

A HUD script with an existing Label marked Access as Unique Name:

```gdscript
extends Control
@onready var coin_label: Label = %CoinLabel
var coins: int = 0

func _ready() -> void:
	refresh_text()

func _notification(what: int) -> void:
	if what == NOTIFICATION_TRANSLATION_CHANGED and is_node_ready():
		refresh_text()

func set_coins(value: int) -> void:
	coins = value
	refresh_text()

func refresh_text() -> void:
	var key: String = "hud.coins_one" if coins == 1 else "hud.coins_other"
	coin_label.text = tr(key).format({"count": coins})
```

These two count keys demonstrate English and Chinese only. Reuse the project's plural system for other locales.
- Load the saved supported locale before constructing localized scenes; apply changes via `TranslationServer.set_locale(locale)`.
- `NOTIFICATION_TRANSLATION_CHANGED` can arrive before children are ready, which is why the guard matters. See [Godot 4.3 Node](https://docs.godotengine.org/en/4.3/classes/class_node.html) and [localization setup](https://docs.godotengine.org/en/4.3/tutorials/i18n/internationalizing_games.html).
- With `ConfigFile`, load and preserve other sections before saving the preference. If loading fails for a reason other than a missing file, keep the session usable rather than overwriting possibly recoverable settings.
- Use the existing Theme font, fallback fonts and containers; bundle the font resource so editor system fonts cannot hide missing export glyphs.

## Phaser 3: lookup and refresh boundaries

Reuse a library if present. For tiny tables, a formatter can catch missing named arguments without silently rendering tokens:

```ts
function formatMessage(message: string, args: Record<string, string | number>): string {
  return message.replace(/\{(\w+)\}/g, (token, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(args, name)) {
      throw new Error('Missing translation argument: ' + name);
    }
    return String(args[name]);
  });
}
```

Validate this during development; production lookup should use the project's fallback and error policy without crashing gameplay.
- Report missing locale keys during development and fall back at runtime. Compare each locale's key set and each message's placeholder-name set before shipping.
- On locale change, refresh existing Text objects with `setText(...)`. Subscribe once to the settings event and remove shared listeners on `Phaser.Scenes.Events.SHUTDOWN`.
- Use `setWordWrapWidth(measuredWidth, true)` when appropriate; advanced wrapping trims or collapses spaces. Inspect real CJK breaks rather than treating that option as complete language-aware typography.
- Wait for local web fonts with `document.fonts.load(...)` before creating Text, or refresh after loading. The family must match `@font-face` and Text style. Include redistribution licenses.
- BitmapText needs every requested glyph in its atlas. Ordinary Text with a suitable local font is usually simpler for broad CJK coverage.
- Read installed Phaser 3 types or [tagged 3.90 Text source](https://github.com/phaserjs/phaser/blob/v3.90.0/src/gameobjects/text/Text.js); current-major documentation may describe Phaser 4.

## Unity 6: Localization package and TextMeshPro

Static labels need no code: add `LocalizeStringEvent` and point it at a table entry. It refreshes when the locale changes. For a computed label, tick Smart on the entry so it can use the locale's plural rules, such as `{count:plural:{} coin|{} coins}` in English and `{count} 枚金币` in Chinese:

```csharp
using TMPro;
using UnityEngine;
using UnityEngine.Localization;
using UnityEngine.Localization.SmartFormat.PersistentVariables;

public sealed class CoinLabel : MonoBehaviour
{
    [SerializeField] private TMP_Text label;
    [SerializeField] private LocalizedString coinsText;
    private readonly IntVariable count = new IntVariable();

    private void Awake() => coinsText["count"] = count;
    private void OnEnable() => coinsText.StringChanged += Show;
    private void OnDisable() => coinsText.StringChanged -= Show;
    private void Show(string text) => label.text = text;

    public void SetCoins(int value) => count.Value = value; // Refreshes the string.
}
```

`StringChanged` fires on subscribe and on locale changes, so the label needs no separate refresh.

- String Tables load through Addressables. Keep Build Addressables on Player Build on, or the Editor shows translations and the player shows none. Test a real player build.
- Startup is asynchronous. Wait on `LocalizationSettings.InitializationOperation` before reading a string or `AvailableLocales`.
- Switch with `LocalizationSettings.SelectedLocale = LocalizationSettings.AvailableLocales.GetLocale("zh-Hans")`. A code not in the list returns null, so map stored or system values at the boundary. Persistence comes from the Locale Selectors in Localization Settings (`PlayerPrefLocaleSelector`), unless the project's settings owner already stores it; keep one owner.
- Give each TextMeshPro font asset fallbacks. A CJK font usually works as Dynamic Atlas Population, which needs Include Font Data on the source font. A static atlas needs every glyph baked in; check with `TMP_FontAsset.HasCharacters`. Missing glyphs draw as squares, and only in languages you did not test.
- CJK line breaking comes from the TMP Settings line-breaking rules. TextMeshPro has no built-in Arabic shaping, so right-to-left text needs an installed solution.
- A locale switch must not reload the scene, which would reset the round. Keep save data and parsing on `CultureInfo.InvariantCulture`: a locale that writes `1,5` breaks a save parsed as `1.5`.

## Layout and locale changes

Keep complete messages together; placeholders let translators reorder count, item and action names. Use logical margins and reflow instead of shrinking all text for one long translation. Test the requested narrow viewport and maximum UI and subtitle scale. Include requested languages without spaces.

A saved unsupported locale follows the project's fallback policy. Switching must retain input focus, pause state and gameplay progress; rebuilding gameplay to redraw labels risks resetting the round.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Translate save keys or input action IDs | Translate display strings; persistent identity must remain stable |
| Concatenate “count + translated suffix” | Use complete messages with named placeholders and the required plural forms and context |
| Assume Latin BitmapText covers Chinese | Verify exported glyph coverage using the real font |
| Treat locale selection as automatic dynamic-label refresh | Refresh computed labels on the locale-change event |
| Put names into RichTextLabel, TextMeshPro rich text or HTML as trusted markup | Escape data or turn rich text off unless markup is intentionally supported |
| Build only in the editor's installed fonts | Test the packaged font resources in the exported runtime |

## Done when

- [ ] Requested locales have matching keys and placeholders. Count cases cover 0, 1 and multiple.
- [ ] Longest text, glyphs, wrapping and focus work at target sizes, including pause and restart UI.
- [ ] Selected locale survives restart without changing progress; corrupt or unknown settings follow the fallback policy.
- [ ] Applicable verify command above passes; `pixo game playtest --duration 10 --json` provides supported capture on Godot and web, while switching and persistence need separate observed interaction. Unity needs a player build for both.
