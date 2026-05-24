import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { RemoteAdminStatus } from '../lib/types';
import { useToast } from './Toast';

interface RemoteAdminErrorNotifierProps {
  status: RemoteAdminStatus;
  errorKey?: string;
}

/** Surfaces remote admin failures via toast (visible on any tab). */
export default function RemoteAdminErrorNotifier({
  status,
  errorKey,
}: RemoteAdminErrorNotifierProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const lastNotifiedKeyRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (status !== 'error' || !errorKey) return;
    if (errorKey === lastNotifiedKeyRef.current) return;
    lastNotifiedKeyRef.current = errorKey;
    addToast(t(errorKey), 'error', 8000);
  }, [status, errorKey, addToast, t]);

  useEffect(() => {
    if (status !== 'error') {
      lastNotifiedKeyRef.current = undefined;
    }
  }, [status]);

  return null;
}
