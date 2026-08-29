import { describe, expect, it } from 'vitest';

import {
  humanizeNomadPageError,
  isRetryableNomadPageError,
  nomadPageErrorI18nKey,
  shouldForceNomadPathRefreshRetry,
} from './nomadPageErrorHumanize';

describe('nomadPageErrorHumanize', () => {
  const t = (key: string) => `t:${key}`;

  it('maps known codes to i18n keys', () => {
    expect(nomadPageErrorI18nKey('path_timeout')).toBe('nomadNetwork.errors.pathTimeout');
    expect(nomadPageErrorI18nKey('response_too_large')).toBe(
      'nomadNetwork.errors.responseTooLarge',
    );
    expect(nomadPageErrorI18nKey('nomad_busy')).toBe('nomadNetwork.errors.nomadBusy');
    expect(nomadPageErrorI18nKey('nomad_not_serving')).toBe('nomadNetwork.errors.nomadNotServing');
    expect(nomadPageErrorI18nKey('network_not_ready')).toBe('nomadNetwork.errors.networkNotReady');
    expect(nomadPageErrorI18nKey('invalid_url')).toBe('nomadNetwork.invalidUrl');
    expect(nomadPageErrorI18nKey('missing_identity_hash')).toBe(
      'nomadNetwork.errors.missingIdentity',
    );
    expect(nomadPageErrorI18nKey('sidecar_not_running')).toBe(
      'nomadNetwork.errors.sidecarNotRunning',
    );
    expect(nomadPageErrorI18nKey('content_source_required')).toBe(
      'nomadNetwork.serving.contentSourceRequired',
    );
    expect(nomadPageErrorI18nKey('content_source_unavailable')).toBe(
      'nomadNetwork.serving.contentSourceUnavailable',
    );
    expect(nomadPageErrorI18nKey('invalid_content_source')).toBe(
      'nomadNetwork.serving.invalidContentSource',
    );
    expect(nomadPageErrorI18nKey('content_source_not_from_picker')).toBe(
      'nomadNetwork.serving.contentSourceNotFromPicker',
    );
  });

  describe('local page authoring codes', () => {
    it('maps every code emitted by page_error_code in the sidecar', () => {
      expect(nomadPageErrorI18nKey('page_too_large')).toBe('nomadNetwork.serving.pageTooLarge');
      expect(nomadPageErrorI18nKey('page_not_found')).toBe('nomadNetwork.serving.pageNotFound');
      expect(nomadPageErrorI18nKey('invalid_page_path')).toBe(
        'nomadNetwork.serving.invalidPagePath',
      );
      expect(nomadPageErrorI18nKey('page_io_error')).toBe('nomadNetwork.serving.pageIoError');
      expect(nomadPageErrorI18nKey('page_not_utf8')).toBe('nomadNetwork.serving.pageNotUtf8');
      expect(nomadPageErrorI18nKey('page_write_failed')).toBe(
        'nomadNetwork.serving.pageWriteFailed',
      );
    });

    it('humanizes authoring failures rather than echoing the code', () => {
      expect(humanizeNomadPageError('page_too_large', t)).toBe(
        't:nomadNetwork.serving.pageTooLarge',
      );
      expect(humanizeNomadPageError('invalid_page_path', t)).toBe(
        't:nomadNetwork.serving.invalidPagePath',
      );
    });

    /**
     * Guards the sidecar mapping in `nomad_server.rs::page_error_code`. If it is
     * reverted, raw `NomadError` Display prose reaches the UI untranslated and
     * these strings start appearing verbatim.
     */
    it('cannot translate raw NomadError prose, so the sidecar must send codes', () => {
      for (const prose of [
        'response too large (600000 > 524288)',
        'not found: index.mu',
        'path traversal rejected',
        'invalid path: path too long',
        'io error: permission denied',
      ]) {
        expect(nomadPageErrorI18nKey(prose)).toBeNull();
        expect(humanizeNomadPageError(prose, t)).toBe(prose);
      }
    });
  });

  it('humanizes known codes and passes through unknown', () => {
    expect(humanizeNomadPageError('path_timeout', t)).toBe('t:nomadNetwork.errors.pathTimeout');
    expect(humanizeNomadPageError('content_source_unavailable', t)).toBe(
      't:nomadNetwork.serving.contentSourceUnavailable',
    );
    expect(humanizeNomadPageError('weird failure', t)).toBe('weird failure');
    expect(humanizeNomadPageError(null, t)).toBe('t:common.error');
  });

  it('uses path-ensure diagnostics for link_timeout copy', () => {
    expect(nomadPageErrorI18nKey('link_timeout')).toBe('nomadNetwork.errors.linkTimeout');
    expect(
      nomadPageErrorI18nKey('link_timeout', {
        forcePathOk: true,
        pathEnsureKind: 'rediscovered',
      }),
    ).toBe('nomadNetwork.errors.linkTimeoutPathOk');
    expect(
      nomadPageErrorI18nKey('link_timeout', { pathEnsureKind: 'cached_hit', forcePathOk: false }),
    ).toBe('nomadNetwork.errors.linkTimeoutCachedPath');
    expect(nomadPageErrorI18nKey('path_timeout', { pathEnsureKind: 'stale_accept' })).toBe(
      'nomadNetwork.errors.pathTimeoutStale',
    );
    expect(
      humanizeNomadPageError('link_timeout', t, {
        forcePathOk: true,
        pathEnsureKind: 'rediscovered',
      }),
    ).toBe('t:nomadNetwork.errors.linkTimeoutPathOk');
    expect(
      nomadPageErrorI18nKey('link_timeout', {
        forcePathOk: true,
        pathEnsureKind: 'rediscovered',
        triedInterfaces: ['Ratspeak', 'RNS_Transport_US-East'],
      }),
    ).toBe('nomadNetwork.errors.linkTimeoutRoutesTried');
    const tOpts = (key: string, options?: Record<string, unknown>) =>
      options ? `t:${key}:${JSON.stringify(options)}` : `t:${key}`;
    expect(
      humanizeNomadPageError('link_timeout', tOpts, {
        triedInterfaces: ['Ratspeak', 'RNS_Transport_US-East'],
      }),
    ).toBe(
      't:nomadNetwork.errors.linkTimeoutRoutesTried:{"ifaces":"Ratspeak, RNS_Transport_US-East"}',
    );
  });

  it('classifies announce-reload vs force-path-refresh errors', () => {
    expect(isRetryableNomadPageError('path_timeout')).toBe(true);
    expect(isRetryableNomadPageError('link_timeout')).toBe(true);
    expect(isRetryableNomadPageError('response_timeout')).toBe(true);
    expect(isRetryableNomadPageError('nomad_busy')).toBe(false);
    expect(isRetryableNomadPageError('pubkey_not_found')).toBe(true);
    expect(isRetryableNomadPageError('missing_identity_hash')).toBe(true);
    expect(isRetryableNomadPageError('sidecar_not_running')).toBe(false);
    expect(isRetryableNomadPageError('content_source_required')).toBe(false);
    expect(isRetryableNomadPageError(null)).toBe(false);
    expect(isRetryableNomadPageError('')).toBe(false);

    expect(shouldForceNomadPathRefreshRetry('path_timeout')).toBe(true);
    expect(shouldForceNomadPathRefreshRetry('pubkey_not_found')).toBe(true);
    expect(shouldForceNomadPathRefreshRetry('missing_identity_hash')).toBe(true);
    expect(shouldForceNomadPathRefreshRetry('response_timeout')).toBe(false);
    expect(shouldForceNomadPathRefreshRetry('nomad_busy')).toBe(false);

    // TCP/network hub link_timeout: force DropPath; RF/BLE does not.
    expect(shouldForceNomadPathRefreshRetry('link_timeout', 'tcp')).toBe(true);
    expect(shouldForceNomadPathRefreshRetry('link_timeout', 'network')).toBe(true);
    expect(shouldForceNomadPathRefreshRetry('link_timeout')).toBe(true);
    expect(shouldForceNomadPathRefreshRetry('link_timeout', 'unknown')).toBe(true);
    expect(shouldForceNomadPathRefreshRetry('link_timeout', 'rf')).toBe(false);
    expect(shouldForceNomadPathRefreshRetry('link_timeout', 'ble')).toBe(false);
    expect(shouldForceNomadPathRefreshRetry('link_timeout', 'RF')).toBe(false);

    // Sidecar already via-failovers / rediscovered — do not start a second HTTP attempt.
    expect(
      shouldForceNomadPathRefreshRetry('link_timeout', 'tcp', {
        forcePathOk: true,
        pathEnsureKind: 'rediscovered',
      }),
    ).toBe(false);
    expect(
      shouldForceNomadPathRefreshRetry('link_timeout', 'tcp', {
        triedInterfaces: ['Ratspeak', 'RNS_Transport_US-East'],
      }),
    ).toBe(false);
    // Omitting diag (announce reload) still allows force-path.
    expect(shouldForceNomadPathRefreshRetry('link_timeout', 'tcp', null)).toBe(true);
  });
});
