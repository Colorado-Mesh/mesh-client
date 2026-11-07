/**
 * Starts the scheduled-broadcast scheduler outside the App entry chunk.
 * Mounted from `main.tsx` so deliver/store edges do not reshuffle App's sync graph.
 */
import { useScheduledBroadcastsStore } from '../../stores/scheduledBroadcastsStore';

export async function bootScheduledBroadcastScheduler(): Promise<() => void> {
  const { getScheduledBroadcastScheduler } = await import('./scheduler');
  const scheduler = getScheduledBroadcastScheduler();

  const refresh = (): void => {
    void scheduler.refresh();
  };

  await scheduler.start();
  window.addEventListener('mesh-client:appSettings', refresh);
  const unsubscribeStore = useScheduledBroadcastsStore.subscribe((state, prev) => {
    if (state.slots !== prev.slots) refresh();
  });
  const offPowerResume = window.electronAPI.onPowerResume(() => {
    void scheduler.onPowerResume();
  });

  return () => {
    window.removeEventListener('mesh-client:appSettings', refresh);
    unsubscribeStore();
    offPowerResume();
    scheduler.stop();
  };
}
