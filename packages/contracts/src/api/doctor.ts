/** Read-only machine readiness results shared by Settings and `pixo doctor`. */
export type DoctorStatus = 'ok' | 'warn' | 'missing' | 'error';
export type DoctorGroup = 'agents' | 'engines' | 'media-tools' | 'providers';
export type DoctorSettingsSection = 'execution' | 'gameEngines' | 'media';

export type DoctorFix =
  | { kind: 'install-url'; value: string }
  | { kind: 'settings'; value: DoctorSettingsSection }
  | { kind: 'command'; value: string };

export type DoctorTitleCode = 'agent' | 'godot' | 'node' | 'npm' | 'ffmpeg' | 'image-provider' | 'audio-provider';
export type DoctorDetailCode =
  | 'available'
  | 'not-found'
  | 'signed-in'
  | 'sign-in-required'
  | 'auth-unknown'
  | 'configured'
  | 'not-configured'
  | 'probe-failed'
  | 'probe-timeout'
  | 'invalid-path';

export interface DoctorCheck {
  /** Stable logical identity, independent of localized display names. */
  id: string;
  group: DoctorGroup;
  status: DoctorStatus;
  title: { code: DoctorTitleCode; params?: { name?: string } };
  detail: {
    code: DoctorDetailCode;
    /** No credentials, provider URLs, config objects or raw probe errors. */
    params?: {
      version?: string;
      source?: 'configured' | 'path' | 'bundled';
      configured?: boolean;
    };
  };
  fix: DoctorFix;
}

export interface DoctorResponse {
  checks: DoctorCheck[];
}
