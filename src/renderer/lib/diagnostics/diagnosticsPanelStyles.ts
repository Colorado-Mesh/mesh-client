export const DIAGNOSTICS_CATEGORY_STYLES: Record<string, string> = {
  Configuration: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  Physical: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  Hardware: 'bg-purple-500/20 text-purple-400 border border-purple-500/30',
  Software: 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30',
};

export const DIAGNOSTICS_SEVERITY_HEADER: Record<string, string> = {
  error: 'bg-red-950/40 text-red-400',
  warning: 'bg-orange-950/20 text-orange-400',
  info: 'bg-blue-950/20 text-blue-400',
};

export const DIAGNOSTICS_SEVERITY_TEXT: Record<string, string> = {
  error: 'text-red-400',
  warning: 'text-orange-400',
  info: 'text-blue-400',
};

export function reticulumMeshHealthBand(
  errorCount: number,
  warningCount: number,
): {
  labelKey: string;
  bg: string;
  textColor: string;
} {
  if (errorCount > 0) {
    return {
      labelKey: 'diagnosticsPanel.meshHealthDegraded',
      bg: 'bg-red-500/10 border-red-500/30',
      textColor: 'text-red-400',
    };
  }
  if (warningCount > 0) {
    return {
      labelKey: 'diagnosticsPanel.meshHealthAttention',
      bg: 'bg-yellow-500/10 border-yellow-500/30',
      textColor: 'text-yellow-400',
    };
  }
  return {
    labelKey: 'diagnosticsPanel.meshHealthHealthy',
    bg: 'bg-brand-green/10 border-brand-green/30',
    textColor: 'text-brand-green',
  };
}
