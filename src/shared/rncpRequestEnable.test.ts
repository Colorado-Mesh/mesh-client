import { describe, expect, it } from 'vitest';

import {
  buildRncpRequestEnableMessageBody,
  lxmfBodyContainsRncpRequestEnable,
  RNCP_REQUEST_ENABLE_SENTINEL,
} from './rncpRequestEnable';

describe('rncpRequestEnable', () => {
  it('embeds sentinel after human instructions', () => {
    const body = buildRncpRequestEnableMessageBody('Please enable file receiving.');
    expect(body).toContain('Please enable file receiving.');
    expect(body).toContain(RNCP_REQUEST_ENABLE_SENTINEL);
  });

  it('detects sentinel in inbound body', () => {
    expect(lxmfBodyContainsRncpRequestEnable(`hi\n${RNCP_REQUEST_ENABLE_SENTINEL}`)).toBe(true);
    expect(lxmfBodyContainsRncpRequestEnable('ordinary chat')).toBe(false);
    expect(lxmfBodyContainsRncpRequestEnable(null)).toBe(false);
  });
});
