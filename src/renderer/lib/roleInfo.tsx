import { useTranslation } from 'react-i18next';

import { NODE_BADGE_PATHS } from './nodeIcons';

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
  const p = {
    className: 'w-3.5 h-3.5',
    fill: 'none',
    viewBox: '0 0 24 24',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (role) {
    case 0: // Client — User
      return (
        <svg {...p}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4 3.58-7 8-7s8 3 8 7" />
        </svg>
      );
    case 1: // Client Mute — UserX
      return (
        <svg {...p}>
          <circle cx="10" cy="7" r="4" />
          <path d="M10.3 15H6a4 4 0 0 0-4 4v2" />
          <line x1="15" y1="11" x2="21" y2="17" />
          <line x1="21" y1="11" x2="15" y2="17" />
        </svg>
      );
    case 2: // Router — wifi/signal-arc (matches meshcore repeater icon)
      return (
        <svg {...p}>
          <path d={NODE_BADGE_PATHS.repeater} />
        </svg>
      );
    case 3: // Router Client — UserCog
      return (
        <svg {...p}>
          <circle cx="10" cy="7" r="4" />
          <path d="M10.3 15H6a4 4 0 0 0-4 4v2" />
          <circle cx="18" cy="16" r="2" />
          <path d="M18 12v1m0 6v1m-3 .46.87-.5m4.26 2.5.87-.5m-4.26-8 .87.5m4.26-2.5.87.5" />
        </svg>
      );
    case 4: // Repeater — Repeat (circular arrows)
      return (
        <svg {...p}>
          <polyline points="17 1 21 5 17 9" />
          <path d="M3 11V9a4 4 0 0 1 4-4h14" />
          <polyline points="7 23 3 19 7 15" />
          <path d="M21 13v2a4 4 0 0 1-4 4H3" />
        </svg>
      );
    case 5: // Tracker — MapPin
      return (
        <svg {...p}>
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      );
    case 6: // Sensor — Activity (pulse wave)
      return (
        <svg {...p}>
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      );
    case 7: // TAK — Crosshair
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <line x1="22" y1="12" x2="18" y2="12" />
          <line x1="6" y1="12" x2="2" y2="12" />
          <line x1="12" y1="6" x2="12" y2="2" />
          <line x1="12" y1="22" x2="12" y2="18" />
        </svg>
      );
    case 8: // Client Hidden — Ghost
      return (
        <svg {...p}>
          <path d="M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" />
        </svg>
      );
    case 9: // Lost & Found — LifeBuoy
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="4" />
          <line x1="4.93" y1="4.93" x2="9.17" y2="9.17" />
          <line x1="14.83" y1="14.83" x2="19.07" y2="19.07" />
          <line x1="14.83" y1="9.17" x2="19.07" y2="4.93" />
          <line x1="4.93" y1="19.07" x2="9.17" y2="14.83" />
        </svg>
      );
    case 10: // TAK Tracker — Target (bullseye)
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      );
    case 11: // Router Late — Clock
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case 12: // Client Base — MDI home-variant
      return (
        <svg {...p} fill="currentColor" stroke="none">
          <path d="M12 3L2 12h3v8h14v-8h3L12 3zm0 2.5L17 10v8h-2v-5H9v5H7v-8l5-4.5z" />
        </svg>
      );
    default: // Unknown — question mark in circle
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      );
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
