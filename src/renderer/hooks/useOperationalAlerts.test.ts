import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OperationalAlertSettings } from '../lib/appSettingsStorage';
import type { ProtocolCapabilities } from '../lib/radio/BaseRadioProvider';
import type { ConnectionStatus, MeshNode } from '../lib/types';
import { useWatchedNodesStore } from '../stores/watchedNodesStore';
import {
  LINK_DOWN_GRACE_MS,
  type OperationalLinkState,
  useOperationalAlerts,
  type UseOperationalAlertsArgs,
} from './useOperationalAlerts';

const playMessageNotification = vi.fn();
vi.mock('../lib/chatNotifications', () => ({
  playMessageNotification: (...args: unknown[]) => {
    playMessageNotification(...args);
  },
}));

const caps = {
  protocol: 'meshtastic',
  hasBatteryTelemetry: true,
  nodeStaleThresholdMs: 2 * 3_600_000,
  nodeOfflineThresholdMs: 7 * 24 * 3_600_000,
} as unknown as ProtocolCapabilities;

const defaults: OperationalAlertSettings = {
  nodeSilenceAlertMinutes: null,
  nodeBatteryLowThreshold: 10,
  notifyOnLinkDown: true,
};

function makeNode(overrides: Partial<MeshNode> = {}): MeshNode {
  return {
    node_id: 1,
    long_name: 'Alpha',
    short_name: 'A',
    hw_model: '',
    snr: 0,
    battery: 80,
    last_heard: Date.now(),
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

function link(status: ConnectionStatus, connectionLoss?: boolean): OperationalLinkState[] {
  return [{ key: 'meshtastic', label: 'Meshtastic', status, connectionLoss }];
}

function setup(initial: Partial<UseOperationalAlertsArgs> = {}) {
  const base: UseOperationalAlertsArgs = {
    nodes: new Map(),
    capabilities: caps,
    links: [],
    settings: defaults,
    ...initial,
  };
  return renderHook(
    (props: UseOperationalAlertsArgs) => {
      useOperationalAlerts(props);
    },
    { initialProps: base },
  );
}

describe('useOperationalAlerts', () => {
  let notificationSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    notificationSpy = vi.fn();
    vi.stubGlobal('Notification', Object.assign(notificationSpy, { permission: 'granted' }));
    playMessageNotification.mockClear();
    useWatchedNodesStore.setState({ watchedNodeIds: new Set([1]) });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('battery low', () => {
    it.each([
      ['meshtastic', '!0bcd5737 battery low', 0x0bcd5737, undefined],
      ['meshcore', 'Node-F6 battery low', 0xf6, undefined],
      ['reticulum', 'abcdef123456 battery low', 0xabc, 'abcdef1234567890abcdef1234567890'],
      ['reticulum', 'ABC battery low', 0xabc, undefined],
    ] as const)('notifies an unnamed %s node as %s', (protocol, title, nodeId, hash) => {
      useWatchedNodesStore.setState({ watchedNodeIds: new Set([nodeId]) });
      setup({
        nodes: new Map([
          [
            nodeId,
            makeNode({
              node_id: nodeId,
              long_name: '',
              short_name: '',
              battery: 5,
              ...(hash ? { reticulum_destination_hash: hash } : {}),
            }),
          ],
        ]),
        capabilities: { ...caps, protocol },
      });
      expect(notificationSpy).toHaveBeenCalledOnce();
      expect(notificationSpy.mock.calls[0]?.[0]).toBe(title);
    });

    it('fires once at or below threshold and plays batteryLow', () => {
      const { rerender } = setup({ nodes: new Map([[1, makeNode({ battery: 50 })]]) });
      expect(notificationSpy).not.toHaveBeenCalled();

      const low = new Map([[1, makeNode({ battery: 9 })]]);
      rerender({ nodes: low, capabilities: caps, links: [], settings: defaults });
      expect(notificationSpy).toHaveBeenCalledOnce();
      expect(notificationSpy.mock.calls[0][0]).toBe('Alpha battery low');
      expect(playMessageNotification).toHaveBeenCalledWith('batteryLow');

      rerender({
        nodes: new Map([[1, makeNode({ battery: 8 })]]),
        capabilities: caps,
        links: [],
        settings: defaults,
      });
      expect(notificationSpy).toHaveBeenCalledOnce();
    });

    it('re-arms only after recovering above threshold + hysteresis', () => {
      const { rerender } = setup({ nodes: new Map([[1, makeNode({ battery: 5 })]]) });
      expect(notificationSpy).toHaveBeenCalledTimes(1);
      const at = (battery: number) => {
        rerender({
          nodes: new Map([[1, makeNode({ battery })]]),
          capabilities: caps,
          links: [],
          settings: defaults,
        });
      };
      at(12);
      at(6);
      expect(notificationSpy).toHaveBeenCalledTimes(1);
      at(20);
      at(6);
      expect(notificationSpy).toHaveBeenCalledTimes(2);
    });

    it('ignores unwatched nodes, charging (>100), unknown (0), and protocols without battery', () => {
      useWatchedNodesStore.setState({ watchedNodeIds: new Set([1]) });
      setup({
        nodes: new Map([
          [1, makeNode({ battery: 101 })],
          [2, makeNode({ node_id: 2, battery: 3 })],
        ]),
      });
      setup({ nodes: new Map([[1, makeNode({ battery: 0 })]]) });
      setup({
        nodes: new Map([[1, makeNode({ battery: 3 })]]),
        capabilities: { ...caps, hasBatteryTelemetry: false },
      });
      expect(notificationSpy).not.toHaveBeenCalled();
    });
  });

  describe('silence escalation', () => {
    it('does nothing when no user silence threshold is set', () => {
      setup({ nodes: new Map([[1, makeNode({ last_heard: Date.now() - 10 * 3_600_000 })]]) });
      expect(notificationSpy).not.toHaveBeenCalled();
    });

    it('fires at 2x the user threshold once per silence cycle', () => {
      const settings = { ...defaults, nodeSilenceAlertMinutes: 15 };
      const heardAt = Date.now();
      const { rerender } = setup({
        nodes: new Map([[1, makeNode({ last_heard: heardAt })]]),
        settings,
      });
      act(() => {
        vi.advanceTimersByTime(31 * 60_000);
      });
      expect(notificationSpy).toHaveBeenCalledOnce();
      expect(notificationSpy.mock.calls[0][0]).toBe('Alpha still silent');
      expect(playMessageNotification).toHaveBeenCalledWith('connectionLost');

      act(() => {
        vi.advanceTimersByTime(10 * 60_000);
      });
      expect(notificationSpy).toHaveBeenCalledOnce();

      // Heard again → cycle resets.
      rerender({
        nodes: new Map([[1, makeNode({ last_heard: Date.now() })]]),
        capabilities: caps,
        links: [],
        settings,
      });
      act(() => {
        vi.advanceTimersByTime(31 * 60_000);
      });
      expect(notificationSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('link down', () => {
    function drive(statuses: [ConnectionStatus, boolean | undefined][], settings = defaults) {
      const { rerender } = setup({ links: link('disconnected') });
      for (const [status, loss] of statuses) {
        rerender({ nodes: new Map(), capabilities: caps, links: link(status, loss), settings });
      }
      act(() => {
        vi.advanceTimersByTime(LINK_DOWN_GRACE_MS + 1);
      });
    }

    it('fires after unexpected drop once reconnect gives up', () => {
      drive([
        ['connecting', undefined],
        ['configured', false],
        ['reconnecting', true],
        ['reconnecting', true],
        ['disconnected', true],
      ]);
      expect(notificationSpy).toHaveBeenCalledOnce();
      expect(notificationSpy.mock.calls[0][0]).toBe('Meshtastic link down');
      expect(playMessageNotification).toHaveBeenCalledWith('connectionLost');
    });

    it('S10: manual disconnect does not fire', () => {
      drive([
        ['configured', false],
        ['disconnected', false],
      ]);
      expect(notificationSpy).not.toHaveBeenCalled();
    });

    it('S11: does not fire while reconnect is in progress', () => {
      drive([
        ['configured', false],
        ['reconnecting', true],
      ]);
      expect(notificationSpy).not.toHaveBeenCalled();
    });

    it('does not fire when the link recovers within the grace window', () => {
      const { rerender } = setup({ links: link('configured', false) });
      rerender({
        nodes: new Map(),
        capabilities: caps,
        links: link('disconnected', true),
        settings: defaults,
      });
      rerender({
        nodes: new Map(),
        capabilities: caps,
        links: link('reconnecting', true),
        settings: defaults,
      });
      act(() => {
        vi.advanceTimersByTime(LINK_DOWN_GRACE_MS + 1);
      });
      expect(notificationSpy).not.toHaveBeenCalled();
    });

    it('still fires on exhaustion after a cancelled grace-window blip', () => {
      drive([
        ['configured', false],
        ['disconnected', true],
        ['reconnecting', true],
        ['disconnected', true],
      ]);
      expect(notificationSpy).toHaveBeenCalledOnce();
    });

    it('respects notifyOnLinkDown=false', () => {
      drive(
        [
          ['configured', false],
          ['disconnected', true],
        ],
        { ...defaults, notifyOnLinkDown: false },
      );
      expect(notificationSpy).not.toHaveBeenCalled();
    });

    it('never fires for a link that was never up', () => {
      drive([
        ['connecting', undefined],
        ['disconnected', true],
      ]);
      expect(notificationSpy).not.toHaveBeenCalled();
    });
  });
});
