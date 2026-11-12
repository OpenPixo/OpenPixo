// Modal for image, video and audio projects.

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import type { OpenPixoHostProjectImportSuccess } from '@openpixo/host';
import { modalOverlay, modalContent } from '../motion';
import { useT } from '../i18n';
import type {
  MediaProviderCredentials,
  PromptTemplateSummary,
  SkillSummary,
} from '../types';
import { Icon } from './Icon';
import {
  NewProjectPanel,
  type CreateInput,
} from './NewProjectPanel';

interface Props {
  open: boolean;
  skills: SkillSummary[];
  promptTemplates: PromptTemplateSummary[];
  mediaProviders?: Record<string, MediaProviderCredentials>;
  loading?: boolean;
  onCreate: (input: CreateInput & { requestId?: string }) => Promise<boolean> | boolean | void;
  onImportFolder?: (baseDir: string) => Promise<void> | void;
  onImportFolderResponse?: (response: OpenPixoHostProjectImportSuccess) => Promise<void> | void;
  onClose: () => void;
}

// The `open` flag stays the public API, but the close animation has to play
// before the modal leaves the DOM. So the outer component never early-returns
// null: it renders the body inside `AnimatePresence` and gates the body on
// `open`. When `open` flips to false the body unmounts through
// `AnimatePresence`, which runs the `exit` variants on the overlay + content
// first. The body lives in its own component so its mount effects (focus the
// close button, lock body scroll, bind Esc) fire exactly when it appears.
export function NewProjectModal({ open, ...rest }: Props) {
  return (
    <AnimatePresence>
      {open ? <NewProjectModalBody {...rest} /> : null}
    </AnimatePresence>
  );
}

function NewProjectModalBody({
  skills,
  promptTemplates,
  mediaProviders,
  loading,
  onCreate,
  onImportFolder,
  onImportFolderResponse,
  onClose,
}: Omit<Props, 'open'>) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const t = useT();
  const title = t('newproj.tabMedia');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !creating) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [creating, onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  async function handleCreate(input: CreateInput & { requestId?: string }) {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await onCreate(input);
      if (result === false) {
        setCreateError(t('newproj.createFailed'));
        return;
      }
      onClose();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : t('newproj.createFailed'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <motion.div
      className="new-project-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="new-project-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget && !creating) onClose();
      }}
      variants={modalOverlay}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <motion.div
        className="new-project-modal"
        variants={modalContent}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <header className="new-project-modal__head">
          <h2 className="new-project-modal__title">{title}</h2>
          <button
            ref={closeRef}
            type="button"
            className="new-project-modal__close"
            onClick={onClose}
            disabled={creating}
            aria-label={t('common.close')}
            title={t('preview.closeTitle')}
          >
            <Icon name="close" size={14} />
          </button>
        </header>
        <div className="new-project-modal__body">
          <NewProjectPanel
            skills={skills}
            promptTemplates={promptTemplates}
            {...(mediaProviders ? { mediaProviders } : {})}
            loading={Boolean(loading) || creating}
            onCreate={(input) => {
              void handleCreate(input);
            }}
            {...(onImportFolder ? { onImportFolder } : {})}
            {...(onImportFolderResponse ? { onImportFolderResponse } : {})}
          />
          {creating ? (
            <div className="new-project-modal__status" role="status">
              {t('newproj.creating')}
            </div>
          ) : null}
          {createError ? (
            <div className="new-project-modal__status error" role="alert">
              {createError}
            </div>
          ) : null}
        </div>
      </motion.div>
    </motion.div>
  );
}
