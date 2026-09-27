import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { INPUT_BOX_CLASS } from '../ui/formClasses';

export type RNodeWifiMode = 'off' | 'ap' | 'station';

export interface WifiConfigProps {
  disabled?: boolean;
  configSummary: string | null;
  onWifiOff: () => void;
  onEnableAp: (ssid: string, psk: string) => void;
  onApplyStation: (args: {
    ssid: string;
    psk: string;
    channel?: number;
    staticIp?: string;
    staticNetmask?: string;
  }) => void;
  onReadConfig: () => void;
}

export function WifiConfig({
  disabled,
  configSummary,
  onWifiOff,
  onEnableAp,
  onApplyStation,
  onReadConfig,
}: WifiConfigProps) {
  const { t } = useTranslation();
  const [ssid, setSsid] = useState('');
  const [psk, setPsk] = useState('');
  const [channel, setChannel] = useState('');
  const [staticIp, setStaticIp] = useState('');
  const [staticNetmask, setStaticNetmask] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="border-ink-700 bg-ink-900/40 space-y-2 rounded border p-3">
      <h4 className="text-ink-200 text-sm font-medium">{t('flasher.wifiTitle')}</h4>
      <p className="text-ink-400 text-xs">{t('flasher.wifiHint')}</p>
      <label className="text-ink-400 block text-xs">
        {t('flasher.wifiSsidLabel')}
        <input
          value={ssid}
          disabled={disabled}
          onChange={(e) => {
            setSsid(e.target.value);
          }}
          className={`${INPUT_BOX_CLASS} mt-1 block w-full`}
          aria-label={t('flasher.wifiSsidLabel')}
        />
      </label>
      <label className="text-ink-400 block text-xs">
        {t('flasher.wifiPskLabel')}
        <input
          type="password"
          value={psk}
          disabled={disabled}
          onChange={(e) => {
            setPsk(e.target.value);
          }}
          className={`${INPUT_BOX_CLASS} mt-1 block w-full`}
          aria-label={t('flasher.wifiPskLabel')}
        />
      </label>
      {showAdvanced ? (
        <div className="border-ink-700/60 space-y-2 rounded border p-2">
          <label className="text-ink-400 block text-xs">
            {t('flasher.wifiChannelLabel')}
            <input
              value={channel}
              disabled={disabled}
              onChange={(e) => {
                setChannel(e.target.value);
              }}
              className={`${INPUT_BOX_CLASS} mt-1 block w-20`}
              aria-label={t('flasher.wifiChannelLabel')}
            />
          </label>
          <label className="text-ink-400 block text-xs">
            {t('flasher.wifiStaticIpLabel')}
            <input
              value={staticIp}
              disabled={disabled}
              onChange={(e) => {
                setStaticIp(e.target.value);
              }}
              placeholder={t('flasher.wifiDhcpPlaceholder')}
              className={`${INPUT_BOX_CLASS} mt-1 block w-full`}
              aria-label={t('flasher.wifiStaticIpLabel')}
            />
          </label>
          <label className="text-ink-400 block text-xs">
            {t('flasher.wifiStaticNetmaskLabel')}
            <input
              value={staticNetmask}
              disabled={disabled}
              onChange={(e) => {
                setStaticNetmask(e.target.value);
              }}
              placeholder={t('flasher.wifiNetmaskPlaceholder')}
              className={`${INPUT_BOX_CLASS} mt-1 block w-full`}
              aria-label={t('flasher.wifiStaticNetmaskLabel')}
            />
          </label>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.wifiOff')}
          onClick={onWifiOff}
          className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
        >
          {t('flasher.wifiOff')}
        </button>
        <button
          type="button"
          disabled={disabled || !ssid.trim() || !psk.trim()}
          aria-label={t('flasher.wifiEnableAp')}
          onClick={() => {
            onEnableAp(ssid, psk);
          }}
          className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
        >
          {t('flasher.wifiEnableAp')}
        </button>
        <button
          type="button"
          disabled={disabled || !ssid.trim() || !psk.trim()}
          aria-label={t('flasher.wifiApplyStation')}
          onClick={() => {
            const parsedChannel = channel.trim() ? Number.parseInt(channel, 10) : undefined;
            const validChannel =
              parsedChannel != null &&
              Number.isFinite(parsedChannel) &&
              parsedChannel >= 1 &&
              parsedChannel <= 14
                ? parsedChannel
                : undefined;
            onApplyStation({
              ssid,
              psk,
              channel: validChannel,
              staticIp: staticIp.trim() || undefined,
              staticNetmask: staticNetmask.trim() || undefined,
            });
          }}
          className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
        >
          {t('flasher.wifiApplyStation')}
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.wifiReadConfig')}
          onClick={onReadConfig}
          className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
        >
          {t('flasher.wifiReadConfig')}
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.wifiAdvancedToggle')}
          onClick={() => {
            setShowAdvanced((v) => !v);
          }}
          className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
        >
          {showAdvanced ? t('flasher.wifiAdvancedHide') : t('flasher.wifiAdvancedShow')}
        </button>
      </div>
      {configSummary ? (
        <pre className="text-label bg-ink-950/60 overflow-x-auto rounded p-2 whitespace-pre-wrap text-orange-100/90">
          {configSummary}
        </pre>
      ) : null}
    </div>
  );
}
