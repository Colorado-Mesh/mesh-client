import { Bluetooth, Cpu, Globe, Radio } from 'lucide-react-motion';

import { ICON_LG } from '@/renderer/lib/icons/iconClass';
import { useIconTrigger } from '@/renderer/lib/icons/iconMotionContext';

export type ConnectionTransportType = 'ble' | 'serial' | 'http';

type IconTrigger = 'hover' | 'parent-hover' | 'manual';

export function ConnectionIcon({
  type,
  trigger: triggerProp,
}: {
  type: ConnectionTransportType;
  trigger?: IconTrigger;
}) {
  const defaultTrigger = useIconTrigger();
  const trigger = triggerProp ?? defaultTrigger;
  const p = { 'aria-hidden': true as const, className: ICON_LG, trigger, size: 20 };

  switch (type) {
    case 'ble':
      return <Bluetooth {...p} />;
    case 'serial':
      return <Cpu {...p} />;
    case 'http':
      return <Radio {...p} />;
    default:
      return null;
  }
}

export function MqttGlobeIcon({
  className,
  trigger: triggerProp,
}: {
  className?: string;
  trigger?: IconTrigger;
}) {
  const defaultTrigger = useIconTrigger();
  const trigger = triggerProp ?? defaultTrigger;
  return <Globe aria-hidden className={className ?? ICON_LG} trigger={trigger} size={20} />;
}
