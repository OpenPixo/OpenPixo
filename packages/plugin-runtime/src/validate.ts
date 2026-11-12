import { PluginManifestSchema, type PluginManifest } from '@openpixo/contracts';

export interface ValidateResult {
  ok: boolean;
  warnings: string[];
  errors: string[];
}

// Doctor-level validation. Combines schema parse + cross-field rules that
// the JSON Schema cannot easily express:
//
//   - Pipeline stages with `repeat: true` must declare an `until`
//     expression (spec §10.2 hard constraint).
//   - Capability list must be an array of canonical capability strings;
//     unknown ids land in `warnings[]` instead of `errors[]` so a forward
//     spec patch can introduce new caps without breaking installs.

const KNOWN_CAPABILITIES = new Set([
  'prompt:inject',
  'fs:read',
  'fs:write',
  'mcp',
  'subprocess',
  'bash',
  'network',
]);

export function validateManifest(value: unknown): ValidateResult {
  const parsed = PluginManifestSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      warnings: [],
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
    };
  }
  return validateSafe(parsed.data);
}

export function validateSafe(manifest: PluginManifest): ValidateResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const pixo = manifest.pixo;
  if (pixo) {
    const stages = pixo.pipeline?.stages ?? [];
    for (const stage of stages) {
      if (stage.repeat && !stage.until) {
        errors.push(`pipeline.stages[${stage.id}]: repeat=true requires an 'until' expression`);
      }
    }

    const caps = pixo.capabilities ?? [];
    for (const cap of caps) {
      if (!KNOWN_CAPABILITIES.has(cap)) {
        warnings.push(`capability '${cap}' is not in the v1 vocabulary; doctor will surface this to the operator`);
      }
    }

   }

  return { ok: errors.length === 0, warnings, errors };
}
