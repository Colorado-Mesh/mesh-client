import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getAppSettingsRaw, mergeAppSetting } from '@/renderer/lib/appSettingsStorage';
import {
  createEmptyMecpRebroadcastRules,
  MECP_REBROADCAST_ANY_PEER,
  MECP_REBROADCAST_SETTINGS_KEY,
  type MecpRebroadcastEndpoint,
  type MecpRebroadcastRule,
  type MecpReticulumEndpoint,
  parseMecpRebroadcastRules,
} from '@/renderer/lib/mecp/mecpRebroadcast';

import { INPUT_BOX_SM_CLASS, SELECT_BOX_SM_CLASS } from '../ui/formClasses';

function newRuleId(): string {
  return `mecp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function MecpRebroadcastSettings() {
  const { t } = useTranslation();
  const [rules, setRules] = useState<MecpRebroadcastRule[]>(() => {
    try {
      const raw = getAppSettingsRaw();
      if (!raw) return createEmptyMecpRebroadcastRules();
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return parseMecpRebroadcastRules(parsed[MECP_REBROADCAST_SETTINGS_KEY]);
    } catch {
      // catch-no-log-ok
      return createEmptyMecpRebroadcastRules();
    }
  });

  const lastSavedRules = useRef(rules);
  useEffect(() => {
    if (rules === lastSavedRules.current) return;
    mergeAppSetting(MECP_REBROADCAST_SETTINGS_KEY, rules, 'MecpRebroadcastSettings');
    lastSavedRules.current = rules;
  }, [rules]);

  const addRule = useCallback(() => {
    setRules((prev) => [
      ...prev,
      {
        id: newRuleId(),
        enabled: false,
        bidirectional: false,
        endpointA: { protocol: 'meshtastic', channelIndex: 0 },
        endpointB: { protocol: 'meshcore', channelIndex: 0 },
      },
    ]);
  }, []);

  const updateRule = useCallback((id: string, patch: Partial<MecpRebroadcastRule>) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const removeRule = useCallback((id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return (
    <div className="space-y-2" aria-label={t('mecp.rebroadcast.title')}>
      <h4 className="text-ink-200 text-sm font-semibold">{t('mecp.rebroadcast.title')}</h4>
      <p className="text-ink-400 text-xs">{t('mecp.rebroadcast.hint')}</p>
      <p className="text-ink-400 text-xs">{t('mecp.rebroadcast.hintReticulum')}</p>
      <ul className="flex flex-col gap-3">
        {rules.map((rule) => (
          <li
            key={rule.id}
            className="border-ink-700/50 bg-ink-900/40 text-ink-300 rounded border p-2 text-xs"
          >
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) => {
                    updateRule(rule.id, { enabled: e.target.checked });
                  }}
                  aria-label={t('mecp.rebroadcast.enableRule')}
                />
                {t('mecp.rebroadcast.enableRule')}
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={rule.bidirectional}
                  onChange={(e) => {
                    updateRule(rule.id, { bidirectional: e.target.checked });
                  }}
                  aria-label={t('mecp.rebroadcast.bidirectional')}
                />
                {t('mecp.rebroadcast.bidirectional')}
              </label>
              <button
                type="button"
                className="ml-auto text-red-400 hover:text-red-300"
                onClick={() => {
                  removeRule(rule.id);
                }}
                aria-label={t('mecp.rebroadcast.remove')}
              >
                {t('common.delete')}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <EndpointEditors
                label={t('mecp.rebroadcast.endpointA')}
                endpoint={rule.endpointA}
                onChange={(endpointA) => {
                  updateRule(rule.id, { endpointA });
                }}
              />
              <EndpointEditors
                label={t('mecp.rebroadcast.endpointB')}
                endpoint={rule.endpointB}
                onChange={(endpointB) => {
                  updateRule(rule.id, { endpointB });
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="border-ink-600 text-ink-200 mt-2 rounded border px-2 py-1 text-xs"
        onClick={addRule}
        aria-label={t('mecp.rebroadcast.add')}
      >
        {t('mecp.rebroadcast.add')}
      </button>
    </div>
  );
}

type EndpointProtocol = MecpRebroadcastEndpoint['protocol'];

function defaultEndpointFor(protocol: EndpointProtocol): MecpRebroadcastEndpoint {
  // Wire/storage routing by endpoint protocol id (not a ProtocolCapabilities feature gate).
  switch (protocol) {
    case 'reticulum':
      return { protocol: 'reticulum', kind: 'lxmf', destinationHash: MECP_REBROADCAST_ANY_PEER };
    case 'meshcore':
      return { protocol: 'meshcore', channelIndex: 0 };
    default:
      return { protocol: 'meshtastic', channelIndex: 0 };
  }
}

function isReticulumEndpoint(
  endpoint: MecpRebroadcastEndpoint,
): endpoint is Extract<MecpRebroadcastEndpoint, { kind: string }> {
  return 'kind' in endpoint;
}

/** Lenient draft sanitizer: keep only hex digits while typing (validated on parse/send). */
function hexDraft(value: string): string {
  return value.replace(/[^0-9a-f*]/gi, '').toLowerCase();
}

function EndpointEditors({
  label,
  endpoint,
  onChange,
}: {
  label: string;
  endpoint: MecpRebroadcastEndpoint;
  onChange: (endpoint: MecpRebroadcastEndpoint) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="min-w-0">
      <legend className="text-2xs text-muted mb-1">{label}</legend>
      <select
        className={`${SELECT_BOX_SM_CLASS} mb-1 w-full`}
        value={endpoint.protocol}
        onChange={(e) => {
          onChange(defaultEndpointFor(e.target.value as EndpointProtocol));
        }}
        aria-label={t('mecp.rebroadcast.protocol')}
      >
        <option value="meshtastic">Meshtastic</option>
        <option value="meshcore">MeshCore</option>
        <option value="reticulum">Reticulum</option>
      </select>
      {isReticulumEndpoint(endpoint) ? (
        <ReticulumEndpointFields endpoint={endpoint} onChange={onChange} />
      ) : (
        <input
          type="number"
          min={0}
          max={7}
          className={`${INPUT_BOX_SM_CLASS} w-full`}
          value={endpoint.channelIndex}
          onChange={(e) => {
            onChange({
              ...endpoint,
              channelIndex: Math.min(7, Math.max(0, Math.trunc(Number(e.target.value) || 0))),
            });
          }}
          aria-label={t('mecp.rebroadcast.channelIndex')}
        />
      )}
    </fieldset>
  );
}

function ReticulumEndpointFields({
  endpoint,
  onChange,
}: {
  endpoint: MecpReticulumEndpoint;
  onChange: (endpoint: MecpRebroadcastEndpoint) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <select
        className={`${SELECT_BOX_SM_CLASS} w-full`}
        value={endpoint.kind}
        onChange={(e) => {
          onChange(
            e.target.value === 'rrc'
              ? { protocol: 'reticulum', kind: 'rrc', hubDestHash: '', room: '' }
              : defaultEndpointFor('reticulum'),
          );
        }}
        aria-label={t('mecp.rebroadcast.reticulumKind')}
      >
        <option value="lxmf">{t('mecp.rebroadcast.reticulumKindLxmf')}</option>
        <option value="rrc">{t('mecp.rebroadcast.reticulumKindRrc')}</option>
      </select>
      {endpoint.kind === 'lxmf' ? (
        <input
          type="text"
          className={`${INPUT_BOX_SM_CLASS} w-full font-mono`}
          value={endpoint.destinationHash}
          maxLength={32}
          placeholder={t('mecp.rebroadcast.reticulumPeerPlaceholder')}
          onChange={(e) => {
            onChange({ ...endpoint, destinationHash: hexDraft(e.target.value) });
          }}
          aria-label={t('mecp.rebroadcast.reticulumPeerHash')}
        />
      ) : (
        <>
          <input
            type="text"
            className={`${INPUT_BOX_SM_CLASS} w-full font-mono`}
            value={endpoint.hubDestHash}
            maxLength={32}
            placeholder={t('mecp.rebroadcast.reticulumHubPlaceholder')}
            onChange={(e) => {
              onChange({ ...endpoint, hubDestHash: hexDraft(e.target.value) });
            }}
            aria-label={t('mecp.rebroadcast.reticulumHubHash')}
          />
          <input
            type="text"
            className={`${INPUT_BOX_SM_CLASS} w-full`}
            value={endpoint.room}
            maxLength={64}
            placeholder={t('mecp.rebroadcast.reticulumRoomPlaceholder')}
            onChange={(e) => {
              onChange({ ...endpoint, room: e.target.value });
            }}
            aria-label={t('mecp.rebroadcast.reticulumRoom')}
          />
        </>
      )}
    </div>
  );
}
