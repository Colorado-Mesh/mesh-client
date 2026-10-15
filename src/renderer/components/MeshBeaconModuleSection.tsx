import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSyncFormFromConfig } from '@/renderer/hooks/useSyncFormFromConfig';
import {
  clampMeshBeaconInterval,
  clampMeshBeaconMessage,
  EMPTY_MESH_BEACON_TARGET,
  matchMeshBeaconOfferChannel,
  MESH_BEACON_MAX_TARGETS,
  MESH_BEACON_MESSAGE_MAX_BYTES,
  MESH_BEACON_MIN_INTERVAL_SECS,
  meshBeaconOfferChannelFrom,
  type MeshBeaconTargetDraft,
  meshBeaconTargetsFromConfig,
  meshBeaconTargetsToApply,
  packMeshBeaconFlags,
  unpackMeshBeaconFlags,
  utf8ByteLength,
  validateMeshBeaconTarget,
} from '@/renderer/lib/meshtastic/meshBeaconConfig';
import { meshtasticConfigSlice } from '@/renderer/lib/meshtastic/meshtasticConfigApply';
import {
  meshtasticModemPresetSelectOptions,
  meshtasticRegionSelectOptions,
} from '@/renderer/lib/meshtastic/meshtasticEnumLabels';

import {
  cfgNum,
  cfgStr,
  ConfigNumber,
  ConfigSelect,
  ConfigText,
  ConfigToggle,
  ModuleSection,
} from './moduleConfigControls';
import { useToast } from './Toast';
import { buttonClassName } from './ui/Button';

/** Channel slot as held by the Meshtastic runtime (`channelConfigs`). */
export interface MeshBeaconChannelConfig {
  index: number;
  name: string;
  role: number;
  psk: Uint8Array;
}

const OFFER_CHANNEL_NONE = -1;
const OFFER_CHANNEL_KEEP = -2;
const PRESET_UNSET = -1;
const CHANNEL_DEFAULT = -1;
/** `Channel.Role.DISABLED` */
const CHANNEL_ROLE_DISABLED = 0;

interface Props {
  moduleConfig: unknown;
  channelConfigs: readonly MeshBeaconChannelConfig[];
  disabled: boolean;
  applying: boolean;
  sliceReady: boolean;
  showSliceWaiting: boolean;
  globalApplyLocked: boolean;
  onApply: (sectionLabel: string, deviceSlice: unknown, overrides: Record<string, unknown>) => void;
  /** Heard-beacon list rendered under the config fields. */
  children?: ReactNode;
}

