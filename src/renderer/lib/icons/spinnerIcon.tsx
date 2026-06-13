import { Loader } from 'lucide-react-motion';

import { ICON_SM, ICON_SM_PLUS } from '@/renderer/lib/icons/iconClass';

interface SpinnerIconProps {
  className?: string;
  /** When false, icon is hidden (RefreshButton idle state). */
  active?: boolean;
}

/** Loading spinner — always animates on mount when active (essential feedback). */
export function SpinnerIcon({ className, active = true }: SpinnerIconProps) {
  if (!active) return null;
  const cls = className ?? `${ICON_SM} text-gray-400`;
  return (
    <Loader
      aria-hidden
      className={cls}
      trigger="mount"
      mode="signature"
      repeat={Infinity}
      size={16}
    />
  );
}

export function SpinnerIconMd({ className }: { className?: string }) {
  return (
    <Loader
      aria-hidden
      className={className ?? `${ICON_SM_PLUS} text-gray-400`}
      trigger="mount"
      mode="signature"
      repeat={Infinity}
      size={14}
    />
  );
}

export function SpinnerIconLg({ className }: { className?: string }) {
  return (
    <Loader
      aria-hidden
      className={className ?? 'h-12 w-12'}
      trigger="mount"
      mode="signature"
      repeat={Infinity}
      size={48}
    />
  );
}
