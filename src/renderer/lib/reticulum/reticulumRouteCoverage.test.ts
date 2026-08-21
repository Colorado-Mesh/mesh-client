import { beforeEach, describe, expect, it } from 'vitest';

import { useRelayCoverageStore } from '@/renderer/lib/relayCoverage/relayCoverageStore';

import { setReticulumPredictedRoute } from './reticulumRouteCoverage';

const ID = 'rns-id';
const MSG = 'reticulum-pending-1';

describe('reticulumRouteCoverage', () => {
  beforeEach(() => {
    useRelayCoverageStore.setState({ coverage: {} });
  });

  it('maps hops=4 via hash → predictedRelayHops=3', () => {
    setReticulumPredictedRoute(ID, MSG, {
      hops: 4,
      viaHash: 'abcdef0123456789',
    });
    const entry = useRelayCoverageStore.getState().coverageFor(ID, MSG);
    expect(entry?.protocol).toBe('reticulum');
    expect(entry?.mode).toBe('predicted');
    expect(entry?.predictedRelayHops).toBe(3);
    expect(entry?.predictedFirstHop).toBe('abcdef0123456789');
  });

  it('maps hops=1 → predictedRelayHops=0', () => {
    setReticulumPredictedRoute(ID, MSG, { hops: 1, viaHash: 'aa' });
    expect(useRelayCoverageStore.getState().coverageFor(ID, MSG)?.predictedRelayHops).toBe(0);
  });

  it('maps hops=0 → predictedRelayHops=0', () => {
    setReticulumPredictedRoute(ID, MSG, { hops: 0 });
    expect(useRelayCoverageStore.getState().coverageFor(ID, MSG)?.predictedRelayHops).toBe(0);
  });

  it('missing / non-finite hops with via still stores predictedFirstHop', () => {
    setReticulumPredictedRoute(ID, MSG, { hops: Number.NaN, viaHash: 'abcdef' });
    const entry = useRelayCoverageStore.getState().coverageFor(ID, MSG);
    expect(entry?.predictedRelayHops).toBeUndefined();
    expect(entry?.predictedFirstHop).toBe('abcdef');
  });

  it('omits store write when hops and via are both absent', () => {
    setReticulumPredictedRoute(ID, MSG, {});
    expect(useRelayCoverageStore.getState().coverageFor(ID, MSG)).toBeUndefined();
  });

  it('trims via_hash and treats empty via as undefined', () => {
    setReticulumPredictedRoute(ID, MSG, { hops: 2, viaHash: '  abcd  ' });
    expect(useRelayCoverageStore.getState().coverageFor(ID, MSG)?.predictedFirstHop).toBe('abcd');
    useRelayCoverageStore.setState({ coverage: {} });
    setReticulumPredictedRoute(ID, MSG, { hops: 2, viaHash: '   ' });
    expect(
      useRelayCoverageStore.getState().coverageFor(ID, MSG)?.predictedFirstHop,
    ).toBeUndefined();
  });

  it('stores hops-only coverage when via is absent (UI uses hops-only label)', () => {
    setReticulumPredictedRoute(ID, MSG, { hops: 3 });
    const entry = useRelayCoverageStore.getState().coverageFor(ID, MSG);
    expect(entry?.predictedRelayHops).toBe(2);
    expect(entry?.predictedFirstHop).toBeUndefined();
  });

  it('caps via_hash length when storing predictedFirstHop', () => {
    const long = 'ab'.repeat(40);
    setReticulumPredictedRoute(ID, MSG, { hops: 2, viaHash: long });
    expect(useRelayCoverageStore.getState().coverageFor(ID, MSG)?.predictedFirstHop).toBe(
      long.slice(0, 64),
    );
  });
});
