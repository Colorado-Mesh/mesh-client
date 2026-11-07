import { withReticulumIpcSendDeadline } from '@/renderer/lib/reticulum/reticulumIpcDeadline';

export type RrcSendArgs = Parameters<typeof window.electronAPI.reticulum.rrc.send>[0];
export type RrcSendResult = Awaited<ReturnType<typeof window.electronAPI.reticulum.rrc.send>>;

/** Bound RRC send so a stuck proxy cannot hang the composer. */
export function rrcSendBounded(args: RrcSendArgs): Promise<RrcSendResult> {
  return withReticulumIpcSendDeadline(window.electronAPI.reticulum.rrc.send(args));
}
