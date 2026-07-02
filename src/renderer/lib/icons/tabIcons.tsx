import {
  Blocks,
  ChartBar,
  ChartPie,
  Code,
  Crosshair,
  FileChartColumn,
  GitBranch,
  Globe,
  House,
  Link2,
  Lock,
  MapPin,
  MessageCircle,
  Network,
  Radio,
  Settings,
  Shield,
  Users,
  Wifi,
  Wrench,
} from 'lucide-react-motion';

import { ICON_MD } from '@/renderer/lib/icons/iconClass';
import { useParentIconTrigger } from '@/renderer/lib/icons/iconMotionContext';

const TAB_ICON_CLS = ICON_MD;

/** Sidebar / tab navigation icons — use parent-hover inside tab buttons. */
export function TabIcon({ name }: { name: string }) {
  const trigger = useParentIconTrigger();
  const p = { 'aria-hidden': true as const, className: TAB_ICON_CLS, trigger, size: 16 };

  switch (name) {
    case 'Connection':
      return <Link2 {...p} />;
    case 'Chat':
      return <MessageCircle {...p} />;
    case 'NomadNetwork':
      return <Globe {...p} />;
    case 'Nodes':
    case 'Contacts':
      return <Users {...p} />;
    case 'Radio':
      return <Settings {...p} />;
    case 'Map':
      return <MapPin {...p} />;
    case 'Telemetry':
      return <ChartBar {...p} />;
    case 'Security':
      return <Lock {...p} />;
    case 'App':
      return <Wrench {...p} />;
    case 'Diagnostics':
      return <FileChartColumn {...p} />;
    case 'Modules':
      return <Blocks {...p} />;
    case 'Repeaters':
      return <Radio {...p} />;
    case 'Rooms':
      return <House {...p} />;
    case 'TAK':
      return <Crosshair {...p} />;
    case 'Stats':
      return <ChartPie {...p} />;
    case 'Sniffer':
      return <Code {...p} />;
    case 'RF':
      return <Wifi {...p} />;
    case 'Graph':
      return <GitBranch {...p} />;
    case 'Topology':
      return <Network {...p} />;
    case 'Admin':
      return <Shield {...p} />;
    default:
      return null;
  }
}
