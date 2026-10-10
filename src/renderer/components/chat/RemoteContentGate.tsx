import type { ReactNode } from 'react';
import { useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface RemoteContentGateProps {
  destinationHost: string;
  children: ReactNode;
  onContentResize?: () => void;
}

/** Keeps message-selected remote content inert until the reader explicitly loads it. */
export function RemoteContentGate({
  destinationHost,
  children,
  onContentResize,
}: Readonly<RemoteContentGateProps>) {
  const { t } = useTranslation();
  const [approved, setApproved] = useState(false);

  useLayoutEffect(() => {
    if (approved) onContentResize?.();
  }, [approved, onContentResize]);

  if (approved) return <>{children}</>;

  return (
    <button
      type="button"
      className="mt-2 max-w-full rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-left text-xs text-cyan-200 hover:bg-cyan-500/15 hover:text-cyan-100"
      onClick={() => {
        setApproved(true);
      }}
    >
      {t('chatPayload.remoteContent.load', { host: destinationHost })}
    </button>
  );
}
