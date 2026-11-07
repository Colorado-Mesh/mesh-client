import { useEffect, useRef } from 'react';

export interface UseScheduledBroadcastSchedulerOptions {
  /** MeshCore runtime room post (`meshcorePanelActions.sendRoomPost`). */
  sendRoomPost?: (roomNodeId: number, text: string) => Promise<void>;
}

/**
 * Registers MeshCore room-post delivery with the scheduled-broadcast runner.
 * The scheduler itself boots from `main.tsx` (`bootScheduledBroadcastScheduler`) so
 * deliver/store edges stay out of the App entry chunk.
 */
export function useScheduledBroadcastScheduler(
  options: UseScheduledBroadcastSchedulerOptions = {},
): void {
  const sendRoomPostRef = useRef(options.sendRoomPost);

  useEffect(() => {
    sendRoomPostRef.current = options.sendRoomPost;
  });

  useEffect(() => {
    let cancelled = false;
    void import('../lib/scheduledBroadcasts/deliveryAdapters').then(
      ({ setScheduledBroadcastDeliveryAdapters }) => {
        if (cancelled) return;
        setScheduledBroadcastDeliveryAdapters({
          sendRoomPost: (roomNodeId, text) => {
            const send = sendRoomPostRef.current;
            if (!send) return Promise.reject(new Error('MeshCore room post unavailable'));
            return send(roomNodeId, text);
          },
        });
      },
    );
    return () => {
      cancelled = true;
      void import('../lib/scheduledBroadcasts/deliveryAdapters').then(
        ({ clearScheduledBroadcastDeliveryAdapters }) => {
          clearScheduledBroadcastDeliveryAdapters();
        },
      );
    };
  }, []);
}
