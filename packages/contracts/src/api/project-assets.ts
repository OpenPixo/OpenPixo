import type { ProjectMediaTaskFile } from './media.js';

/** `all` remains a query-only compatibility value for the original asset panel. */
export type ProjectAssetKind = 'image' | 'audio' | 'video' | 'model3d' | 'font' | 'data' | 'other' | 'all';
export type AssetOrigin = 'generated' | 'processed' | 'imported';
export type AssetSemanticType = 'sprite-sheet' | 'atlas' | 'grid' | 'nine-slice' | 'tileset' | 'loop';

export type AssetGrid = { rows: number; cols: number } | { cellWidth: number; cellHeight: number };
export interface AssetFrame {
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  durationMs?: number;
}
export interface AssetSemantic {
  type: AssetSemanticType;
  /** Project-relative evidence path; a user grid uses the asset's own path. */
  source: string;
  frames?: AssetFrame[];
  grid?: AssetGrid;
  border?: { left: number; right: number; top: number; bottom: number };
  loop?: { start?: number; end?: number };
}
export type AssetSemantics = AssetSemantic[];

export interface EngineAssetMeta {
  engine: 'unity' | 'godot';
  source: string;
  guid?: string;
  uid?: string;
  importer?: string;
  pairMissing?: boolean;
}

export interface AssetProvenance {
  id: string;
  projectId: string;
  relPath: string;
  contentHash: string;
  origin: AssetOrigin;
  runId?: string;
  mediaTaskId?: string;
  recipeRunId?: string;
  provider?: string;
  model?: string;
  promptText?: string;
  params?: Record<string, unknown>;
  referenceHashes?: string[];
  parentHashes?: string[];
  seed?: string;
  cost?: { credits?: number };
  createdAt: number;
  /** Current bytes differ from this historical record. */
  modifiedSinceProvenance?: boolean;
}

export interface ProjectAsset {
  projectId: string;
  relPath: string;
  kind: Exclude<ProjectAssetKind, 'all'>;
  mime?: string;
  size: number;
  mtime: number;
  contentHash?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  semantics: AssetSemantics;
  engineMeta?: EngineAssetMeta;
  tags: string[];
  libraryAssetId?: string;
  indexedAt: number;
  origin: AssetOrigin;
  modifiedSinceProvenance?: boolean;
}

export interface AssetListQuery {
  kind?: ProjectAssetKind;
  tag?: string;
  origin?: AssetOrigin;
  semantic?: AssetSemanticType;
  query?: string;
  cursor?: string;
  limit?: number;
}
export interface AssetListResponse { assets: ProjectAsset[]; nextCursor: string | null }
export interface AssetTagsRequest { paths: string[]; add?: string[]; remove?: string[] }
export interface AssetGridRequest { path: string; grid: AssetGrid | null }
export interface AssetProvenanceResponse { provenance: AssetProvenance[] }
export interface AssetWaveform { pointsPerSecond: 50; peaks: number[]; durationMs: number }

/** Deterministic local image transforms, applied in the given order. */
export type ImageEditOp =
  | { op: 'crop'; x: number; y: number; width: number; height: number }
  | { op: 'resize'; width?: number; height?: number; scale?: number; filter?: 'nearest' | 'smooth' }
  | { op: 'trim' }
  | { op: 'pad'; width?: number; height?: number; powerOfTwo?: true }
  | { op: 'flip'; axis: 'h' | 'v' }
  | { op: 'rotate'; degrees: 90 };

export interface EditProjectImageRequest {
  source: string;
  ops: ImageEditOp[];
  /** PNG filename beside the source, or a project-relative PNG path. Never overwrites. */
  output: string;
}

/** Generation-time facts travel with the completed media file into persistence. */
export interface GeneratedProjectAssetFile extends ProjectMediaTaskFile {
  assetProvenance: {
    contentHash: string;
    provider: string;
    model: string;
    promptText: string;
    params: Record<string, unknown>;
    referenceHashes: string[];
  };
}
