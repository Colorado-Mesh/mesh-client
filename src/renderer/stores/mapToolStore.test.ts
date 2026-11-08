import { beforeEach, describe, expect, it } from 'vitest';

import { useMapToolStore } from './mapToolStore';

describe('mapToolStore', () => {
  beforeEach(() => {
    useMapToolStore.setState({ measureActive: false });
  });

  it('defaults measureActive to false', () => {
    expect(useMapToolStore.getState().measureActive).toBe(false);
  });

  it('toggles measureActive', () => {
    useMapToolStore.getState().setMeasureActive(true);
    expect(useMapToolStore.getState().measureActive).toBe(true);
    useMapToolStore.getState().setMeasureActive(false);
    expect(useMapToolStore.getState().measureActive).toBe(false);
  });
});
