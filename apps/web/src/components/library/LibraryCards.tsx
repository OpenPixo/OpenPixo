import { useEffect, useRef, useState } from 'react';
import { appendResourceQuery } from '../../lib/resource-url';
import { assetThumbnailUrl } from '../../providers/project-assets';
import { projectRawUrl } from '../../providers/registry';
import type { ProjectFile } from '../../types';
import { AddToChatButton } from '../files/AddToChatButton';
import { projectFileKind } from '../files/file-kind';
import { Icon } from '../Icon';
import { EntryMenuButton, RenameInput, SelectCheck, type EntryContext } from './entry-controls';
import { categoryGlyph, categoryLabel, fileCategory, humanBytes } from './file-meta';
import { HtmlCardThumbnail } from './HtmlCardThumbnail';
import { baseName, fileExtension, folderWithinDir } from './library-entries';
import styles from './Library.module.css';

// 资源库 grid mode: small uniform cards. Images and video show the daemon's
// asset thumbnail (pixel art is upscaled nearest-neighbour there), audio gets
// a play button, pages their live thumbnail, everything else a type glyph.
// The card names the file; its full path is the tooltip, and a flat result
// shows the folder underneath.
//
// The `df-card*` class names are hooks only (tests, e2e); styling lives in
// Library.module.css.

type ImageStatus = 'loading' | 'loaded' | 'error';

/** Thumbnail first, the original bytes if the thumbnail cannot be made, then a glyph. */
function useImageSources(projectId: string, file: ProjectFile): string[] {
  return [
    assetThumbnailUrl(projectId, { relPath: file.name, mtime: Math.round(file.mtime) }, 256),
    appendResourceQuery(projectRawUrl(projectId, file.name), `v=${Math.round(file.mtime)}`),
  ];
}

function ImageThumb({ projectId, file, label, onOpen }: {
  projectId: string;
  file: ProjectFile;
  label: string;
  onOpen: () => void;
}) {
  const sources = useImageSources(projectId, file);
  const [attempt, setAttempt] = useState({ key: '', index: 0, status: 'loading' as ImageStatus });
  const key = sources.join('\u0000');
  const current = attempt.key === key ? attempt : { key, index: 0, status: 'loading' as ImageStatus };
  const imageRef = useRef<HTMLImageElement | null>(null);
  const src = sources[current.index];

  // A cached image can finish before React attaches onLoad.
  useEffect(() => {
    const image = imageRef.current;
    if (!image?.complete || !image.currentSrc) return;
    setAttempt({ key, index: current.index, status: image.naturalWidth > 0 ? 'loaded' : 'loading' });
  }, [key, current.index]);

  const fail = () => setAttempt(current.index + 1 < sources.length
    ? { key, index: current.index + 1, status: 'loading' }
    : { key, index: current.index, status: 'error' });

  return (
    <button
      type="button"
      className={`df-card-thumb ${styles.thumb}`}
      data-image-status={current.status}
      title={label}
      aria-label={label}
      onClick={onOpen}
    >
      {current.status === 'loading' ? <span className={`df-image-skeleton ${styles.skeleton}`} aria-hidden /> : null}
      {current.status === 'error' ? (
        <span className={styles.glyph} aria-hidden><Icon name="image" size={20} /></span>
      ) : (
        <img
          ref={imageRef}
          key={src}
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          className={styles.image}
          data-loaded={current.status === 'loaded' ? 'true' : 'false'}
          onLoad={() => setAttempt({ key, index: current.index, status: 'loaded' })}
          onError={fail}
        />
      )}
    </button>
  );
}

// One clip plays at a time across the whole browser.
let playingAudio: HTMLAudioElement | null = null;

