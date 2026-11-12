import type { DoctorResponse } from '@openpixo/contracts';

export async function fetchDoctor(signal?: AbortSignal): Promise<DoctorResponse> {
  const response = await fetch('/api/doctor', { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json() as DoctorResponse;
  if (!Array.isArray(result.checks)) throw new Error('Invalid environment check response');
  return result;
}
