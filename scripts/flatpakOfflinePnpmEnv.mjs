/**
 * Shared Flatpak manifest contract for offline pnpm 11 install.
 *
 * Failure point: loose YAML regex can match commented or quoted keys outside the
 * mesh-client module env map. Fallback: parse only that scoped env block.
 *
 * Failure point: flatpak-builder deserializes `env` as GStrv (string values only).
 * Unquoted YAML `true`/`false` become JSON booleans → entire env map is dropped
 * (`Failed to deserialize "env" property of type "GStrv"`). Fallback: require
 * quoted `'true'` / `'false'` strings.
 */

/**
 * @param {string} yaml
 * @returns {Record<string, boolean | string> | null}
 */
export function parseMeshClientModuleBuildEnv(yaml) {
  const moduleMatch = yaml.match(/^ {2}- name: mesh-client\s*$/m);
  if (!moduleMatch || moduleMatch.index == null) return null;

  const fromModule = yaml.slice(moduleMatch.index);
  const nextModuleOffset = fromModule.slice(1).search(/^ {2}- name: /m);
  const moduleBlock =
    nextModuleOffset === -1 ? fromModule : fromModule.slice(0, nextModuleOffset + 1);

  const envMatch = moduleBlock.match(/^ {6}env:\s*$/m);
  if (!envMatch || envMatch.index == null) return null;

  const envIndent = 6;
  const afterEnv = moduleBlock.slice(envMatch.index + envMatch[0].length);
  /** @type {Record<string, boolean | string>} */
  const env = {};

  for (const line of afterEnv.split('\n')) {
    if (line.trim() === '') continue;
    const indent = line.match(/^ */)[0].length;
    if (indent <= envIndent) break;

    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;

    const m = trimmed.match(/^([A-Za-z0-9_]+):\s*(.+)$/);
    if (!m) continue;

    const [, key, raw] = m;
    if (raw === 'true') {
      env[key] = true;
    } else if (raw === 'false') {
      env[key] = false;
    } else if (
      (raw.startsWith("'") && raw.endsWith("'")) ||
      (raw.startsWith('"') && raw.endsWith('"'))
    ) {
      env[key] = raw.slice(1, -1);
    } else {
      env[key] = raw;
    }
  }

  return env;
}

/**
 * @param {string} yaml
 * @param {string} [fileRel]
 * @returns {{ file: string, message: string }[]}
 */
export function offlinePnpmEnvContractViolations(
  yaml,
  fileRel = 'org.coloradomesh.MeshClient.yml',
) {
  const env = parseMeshClientModuleBuildEnv(yaml);
  /** @type {{ file: string, message: string }[]} */
  const violations = [];

  if (!env) {
    violations.push({
      file: fileRel,
      message: 'manifest mesh-client module build-options.env is missing',
    });
    return violations;
  }

  // GStrv requires string values — quoted 'true'/'false', not YAML booleans.
  if (env.PNPM_CONFIG_TRUST_LOCKFILE !== 'true') {
    violations.push({
      file: fileRel,
      message:
        "manifest mesh-client build-options.env must set PNPM_CONFIG_TRUST_LOCKFILE: 'true' " +
        '(quoted string for flatpak-builder GStrv; unquoted true drops the whole env map)',
    });
  }

  if (env.PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN !== 'false') {
    violations.push({
      file: fileRel,
      message:
        "manifest mesh-client build-options.env must set PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false' " +
        '(quoted string for flatpak-builder GStrv; unquoted false drops the whole env map)',
    });
  }

  return violations;
}