function AudioPlayButton({ projectId, file, ctx }: { projectId: string; file: ProjectFile; ctx: EntryContext }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const name = baseName(file.name);
  useEffect(() => () => {
    const audio = audioRef.current;
    if (audio && playingAudio === audio) playingAudio = null;
    audio?.pause();
  }, []);
  return (
    <>
      <audio
        ref={audioRef}
        preload="none"
        src={appendResourceQuery(projectRawUrl(projectId, file.name), `v=${Math.round(file.mtime)}`)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button
        type="button"
        className={styles.play}
        aria-label={ctx.t(playing ? 'panel.library.pauseAudio' : 'panel.library.playAudio', { name })}
        aria-pressed={playing}
        onClick={(event) => {
          event.stopPropagation();
          const audio = audioRef.current;
          if (!audio) return;
          if (!audio.paused) {
            audio.pause();
            return;
          }
          if (playingAudio && playingAudio !== audio) playingAudio.pause();
          playingAudio = audio;
          void audio.play()?.catch(() => setPlaying(false));
        }}
      >
        <Icon name={playing ? 'pause' : 'play'} size={14} />
      </button>
    </>
  );
}

function GlyphThumb({ file, label, onOpen }: { file: ProjectFile; label: string; onOpen: () => void }) {
  const extension = fileExtension(file.name);
  return (
    <button type="button" className={`df-card-thumb ${styles.thumb}`} title={label} aria-label={label} onClick={onOpen}>
      <span className={styles.glyph} aria-hidden>{categoryGlyph(fileCategory(file))}</span>
      {extension ? <span className={styles.ext} aria-hidden>{extension.toUpperCase()}</span> : null}
    </button>
  );
}

export function FileCard({ file, ctx }: { file: ProjectFile; ctx: EntryContext }) {
  const kind = projectFileKind(file);
  const isSelected = ctx.selected.has(file.name);
  const renameState = ctx.renaming?.name === file.name ? ctx.renaming : null;
  const openLabel = `${ctx.t('filesPanel.previewOpen')} ${file.name}`;
  const open = () => ctx.onOpen(file.name);
  const folder = ctx.flat ? folderWithinDir(file.name, ctx.currentDir) : '';
  const sub = folder || `${categoryLabel(fileCategory(file), ctx.t)} · ${humanBytes(file.size)}`;

  let thumb;
  if (kind === 'image' || kind === 'video') {
    thumb = <ImageThumb projectId={ctx.projectId} file={file} label={openLabel} onOpen={open} />;
  } else if (kind === 'html') {
    thumb = (
      <button type="button" className={`df-card-thumb ${styles.thumb}`} title={openLabel} aria-label={openLabel} onClick={open}>
        <HtmlCardThumbnail projectId={ctx.projectId} file={file} filesRefreshKey={ctx.filesRefreshKey} className={styles.page} />
      </button>
    );
  } else {
    thumb = <GlyphThumb file={file} label={openLabel} onOpen={open} />;
  }

  return (
    <div
      data-testid={`design-file-row-${file.name}`}
      className={`df-card ${styles.card} ${isSelected ? 'selected' : ''}`}
      data-kind={kind}
      data-selected={isSelected || undefined}
      draggable={!renameState}
      onDragStart={(event) => ctx.onDragStart(event, file)}
      onContextMenu={(event) => ctx.onContextMenu(event, file.name)}
    >
      <div className={styles.thumbBox}>
        {thumb}
        {kind === 'audio' ? <AudioPlayButton projectId={ctx.projectId} file={file} ctx={ctx} /> : null}
        <SelectCheck className={`df-card-check ${styles.check}`} name={file.name} checked={isSelected} ctx={ctx} />
        <EntryMenuButton name={file.name} className={styles.menu} ctx={ctx} />
        {ctx.viewerOnly || renameState ? null : (
          <AddToChatButton name={file.name} className={styles.addToChat} onAdd={() => ctx.onAddToChat([file.name])} />
        )}
      </div>
      <div className={styles.meta}>
        {renameState ? <RenameInput state={renameState} ctx={ctx} /> : (
          <button
            type="button"
            className={`df-card-name-btn ${styles.name}`}
            title={ctx.viewerOnly ? file.name : `${file.name} · ${ctx.t('common.rename')}`}
            onClick={(event) => {
              event.stopPropagation();
              // Read-only viewers have no rename, so the name stays an open target.
              if (ctx.viewerOnly) open();
              else ctx.onStartRename(file.name);
            }}
          >
            <span className="df-card-name">{baseName(file.name)}</span>
          </button>
        )}
        <span className={styles.sub} title={folder || undefined}>{sub}</span>
      </div>
    </div>
  );
}

export function DirCard({ path, name, count, ctx }: { path: string; name: string; count: number; ctx: EntryContext }) {
  return (
    <div className={`df-dir-card ${styles.card}`} data-kind="folder" data-testid={`library-dir-${path}`}>
      <div className={styles.thumbBox}>
        <button type="button" className={`${styles.thumb} ${styles.folderThumb}`} title={path} aria-label={name} onClick={() => ctx.onOpenDir(path)}>
          <Icon name="folder" size={28} />
        </button>
      </div>
      <div className={styles.meta}>
        <button type="button" className={styles.name} title={path} onClick={() => ctx.onOpenDir(path)}>
          <span>{name}</span>
        </button>
        <span className={styles.sub}>{ctx.t('filesPanel.folderCount', { n: count })}</span>
      </div>
    </div>
  );
}
