/**
 * Shared text-link style for Reticulum Chat DM header actions
 * (Probe / Peer details / Call / Send file). Status chips stay pill-shaped.
 */
export const RETICULUM_DM_HEADER_ACTION_CLASS =
  'inline-flex items-center gap-1 text-xs text-cyan-400 hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline';

/** Non-interactive status chips (path reachability, last heard). */
export const RETICULUM_DM_HEADER_STATUS_CLASS =
  'inline-flex items-center gap-1.5 rounded-lg bg-slate-800/60 px-2.5 py-1 text-xs';
