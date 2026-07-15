import { describe, expect, it } from 'vitest';

import {
  isDecommissionedReticulumTcpHub,
  normalizeReticulumTcpHubHost,
  RETICULUM_DECOMMISSIONED_HUB_ENDPOINTS,
} from './reticulumDecommissionedHubs';

describe('reticulumDecommissionedHubs', () => {
  it('normalizes bracketed IPv6-style hosts and case', () => {
    expect(normalizeReticulumTcpHubHost(' Dublin.CONNECT.reticulum.network ')).toBe(
      'dublin.connect.reticulum.network',
    );
    expect(normalizeReticulumTcpHubHost('[dublin.connect.reticulum.network]')).toBe(
      'dublin.connect.reticulum.network',
    );
  });

  it('matches decommissioned hubs by host alias and port', () => {
    expect(isDecommissionedReticulumTcpHub('dublin.connect.reticulum.network', 4965)).toBe(true);
    expect(isDecommissionedReticulumTcpHub('Amsterdam.connect.reticulum.network', 4965)).toBe(true);
    expect(isDecommissionedReticulumTcpHub('reticulum.betweentheborders.com', 4242)).toBe(true);
    expect(isDecommissionedReticulumTcpHub('betweentheborders.com', 4242)).toBe(true);
  });

  it('rejects wrong ports and unknown hosts', () => {
    expect(isDecommissionedReticulumTcpHub('dublin.connect.reticulum.network', 443)).toBe(false);
    expect(isDecommissionedReticulumTcpHub('us-east.connect.reticulum.network', 4965)).toBe(false);
  });

  it('lists the three retired official endpoints', () => {
    expect(RETICULUM_DECOMMISSIONED_HUB_ENDPOINTS.map((e) => e.id)).toEqual([
      'decommissioned-dublin',
      'decommissioned-amsterdam',
      'decommissioned-betweentheborders',
    ]);
  });
});
