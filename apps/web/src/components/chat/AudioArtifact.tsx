/**
 * 音频产物(设计稿组件 24 · 第 43 / 44 格)。
 *
 * 一条胶囊:文件名 + 图标 + 已播时长 + 波形 + 总时长,右边一颗播放键、一颗下载。
 * 播放中已播那截的竖条换成实色(第 44 格)。波形就是进度条:点、拖、方向键都能跳。
 *
 * 文件没了或播不了:整条换成一句人话,不留一条点了没反应的波形。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react';
import { Icon } from '../Icon';
import { ChatPlayIcon } from './primitives/icons';
import { useT } from '../../i18n';
import { fallbackWave, formatClock, playedBars } from '../../runtime/chat/audio-wave';
import { useAudioPeaks } from './useAudioPeaks';
import styles from './AudioArtifact.module.css';

export interface AudioArtifactProps {
  src: string;
  name: string;
  /** 总时长(秒)。拿不到就等 `loadedmetadata` */
  durationSec?: number;
  /** 真采样。没有就自己解码文件;解码不了按时长生成一条稳定的占位波形 */
  samples?: number[];
  /**
   * 竖条数量。稿子那一条 406px 宽的卡是 **28** 条(`--i:0` … `--i:27`,数过)。
   * 这个数不是随便取的:3px 柱 + 3px 间距,28 条正好铺满 `.wave` 那一段净宽;
   * 给多了会被 `overflow: hidden` 从右边裁掉,波形看着像被切了一刀。
   */
  bars?: number;
  onDownload?: () => void;
  /** 在右侧面板打开这个文件;点文件名触发 */
  onOpenFile?: (() => void) | undefined;
  /** 陈列页 / 测试用:直接摆出播放中的样子,不真的播 */
  previewCurrentSec?: number;
  previewPlaying?: boolean;
}

const SEEK_STEP_SEC = 5;

export function AudioArtifact({
  src,
  name,
  durationSec,
  samples,
  bars = 28,
  onDownload,
  onOpenFile,
  previewCurrentSec,
  previewPlaying,
}: AudioArtifactProps): ReactElement {
  const t = useT();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState(durationSec ?? 0);
  const [current, setCurrent] = useState(previewCurrentSec ?? 0);
  const [playing, setPlaying] = useState(previewPlaying ?? false);
  const [failed, setFailed] = useState(false);
  const peaks = useAudioPeaks(src, bars, !samples?.length && previewPlaying === undefined);

  const wave = useMemo(
    () => (samples && samples.length > 0 ? samples.slice(0, bars) : peaks ?? fallbackWave(duration || 30, bars)),
    [samples, bars, duration, peaks],
  );
  const lit = playedBars(current, duration, wave.length);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setFailed(true));
    else el.pause();
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onMeta = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const onTime = () => setCurrent(el.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onError = () => setFailed(true);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('durationchange', onMeta);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onPause);
    el.addEventListener('error', onError);
    return () => {
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('durationchange', onMeta);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onPause);
      el.removeEventListener('error', onError);
    };
  }, []);

  const seekTo = useCallback((sec: number) => {
    const el = audioRef.current;
    if (!el || !(duration > 0)) return;
    const next = Math.min(duration, Math.max(0, sec));
    el.currentTime = next;
    setCurrent(next);
  }, [duration]);

  const seekFromPointer = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width > 0) seekTo(((event.clientX - rect.left) / rect.width) * duration);
  };
  const onWaveKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowRight') seekTo(current + SEEK_STEP_SEC);
    else if (event.key === 'ArrowLeft') seekTo(current - SEEK_STEP_SEC);
    else if (event.key === 'Home') seekTo(0);
    else if (event.key === 'End') seekTo(duration);
    else return;
    event.preventDefault();
  };

  const shownName = name.split('/').pop() ?? name;

  return (
    <div className={styles.aud} data-testid="chat-audio-artifact" data-playing={playing ? '' : undefined} data-failed={failed ? '' : undefined}>
      {onOpenFile ? (
        <button type="button" className={`${styles.caption} ${styles.captionButton}`} title={name} aria-label={t('chat.assets.openInFiles')} onClick={onOpenFile}>
          {shownName}
        </button>
      ) : (
        <span className={styles.caption} title={name}>{shownName}</span>
      )}
      <div className={styles.inner}>
        <span className={styles.icon}>
          <Icon name="volume" size={15} />
        </span>
        {failed ? (
          <span className={styles.failed} role="status">{t('chat.audio.failed')}</span>
        ) : (
          <>
            <span className={styles.time}>{formatClock(current)}</span>
            <span
              className={styles.wave}
              role="slider"
              tabIndex={duration > 0 ? 0 : -1}
              aria-label={t('chat.audio.seek')}
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(current)}
              aria-valuetext={formatClock(current)}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture?.(event.pointerId);
                seekFromPointer(event);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture?.(event.pointerId)) seekFromPointer(event);
              }}
              onKeyDown={onWaveKey}
            >
              {wave.map((h, i) => (
                <i
                  key={i}
                  className={i < lit ? styles.on : undefined}
                  /*
                   * `--h` 是这根柱子多高(采样值),`--i` 是它排第几根。
                   * 后者只为起伏那条动画服务:CSS 用 `calc(var(--i) * 18ms)` 把每根
                   * 的起点错开。不写它的话整排柱子会齐步走 —— 看着像一整块在呼吸,
                   * 不像一条波形。稿子的静态 DOM 里两个变量也是并排写在 style 上的。
                   */
                  style={{ ['--h' as string]: String(h), ['--i' as string]: String(i) }}
                />
              ))}
            </span>
            <span className={`${styles.time} ${styles.timeEnd}`}>{formatClock(duration)}</span>
            {/*
             * 播放键在白行【里面】(稿子的 `.aud-b` 是 `.aud-in` 的最后一个孩子)。
             * 它操作的是这段音频本身 —— 播 / 停,属于内容;挂到白行外面会让白行
             * 右端凭空短一截,而那一截是外层灰底。
             * 下面那颗下载键相反:它拿的是整条附件,不是音频里的某一段,所以留在外面
             * (稿子那个位置是「×」,2026-08-27 裁决换成下载原件)。
             */}
            <button
              type="button"
              className={styles.play}
              onClick={toggle}
              aria-label={playing ? t('chat.audio.pause') : t('chat.audio.play')}
            >
              {playing ? (
                <Icon name="pause" size={12} />
              ) : (
                <span className={styles.playGlyph}>
                  <ChatPlayIcon size={12} />
                </span>
              )}
            </button>
          </>
        )}
      </div>
      <button type="button" className={styles.download} onClick={onDownload} aria-label={t('chat.audio.download', { name })}>
        <Icon name="download" size={14} />
      </button>
      {/* 真正出声的那一个。波形是画的,进度靠它的 timeupdate 驱动 */}
      <audio ref={audioRef} src={src} preload="metadata" style={{ display: 'none' }} />
    </div>
  );
}
