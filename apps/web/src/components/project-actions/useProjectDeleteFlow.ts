import { useCallback, useRef, useState } from 'react';

import type { TrackingProjectCollectionPage } from '@openpixo/contracts/analytics';

import { useAnalytics } from '../../analytics/provider';
import { trackWorkspaceProjectActionResult } from '../../analytics/events';
import { stableAnalyticsRequestErrorCode } from '../../analytics/workspace';
import { ProjectDeleteError } from '../../state/projects';
import type { Project } from '../../types';


/** Return `false` (or reject) when the daemon refused or the request failed;
 *  anything else means the project is gone. */
export type ProjectDeleteHandler = (id: string) => Promise<boolean | void> | boolean | void;

/**
 * The confirm → request → settle state behind {@link ProjectDeleteConfirmDialog},
 * shared by the project cards and the rail rows so both surfaces delete
 * through one path with one analytics story.
 *
 * `commit` never runs twice for one confirmation (`pending` gates it), and a
 * falsy result keeps the dialog open with `failed` set — a 403 or a dropped
 * request must not close the dialog as if the project were gone
 * (recvqbh189zBY6).
 */
export function useProjectDeleteFlow(input: {
  onDelete?: ProjectDeleteHandler;
  analyticsPage: TrackingProjectCollectionPage;

}) {
  const { onDelete, analyticsPage,  } = input;
  const analytics = useAnalytics();
  const [target, setTarget] = useState<Project | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [failed, setFailed] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);


  const request = useCallback((project: Project) => {
    setFailed(false);
    setErrorCode(null);
    setTarget(project);
  }, []);

  const cancel = useCallback(() => {
    if (pending) return;
    setTarget(null);
    setFailed(false);
    setErrorCode(null);
  }, [pending]);

  const commit = useCallback(async () => {
    if (!target || !onDelete || pending || inFlight.current) return;
    inFlight.current = true;
    const startedAt = performance.now();
    const workspaceDimensions = {};
    setFailed(false);
    setErrorCode(null);
    setPending(true);
    try {
      const result = await onDelete(target.id);
      if (result === false) {
        trackWorkspaceProjectActionResult(analytics.track, {
          page_name: analyticsPage,
          area: 'project_collection',
          action: 'delete',
          result: 'failed',
          requested_count: 1,
          succeeded_count: 0,
          failed_count: 1,
          duration_ms: Math.round(performance.now() - startedAt),
          error_code: 'request_failed',
          ...workspaceDimensions,
        });
        setFailed(true);
        return;
      }
      setTarget(null);
      trackWorkspaceProjectActionResult(analytics.track, {
        page_name: analyticsPage,
        area: 'project_collection',
        action: 'delete',
        result: 'success',
        requested_count: 1,
        succeeded_count: 1,
        failed_count: 0,
        duration_ms: Math.round(performance.now() - startedAt),
        ...workspaceDimensions,
      });
    } catch (err) {
      console.warn('[useProjectDeleteFlow] delete project failed:', err);
      setFailed(true);
      setErrorCode(err instanceof ProjectDeleteError ? err.code ?? null : null);
      trackWorkspaceProjectActionResult(analytics.track, {
        page_name: analyticsPage,
        area: 'project_collection',
        action: 'delete',
        result: 'failed',
        requested_count: 1,
        succeeded_count: 0,
        failed_count: 1,
        duration_ms: Math.round(performance.now() - startedAt),
        error_code: stableAnalyticsRequestErrorCode(err),
        ...workspaceDimensions,
      });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, [analytics.track, analyticsPage, onDelete, pending, target]);

  return { target, pending, failed, errorCode, request, cancel, commit };
}
