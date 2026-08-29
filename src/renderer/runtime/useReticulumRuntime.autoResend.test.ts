/**
 * Source contract tests for announce-triggered LXMF auto-resend wiring.
 *
 * The announce handler lives inside a large runtime callback that is impractical to
 * mount in isolation, so the wiring is pinned at the source level (see
 * docs/development-environment.md on runtime contract tests).
 */
import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const SOURCE = loadRuntimeSource('useReticulumRuntime.ts');

describe('useReticulumRuntime announce auto-resend wiring', () => {
  it('imports the helper and the setting reader', () => {
    expect(SOURCE).toContain('resendFailedReticulumForDestination');
    expect(SOURCE).toContain('isReticulumAutoResendOnAnnounceEnabled');
    expect(SOURCE).toContain('announceDestinationHashes');
  });

  it('calls the helper from the announce.received branch', () => {
    expect(SOURCE).toMatch(
      /evt\.type === 'announce\.received'[\s\S]*?resendFailedReticulumForDestination\(/,
    );
  });

  it('gates the call on the opt-in setting', () => {
    expect(SOURCE).toMatch(
      /const autoResendEnabled = isReticulumAutoResendOnAnnounceEnabled\(\);[\s\S]*?if \(autoResendEnabled\)/,
    );
  });

  it('iterates every hash so batched announce payloads are covered', () => {
    expect(SOURCE).toMatch(
      /for \(const destinationHash of announceDestinationHashes\(evt\.payload\)\)/,
    );
  });

  it('forwards retryOfStoreId through the injected send so prior rows are rekeyed', () => {
    expect(SOURCE).toMatch(
      /send: \(text, destination, retryOfStoreId\) => \{[\s\S]*?sendMessageRef\.current\?\.\(text, destination, undefined, retryOfStoreId\)/,
    );
  });

  it('keeps the existing outbox drain on announce', () => {
    expect(SOURCE).toMatch(
      /evt\.type === 'announce\.received'[\s\S]*?requestChatOutboxDrain\('reticulum'\)/,
    );
  });
});
