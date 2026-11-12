/**
 * 这一轮生成的图片、音频、视频,直接摆在消息里 —— 不收进执行记录,不随执行记录收起。
 *
 * 数据源与检测规则在 `runtime/chat/turn-assets.ts`(只收已经出来的文件);这里只管画。
 * 音频是可以拖动的波形(`AudioArtifact`),视频是内联播放器(`VideoArtifact`)。图片:
 *
 *   · 一张图:一格大一点的预览;多张:紧凑的方格网格。
 *   · 底是棋盘格 —— 透明的立绘 / sprite 一眼看得出哪里是透明的(不透明的贴图盖住它)。
 *   · 小图(≤256px,像素画)按最近邻放大,不糊。
 *   · sprite:有帧信息就在格子里循环播放,角上标「N 帧」。帧信息只认 daemon 资产索引的
 *     结论(`/assets/info` 的 `semantics`:Aseprite / TexturePacker JSON、引擎侧车、
 *     用户在资产面板里设的网格),没有声明时只认「≥3 个正方形格子的横条 / 竖条」这一种
 *     几何 —— 两格的宽图更可能是一张横幅,不去猜。
 *   · 点一格:大图浮层(棋盘底、sprite 可暂停、左右键翻页),里面有「在文件中打开」与「下载」。
 *
 * 卡面读这一轮的**快照**(有就用,`artifactRefs` 的 ready 快照),打开永远去工作区最新那份 ——
 * 和产物卡同一条裁决(`runtime/chat/artifact-refs.ts`)。
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from '@openpixo/components';
import type { AssetFrame, ProjectAsset } from '@openpixo/contracts';
import { useT } from '../../i18n';
import { fetchAssetInfo } from '../../providers/project-assets';
import type { TurnAsset } from '../../runtime/chat/turn-assets';
import { detectFrameGrid, spriteFrames } from '../assets/frame-grid';
import { Icon } from '../Icon';
import { AudioArtifact } from './AudioArtifact';
import { chatSeam } from './ChatRoot';
import { VideoArtifact } from './VideoArtifact';
import { Model3dViewer } from '../Model3dViewer';
import styles from './AssetGallery.module.css';

export interface AssetGalleryProps {
  assets: readonly TurnAsset[];
  projectId: string;
  /** 卡面用的地址:有当轮快照给快照,没有给工作区当前文件 */
  imageSrc: (path: string) => string;
  /** 在右侧工作区打开(永远是最新那份) */
  onOpenFile?: ((name: string) => void) | undefined;
}

/** 一轮写出几百张切图时,消息里只摆够认出这轮干了什么的那些;其余在改动和文件视图里 */
const MAX_IMAGES = 24;
const MAX_VIDEOS = 4;
const MAX_AUDIOS = 8;
const MAX_MODELS = 4;

export function AssetGallery({ assets, projectId, imageSrc, onOpenFile }: AssetGalleryProps): ReactElement | null {
  const t = useT();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (assets.length === 0) return null;
  const images = assets.filter((asset) => asset.kind === 'image').slice(0, MAX_IMAGES);
  const videos = assets.filter((asset) => asset.kind === 'video').slice(0, MAX_VIDEOS);
  const audios = assets.filter((asset) => asset.kind === 'audio').slice(0, MAX_AUDIOS);
  const models = assets.filter((asset) => asset.kind === 'model3d').slice(0, MAX_MODELS);
  const hidden = assets.length - images.length - videos.length - audios.length - models.length;
  const single = images.length === 1;
  const download = (path: string) => downloadFile(imageSrc(path), baseName(path));
  return (
    <section className={styles.gallery} data-testid="chat-asset-gallery" aria-label={t('chat.assets.title', { count: assets.length })}>
      <div className={styles.head}>{t('chat.assets.title', { count: assets.length })}</div>
      {images.length > 0 ? (
        <div className={single ? styles.single : styles.grid}>
          {images.map((asset, index) => (
            <AssetTile
              key={asset.path}
              asset={asset}
              projectId={projectId}
              src={imageSrc(asset.path)}
              large={single}
              onOpen={() => setOpenIndex(index)}
            />
          ))}
        </div>
      ) : null}
      {videos.map((asset) => (
        <VideoArtifact
          key={asset.path}
          src={imageSrc(asset.path)}
          name={asset.path}
          onOpenFile={onOpenFile ? () => onOpenFile(asset.path) : undefined}
          onDownload={() => download(asset.path)}
        />
      ))}
      {audios.map((asset) => (
        <AudioArtifact
          key={asset.path}
          src={imageSrc(asset.path)}
          name={asset.path}
          onOpenFile={onOpenFile ? () => onOpenFile(asset.path) : undefined}
          onDownload={() => download(asset.path)}
        />
      ))}
      {models.map((asset) => (
        <Model3dViewer key={asset.path} src={imageSrc(asset.path)} name={asset.path} height={280}
          onOpen={onOpenFile ? () => onOpenFile(asset.path) : undefined} />
      ))}
      {hidden > 0 ? <div className={styles.head}>{t('chat.assets.more', { count: hidden })}</div> : null}
      {openIndex != null && images[openIndex] ? (
        <AssetViewer
          assets={images}
          index={openIndex}
          projectId={projectId}
          imageSrc={imageSrc}
          onIndex={setOpenIndex}
          onClose={() => setOpenIndex(null)}
          onOpenFile={onOpenFile}
        />
      ) : null}
    </section>
  );
}

