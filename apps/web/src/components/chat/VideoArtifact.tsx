/**
 * 消息里的视频:内联播放器,封面是视频自己的第一帧,下面一行文件名和下载。
 *
 * 播放器盒子先按 16:9 占好位(竖屏视频在里面上下留黑),元数据到了也不改高度 ——
 * 流式进行中改高度会把用户正在看的内容顶走。文件没了或格式不支持,盒子里写一句人话。
 */
import { useState, type ReactElement } from 'react';
import { Button } from '@openpixo/components';
import { useT } from '../../i18n';
import { Icon } from '../Icon';
import styles from './VideoArtifact.module.css';

export function VideoArtifact({ src, name, onOpenFile, onDownload }: {
  src: string;
  name: string;
  onOpenFile?: (() => void) | undefined;
  onDownload?: (() => void) | undefined;
}): ReactElement {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const shownName = name.split('/').pop() ?? name;
  return (
    <figure className={styles.video} data-testid="chat-video-artifact" data-failed={failed ? '' : undefined}>
      <div className={styles.stage}>
        {failed ? (
          <span className={styles.failed} role="status">{t('chat.video.failed')}</span>
        ) : (
          <video
            className={styles.player}
            /* `#t=` 让浏览器停在第一帧上,当封面;不自动播放 */
            src={`${src}#t=0.1`}
            controls
            preload="metadata"
            playsInline
            aria-label={shownName}
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <figcaption className={styles.caption}>
        {onOpenFile ? (
          <button type="button" className={styles.name} title={name} aria-label={t('chat.assets.openInFiles')} onClick={onOpenFile}>{shownName}</button>
        ) : (
          <span className={styles.name} title={name}>{shownName}</span>
        )}
        {onDownload ? (
          <Button size="icon" variant="ghost" className={styles.download} aria-label={t('chat.audio.download', { name: shownName })} onClick={onDownload}>
            <Icon name="download" size={14} />
          </Button>
        ) : null}
      </figcaption>
    </figure>
  );
}