export function MeshBeaconModuleSection({
  moduleConfig,
  channelConfigs,
  disabled,
  applying,
  sliceReady,
  showSliceWaiting,
  globalApplyLocked,
  onApply,
  children,
}: Props) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const cfg = meshtasticConfigSlice(moduleConfig);
  const sectionTitle = t('modulePanel.sectionMeshBeacon');

  const activeChannels = useMemo(
    () => channelConfigs.filter((c) => c.role !== CHANNEL_ROLE_DISABLED),
    [channelConfigs],
  );
  const configuredIndices = useMemo(
    () => new Set(activeChannels.map((c) => c.index)),
    [activeChannels],
  );

  const offerChannelFromCfg = (c: Record<string, unknown>): number => {
    const offer = c.broadcastOfferChannel;
    const matched = matchMeshBeaconOfferChannel(offer, activeChannels);
    if (matched != null) return matched;
    const o = offer as { name?: unknown; psk?: unknown } | undefined;
    const hasOffer =
      (typeof o?.name === 'string' && o.name !== '') ||
      (o?.psk instanceof Uint8Array && o.psk.length > 0);
    return hasOffer ? OFFER_CHANNEL_KEEP : OFFER_CHANNEL_NONE;
  };

  const initialFlags = unpackMeshBeaconFlags(cfg.flags);
  const [listen, setListen] = useState(initialFlags.listen);
  const [broadcast, setBroadcast] = useState(initialFlags.broadcast);
  const [legacySplit, setLegacySplit] = useState(initialFlags.legacySplit);
  const [message, setMessage] = useState(cfgStr(cfg.broadcastMessage, ''));
  const [intervalSecs, setIntervalSecs] = useState(
    cfgNum(cfg.broadcastIntervalSecs, MESH_BEACON_MIN_INTERVAL_SECS) ||
      MESH_BEACON_MIN_INTERVAL_SECS,
  );
  const [offerChannel, setOfferChannel] = useState(() => offerChannelFromCfg(cfg));
  const [offerRegion, setOfferRegion] = useState(cfgNum(cfg.broadcastOfferRegion, 0));
  const [offerPreset, setOfferPreset] = useState(cfgNum(cfg.broadcastOfferPreset, PRESET_UNSET));
  const [offerSlot, setOfferSlot] = useState(cfgNum(cfg.broadcastOfferFrequencySlot, 0));
  const [targets, setTargets] = useState<MeshBeaconTargetDraft[]>(() =>
    meshBeaconTargetsFromConfig(cfg.broadcastTargets),
  );

  useSyncFormFromConfig(moduleConfig, (c) => {
    const f = unpackMeshBeaconFlags(c.flags);
    setListen(f.listen);
    setBroadcast(f.broadcast);
    setLegacySplit(f.legacySplit);
    setMessage(cfgStr(c.broadcastMessage, ''));
    setIntervalSecs(
      cfgNum(c.broadcastIntervalSecs, MESH_BEACON_MIN_INTERVAL_SECS) ||
        MESH_BEACON_MIN_INTERVAL_SECS,
    );
    setOfferChannel(offerChannelFromCfg(c));
    setOfferRegion(cfgNum(c.broadcastOfferRegion, 0));
    setOfferPreset(cfgNum(c.broadcastOfferPreset, PRESET_UNSET));
    setOfferSlot(cfgNum(c.broadcastOfferFrequencySlot, 0));
    setTargets(meshBeaconTargetsFromConfig(c.broadcastTargets));
  });

  const regionOptions = useMemo(() => meshtasticRegionSelectOptions(t), [t]);
  const presetOptions = useMemo(() => meshtasticModemPresetSelectOptions(t), [t]);
  const channelLabel = (c: MeshBeaconChannelConfig) =>
    t('modulePanel.fields.mbChannelOption', {
      index: c.index,
      name: c.name || t('modulePanel.fields.mbPrimaryChannel'),
    });

  const keepOfferName = cfgStr(meshtasticConfigSlice(cfg.broadcastOfferChannel).name, '');
  const offerChannelOptions = [
    { value: OFFER_CHANNEL_NONE, label: t('modulePanel.fields.mbOfferChannelNone') },
    ...(offerChannel === OFFER_CHANNEL_KEEP
      ? [
          {
            value: OFFER_CHANNEL_KEEP,
            label: t('modulePanel.fields.mbOfferChannelKeep', { name: keepOfferName }),
          },
        ]
      : []),
    ...activeChannels.map((c) => ({ value: c.index, label: channelLabel(c) })),
  ];
  const offerRegionOptions = regionOptions.map((o) =>
    o.value === 0 ? { ...o, label: t('modulePanel.fields.mbOfferRegionNone') } : o,
  );
  const offerPresetOptions = [
    { value: PRESET_UNSET, label: t('modulePanel.fields.mbOfferPresetNone') },
    ...presetOptions,
  ];
  const targetRegionOptions = regionOptions.map((o) =>
    o.value === 0 ? { ...o, label: t('modulePanel.fields.mbTargetRegionRunning') } : o,
  );
  const targetPresetOptions = [
    { value: PRESET_UNSET, label: t('modulePanel.fields.mbTargetPresetRunning') },
    ...presetOptions,
  ];
  const targetChannelOptions = [
    { value: CHANNEL_DEFAULT, label: t('modulePanel.fields.mbTargetChannelDefault') },
    ...activeChannels.map((c) => ({ value: c.index, label: channelLabel(c) })),
  ];

  const targetErrors = targets.map((d) => validateMeshBeaconTarget(d, configuredIndices));
  const messageBytes = utf8ByteLength(message);
  const fieldsDisabled = disabled;

  const updateTarget = (i: number, patch: Partial<MeshBeaconTargetDraft>) => {
    setTargets((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  };

  const handleApply = () => {
    if (targetErrors.some((e) => e != null)) {
      addToast(t('modulePanel.fields.mbTargetsInvalid'), 'error');
      return;
    }
    const overrides: Record<string, unknown> = {
      flags: packMeshBeaconFlags({ listen, broadcast, legacySplit }, cfg.flags),
      broadcastMessage: clampMeshBeaconMessage(message),
      broadcastIntervalSecs: clampMeshBeaconInterval(intervalSecs),
      broadcastOfferRegion: offerRegion,
      broadcastOfferPreset: offerPreset === PRESET_UNSET ? undefined : offerPreset,
      broadcastOfferFrequencySlot: offerSlot > 0 ? Math.trunc(offerSlot) : undefined,
      broadcastTargets: meshBeaconTargetsToApply(targets),
    };
    if (offerChannel === OFFER_CHANNEL_NONE) {
      overrides.broadcastOfferChannel = undefined;
    } else if (offerChannel !== OFFER_CHANNEL_KEEP) {
      const ch = activeChannels.find((c) => c.index === offerChannel);
      overrides.broadcastOfferChannel = ch ? meshBeaconOfferChannelFrom(ch) : undefined;
    }
    onApply(sectionTitle, moduleConfig, overrides);
  };

  return (
    <ModuleSection
      title={sectionTitle}
      anchorId="modules.meshBeacon"
      sliceReady={sliceReady}
      showSliceWaiting={showSliceWaiting}
      globalApplyLocked={globalApplyLocked}
      onApply={handleApply}
      applying={applying}
      disabled={disabled}
    >
      <ConfigToggle
        label={t('modulePanel.fields.mbListenEnabled')}
        checked={listen}
        onChange={setListen}
        disabled={fieldsDisabled}
        description={t('modulePanel.fields.mbListenEnabledDesc')}
      />
      <ConfigToggle
        label={t('modulePanel.fields.mbBroadcastEnabled')}
        anchorId="modules.meshBeacon.broadcast"
        checked={broadcast}
        onChange={setBroadcast}
        disabled={fieldsDisabled}
        description={t('modulePanel.fields.mbBroadcastEnabledDesc')}
      />
      <ConfigToggle
        label={t('modulePanel.fields.mbLegacySplit')}
        checked={legacySplit}
        onChange={setLegacySplit}
        disabled={fieldsDisabled || !broadcast}
        description={t('modulePanel.fields.mbLegacySplitDesc')}
      />
      <div className="space-y-1">
        <ConfigText
          label={t('modulePanel.fields.mbMessage')}
          value={message}
          onChange={(v) => {
            setMessage(clampMeshBeaconMessage(v));
          }}
          disabled={fieldsDisabled || !broadcast}
          description={t('modulePanel.fields.mbMessageDesc')}
        />
        <p className="text-muted text-right text-xs">
          {t('modulePanel.fields.mbMessageBytes', {
            used: messageBytes,
            max: MESH_BEACON_MESSAGE_MAX_BYTES,
          })}
        </p>
      </div>
      <ConfigNumber
        label={t('modulePanel.fields.mbInterval')}
        value={intervalSecs}
        onChange={setIntervalSecs}
        disabled={fieldsDisabled || !broadcast}
        min={MESH_BEACON_MIN_INTERVAL_SECS}
        unit={t('radioPanel.secondsUnit')}
        description={t('modulePanel.fields.mbIntervalDesc')}
      />

      <div className="border-ink-700 space-y-3 border-t pt-3">
        <h4 className="text-ink-300 text-sm font-medium">
          {t('modulePanel.fields.mbOfferHeading')}
        </h4>
        <p className="text-muted text-xs">{t('modulePanel.fields.mbOfferHint')}</p>
        <ConfigSelect
          label={t('modulePanel.fields.mbOfferChannel')}
          value={offerChannel}
          options={offerChannelOptions}
          onChange={setOfferChannel}
          disabled={fieldsDisabled || !broadcast}
          description={t('modulePanel.fields.mbOfferChannelDesc')}
        />
        <ConfigSelect
          label={t('modulePanel.fields.mbOfferRegion')}
          value={offerRegion}
          options={offerRegionOptions}
          onChange={setOfferRegion}
          disabled={fieldsDisabled || !broadcast}
        />
        <ConfigSelect
          label={t('modulePanel.fields.mbOfferPreset')}
          value={offerPreset}
          options={offerPresetOptions}
          onChange={setOfferPreset}
          disabled={fieldsDisabled || !broadcast}
        />
        <ConfigNumber
          label={t('modulePanel.fields.mbOfferSlot')}
          value={offerSlot}
          onChange={setOfferSlot}
          disabled={fieldsDisabled || !broadcast}
          min={0}
          description={t('modulePanel.fields.mbOfferSlotDesc')}
        />
      </div>

      <div className="border-ink-700 space-y-3 border-t pt-3">
        <h4 className="text-ink-300 text-sm font-medium">
          {t('modulePanel.fields.mbTargetsHeading')}
        </h4>
        <p className="text-muted text-xs">{t('modulePanel.fields.mbTargetsHint')}</p>
        {targets.map((d, i) => {
          const err = targetErrors[i];
          const n = i + 1;
          return (
            <fieldset
              key={i}
              className="border-ink-700 space-y-2 rounded-lg border p-3"
              aria-label={t('modulePanel.fields.mbTargetLabel', { n })}
            >
              <div className="flex items-center justify-between">
                <legend className="text-ink-300 text-sm">
                  {t('modulePanel.fields.mbTargetLabel', { n })}
                </legend>
                <button
                  type="button"
                  className={buttonClassName('ghost', 'sm')}
                  aria-label={t('modulePanel.fields.mbTargetRemove', { n })}
                  disabled={fieldsDisabled}
                  onClick={() => {
                    setTargets((prev) => prev.filter((_, j) => j !== i));
                  }}
                >
                  {t('common.delete')}
                </button>
              </div>
              <ConfigSelect
                label={t('modulePanel.fields.mbTargetPreset')}
                value={d.preset ?? PRESET_UNSET}
                options={targetPresetOptions}
                onChange={(v) => {
                  updateTarget(i, { preset: v === PRESET_UNSET ? null : v });
                }}
                disabled={fieldsDisabled}
              />
              <ConfigSelect
                label={t('modulePanel.fields.mbTargetRegion')}
                value={d.region}
                options={targetRegionOptions}
                onChange={(v) => {
                  updateTarget(i, { region: v });
                }}
                disabled={fieldsDisabled}
              />
              <ConfigSelect
                label={t('modulePanel.fields.mbTargetChannel')}
                value={d.channelIndex ?? CHANNEL_DEFAULT}
                options={targetChannelOptions}
                onChange={(v) => {
                  updateTarget(i, { channelIndex: v === CHANNEL_DEFAULT ? null : v });
                }}
                disabled={fieldsDisabled}
              />
              <ConfigNumber
                label={t('modulePanel.fields.mbTargetSlot')}
                value={d.frequencySlot ?? 0}
                onChange={(v) => {
                  updateTarget(i, { frequencySlot: v > 0 ? Math.trunc(v) : null });
                }}
                disabled={fieldsDisabled}
                min={0}
                description={t('modulePanel.fields.mbTargetSlotDesc')}
              />
              {err && (
                <p className="text-xs text-red-400" role="alert">
                  {t(`modulePanel.fields.mbTargetErrors.${err}`)}
                </p>
              )}
            </fieldset>
          );
        })}
        <button
          type="button"
          className={buttonClassName('secondary', 'sm')}
          disabled={fieldsDisabled || targets.length >= MESH_BEACON_MAX_TARGETS}
          onClick={() => {
            setTargets((prev) => [...prev, { ...EMPTY_MESH_BEACON_TARGET }]);
          }}
        >
          {t('modulePanel.fields.mbTargetAdd')}
        </button>
      </div>

      {children}
    </ModuleSection>
  );
}
