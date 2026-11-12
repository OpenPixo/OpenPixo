import { useEffect, useState } from 'react';
import { peaksToWave } from '../../runtime/chat/audio-wave';

/** 再大就不为一条波形把整个文件读进内存,回落到稳定的占位波形 */
const MAX_BYTES = 40 * 1024 * 1024;

const cache = new Map<string, number[] | null>();
const CACHE_MAX = 64;

async function decode(src: string, bars: number, signal: AbortSignal): Promise<number[] | null> {
  const response = await fetch(src, { signal });
  if (!response.ok) return null;
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) return null;
  const bytes = await response.arrayBuffer();
  // 离线解码不需要用户手势,也不占音频设备
  const context = new OfflineAudioContext(1, 1, 44_100);
  const audio = await context.decodeAudioData(bytes);
  return peaksToWave(audio.getChannelData(0), bars);
}

/**
 * 这段音频真实的波形。拿不到(解码不了、文件太大、环境没有 Web Audio)是 null,
 * 调用方继续画占位波形。柱子总高度是定的,所以真波形落下来时不会引起布局跳动。
 */
export function useAudioPeaks(src: string, bars: number, enabled: boolean): number[] | null {
  const key = `${bars}:${src}`;
  const [state, setState] = useState<{ key: string; peaks: number[] | null } | null>(() => (cache.has(key) ? { key, peaks: cache.get(key) ?? null } : null));
  useEffect(() => {
    if (!enabled || typeof OfflineAudioContext === 'undefined' || typeof fetch !== 'function') return undefined;
    if (cache.has(key)) { setState({ key, peaks: cache.get(key) ?? null }); return undefined; }
    const controller = new AbortController();
    void decode(src, bars, controller.signal).then(
      (peaks) => {
        if (controller.signal.aborted) return;
        if (cache.size >= CACHE_MAX) {
          const first = cache.keys().next().value;
          if (first !== undefined) cache.delete(first);
        }
        cache.set(key, peaks);
        setState({ key, peaks });
      },
      () => { if (!controller.signal.aborted) setState({ key, peaks: null }); },
    );
    return () => controller.abort();
  }, [bars, enabled, key, src]);
  return state?.key === key ? state.peaks : null;
}
