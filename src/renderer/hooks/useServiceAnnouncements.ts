import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { createOnlineRecoveryScheduler } from '@/renderer/lib/onlineRecoveryDebounce';
import {
  dismissServiceAnnouncementId,
  readDismissedServiceAnnouncementIds,
} from '@/renderer/lib/serviceAnnouncementDismiss';
import {
  isServiceAnnouncementInWindow,
  resolveServiceAnnouncementText,
  type ServiceAnnouncement,
  type ServiceAnnouncementSeverity,
} from '@/shared/serviceAnnouncementFeed';
import {
  MS_PER_MINUTE,
  SERVICE_ANNOUNCEMENT_CHECK_INTERVAL_MS,
  SERVICE_ANNOUNCEMENT_STARTUP_DELAY_MS,
} from '@/shared/timeConstants';

export interface VisibleServiceAnnouncement {
  id: string;
  severity: ServiceAnnouncementSeverity;
  title: string;
  body: string;
  url?: string;
  urlLabel?: string;
}

export interface ServiceAnnouncementsState {
  visible: VisibleServiceAnnouncement[];
  dismiss: (id: string) => void;
  openUrl: (url: string) => void;
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

/**
 * Poll the developer announcements feed (startup, interval, and after the network recovers).
 * Offline or failed checks are silent and keep the current list, like the update checker.
 */
export function useServiceAnnouncements(): ServiceAnnouncementsState {
  const { i18n } = useTranslation();
  const [announcements, setAnnouncements] = useState<ServiceAnnouncement[]>([]);
  const [dismissedIds, setDismissedIds] = useState<string[]>(readDismissedServiceAnnouncementIds);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let disposed = false;
    let inFlight = false;

    const runCheck = () => {
      if (disposed || inFlight || isOffline()) return;
      inFlight = true;
      void window.electronAPI.serviceAnnouncements
        .fetch()
        .then((result) => {
          if (disposed || result.status !== 'ok') return;
          setAnnouncements(result.announcements);
          setNowMs(Date.now());
        })
        .catch((e: unknown) => {
          console.debug('[serviceAnnouncements] check failed ' + errLikeToLogString(e));
        })
        .finally(() => {
          inFlight = false;
        });
    };

    const startupTimer = setTimeout(runCheck, SERVICE_ANNOUNCEMENT_STARTUP_DELAY_MS);
    const intervalTimer = setInterval(runCheck, SERVICE_ANNOUNCEMENT_CHECK_INTERVAL_MS);
    // Re-evaluate startsAt / expiresAt between fetches.
    const clockTimer = setInterval(() => {
      setNowMs(Date.now());
    }, MS_PER_MINUTE);
    const scheduler = createOnlineRecoveryScheduler(runCheck);
    const onOnline = () => {
      scheduler.onOnline();
    };
    const onOffline = () => {
      scheduler.onOffline();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      disposed = true;
      clearTimeout(startupTimer);
      clearInterval(intervalTimer);
      clearInterval(clockTimer);
      scheduler.dispose();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const language = i18n.language;
  const visible = useMemo(() => {
    const dismissed = new Set(dismissedIds);
    return announcements
      .filter((a) => !dismissed.has(a.id) && isServiceAnnouncementInWindow(a, nowMs))
      .map((a): VisibleServiceAnnouncement => {
        const text = resolveServiceAnnouncementText(a, language);
        const item: VisibleServiceAnnouncement = {
          id: a.id,
          severity: a.severity,
          title: text.title,
          body: text.body,
        };
        if (a.url) {
          item.url = a.url;
          if (text.urlLabel) item.urlLabel = text.urlLabel;
        }
        return item;
      });
  }, [announcements, dismissedIds, nowMs, language]);

  const dismiss = useCallback((id: string) => {
    setDismissedIds(dismissServiceAnnouncementId(id));
  }, []);

  const openUrl = useCallback((url: string) => {
    void window.electronAPI.serviceAnnouncements.openUrl(url).catch((e: unknown) => {
      console.debug('[serviceAnnouncements] open link failed ' + errLikeToLogString(e));
    });
  }, []);

  return { visible, dismiss, openUrl };
}
