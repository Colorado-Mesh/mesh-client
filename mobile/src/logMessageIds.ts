/**
 * Stable log message IDs for the mobile app's warn/error output (`mcM####`). Same rules as the
 * desktop `mcL####` registry (src/shared/logMessageIds.ts): allocate the next free ID here, never
 * reuse one, IDs only on warn/error. Enforced by `pnpm -C mobile run check:log-ids`.
 */
export const MOBILE_LOG_MESSAGE_IDS: Readonly<Record<string, string>> = {
  mcM0001: 'src/host/shims/node/sqlite.ts:359',
  mcM0002: 'src/host/shims/node/sqlite.ts:423',
  mcM0003: 'src/host/shims/node/fs.ts:121',
  mcM0004: 'src/host/shims/node/fs.ts:147',
  mcM0005: 'src/host/shims/node/fs.ts:172',
  mcM0006: 'src/host/worker.ts:106',
  mcM0007: 'src/host/worker.ts:237',
  mcM0008: 'src/host/overrides/gatt-mobile-proxy.ts:426',
  mcM0009: 'src/host/sharedDir.ts:82',
  mcM0010: 'src/host/sharedDir.ts:120',
  mcM0011: 'src/host/worker.ts:175',
  mcM0012: 'src/bridge/backgroundKeeper.ts:35',
  mcM0013: 'src/bridge/hostClient.ts:55',
  mcM0014: 'src/bridge/hostClient.ts:113',
  mcM0015: 'src/bridge/hostClient.ts:159',
  mcM0016: 'src/bridge/hostClient.ts:199',
  mcM0017: 'src/bridge/hostClient.ts:173',
  mcM0018: 'src/bridge/hostClient.ts:174',
  mcM0019: 'src/host/hostChannel.ts:151',
  mcM0020: 'src/host/hostChannel.ts:239',
  mcM0021: 'src/host/hostChannel.ts:251',
  mcM0022: 'src/main.tsx:146',
  mcM0023: 'src/host/globals.ts:49',
  mcM0024: 'src/platform/webNotifications.ts:148',
};