/* ── 单格 ───────────────────────────────────────────────────── */

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

function downloadFile(src: string, name: string): void {
  const link = document.createElement('a');
  link.href = src;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

interface Natural { width: number; height: number }

function AssetTile({ asset, projectId, src, large, onOpen }: {
  asset: TurnAsset;
  projectId: string;
  src: string;
  large: boolean;
  onOpen: () => void;
}): ReactElement {
  const t = useT();
  const [natural, setNatural] = useState<Natural | null>(null);
  const [broken, setBroken] = useState(false);
  const frames = useSpriteFrames(projectId, asset.path, natural);
  const ref = useRef<HTMLButtonElement>(null);
  const visible = useInView(ref);
  const frame = useFrameClock(frames, visible && !prefersReducedMotion());
  const name = baseName(asset.path);
  return (
    <button
      ref={ref}
      type="button"
      className={`${styles.tile} ${large ? styles.large : ''}`}
      data-testid={`chat-asset-${asset.path}`}
      data-sprite={frames ? 'true' : undefined}
      data-failed={broken ? 'true' : undefined}
      aria-label={broken ? t('chat.assets.missing', { name }) : t('chat.assets.open', { name })}
      title={name}
      /* 一张加载不出来的图,没有大图可看 */
      disabled={broken}
      onClick={onOpen}
    >
      <span className={styles.checker} aria-hidden hidden={broken} />
      {broken ? (
        <span className={styles.missing}>
          <Icon name="file" size={16} />
          <span className={styles.missingName}>{name}</span>
          <span>{t('chat.assets.missingShort')}</span>
        </span>
      ) : null}
      {frames && natural ? (
        <SpriteFrame src={src} natural={natural} frame={frames[frame]!} />
      ) : null}
      {/* 原图一直挂着:量尺寸靠它,sprite 播放时把它藏起来(不卸载,免得重新加载) */}
      <img
        className={`${styles.media} ${natural && isPixelArt(natural) ? styles.pixel : ''}`}
        src={src}
        alt=""
        loading="lazy"
        hidden={Boolean(frames && natural) || broken}
        onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        onError={() => setBroken(true)}
      />
      {frames ? <span className={styles.badge}>{t('chat.assets.frames', { count: frames.length })}</span> : null}
    </button>
  );
}

function SpriteFrame({ src, natural, frame, className }: {
  src: string;
  natural: Natural;
  frame: AssetFrame;
  className?: string;
}): ReactElement {
  return (
    <svg
      className={`${styles.media} ${styles.pixel} ${className ?? ''}`}
      viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <image href={src} width={natural.width} height={natural.height} />
    </svg>
  );
}

/** 像素画(两边都不超过 256px)放大时走最近邻,和资产面板 `isPixelAsset` 同一条线 */
function isPixelArt(natural: Natural): boolean {
  return Math.max(natural.width, natural.height) <= 256;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/* ── sprite 帧 ───────────────────────────────────────────────── */

/**
 * 这张图能不能当 sprite 播。返回帧表,不能播返回 null。
 *
 * 先看几何能不能是一条帧带(避免对每张图都打一次索引请求),再问资产索引要声明:
 *   · 索引里有声明的帧(JSON / 引擎侧车)或用户设过网格 → 用它;
 *   · 没有声明,只认「≥3 个正方形格子」的横条 / 竖条(`detectFrameGrid` 的几何推断)。
 */
export function galleryFrames(asset: Pick<ProjectAsset, 'width' | 'height' | 'semantics'>): AssetFrame[] | null {
  const frames = spriteFrames(asset);
  if (frames.length < 2) return null;
  const declared = asset.semantics.some((semantic) => semantic.frames?.length || semantic.grid);
  if (declared) return frames;
  const grid = detectFrameGrid(asset);
  return grid && grid.source === 'dimensions' && grid.cols * grid.rows >= 3 ? frames : null;
}

function mightBeSheet(natural: Natural): boolean {
  const { width, height } = natural;
  if (!width || !height || width === height) return false;
  const long = Math.max(width, height), short = Math.min(width, height);
  return long % short === 0 || long / short >= 2;
}

function useSpriteFrames(projectId: string, path: string, natural: Natural | null): AssetFrame[] | null {
  const [frames, setFrames] = useState<AssetFrame[] | null>(null);
  const probe = natural != null && mightBeSheet(natural);
  useEffect(() => {
    setFrames(null);
    if (!probe || typeof fetch !== 'function') return undefined;
    const controller = new AbortController();
    fetchAssetInfo(projectId, path, controller.signal)
      .then((asset) => { if (!controller.signal.aborted) setFrames(galleryFrames(asset)); })
      .catch(() => { /* 帧信息是锦上添花,拿不到就当一张普通图 */ });
    return () => controller.abort();
  }, [projectId, path, probe]);
  return frames;
}

/** 循环播放;每帧自己的时长优先,没有就 10fps */
function useFrameClock(frames: AssetFrame[] | null, playing: boolean): number {
  const [index, setIndex] = useState(0);
  const count = frames?.length ?? 0;
  useEffect(() => { setIndex(0); }, [frames]);
  useEffect(() => {
    if (!playing || count < 2) return undefined;
    const duration = frames?.[index % count]?.durationMs;
    const delay = typeof duration === 'number' && duration > 0 ? duration : 100;
    const timer = window.setTimeout(() => setIndex((value) => (value + 1) % count), delay);
    return () => window.clearTimeout(timer);
  }, [playing, frames, index, count]);
  return count ? index % count : 0;
}

/** 滚出视口的格子不跑帧 —— 一条长会话里可能挂着几十张 sprite */
function useInView(ref: { current: Element | null }): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => setInView(entries.some((entry) => entry.isIntersecting)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return inView;
}

/* ── 大图浮层 ───────────────────────────────────────────────── */

function AssetViewer({ assets, index, projectId, imageSrc, onIndex, onClose, onOpenFile }: {
  assets: readonly TurnAsset[];
  index: number;
  projectId: string;
  imageSrc: (path: string) => string;
  onIndex: (index: number) => void;
  onClose: () => void;
  onOpenFile?: ((name: string) => void) | undefined;
}): ReactElement {
  const t = useT();
  const asset = assets[index]!;
  const src = imageSrc(asset.path);
  const [natural, setNatural] = useState<Natural | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const frames = useSpriteFrames(projectId, asset.path, natural);
  const frame = useFrameClock(frames, playing);
  const many = assets.length > 1;
  useEffect(() => { setNatural(null); setFailed(false); }, [asset.path]);

  useEffect(() => {
    if (!many) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') onIndex((index + 1) % assets.length);
      else if (event.key === 'ArrowLeft') onIndex((index - 1 + assets.length) % assets.length);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [many, index, assets.length, onIndex]);

  const download = () => downloadFile(src, baseName(asset.path));
  const pixel = natural != null && isPixelArt(natural);

  return (
    <Dialog open onClose={onClose} size="lg" ariaLabel={asset.path} data-testid="chat-asset-viewer">
      <div {...chatSeam(styles.viewer)}>
        <DialogHeader className={styles.viewerHead}>
          <DialogTitle className={styles.viewerTitle}>{baseName(asset.path)}</DialogTitle>
          <span className={styles.viewerMeta}>
            {natural ? `${natural.width} × ${natural.height}` : null}
            {frames ? ` · ${t('chat.assets.frames', { count: frames.length })}` : null}
            {many ? ` · ${t('chat.assets.position', { index: index + 1, total: assets.length })}` : null}
          </span>
        </DialogHeader>
        <DialogBody className={styles.viewerBody}>
          <div className={styles.stage}>
            <span className={styles.checker} aria-hidden hidden={failed} />
            {frames && natural ? (
              <SpriteFrame src={src} natural={natural} frame={frames[frame]!} className={styles.stageMedia} />
            ) : null}
            {failed ? <p className={styles.stageFailed} role="status">{t('chat.assets.missing', { name: baseName(asset.path) })}</p> : null}
            <img
              key={asset.path}
              className={`${styles.stageMedia} ${pixel ? styles.pixel : ''}`}
              src={src}
              alt={asset.path}
              hidden={Boolean(frames && natural) || failed}
              onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
              onError={() => setFailed(true)}
            />
          </div>
        </DialogBody>
        <DialogFooter className={styles.viewerFoot}>
          <span className={styles.nav}>
            {many ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => onIndex((index - 1 + assets.length) % assets.length)}>
                  {t('chat.assets.prev')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onIndex((index + 1) % assets.length)}>
                  {t('chat.assets.next')}
                </Button>
              </>
            ) : null}
            {frames ? (
              <Button size="sm" variant="ghost" aria-pressed={playing} onClick={() => setPlaying((value) => !value)}>
                {t(playing ? 'chat.assets.pause' : 'chat.assets.play')}
              </Button>
            ) : null}
          </span>
          <span className={styles.actions}>
            <Button size="sm" variant="secondary" onClick={download}>{t('chat.assets.download')}</Button>
            {onOpenFile ? (
              <Button
                size="sm"
                variant="primary"
                onClick={() => { onOpenFile(asset.path); onClose(); }}
              >
                {t('chat.assets.openInFiles')}
              </Button>
            ) : null}
          </span>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
