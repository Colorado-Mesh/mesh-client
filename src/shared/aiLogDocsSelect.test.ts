// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { selectDocsExcerpts, splitMarkdownSections, tokensFromFindings } from './aiLogDocsSelect';

const SAMPLE = `# Title

## Bluetooth connection

Check BLE distance and pairing.

## MQTT broker

Verify broker URL and credentials.

### Nested MQTT note

Extra MQTT detail.

## Unrelated topic

Something else.
`;

describe('aiLogDocsSelect', () => {
  it('splits level-2 and level-3 headings', () => {
    const sections = splitMarkdownSections(SAMPLE);
    expect(sections.map((s) => s.title)).toEqual([
      'Bluetooth connection',
      'MQTT broker',
      'Nested MQTT note',
      'Unrelated topic',
    ]);
  });

  it('tokenizes category ids and free text', () => {
    expect([...tokensFromFindings(['ble-connection', 'MQTT Issues'])].sort()).toEqual([
      'ble',
      'connection',
      'issues',
      'mqtt',
    ]);
  });

  it('prefers matching sections under a byte budget', () => {
    const result = selectDocsExcerpts(SAMPLE, ['ble-connection', 'bluetooth'], 10_000);
    expect(result.text).toContain('Bluetooth connection');
    expect(result.text).not.toContain('Unrelated topic');
    expect(result.sectionCount).toBeGreaterThanOrEqual(1);
  });

  it('clips when nothing fits except a prefix', () => {
    const result = selectDocsExcerpts(SAMPLE, ['bluetooth'], 40);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.truncated).toBe(true);
  });
});
