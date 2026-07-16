#!/usr/bin/env node
/**
 * Ensure SonarCloud uses a custom Quality Gate with Coverage on New Code ≥ 45%.
 *
 * Sonar Way is read-only (requires ≥ 80%). Free-tier orgs can copy it and lower
 * the coverage condition; this script does that idempotently before CI scans.
 *
 * Env:
 *   SONAR_TOKEN (required)
 *   SONAR_HOST_URL (default https://sonarcloud.io)
 *   SONAR_ORGANIZATION (default colorado-mesh)
 *   SONAR_PROJECT_KEY (default Colorado-Mesh_mesh-client)
 *   SONAR_GATE_NAME (default mesh-client)
 *   SONAR_COVERAGE_THRESHOLD (default 45)
 *
 * Failure point: token lacks Administer Quality Gates, or org cannot create gates.
 * Fallback: exit non-zero with a clear message (do not silently keep Sonar Way).
 */
import process from 'node:process';

const HOST = (process.env.SONAR_HOST_URL ?? 'https://sonarcloud.io').replace(/\/$/, '');
const ORG = process.env.SONAR_ORGANIZATION ?? 'colorado-mesh';
const PROJECT_KEY = process.env.SONAR_PROJECT_KEY ?? 'Colorado-Mesh_mesh-client';
const GATE_NAME = process.env.SONAR_GATE_NAME ?? 'mesh-client';
const COVERAGE_THRESHOLD = String(process.env.SONAR_COVERAGE_THRESHOLD ?? '45');
const TOKEN = process.env.SONAR_TOKEN?.trim();

if (!TOKEN) {
  console.error('[sonar-ensure-quality-gate] SONAR_TOKEN is required');
  process.exit(1);
}

const authHeader = `Basic ${Buffer.from(`${TOKEN}:`, 'utf8').toString('base64')}`;

async function sonar(method, path, params = {}) {
  const url = new URL(`${HOST}${path}`);
  const body = new URLSearchParams({ organization: ORG, ...params });
  let res;
  if (method === 'GET') {
    for (const [k, v] of body) url.searchParams.set(k, v);
    res = await fetch(url, { headers: { Authorization: authHeader } });
  } else {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // catch-no-log-ok — non-JSON error bodies are reported via status/text below
  }
  if (!res.ok) {
    const msg = json?.errors?.map((e) => e.msg).join('; ') || text || res.statusText;
    const err = new Error(`${method} ${path} → HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

function findCoverageCondition(gate) {
  return (gate.conditions ?? []).find((c) => c.metric === 'new_coverage') ?? null;
}

async function listGates() {
  return sonar('GET', '/api/qualitygates/list');
}

async function showGate(name) {
  return sonar('GET', '/api/qualitygates/show', { name });
}

async function ensureGateExists(gatesPayload) {
  const existing = (gatesPayload.qualitygates ?? []).find((g) => g.name === GATE_NAME);
  if (existing) {
    console.log(
      `[sonar-ensure-quality-gate] using existing gate "${GATE_NAME}" (id=${existing.id})`,
    );
    return existing;
  }

  const sonarWay = (gatesPayload.qualitygates ?? []).find(
    (g) => g.isBuiltIn || g.name === 'Sonar way',
  );
  if (!sonarWay) {
    throw new Error('Built-in "Sonar way" quality gate not found');
  }

  console.log(
    `[sonar-ensure-quality-gate] copying "${sonarWay.name}" (id=${sonarWay.id}) → "${GATE_NAME}"`,
  );
  try {
    await sonar('POST', '/api/qualitygates/copy', {
      id: String(sonarWay.id),
      name: GATE_NAME,
    });
  } catch (e) {
    // Race: another job may have created it between list and copy.
    if (!String(e.message).includes('already') && e.status !== 400) throw e;
    console.warn(`[sonar-ensure-quality-gate] copy raced or existed: ${e.message}`);
  }
  const refreshed = await listGates();
  const created = (refreshed.qualitygates ?? []).find((g) => g.name === GATE_NAME);
  if (!created) {
    throw new Error(`Failed to create quality gate "${GATE_NAME}"`);
  }
  return created;
}

async function ensureCoverageThreshold(gateName) {
  const shown = await showGate(gateName);
  const cond = findCoverageCondition(shown);
  if (!cond) {
    console.log(
      `[sonar-ensure-quality-gate] adding new_coverage < ${COVERAGE_THRESHOLD} on "${gateName}"`,
    );
    await sonar('POST', '/api/qualitygates/create_condition', {
      gateName,
      metric: 'new_coverage',
      op: 'LT',
      error: COVERAGE_THRESHOLD,
    });
    return;
  }

  if (String(cond.error) === COVERAGE_THRESHOLD && cond.op === 'LT') {
    console.log(
      `[sonar-ensure-quality-gate] new_coverage already LT ${COVERAGE_THRESHOLD} on "${gateName}"`,
    );
    return;
  }

  console.log(
    `[sonar-ensure-quality-gate] updating new_coverage ${cond.op} ${cond.error} → LT ${COVERAGE_THRESHOLD}`,
  );
  await sonar('POST', '/api/qualitygates/update_condition', {
    id: String(cond.id),
    metric: 'new_coverage',
    op: 'LT',
    error: COVERAGE_THRESHOLD,
  });
}

async function selectGateForProject(gateName) {
  const current = await sonar('GET', '/api/qualitygates/get_by_project', {
    project: PROJECT_KEY,
  });
  const currentName = current?.qualityGate?.name;
  if (currentName === gateName) {
    console.log(`[sonar-ensure-quality-gate] project ${PROJECT_KEY} already on gate "${gateName}"`);
    return;
  }
  console.log(
    `[sonar-ensure-quality-gate] selecting gate "${gateName}" for ${PROJECT_KEY} (was "${currentName ?? 'default'}")`,
  );
  await sonar('POST', '/api/qualitygates/select', {
    gateName,
    projectKey: PROJECT_KEY,
  });
}

async function main() {
  console.log(
    `[sonar-ensure-quality-gate] host=${HOST} org=${ORG} project=${PROJECT_KEY} gate=${GATE_NAME} coverage≥${COVERAGE_THRESHOLD}`,
  );
  const gates = await listGates();
  if (gates.actions && gates.actions.create === false) {
    const hasCustom = (gates.qualitygates ?? []).some((g) => g.name === GATE_NAME);
    if (!hasCustom) {
      throw new Error(
        'This SonarCloud token/org cannot create quality gates. Create a gate named ' +
          `"${GATE_NAME}" in the UI (copy Sonar way, set Coverage on New Code to ${COVERAGE_THRESHOLD}%) ` +
          'and re-run.',
      );
    }
  }
  await ensureGateExists(gates);
  await ensureCoverageThreshold(GATE_NAME);
  await selectGateForProject(GATE_NAME);
  console.log('[sonar-ensure-quality-gate] done');
}

main().catch((err) => {
  console.error(`[sonar-ensure-quality-gate] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
