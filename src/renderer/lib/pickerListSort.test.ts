// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  blePickerDisplayName,
  defaultPickerSort,
  defaultPickerSortDir,
  nextPickerSort,
  sortPickerItems,
  useDebouncedPickerSort,
} from './pickerListSort';
import { PICKER_RSSI_REORDER_DEBOUNCE_MS } from './timeConstants';

interface BleItem {
  id: string;
  name: string;
  rssi?: number | null;
}

interface SerialItem {
  id: string;
  name: string;
}

const bleAccessors = {
  getName: (d: BleItem) => d.name,
  getId: (d: BleItem) => d.id,
  getRssi: (d: BleItem) => d.rssi,
};

const serialAccessors = {
  getName: (d: SerialItem) => d.name,
  getId: (d: SerialItem) => d.id,
};

describe('pickerListSort', () => {
  it('defaultPickerSortDir is desc for RSSI and asc for name', () => {
    expect(defaultPickerSortDir('rssi')).toBe('desc');
    expect(defaultPickerSortDir('name')).toBe('asc');
  });

  it('defaultPickerSort is RSSI desc for BLE and Name asc for serial', () => {
    expect(defaultPickerSort('ble')).toEqual({ key: 'rssi', dir: 'desc' });
    expect(defaultPickerSort('serial')).toEqual({ key: 'name', dir: 'asc' });
  });

  it('nextPickerSort selects default dir then flips on the same key', () => {
    const fromName = nextPickerSort({ key: 'name', dir: 'asc' }, 'rssi');
    expect(fromName).toEqual({ key: 'rssi', dir: 'desc' });
    expect(nextPickerSort(fromName, 'rssi')).toEqual({ key: 'rssi', dir: 'asc' });
    expect(nextPickerSort({ key: 'rssi', dir: 'desc' }, 'name')).toEqual({
      key: 'name',
      dir: 'asc',
    });
  });

  it('returns empty for empty input', () => {
    expect(sortPickerItems([], 'rssi', 'desc', bleAccessors)).toEqual([]);
    expect(sortPickerItems([], 'name', 'asc', serialAccessors)).toEqual([]);
  });

  it('sorts name A–Z / Z–A and falls back to id when name is blank', () => {
    const items: BleItem[] = [
      { id: 'z', name: 'Zulu' },
      { id: 'a', name: 'Alpha' },
      { id: 'm', name: '' },
    ];
    expect(sortPickerItems(items, 'name', 'asc', bleAccessors).map((d) => d.id)).toEqual([
      'a',
      'm',
      'z',
    ]);
    expect(sortPickerItems(items, 'name', 'desc', bleAccessors).map((d) => d.id)).toEqual([
      'z',
      'm',
      'a',
    ]);
  });

  it('tie-breaks equal names on id', () => {
    const items: SerialItem[] = [
      { id: '/dev/ttyUSB1', name: 'Port' },
      { id: '/dev/ttyUSB0', name: 'Port' },
    ];
    expect(sortPickerItems(items, 'name', 'asc', serialAccessors).map((d) => d.id)).toEqual([
      '/dev/ttyUSB0',
      '/dev/ttyUSB1',
    ]);
  });

  it('sorts RSSI strongest first (desc) and weakest first (asc)', () => {
    const items: BleItem[] = [
      { id: 'weak', name: 'Zulu', rssi: -90 },
      { id: 'strong', name: 'Alpha', rssi: -40 },
      { id: 'mid', name: 'Mid', rssi: -70 },
    ];
    expect(sortPickerItems(items, 'rssi', 'desc', bleAccessors).map((d) => d.id)).toEqual([
      'strong',
      'mid',
      'weak',
    ]);
    expect(sortPickerItems(items, 'rssi', 'asc', bleAccessors).map((d) => d.id)).toEqual([
      'weak',
      'mid',
      'strong',
    ]);
  });

  it('puts null, undefined, and NaN RSSI last in both directions', () => {
    const items: BleItem[] = [
      { id: 'nan', name: 'Nan', rssi: Number.NaN },
      { id: 'ok', name: 'Ok', rssi: -55 },
      { id: 'missing', name: 'Missing' },
      { id: 'nul', name: 'Null', rssi: null },
    ];
    expect(sortPickerItems(items, 'rssi', 'desc', bleAccessors).map((d) => d.id)).toEqual([
      'ok',
      'missing',
      'nan',
      'nul',
    ]);
    expect(sortPickerItems(items, 'rssi', 'asc', bleAccessors).map((d) => d.id)).toEqual([
      'ok',
      'missing',
      'nan',
      'nul',
    ]);
  });

  it('uses blePickerDisplayName cached + advertised for Name sort', () => {
    const devices = [
      { deviceId: 'aa', deviceName: 'AdvertZ', cached: 'CachedA' },
      { deviceId: 'bb', deviceName: 'AdvertM', cached: undefined },
    ];
    const accessors = {
      getName: (d: (typeof devices)[number]) =>
        blePickerDisplayName(d.deviceId, d.deviceName, d.cached),
      getId: (d: (typeof devices)[number]) => d.deviceId,
    };
    expect(blePickerDisplayName('aa', 'AdvertZ', 'CachedA')).toBe('CachedA (AdvertZ)');
    expect(sortPickerItems(devices, 'name', 'asc', accessors).map((d) => d.deviceId)).toEqual([
      'bb',
      'aa',
    ]);
  });
});

