import { describe, expect, it } from 'vitest';

import { formatMediaTaskDiagnostic } from '../../src/media/diagnostics.js';

describe('formatMediaTaskDiagnostic', () => {
  it('keeps correlation and routing context while redacting secrets', () => {
    const line = formatMediaTaskDiagnostic({
      event: 'failed',
      taskId: 'media-task-123',
      runId: 'run-456',
      projectId: 'project-789',
      surface: 'image',
      model: 'gpt-image-2',
      providerId: 'openai',
      status: 503,
      code: 'provider_error',
      elapsedMs: 1_234.4,
      referenceImageCount: 2,
      hasCompositionDir: false,
      error: 'upstream rejected Authorization: Bearer abcdefghijklmnop',
    });

    expect(line).toContain('"task_id":"media-task-123"');
    expect(line).toContain('"run_id":"run-456"');
    expect(line).toContain('"model_id":"gpt-image-2"');
    expect(line).toContain('"provider_id":"openai"');
    expect(line).toContain('"code":"provider_error"');
    expect(line).toContain('"elapsed_ms":1234');
    expect(line).toContain('"reference_image_count":2');
    expect(line).toContain('"has_composition_dir":false');
    expect(line).toContain('[REDACTED:');
    expect(line).not.toContain('abcdefghijklmnop');
  });

  // 2026-11-19: every Codex image failed on an unsupported model and the log said only "failed".
  it("logs the provider's own short reason when the error carries one", () => {
    const line = formatMediaTaskDiagnostic({
      event: 'failed', taskId: 't', projectId: 'p', surface: 'image', model: 'codex-image',
      code: 'CODEX_IMAGE_MODEL_UNSUPPORTED', error: 'Codex cannot use this model.',
      detail: `  The 'gpt-6.2-sol' model is not supported\n  (model_not_found) ${'x'.repeat(1_000)}`,
    });
    const detail = JSON.parse(line.slice('[media] '.length)).detail as string;
    expect(detail.startsWith("The 'gpt-6.2-sol' model is not supported (model_not_found)")).toBe(true);
    expect(detail.length).toBeLessThanOrEqual(300);
  });
});
