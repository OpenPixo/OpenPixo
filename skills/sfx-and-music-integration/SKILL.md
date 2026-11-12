---
name: sfx-and-music-integration
en_name: SFX and music integration
zh_name: 音效与音乐接入
description: Integrate existing game audio and fix voices, ducking, loops, saved mix preferences or browser unlock in Godot 4, Unity 6 or Phaser 3; not for audio generation.
zh_description: 在 Godot 4、Unity 6 或 Phaser 3 中接入已有音频，修复声部、闪避、循环、混音偏好与浏览器解锁；不用于音频生成。
triggers:
  - game audio integration
  - audio buses
  - music ducking
  - web audio unlock
  - Unity AudioMixer
  - 游戏音频接入
  - 音乐闪避
license: Apache-2.0
pixo:
  mode: utility
  engines:
    - godot
    - unity
    - phaser
  category: game-development
---

# SFX and music integration

Wire existing audio into Godot 4, Unity 6 or Phaser 3 gameplay or fix voices, loops, clipping and browser silence.
Project conventions, installed versions, architecture, audio ownership and explicit user choices take precedence.
Use the current audio and settings service. A clip fix does not require a new manager, asset-generation call or complete mix redesign.

## Quick path

1. Locate the real audio files and events; inspect `pixo asset info <path> --json` and listen.
2. Reproduce the issue: first gesture, busy encounter, loop boundary, mute or restart.
3. Choose the relevant branch below; derive new files only when preparation is actually needed.
4. Wire playback to the accepted gameplay event, preserving user gain separately from ducking and per-clip gain.
5. Run `pixo game verify --steps check,build,run --json` and inspect loader and runtime logs, then listen to the affected cases.

Commands assume `PIXO_PROJECT_ID`; otherwise add `--project <id>`.
On Unity the `run` step is skipped, so `check,build` is the useful set and listening happens in the Editor or a player.

## Choose the smallest audio change

| Need | Choose | Acceptance |
| --- | --- | --- |
| Rapid repeated SFX | Bounded voices, rules for priority and dropping cues, optional cooldown | Important cues remain audible; no unbounded overlaps |
| Less repetition | Small variation in pitch or rate, or clip selection that avoids repeats | Cue remains recognizable; no critical timing drift |
| Dialogue over music | Temporary duck multiplier with attack and release | Current user preference restores, even after overlaps |
| Spatial world cue | Godot AudioStreamPlayer2D, Unity AudioSource with Spatial Blend above 0, or the project's spatial service | Position and attenuation match gameplay |
| Seamless ambience | Authored seam or reviewed crossfade derivative | Listen through two boundaries in the exported target |
| Browser initially silent | Gesture and unlock path owned by Phaser or the engine | Fresh browser session starts sound after input |
| New Game resets volume | Separate settings storage from progression | Mute and volume survive restart and new progress |

Effective gain combines saved user preference, per-clip gain and temporary ducking.
Reserve mix headroom; several individually clean sounds can clip when summed.

## Optional deterministic preparation

```sh
pixo asset audio normalize public/assets/jump.wav public/assets/coin.wav --lufs -18 --out public/audio/normalized --dry-run --json
pixo asset audio normalize public/assets/jump.wav public/assets/coin.wav --lufs -18 --out public/audio/normalized --json
pixo asset audio loop audio/ambience.wav --crossfade-ms 60 --out derived/ambience-loop --json
```

Paths and levels are examples; use the game's agreed targets and real inputs.
Short transients may not have useful integrated LUFS. Crossfading rhythmic music can smear the downbeat.
`audio loop` prepares a file; engine loop playback still needs enabling.
Read real output paths, failures and `originalsPreserved`; existing destinations are skipped.
Listen before replacing references: normalization does not certify the summed mix.
On Unity, `--out` must be under `Assets/`, such as `Assets/Audio/normalized`, or the Editor will not import the file.

## Godot 4: buses and owned voices

Use the project's buses (commonly Master, Music, SFX and UI) and assign players deliberately.
Persistent music belongs in the existing persistent owner; level emitters belong to their scene.
Three child AudioStreamPlayers with bus SFX give independent pitches; this fragment assumes `voices`, `jump_stream` and a separate audio RNG:

```gdscript
func play_jump() -> void:
    if jump_stream == null:
        return
    for voice in voices:
        if not voice.playing:
            voice.stream = jump_stream
            voice.pitch_scale = rng.randf_range(0.96, 1.04)
            voice.volume_db = -8.0
            voice.play()
            return
    # All voices busy: drop this low-priority cue.
```

Trigger once on accepted jump, not each tick while held.
Use separate players when active voices need independent pitch; random audio must not consume layout or gameplay RNG.

```gdscript
func set_bus_gain(bus_name: StringName, gain: float) -> void:
    var index := AudioServer.get_bus_index(bus_name)
    if index < 0:
        push_error("Missing audio bus: " + String(bus_name))
        return
    gain = clampf(gain, 0.0, 1.0)
    AudioServer.set_bus_mute(index, gain == 0.0)
    AudioServer.set_bus_volume_db(index, linear_to_db(maxf(gain, 0.0001)))
```

For sidechain ducking, AudioEffectCompressor on Music can use `sidechain = "SFX"`.
Tune attack, release and ratio by listening. For dialogue ownership, a player-level multiplier plus a count or tokens prevents one speaker ending another's duck.
Keep saved Music bus preference independent. Configure looping on the actual AudioStream and import format. Test the export.
Decide whether UI sound continues during pause.

