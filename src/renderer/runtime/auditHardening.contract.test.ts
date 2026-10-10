// @vitest-environment jsdom
/**
 * Source contracts for audit hardening in LoRa runtimes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractUseCallbackBody, loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const MESHTASTIC = loadRuntimeSource('useMeshtasticRuntime.ts');
const MESHCORE = loadRuntimeSource('useMeshcoreRuntime.ts');
const CHAT_PANEL = readFileSync(
  join(import.meta.dirname ?? __dirname, '../components/ChatPanel.tsx'),
  'utf-8',
);
const NODE_LIST = readFileSync(
  join(import.meta.dirname ?? __dirname, '../components/NodeListPanel.tsx'),
  'utf-8',
);
const RAW_PACKET_LOG = readFileSync(
  join(import.meta.dirname ?? __dirname, '../components/RawPacketLogPanel.tsx'),
  'utf-8',
);
const TAK_SERVER = readFileSync(
  join(import.meta.dirname ?? __dirname, '../../main/tak-server-manager.ts'),
  'utf-8',
);

describe('audit hardening source contracts', () => {
  it('refreshMessagesFromDb catches floating hydrateMeshtasticMessagesFromDb rejections', () => {
    const body = extractUseCallbackBody(MESHTASTIC, 'refreshMessagesFromDb');
    expect(body).toContain('hydrateMeshtasticMessagesFromDb');
    expect(body).toMatch(/hydrateMeshtasticMessagesFromDb\([\s\S]*?\)\.catch\(\(err: unknown\) =>/);
    expect(body).toContain('refreshMessagesFromDb identity hydrate failed');
  });

  it('MeshCore auto-connect uses resolveLastHttpAddress instead of hand-parsed lastConnection JSON', () => {
    expect(MESHCORE).toContain('resolveLastHttpAddress');
    expect(MESHCORE).not.toContain("localStorage.getItem('mesh-client:lastConnection:meshcore')");
  });

  it('MeshCore static GPS persist uses gpsSource helper', () => {
    expect(MESHCORE).toContain('persistStoredStaticGps');
    expect(MESHCORE).not.toContain("'mesh-client:gpsSettings'");
  });

  it('Meshtastic GPS interval uses readGpsRefreshIntervalSecs', () => {
    expect(MESHTASTIC).toContain('readGpsRefreshIntervalSecs');
    expect(MESHTASTIC).not.toContain("'mesh-client:gpsSettings'");
  });

  it('ChatPanel localizes MeshCore Unknown sender sentinel only', () => {
    expect(CHAT_PANEL).toContain("protocol === 'meshcore' && rawSenderName === 'Unknown'");
    expect(CHAT_PANEL).toContain("t('common.unknown')");
  });

  it('NodeListPanel maps Sensor/None/Unknown hw_model through i18n keys', () => {
    expect(NODE_LIST).toContain("t('nodeListPanel.meshcoreTypeSensor')");
    expect(NODE_LIST).toContain("t('nodeListPanel.meshcoreTypeNone')");
    expect(NODE_LIST).toContain("t('nodeListPanel.meshcoreTypeUnknown')");
  });

  it('RawPacketLog transport badges use translated filter-chip keys', () => {
    expect(RAW_PACKET_LOG).toContain("'rawPacketLog.filterChipLocal'");
    expect(RAW_PACKET_LOG).toContain("'rawPacketLog.filterChipMqtt'");
    expect(RAW_PACKET_LOG).toContain("'rawPacketLog.filterChipRf'");
    expect(RAW_PACKET_LOG).not.toMatch(/const transportLabel = p\.isLocal \? 'LOCAL'/);
  });

  it('TAK server error path sanitizes before log/emit', () => {
    expect(TAK_SERVER).toMatch(
      /this\.server\.on\('error'[\s\S]*?sanitizeLogMessage\(msg\)[\s\S]*?console\.error\('\[TakServer\]', safe\)/,
    );
  });
});
