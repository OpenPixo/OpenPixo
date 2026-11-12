import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameTuningParameter, GameTuningValue, GameTuningWarning } from '@openpixo/contracts';
import { CHECKPOINT_RESTORED } from '../checkpoints/client';
import { listGameTuning, TuningRequestError, updateGameTuning } from './tuning-api';

export const TUNING_DEBOUNCE_MS = 300;
interface Session {
  projectId: string;
  active: boolean;
  failed: boolean;
  controller: AbortController;
  parameters: Map<string, GameTuningParameter>;
  pending: Map<string, GameTuningValue>;
  timer?: ReturnType<typeof setTimeout>;
  running?: Promise<boolean>;
}
interface State {
  parameters: GameTuningParameter[];
  warnings: GameTuningWarning[];
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: string | null;
}
const initial: State = { parameters: [], warnings: [], loading: true, saving: false, dirty: false, error: null };

/** A single queue keeps file hashes current across controls that share the same file. */
export function useTuning(projectId: string, onCommitted?: () => Promise<void>) {
  const [state, setState] = useState<State>(initial);
  const [revision, setRevision] = useState(0);
  const sessionRef = useRef<Session | null>(null);
  const defaults = useRef(new Map<string, { type: string; value: GameTuningValue }>());
  const defaultsProject = useRef(projectId);
  const committed = useRef(onCommitted); committed.current = onCommitted;

  useEffect(() => {
    if (defaultsProject.current !== projectId) { defaults.current.clear(); defaultsProject.current = projectId; }
    const session: Session = { projectId, active: true, failed: false, controller: new AbortController(), parameters: new Map(), pending: new Map() };
    sessionRef.current = session; setState(initial);
    void listGameTuning(projectId, session.controller.signal).then(result => {
      if (!session.active) return;
      const parameters = result.parameters.map(parameter => {
        const old = defaults.current.get(parameter.id);
        if (!old || old.type !== parameter.type) defaults.current.set(parameter.id, { type: parameter.type, value: parameter.defaultValue });
        return { ...parameter, defaultValue: defaults.current.get(parameter.id)!.value };
      });
      session.parameters = new Map(parameters.map(parameter => [parameter.id, parameter]));
      setState({ ...initial, parameters, warnings: result.warnings, loading: false });
    }).catch(cause => {
      if (session.active) { session.failed = true; setState({ ...initial, loading: false, error: cause instanceof TuningRequestError ? cause.code : 'TUNING_READ_FAILED' }); }
    });
    return () => { session.active = false; session.controller.abort(); clearTimeout(session.timer); session.pending.clear(); };
  }, [projectId, revision]);

  const refresh = useCallback(() => {
    // A restore invalidates queued edits as well as the displayed file hash.
    const session = sessionRef.current;
    if (session) { session.active = false; session.controller.abort(); clearTimeout(session.timer); session.pending.clear(); }
    setRevision(value => value + 1);
  }, []);

  const flush = useCallback((): Promise<boolean> => {
    const session = sessionRef.current;
    if (!session?.active || session.failed || session.projectId !== projectId) return Promise.resolve(false);
    clearTimeout(session.timer); session.timer = undefined;
    if (session.running) return session.running;
    const run = async (): Promise<boolean> => {
      setState(previous => ({ ...previous, saving: session.pending.size > 0 }));
      try {
        while (session.active && session.pending.size) {
          const [id, value] = session.pending.entries().next().value!;
          session.pending.delete(id);
          const parameter = session.parameters.get(id);
          if (!parameter || parameter.value === value) continue;
          const result = await updateGameTuning(projectId, { id, value, fileHash: parameter.fileHash }, session.controller.signal);
          if (!session.active) return false;
          for (const [key, item] of session.parameters) {
            if (item.filePath === parameter.filePath) session.parameters.set(key, { ...item, fileHash: result.parameter.fileHash,
              ...(key === id ? { value: result.parameter.value, literal: result.parameter.literal } : {}) });
          }
          setState(previous => ({ ...previous, parameters: previous.parameters.map(item => item.filePath !== parameter.filePath ? item : {
            ...item, fileHash: result.parameter.fileHash,
            ...(item.id === id ? { literal: result.parameter.literal, ...(session.pending.has(id) ? {} : { value: result.parameter.value }) } : {}),
          }) }));
          void committed.current?.().catch(() => {});
        }
        return session.active;
      } catch (cause) {
        session.failed = true; session.pending.clear();
        if (session.active) setState(previous => ({ ...previous, error: cause instanceof TuningRequestError ? cause.code : 'TUNING_READ_FAILED' }));
        return false;
      } finally {
        session.running = undefined;
        if (session.active) setState(previous => ({ ...previous, saving: false, dirty: session.pending.size > 0 }));
      }
    };
    // Defer execution by a microtask so even an empty queue cannot leave a settled promise installed.
    session.running = Promise.resolve().then(run);
    return session.running;
  }, [projectId]);

  useEffect(() => {
    const restored = (event: Event) => {
      if ((event as CustomEvent<{ projectId: string }>).detail?.projectId === projectId) refresh();
    };
    const focused = () => {
      const session = sessionRef.current;
      // Finish the user's own edits before reading changes from an external editor.
      if (session?.pending.size || session?.running) void flush().then(saved => { if (saved && session === sessionRef.current) refresh(); });
      else refresh();
    };
    window.addEventListener(CHECKPOINT_RESTORED, restored);
    window.addEventListener('focus', focused);
    return () => { window.removeEventListener(CHECKPOINT_RESTORED, restored); window.removeEventListener('focus', focused); };
  }, [projectId, refresh, flush]);

  function edit(id: string, value: GameTuningValue) {
    const session = sessionRef.current;
    if (!session?.active || session.failed || session.projectId !== projectId || !session.parameters.has(id)) return;
    session.pending.set(id, value);
    setState(previous => ({ ...previous, dirty: true, parameters: previous.parameters.map(item => item.id === id ? { ...item, value } : item) }));
    clearTimeout(session.timer);
    session.timer = setTimeout(() => { session.timer = undefined; void flush(); }, TUNING_DEBOUNCE_MS);
  }
  return { ...state, edit, flush, refresh };
}
