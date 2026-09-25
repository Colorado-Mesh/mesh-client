import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getAppSettingsRaw, mergeAppSetting } from '@/renderer/lib/appSettingsStorage';
import {
  createEmptyMecpRebroadcastRules,
  MECP_REBROADCAST_SETTINGS_KEY,
  type MecpRebroadcastRule,
  parseMecpRebroadcastRules,
} from '@/renderer/lib/mecp/mecpRebroadcast';

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

  useEffect(() => {
    mergeAppSetting(MECP_REBROADCAST_SETTINGS_KEY, rules, 'MecpRebroadcastSettings');
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
      <h4 className="text-sm font-semibold text-gray-200">{t('mecp.rebroadcast.title')}</h4>
      <p className="text-xs text-gray-400">{t('mecp.rebroadcast.hint')}</p>
      <ul className="flex flex-col gap-3">
        {rules.map((rule) => (
          <li
            key={rule.id}
            className="rounded border border-gray-700/50 bg-slate-900/40 p-2 text-xs text-gray-300"
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
                protocol={rule.endpointA.protocol}
                channelIndex={rule.endpointA.channelIndex}
                onProtocol={(protocol) => {
                  updateRule(rule.id, {
                    endpointA: { ...rule.endpointA, protocol },
                  });
                }}
                onChannel={(channelIndex) => {
                  updateRule(rule.id, {
                    endpointA: { ...rule.endpointA, channelIndex },
                  });
                }}
              />
              <EndpointEditors
                label={t('mecp.rebroadcast.endpointB')}
                protocol={rule.endpointB.protocol}
                channelIndex={rule.endpointB.channelIndex}
                onProtocol={(protocol) => {
                  updateRule(rule.id, {
                    endpointB: { ...rule.endpointB, protocol },
                  });
                }}
                onChannel={(channelIndex) => {
                  updateRule(rule.id, {
                    endpointB: { ...rule.endpointB, channelIndex },
                  });
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="mt-2 rounded border border-gray-600 px-2 py-1 text-xs text-gray-200"
        onClick={addRule}
        aria-label={t('mecp.rebroadcast.add')}
      >
        {t('mecp.rebroadcast.add')}
      </button>
    </div>
  );
}

function EndpointEditors({
  label,
  protocol,
  channelIndex,
  onProtocol,
  onChannel,
}: {
  label: string;
  protocol: 'meshtastic' | 'meshcore';
  channelIndex: number;
  onProtocol: (p: 'meshtastic' | 'meshcore') => void;
  onChannel: (n: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-[10px] text-gray-500">{label}</legend>
      <select
        className="mb-1 w-full rounded border border-gray-700 bg-slate-950 px-1 py-0.5"
        value={protocol}
        onChange={(e) => {
          onProtocol(e.target.value as 'meshtastic' | 'meshcore');
        }}
        aria-label={t('mecp.rebroadcast.protocol')}
      >
        <option value="meshtastic">Meshtastic</option>
        <option value="meshcore">MeshCore</option>
      </select>
      <input
        type="number"
        min={0}
        max={7}
        className="w-full rounded border border-gray-700 bg-slate-950 px-1 py-0.5"
        value={channelIndex}
        onChange={(e) => {
          onChannel(Math.min(7, Math.max(0, Math.trunc(Number(e.target.value) || 0))));
        }}
        aria-label={t('mecp.rebroadcast.channelIndex')}
      />
    </fieldset>
  );
}
