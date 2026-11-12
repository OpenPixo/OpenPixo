/** Values are literals only. Colors use #rrggbbaa, or a numeric Godot Color literal for HDR. */
export type GameTuningValue = number | boolean | string;
export type GameTuningType = 'int' | 'float' | 'bool' | 'string' | 'color';

export interface GameTuningParameter {
  /** Stable opaque identity; never interpreted as a filesystem path by a client. */
  id: string;
  key: string;
  label: string;
  group: string;
  /** Optional content translations keyed by UI locale; label/group remain the fallback. */
  label_i18n?: Record<string, string>;
  group_i18n?: Record<string, string>;
  owner: string;
  description?: string;
  type: GameTuningType;
  source: 'godot-script' | 'godot-scene' | 'web-json';
  value: GameTuningValue;
  /** Script/parent scene default, or the first discovered value for source defaults. */
  defaultValue: GameTuningValue;
  /** Exact current literal, for code-oriented consumers. */
  literal: string;
  min?: number;
  max?: number;
  step?: number;
  allowLess?: boolean;
  allowGreater?: boolean;
  /** Project-relative, forward-slash path; line numbers are one-based. */
  filePath: string;
  line: number;
  scriptPath?: string;
  nodePath?: string;
  /** SHA-256 of the complete source file. Required for every write. */
  fileHash: string;
}

export interface GameTuningWarning {
  code: 'TUNING_READ_FAILED' | 'TUNING_INVALID_JSON' | 'TUNING_SCAN_LIMIT';
  filePath: string;
}

/** GET /api/projects/:id/game/tuning — read-only, never invokes an agent. */
export interface GameTuningListResponse {
  parameters: GameTuningParameter[];
  warnings: GameTuningWarning[];
}

/** PATCH /api/projects/:id/game/tuning — edits one literal after a checkpoint. */
export interface GameTuningSetRequest {
  id: string;
  value: GameTuningValue;
  fileHash: string;
}

export interface GameTuningSetResponse {
  parameter: GameTuningParameter;
  checkpointId?: string;
}

export type GameTuningErrorCode = 'TUNING_CONFLICT' | 'TUNING_NOT_FOUND' | 'TUNING_INVALID_VALUE'
  | 'TUNING_INVALID_REQUEST' | 'TUNING_UNSAFE_PATH' | 'TUNING_READ_FAILED' | 'TUNING_CHECKPOINT_FAILED';
