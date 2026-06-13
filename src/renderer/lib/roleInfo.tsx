import {
  CircleQuestionMark,
  Clock,
  Crosshair,
  Ghost,
  House,
  LifeBuoy,
  MapPin,
  Repeat,
  Router,
  Target,
  Thermometer,
  User,
  UserCog,
  UserX,
} from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

import { useIconTrigger } from '@/renderer/lib/icons/iconMotionContext';

interface RoleInfo {
  labelKey: string;
  labelParams?: Record<string, string | number>;
  colorClass: string;
  isBadge: boolean;
  badgeClass?: string;
}

const ROLE_INFO: Record<number, RoleInfo> = {
  0: { labelKey: 'roleInfo.roles.client', colorClass: 'text-gray-400', isBadge: false },
  1: { labelKey: 'roleInfo.roles.clientMute', colorClass: 'text-gray-500', isBadge: false },
  2: { labelKey: 'roleInfo.roles.router', colorClass: 'text-gray-400', isBadge: false },
  3: { labelKey: 'roleInfo.roles.routerClient', colorClass: 'text-blue-400', isBadge: false },
  4: {
    labelKey: 'roleInfo.roles.repeater',
    colorClass: 'text-orange-400',
    isBadge: true,
    badgeClass: 'bg-orange-900/60 text-orange-300 border border-orange-700/40',
  },
  5: { labelKey: 'roleInfo.roles.tracker', colorClass: 'text-green-400', isBadge: false },
  6: { labelKey: 'roleInfo.roles.sensor', colorClass: 'text-teal-400', isBadge: false },
  7: {
    labelKey: 'roleInfo.roles.tak',
    colorClass: 'text-red-400',
    isBadge: true,
    badgeClass: 'bg-red-900/60 text-red-300 border border-red-700/40',
  },
  8: { labelKey: 'roleInfo.roles.clientHidden', colorClass: 'text-purple-400', isBadge: false },
  9: {
    labelKey: 'roleInfo.roles.lostAndFound',
    colorClass: 'text-pink-300',
    isBadge: true,
    badgeClass: 'bg-pink-900/60 text-pink-300 border border-pink-700/40',
  },
  10: {
    labelKey: 'roleInfo.roles.takTracker',
    colorClass: 'text-red-300',
    isBadge: true,
    badgeClass: 'bg-red-950/70 text-red-200 border border-red-800/50',
  },
  11: { labelKey: 'roleInfo.roles.routerLate', colorClass: 'text-gray-400', isBadge: false },
  12: { labelKey: 'roleInfo.roles.clientBase', colorClass: 'text-gray-400', isBadge: false },
};

export function getRoleInfo(role: number | undefined): RoleInfo {
  if (role !== undefined && role in ROLE_INFO) return ROLE_INFO[role];
  return {
    labelKey: role !== undefined ? 'roleInfo.unknownRole' : 'roleInfo.placeholderDash',
    labelParams: role !== undefined ? { role } : undefined,
    colorClass: 'text-gray-500',
    isBadge: false,
  };
}

export function RoleIcon({ role }: { role: number | undefined }) {
  const trigger = useIconTrigger();
  const p = { 'aria-hidden': true as const, className: 'w-3.5 h-3.5', trigger, size: 14 };

  switch (role) {
    case 0:
      return <User {...p} />;
    case 1:
      return <UserX {...p} />;
    case 2:
      return <Router {...p} />;
    case 3:
      return <UserCog {...p} />;
    case 4:
      return <Repeat {...p} />;
    case 5:
      return <MapPin {...p} />;
    case 6:
      return <Thermometer {...p} />;
    case 7:
      return <Crosshair {...p} />;
    case 8:
      return <Ghost {...p} />;
    case 9:
      return <LifeBuoy {...p} />;
    case 10:
      return <Target {...p} />;
    case 11:
      return <Clock {...p} />;
    case 12:
      return <House {...p} />;
    default:
      return <CircleQuestionMark {...p} />;
  }
}

export function RoleDisplay({ role }: { role: number | undefined }) {
  const { t } = useTranslation();
  if (role === undefined) {
    return <span className="text-xs text-gray-600">{t('roleInfo.placeholderDash')}</span>;
  }
  const info = getRoleInfo(role);
  if (info.isBadge && info.badgeClass) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${info.badgeClass}`}
      >
        <RoleIcon role={role} />
        {t(info.labelKey, info.labelParams ?? undefined)}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${info.colorClass}`}>
      <RoleIcon role={role} />
      {t(info.labelKey, info.labelParams ?? undefined)}
    </span>
  );
}
