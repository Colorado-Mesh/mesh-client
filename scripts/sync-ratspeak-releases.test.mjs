// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  persistenceExportsDurableApis,
  shouldRefreshVaultAgainstReticulum,
  vaultNeedsDurablePersistence,
} from './sync-ratspeak-releases.mjs';

describe('vaultNeedsDurablePersistence', () => {
  it('detects DurableFileReceipt / durable_* imports', () => {
    expect(
      vaultNeedsDurablePersistence(
        'use rns_identity::persistence::{DurableFileReceipt, durable_write};',
      ),
    ).toBe(true);
    expect(vaultNeedsDurablePersistence('fn durable_remove(path: &Path) {}')).toBe(true);
    expect(vaultNeedsDurablePersistence('DurableCommitPhase::NotCommitted')).toBe(true);
  });

  it('returns false for the pre-durable vault surface', () => {
    expect(
      vaultNeedsDurablePersistence('pub fn encrypt_identity(passcode: &str, key: &[u8; 64]) {}'),
    ).toBe(false);
  });
});

const FULL_DURABLE_EXPORTS =
  'pub use strict::{DurableFileReceipt, DurableCommitPhase, durable_write, durable_remove};';

describe('persistenceExportsDurableApis', () => {
  it('requires all four durable symbols', () => {
    expect(persistenceExportsDurableApis(FULL_DURABLE_EXPORTS)).toBe(true);
    expect(persistenceExportsDurableApis('pub use strict::{DurableFileReceipt};')).toBe(false);
    expect(persistenceExportsDurableApis('fn read_file_bounded() {}')).toBe(false);
  });

  it('rejects a partial export set missing a required symbol', () => {
    expect(
      persistenceExportsDurableApis(
        'pub use strict::{DurableFileReceipt, durable_write, durable_remove};',
      ),
    ).toBe(false);
    expect(
      persistenceExportsDurableApis(
        'pub use strict::{DurableFileReceipt, DurableCommitPhase, durable_write};',
      ),
    ).toBe(false);
  });
});

describe('shouldRefreshVaultAgainstReticulum', () => {
  it('allows refresh when vault does not need durable APIs', () => {
    expect(shouldRefreshVaultAgainstReticulum('encrypt_identity', '')).toBe(true);
  });

  it('holds vault when durable APIs are missing from the pin', () => {
    expect(
      shouldRefreshVaultAgainstReticulum(
        'use DurableFileReceipt; durable_write(path, bytes)',
        'mod tests {}',
      ),
    ).toBe(false);
  });

  it('refreshes when the pin exports durable APIs', () => {
    expect(
      shouldRefreshVaultAgainstReticulum(
        'DurableFileReceipt + durable_write',
        FULL_DURABLE_EXPORTS,
      ),
    ).toBe(true);
  });
});