## Phaser 3: unlock, groups and cleanup

Preload using the project's URL convention, for example `this.load.audio('jump', 'assets/jump.wav')`.
Phaser owns browser unlock; start from a visible Start gesture or wait on `this.sound`'s `unlocked` event.
Keep gameplay usable if audio is disabled or unavailable.

Phaser has no Godot-style named buses. Use the existing group, service or owned sound list.
For a preloaded scene-owned music clip, narrow away disabled-audio stubs before gain control:

```ts
const music = this.sound.add('music', { loop: true, volume: 0 });
if (music instanceof Phaser.Sound.WebAudioSound ||
    music instanceof Phaser.Sound.HTML5AudioSound) {
  const mix = { preference: 0.6, duck: 1 };
  const applyGain = (): void => { music.setVolume(mix.preference * mix.duck); };
  const start = (): void => { applyGain(); if (!music.isPlaying) music.play(); };
  if (this.sound.locked) this.sound.once('unlocked', start);
  else start();
  // Settings change preference; duck tweens change duck; both call applyGain.
  this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    this.sound.off('unlocked', start);
    this.tweens.killTweensOf(mix);
    music.destroy();
  });
}
```

An owned tween can target `mix.duck` (for example 0.35 then 1) with `onUpdate: applyGain`; kill a prior tween before replacing it.
If music persists across Scenes, move ownership and cleanup to the existing persistent service instead.
At an accepted jump, `this.sound.play('jump', { volume: 0.3, rate: Phaser.Math.FloatBetween(0.96, 1.04) })` gives modest variation.
Add a voice limit or cooldown when bursts require it. Rate changes affect duration and are unsuitable for sample-precise music scheduling.

## Unity 6: mixer groups and owned voices

Use the project's AudioMixer groups (commonly Master, Music, SFX and UI) and set each `AudioSource.outputAudioMixerGroup`. Persistent music belongs on the existing persistent owner; on a reload, a second `DontDestroyOnLoad` copy plays a second loop unless the owner checks for one.

Child sources give independent pitch, because `PlayOneShot` shares its source's pitch and `Stop` ends every shot on that source. This uses its own `System.Random`, so audio never advances a seeded `UnityEngine.Random` stream:

```csharp
using UnityEngine;
using UnityEngine.Audio;

public sealed class SfxVoices : MonoBehaviour
{
    [SerializeField] private AudioSource[] voices; // SFX group, Play On Awake off.
    [SerializeField] private AudioClip jump;
    [SerializeField] private AudioMixer mixer;
    private readonly System.Random rng = new System.Random();

    public void PlayJump()
    {
        if (jump == null) return;
        foreach (var voice in voices)
        {
            if (voice.isPlaying) continue;
            voice.clip = jump;
            voice.pitch = 0.96f + (float)rng.NextDouble() * 0.08f;
            voice.volume = 0.4f;
            voice.Play();
            return;
        }
        // All voices busy: drop this low-priority cue.
    }

    // Call from Start or later. "MusicVolume" is an exposed parameter, not a group name.
    public void SetGroupGain(string exposedName, float gain)
    {
        var decibels = gain <= 0.0001f ? -80f : Mathf.Log10(Mathf.Min(gain, 1f)) * 20f;
        if (!mixer.SetFloat(exposedName, decibels)) Debug.LogError("Not exposed: " + exposedName);
    }
}
```

- A slider's linear value needs that log conversion; a mixer's volume is in decibels.
- `SetFloat` takes an exposed parameter away from snapshots. Keep user gain on one exposed parameter and ducking on another, or duck with a Send into a Duck Volume effect on the Music group, which leaves the saved preference alone. Tune threshold, attack and release by listening.
- Time scale does not affect audio, so a paused game keeps playing sound. `AudioListener.pause = true` stops it, and a source with `ignoreListenerPause` keeps UI clicks audible. Decide this per sound.
- Import settings: Decompress On Load for short frequent SFX, Compressed In Memory for medium clips, Streaming for long music. Check overrides for mobile.
- Set looping on the source. MP3 can add a gap at the seam, so prefer WAV or Vorbis, and listen in a build. Sample-accurate stems use `PlayScheduled(AudioSettings.dspTime + lead)`.
- `Max Real Voices` in Project Settings caps audible sources. `AudioSource.priority` decides who drops, and a lower number survives.
- Unity 6's Audio Random Container is an `AudioResource` you assign to `AudioSource.resource`. It handles clip choice, avoiding repeats, and pitch and volume variation with no script.
- `AudioSource.PlayClipAtPoint` makes a temporary object with no mixer group, so it ignores the player's SFX volume. A scene also needs exactly one AudioListener.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Save the ducked volume as user preference | Persist preference independently; compute effective gain |
| One dialogue end unducks all speakers | Track active owners or tokens |
| Restart creates another music loop | Clean up scene-owned sounds and listeners, or use one persistent owner |
| Crossfade guarantees a rhythmic seam | Listen to the exported format; padding or phase can still be wrong |
| Screenshot proves audio works | Record listening and first-gesture tests separately |

## Done when

- [ ] First-gesture unlock, frequent cues and overlapping voices behave as intended.
- [ ] Mute during ducking stays muted; current volume survives pause, restart and New Game as required.
- [ ] Two loop boundaries and the busy summed mix were heard on the target runtime.
- [ ] Use `pixo game run <projectId> --json` for listening tests, or a player build on Unity; report missing audio inputs and remaining audible defects.
- [ ] Inspect `pixo game verify --steps check,build,run --json`; report skipped checks and loader errors.