describe('useDebouncedPickerSort', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies name sort immediately', () => {
    const initial: BleItem[] = [
      { id: 'z', name: 'Zulu', rssi: -40 },
      { id: 'a', name: 'Alpha', rssi: -90 },
    ];
    const { result, rerender } = renderHook(
      ({ items, key }: { items: BleItem[]; key: 'name' | 'rssi' }) =>
        useDebouncedPickerSort(items, key, 'asc', bleAccessors),
      { initialProps: { items: initial, key: 'rssi' as 'name' | 'rssi' } },
    );
    rerender({ items: initial, key: 'name' });
    expect(result.current.map((d) => d.id)).toEqual(['a', 'z']);
  });

  it('does not reorder by RSSI until the debounce elapses', () => {
    const first: BleItem[] = [
      { id: 'a', name: 'A', rssi: -40 },
      { id: 'b', name: 'B', rssi: -90 },
    ];
    const { result, rerender } = renderHook(
      ({ items }: { items: BleItem[] }) =>
        useDebouncedPickerSort(items, 'rssi', 'desc', bleAccessors),
      { initialProps: { items: first } },
    );
    expect(result.current.map((d) => d.id)).toEqual(['a', 'b']);

    const flipped: BleItem[] = [
      { id: 'a', name: 'A', rssi: -95 },
      { id: 'b', name: 'B', rssi: -30 },
    ];
    rerender({ items: flipped });
    expect(result.current.map((d) => d.id)).toEqual(['a', 'b']);
    expect(result.current.find((d) => d.id === 'b')?.rssi).toBe(-30);

    act(() => {
      vi.advanceTimersByTime(PICKER_RSSI_REORDER_DEBOUNCE_MS - 1);
    });
    expect(result.current.map((d) => d.id)).toEqual(['a', 'b']);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.map((d) => d.id)).toEqual(['b', 'a']);
  });

  it('applies only the latest RSSI order after rapid updates', () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: BleItem[] }) =>
        useDebouncedPickerSort(items, 'rssi', 'desc', bleAccessors),
      {
        initialProps: {
          items: [
            { id: 'a', name: 'A', rssi: -40 },
            { id: 'b', name: 'B', rssi: -90 },
          ],
        },
      },
    );

    rerender({
      items: [
        { id: 'a', name: 'A', rssi: -80 },
        { id: 'b', name: 'B', rssi: -50 },
      ],
    });
    rerender({
      items: [
        { id: 'a', name: 'A', rssi: -20 },
        { id: 'b', name: 'B', rssi: -70 },
      ],
    });

    expect(result.current.map((d) => d.id)).toEqual(['a', 'b']);
    act(() => {
      vi.advanceTimersByTime(PICKER_RSSI_REORDER_DEBOUNCE_MS);
    });
    expect(result.current.map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('applies RSSI order immediately when the user changes sort key or direction', () => {
    const items: BleItem[] = [
      { id: 'weak', name: 'Zulu', rssi: -90 },
      { id: 'strong', name: 'Alpha', rssi: -40 },
    ];
    const { result, rerender } = renderHook(
      ({ key, dir }: { key: 'name' | 'rssi'; dir: 'asc' | 'desc' }) =>
        useDebouncedPickerSort(items, key, dir, bleAccessors),
      { initialProps: { key: 'name' as 'name' | 'rssi', dir: 'asc' as 'asc' | 'desc' } },
    );
    expect(result.current.map((d) => d.id)).toEqual(['strong', 'weak']);
    rerender({ key: 'rssi', dir: 'desc' });
    expect(result.current.map((d) => d.id)).toEqual(['strong', 'weak']);
    rerender({ key: 'rssi', dir: 'asc' });
    expect(result.current.map((d) => d.id)).toEqual(['weak', 'strong']);
  });

  it('inserts newly added devices in sorted position immediately', () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: BleItem[] }) =>
        useDebouncedPickerSort(items, 'rssi', 'desc', bleAccessors),
      {
        initialProps: {
          items: [{ id: 'weak', name: 'Weak', rssi: -90 }],
        },
      },
    );
    rerender({
      items: [
        { id: 'weak', name: 'Weak', rssi: -90 },
        { id: 'strong', name: 'Strong', rssi: -30 },
      ],
    });
    expect(result.current.map((d) => d.id)).toEqual(['strong', 'weak']);
  });

  it('keeps committed RSSI order when a device is added before debounce fires', () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: BleItem[] }) =>
        useDebouncedPickerSort(items, 'rssi', 'desc', bleAccessors),
      {
        initialProps: {
          items: [
            { id: 'a', name: 'A', rssi: -40 },
            { id: 'b', name: 'B', rssi: -90 },
          ],
        },
      },
    );
    expect(result.current.map((d) => d.id)).toEqual(['a', 'b']);

    rerender({
      items: [
        { id: 'a', name: 'A', rssi: -95 },
        { id: 'b', name: 'B', rssi: -30 },
      ],
    });
    expect(result.current.map((d) => d.id)).toEqual(['a', 'b']);

    rerender({
      items: [
        { id: 'a', name: 'A', rssi: -95 },
        { id: 'b', name: 'B', rssi: -30 },
        { id: 'c', name: 'C', rssi: -50 },
      ],
    });
    expect(result.current.map((d) => d.id)).toEqual(['c', 'a', 'b']);
    expect(result.current.find((d) => d.id === 'b')?.rssi).toBe(-30);

    act(() => {
      vi.advanceTimersByTime(PICKER_RSSI_REORDER_DEBOUNCE_MS - 1);
    });
    expect(result.current.map((d) => d.id)).toEqual(['c', 'a', 'b']);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.map((d) => d.id)).toEqual(['b', 'c', 'a']);
  });
});
