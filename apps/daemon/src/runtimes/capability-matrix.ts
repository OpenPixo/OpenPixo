import {
  CAPABILITY_CELLS,
  type AgentCapabilitiesResponse,
  type RuntimeCapabilityMatrix,
} from '@openpixo/contracts';

function compareCliVersions(installed: string, tested: string): number {
  const pattern = /(?:^|[^\w.])v?(\d+)\.(\d+)\.(\d+)(?:-([\da-zA-Z.-]+))?/;
  const left = installed.match(pattern);
  const right = tested.match(pattern);
  if (!left || !right) return 0;
  for (let index = 1; index <= 3; index++) {
    const difference = Number(left[index]) - Number(right[index]);
    if (difference) return difference;
  }
  if (left[4] === right[4]) return 0;
  if (!left[4]) return 1;
  if (!right[4]) return -1;
  const leftParts = left[4].split('.');
  const rightParts = right[4].split('.');
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
    const a = leftParts[index];
    const b = rightParts[index];
    if (a === b) continue;
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) return Number(a) - Number(b);
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a > b ? 1 : -1;
  }
  return 0;
}

export function overlayRuntimeCapabilityVersions(
  source: RuntimeCapabilityMatrix,
  installedVersions: Record<string, string | undefined>,
): AgentCapabilitiesResponse {
  const matrix: RuntimeCapabilityMatrix = {};
  const runtimes: AgentCapabilitiesResponse['runtimes'] = {};
  for (const [runtime, cells] of Object.entries(source)) {
    const installedVersion = installedVersions[runtime];
    runtimes[runtime] = installedVersion ? { installedVersion } : {};
    matrix[runtime] = { ...cells };
    for (const key of CAPABILITY_CELLS) {
      const cell = cells[key];
      if (cell.state === 'verified' && cell.testedVersion && installedVersion
        && compareCliVersions(installedVersion, cell.testedVersion) > 0) {
        matrix[runtime][key] = {
          ...cell,
          state: 'implemented',
          note: [cell.note, 'newer CLI version not verified'].filter(Boolean).join('; '),
        };
      }
    }
  }
  return { matrix, runtimes };
}
