export interface MqttNetworkPresetOption {
  /** Preset id stored as the select value. */
  value: string;
  /** Already-translated, user-visible label. */
  label: string;
}

interface MqttNetworkPresetSelectProps {
  id: string;
  /** id of the visible label element for `aria-labelledby`. */
  labelledById: string;
  value: string;
  options: MqttNetworkPresetOption[];
  onSelect: (value: string) => void;
}

/**
 * Shared MQTT network-preset picker (Meshtastic + MeshCore Connection panel).
 * Presentational only — the parent owns preset apply / confirm side effects.
 */
export function MqttNetworkPresetSelect({
  id,
  labelledById,
  value,
  options,
  onSelect,
}: MqttNetworkPresetSelectProps) {
  return (
    <select
      id={id}
      aria-labelledby={labelledById}
      value={value}
      onChange={(e) => {
        onSelect(e.target.value);
      }}
      className="bg-secondary-dark focus:border-brand-green w-full rounded border border-gray-600 px-2 py-1.5 text-xs font-medium text-gray-200 focus:outline-none"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
