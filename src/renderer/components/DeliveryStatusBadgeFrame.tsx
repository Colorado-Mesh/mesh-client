import { HelpTooltip } from '@/renderer/components/HelpTooltip';

export interface DeliveryStatusBadgeFrameProps {
  label: string;
  icon: string;
  colorClass: string;
  tooltip: string;
}

/** Shared compact status pill used by Meshtastic/MeshCore and Reticulum badges. */
export function DeliveryStatusBadgeFrame({
  label,
  icon,
  colorClass,
  tooltip,
}: DeliveryStatusBadgeFrameProps) {
  return (
    <HelpTooltip text={tooltip} ariaLabel={tooltip}>
      <span className={`text-[10px] ${colorClass}`}>
        {label} {icon}
      </span>
    </HelpTooltip>
  );
}
