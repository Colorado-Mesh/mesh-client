import { describe, expect, it } from 'vitest';

import {
  isDecommissionedReticulumTcpHub,
  normalizeReticulumTcpHubHost,
  RETICULUM_DECOMMISSIONED_HUB_ENDPOINTS,
} from './reticulumDecommissionedHubs';

describe('reticulumDecommissionedHubs', () => {
  it('normalizes bracketed IPv6-style hosts and case', () => {
    expect(normalizeReticulumTcpHubHost(' Amsterdam.CONNECT.reticulum.network ')).toBe(
      'amsterdam.connect.reticulum.network',
    );
    expect(normalizeReticulumTcpHubHost('[amsterdam.connect.reticulum.network]')).toBe(
      'amsterdam.connect.reticulum.network',
    );
  });

  it('matches decommissioned amsterdam by host and port', () => {
    expect(isDecommissionedReticulumTcpHub('Amsterdam.connect.reticulum.network', 4965)).toBe(true);
  });

  it('rejects live official gateways, wrong ports, and unknown hosts', () => {
    expect(isDecommissionedReticulumTcpHub('dublin.connect.reticulum.network', 4965)).toBe(false);
    expect(isDecommissionedReticulumTcpHub('reticulum.betweentheborders.com', 4242)).toBe(false);
    expect(isDecommissionedReticulumTcpHub('betweentheborders.com', 4242)).toBe(false);
    expect(isDecommissionedReticulumTcpHub('amsterdam.connect.reticulum.network', 443)).toBe(false);
    expect(isDecommissionedReticulumTcpHub('us-east.connect.reticulum.network', 4965)).toBe(false);
  });

  it('lists only retired amsterdam endpoint', () => {
    expect(RETICULUM_DECOMMISSIONED_HUB_ENDPOINTS.map((e) => e.id)).toEqual([
      'decommissioned-amsterdam',
    ]);
  });
});
