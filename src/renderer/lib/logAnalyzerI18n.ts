/**
 * Static i18n key maps for log analysis (see `check:i18n` — no dynamic t('...' + id)).
 */
export const LOG_ANALYZER_CATEGORY_LABEL_KEYS: Record<string, string> = {
  'ble-connection': 'logAnalyzer.categories.ble-connection.label',
  mqtt: 'logAnalyzer.categories.mqtt.label',
  'mqtt-retries-exhausted': 'logAnalyzer.categories.mqtt-retries-exhausted.label',
  watchdog: 'logAnalyzer.categories.watchdog.label',
  handshake: 'logAnalyzer.categories.handshake.label',
  'ble-connect-race': 'logAnalyzer.categories.ble-connect-race.label',
  'auth-decrypt': 'logAnalyzer.categories.auth-decrypt.label',
  'native-module': 'logAnalyzer.categories.native-module.label',
  'internal-error': 'logAnalyzer.categories.internal-error.label',
  'database-error': 'logAnalyzer.categories.database-error.label',
  'database-chmod': 'logAnalyzer.categories.database-chmod.label',
  'database-writable': 'logAnalyzer.categories.database-writable.label',
  'tak-server': 'logAnalyzer.categories.tak-server.label',
  updater: 'logAnalyzer.categories.updater.label',
  'meshcore-tcp': 'logAnalyzer.categories.meshcore-tcp.label',
  'ble-meshcore-notify-watchdog': 'logAnalyzer.categories.ble-meshcore-notify-watchdog.label',
  'bluetooth-pairing': 'logAnalyzer.categories.bluetooth-pairing.label',
  'sdk-meshtastic': 'logAnalyzer.categories.sdk-meshtastic.label',
  'sdk-meshcore': 'logAnalyzer.categories.sdk-meshcore.label',
};

export const LOG_ANALYZER_CATEGORY_RECOMMENDATION_KEYS: Record<string, string> = {
  'ble-connection': 'logAnalyzer.categories.ble-connection.recommendation',
  mqtt: 'logAnalyzer.categories.mqtt.recommendation',
  'mqtt-retries-exhausted': 'logAnalyzer.categories.mqtt-retries-exhausted.recommendation',
  watchdog: 'logAnalyzer.categories.watchdog.recommendation',
  handshake: 'logAnalyzer.categories.handshake.recommendation',
  'ble-connect-race': 'logAnalyzer.categories.ble-connect-race.recommendation',
  'auth-decrypt': 'logAnalyzer.categories.auth-decrypt.recommendation',
  'native-module': 'logAnalyzer.categories.native-module.recommendation',
  'internal-error': 'logAnalyzer.categories.internal-error.recommendation',
  'database-error': 'logAnalyzer.categories.database-error.recommendation',
  'database-chmod': 'logAnalyzer.categories.database-chmod.recommendation',
  'database-writable': 'logAnalyzer.categories.database-writable.recommendation',
  'tak-server': 'logAnalyzer.categories.tak-server.recommendation',
  updater: 'logAnalyzer.categories.updater.recommendation',
  'meshcore-tcp': 'logAnalyzer.categories.meshcore-tcp.recommendation',
  'ble-meshcore-notify-watchdog':
    'logAnalyzer.categories.ble-meshcore-notify-watchdog.recommendation',
  'bluetooth-pairing': 'logAnalyzer.categories.bluetooth-pairing.recommendation',
  'sdk-meshtastic': 'logAnalyzer.categories.sdk-meshtastic.recommendation',
  'sdk-meshcore': 'logAnalyzer.categories.sdk-meshcore.recommendation',
};

/** Used only by unit tests merging synthetic categories in `dedupeRecommendations`. */
export const LOG_ANALYZER_GROUP_RECOMMENDATION_KEYS: Record<string, string> = {
  __test_merged: 'logAnalyzer.recommendationGroups.__test_merged.recommendation',
};

export function resolveLogAnalyzerRecommendationKey(recommendationGroup: string): string {
  return (
    LOG_ANALYZER_GROUP_RECOMMENDATION_KEYS[recommendationGroup] ??
    LOG_ANALYZER_CATEGORY_RECOMMENDATION_KEYS[recommendationGroup] ??
    'logAnalyzer.categories.internal-error.recommendation'
  );
}
