import { describe, expect, it } from 'vitest';

import { extractUseCallbackBody, loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const RUNTIME_SOURCE = loadRuntimeSource('useMeshcoreRuntime.ts');
const CLI_BODY = extractUseCallbackBody(RUNTIME_SOURCE, 'sendRepeaterCliCommand');

describe('useMeshcoreRuntime remote companion CLI (contract)', () => {
  it('sends companion targets as txt_type 3 and repeaters as CLI data', () => {
    expect(CLI_BODY).toContain("const isCompanionTarget = opts?.target === 'companion';");
    expect(CLI_BODY).toMatch(
      /isCompanionTarget\s*\?\s*MESHCORE_TXT_TYPE_CLI_COMMAND\s*:\s*MESHCORE_TXT_TYPE_CLI_DATA/,
    );
  });

  it('skips server login for companion targets', () => {
    expect(CLI_BODY).toMatch(
      /if \(isCompanionTarget\) \{[\s\S]{0,200}\} else if \(hwModelForCli === 'Room'\)/,
    );
  });

  it('does not schedule a repeater post-reboot status poll for companion targets', () => {
    expect(CLI_BODY).toMatch(
      /if \(!isCompanionTarget && isMeshcoreRepeaterRebootCommand\(trimmed\)\)/,
    );
  });

  it('exposes the remote helpers through the runtime', () => {
    expect(RUNTIME_SOURCE).toContain(
      'const companionRemote = useMeshcoreCompanionRemote({ connRef, sendRepeaterCliCommand });',
    );
  });
});
