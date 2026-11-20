import { projectRawUrl } from '../../providers/registry';
import { resolveChatFileLink } from '../in-project-link';
import { isGalleryImagePath } from './turn-assets';

export interface ChatImageScope {
  projectId?: string | null;
  projectFileNames?: ReadonlySet<string>;
  projectResolvedDir?: string | null;
}

/**
 * Where an image the agent writes into its reply (`![label](concept/style-1.png)`) loads
 * from: an image file of this project, or of another project the reply names, served by
 * the daemon. Anything else (a path outside the project, `..`, a scheme, a non-image file)
 * is null, and the reply keeps the label.
 *
 * The prompt tells agents to show what they made by its project path, and the chat used to
 * drop every such image as an unsafe src: through the 鸦堡 run's planning (2026-11-21) the
 * owner saw only labels, never a style sample.
 */
export function chatImageSrc(src: string, scope: ChatImageScope): string | null {
  if (!scope.projectId) return null;
  const target = resolveChatFileLink(src, scope.projectFileNames, scope.projectId, scope.projectResolvedDir);
  if (!target || !isGalleryImagePath(target.filePath)) return null;
  return projectRawUrl(target.kind === 'project-file' ? target.projectId : scope.projectId, target.filePath);
}
