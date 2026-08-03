/**
 * Shared outlined chip style for Reticulum Chat DM header actions
 * (Probe / Peer details / Call / Send file). Status chips stay non-interactive pills.
 */
export const RETICULUM_DM_HEADER_ACTION_CLASS =
  'inline-flex items-center gap-1 rounded-lg border border-cyan-500/35 bg-slate-800/40 px-2.5 py-1 text-xs text-cyan-300 hover:border-cyan-400/55 hover:bg-slate-800/70 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40';

/** Non-interactive status chips (path reachability, last heard). */
export const RETICULUM_DM_HEADER_STATUS_CLASS =
  'inline-flex items-center gap-1.5 rounded-lg bg-slate-800/60 px-2.5 py-1 text-xs';
