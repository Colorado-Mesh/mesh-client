import { buttonClassName } from '@/renderer/components/ui/Button';

/**
 * Shared secondary `sm` action chrome for Reticulum Peers rows and Chat DM header
 * (Probe / Peer details / Call / Challenge / Send file / Paper).
 */
export const RETICULUM_DM_HEADER_ACTION_CLASS = buttonClassName('secondary', 'sm');

/** Non-interactive status chips (path reachability, last heard) in the Chat DM header. */
export const RETICULUM_DM_HEADER_STATUS_CLASS =
  'inline-flex items-center gap-1.5 rounded-lg bg-ink-800/60 px-2.5 py-1 text-xs';
