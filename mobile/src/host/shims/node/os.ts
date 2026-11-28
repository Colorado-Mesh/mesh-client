/** `os` shim for the mobile host worker. */
import { getBootConfig } from '../../hostChannel';
import { MOBILE_PATHS } from '../paths';

export const EOL = '\n';
export function platform(): string {
  return getBootConfig().nodePlatform;
}
export function type(): string {
  return getBootConfig().mobilePlatform === 'ios' ? 'Darwin' : 'Linux';
}
export function release(): string {
  return getBootConfig().mobilePlatform;
}
export function version(): string {
  return getBootConfig().mobilePlatform;
}
export function arch(): string {
  return 'arm64';
}
export function machine(): string {
  return 'arm64';
}
export function tmpdir(): string {
  return MOBILE_PATHS.temp;
}
export function homedir(): string {
  return MOBILE_PATHS.home;
}
export function hostname(): string {
  return 'mesh-client-mobile';
}
export function userInfo(): {
  username: string;
  uid: number;
  gid: number;
  shell: null;
  homedir: string;
} {
  return { username: 'mobile', uid: 0, gid: 0, shell: null, homedir: MOBILE_PATHS.home };
}
export function cpus(): { model: string; speed: number; times: Record<string, number> }[] {
  const n = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  return Array.from({ length: n }, () => ({
    model: 'mobile',
    speed: 0,
    times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
  }));
}
export function availableParallelism(): number {
  return cpus().length;
}
export function totalmem(): number {
  const gb =
    (typeof navigator !== 'undefined'
      ? (navigator as { deviceMemory?: number }).deviceMemory
      : undefined) ?? 4;
  return gb * 1024 ** 3;
}
export function freemem(): number {
  return totalmem() / 2;
}
export function uptime(): number {
  return performance.now() / 1000;
}
export function loadavg(): number[] {
  return [0, 0, 0];
}
export function networkInterfaces(): Record<string, unknown[]> {
  return {};
}
export function endianness(): 'LE' {
  return 'LE';
}
export function getPriority(): number {
  return 0;
}
export function setPriority(): void {}
export const constants = {
  signals: { SIGTERM: 15, SIGKILL: 9, SIGINT: 2 },
  errno: {},
  priority: {},
};
export const devNull = '/dev/null';
export default {
  EOL,
  platform,
  type,
  release,
  version,
  arch,
  machine,
  tmpdir,
  homedir,
  hostname,
  userInfo,
  cpus,
  availableParallelism,
  totalmem,
  freemem,
  uptime,
  loadavg,
  networkInterfaces,
  endianness,
  getPriority,
  setPriority,
  constants,
  devNull,
};
