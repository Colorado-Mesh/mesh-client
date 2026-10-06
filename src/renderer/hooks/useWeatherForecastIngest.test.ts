import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ensureOfflineProtocolIdentities,
  OFFLINE_MESHCORE_IDENTITY_ID,
  OFFLINE_MESHTASTIC_IDENTITY_ID,
} from '../lib/offlineProtocolIdentities';
import { useIdentityStore } from '../stores/identityStore';
import { upsertMessage, useMessageStore } from '../stores/messageStore';
import { upsertNodeRecord, useNodeStore } from '../stores/nodeStore';
import { useWeatherFilterStore } from '../stores/weatherFilterStore';
import { useWeatherForecastStore } from '../stores/weatherForecastStore';
import { useWeatherForecastIngest } from './useWeatherForecastIngest';

const BOT = 0x1234;
const POST =
  'Aurora, CO 80013 | NWS forecast\nTonight: 59°F Mostly Clear | S 6 to 9 mph | precip 2%\nIssued 10/05 12:46 MDT';

describe('useWeatherForecastIngest', () => {
  beforeEach(() => {
    useIdentityStore.setState({ identities: {}, activeIdentityId: null });
    useMessageStore.setState({ messages: {} });
    useNodeStore.setState({ nodes: {} });
    useWeatherForecastStore.getState().clearForecasts();
    ensureOfflineProtocolIdentities();
    vi.mocked(window.electronAPI.geo.resolvePlace).mockResolvedValue({
      lat: 39.73,
      lon: -104.83,
      population: 359407,
      label: 'Aurora, Colorado, US',
      source: 'gazetteer',
    });
  });

  afterEach(() => {
    useWeatherFilterStore.getState().setSenderMarked('meshcore', BOT, false);
    useWeatherFilterStore.getState().setSenderMarked('meshtastic', BOT, false);
  });

  it('ingests marked posts from the MeshCore bucket and reacts to newly marked senders', async () => {
    upsertMessage(OFFLINE_MESHCORE_IDENTITY_ID, {
      id: 'm1',
      from: BOT,
      to: 0,
      payload: POST,
      channelIndex: 0,
      timestamp: Date.now() - 1000,
    });
    renderHook(() => {
      useWeatherForecastIngest();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(Object.keys(useWeatherForecastStore.getState().entries)).toHaveLength(0);

    act(() => {
      useWeatherFilterStore.getState().setSenderMarked('meshcore', BOT, true);
    });
    await waitFor(() => {
      expect(useWeatherForecastStore.getState().entries['place:aurora|co']).toMatchObject({
        protocol: 'meshcore',
        positionSource: 'gazetteer',
      });
    });
  });

  it('passes the online-lookup setting and the bot position to the resolver', async () => {
    useWeatherFilterStore.getState().setOnlinePlaceLookup(true);
    useWeatherFilterStore.getState().setSenderMarked('meshtastic', BOT, true);
    upsertNodeRecord(OFFLINE_MESHTASTIC_IDENTITY_ID, {
      nodeId: BOT,
      latitude: 39.9,
      longitude: -105,
    });
    upsertMessage(OFFLINE_MESHTASTIC_IDENTITY_ID, {
      id: 'm2',
      from: BOT,
      to: 0xffffffff,
      payload: POST,
      channelIndex: 0,
      timestamp: Date.now() - 1000,
    });
    renderHook(() => {
      useWeatherForecastIngest();
    });
    await waitFor(() => {
      expect(window.electronAPI.geo.resolvePlace).toHaveBeenCalledWith(
        expect.objectContaining({ nearLat: 39.9, nearLon: -105, allowOnline: true }),
      );
    });
    useWeatherFilterStore.getState().setOnlinePlaceLookup(false);
  });
});
