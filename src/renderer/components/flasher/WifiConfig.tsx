import { useState } from 'react';
import { useTranslation } from 'react-i18next';

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
    <div className="space-y-2 rounded border border-gray-700 bg-slate-900/40 p-3">
      <h4 className="text-sm font-medium text-gray-200">{t('flasher.wifiTitle')}</h4>
      <p className="text-xs text-gray-400">{t('flasher.wifiHint')}</p>
      <label className="block text-xs text-gray-400">
        {t('flasher.wifiSsidLabel')}
        <input
          value={ssid}
          disabled={disabled}
          onChange={(e) => {
            setSsid(e.target.value);
          }}
          className="mt-1 block w-full rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm disabled:opacity-40"
          aria-label={t('flasher.wifiSsidLabel')}
        />
      </label>
      <label className="block text-xs text-gray-400">
        {t('flasher.wifiPskLabel')}
        <input
          type="password"
          value={psk}
          disabled={disabled}
          onChange={(e) => {
            setPsk(e.target.value);
          }}
          className="mt-1 block w-full rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm disabled:opacity-40"
          aria-label={t('flasher.wifiPskLabel')}
        />
      </label>
      {showAdvanced ? (
        <div className="space-y-2 rounded border border-gray-700/60 p-2">
          <label className="block text-xs text-gray-400">
            {t('flasher.wifiChannelLabel')}
            <input
              value={channel}
              disabled={disabled}
              onChange={(e) => {
                setChannel(e.target.value);
              }}
              className="mt-1 block w-20 rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm disabled:opacity-40"
              aria-label={t('flasher.wifiChannelLabel')}
            />
          </label>
          <label className="block text-xs text-gray-400">
            {t('flasher.wifiStaticIpLabel')}
            <input
              value={staticIp}
              disabled={disabled}
              onChange={(e) => {
                setStaticIp(e.target.value);
              }}
              placeholder={t('flasher.wifiDhcpPlaceholder')}
              className="mt-1 block w-full rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm disabled:opacity-40"
              aria-label={t('flasher.wifiStaticIpLabel')}
            />
          </label>
          <label className="block text-xs text-gray-400">
            {t('flasher.wifiStaticNetmaskLabel')}
            <input
              value={staticNetmask}
              disabled={disabled}
              onChange={(e) => {
                setStaticNetmask(e.target.value);
              }}
              placeholder="255.255.255.0"
              className="mt-1 block w-full rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm disabled:opacity-40"
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
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
        >
          {t('flasher.wifiOff')}
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.wifiEnableAp')}
          onClick={() => {
            onEnableAp(ssid, psk);
          }}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
        >
          {t('flasher.wifiEnableAp')}
        </button>
        <button
          type="button"
          disabled={disabled || !ssid.trim() || !psk.trim()}
          aria-label={t('flasher.wifiApplyStation')}
          onClick={() => {
            const parsedChannel = channel.trim() ? Number.parseInt(channel, 10) : undefined;
            onApplyStation({
              ssid,
              psk,
              channel:
                parsedChannel != null && Number.isFinite(parsedChannel) ? parsedChannel : undefined,
              staticIp: staticIp.trim() || undefined,
              staticNetmask: staticNetmask.trim() || undefined,
            });
          }}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
        >
          {t('flasher.wifiApplyStation')}
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.wifiReadConfig')}
          onClick={onReadConfig}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
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
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
        >
          {showAdvanced ? t('flasher.wifiAdvancedHide') : t('flasher.wifiAdvancedShow')}
        </button>
      </div>
      {configSummary ? (
        <pre className="overflow-x-auto rounded bg-slate-950/60 p-2 text-[11px] whitespace-pre-wrap text-amber-100/90">
          {configSummary}
        </pre>
      ) : null}
    </div>
  );
}
