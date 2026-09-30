import type { OurPosition } from '../lib/gpsSource';
import { useLocationTrust } from '../lib/ourPositionReference';
import { useLocationPromptStore } from '../stores/locationPromptStore';
import SetLocationCard from './SetLocationCard';

interface StartupLocationPromptProps {
  ourPosition: OurPosition | null | undefined;
  /** Active protocol runs LoRa distance diagnostics (capability-gated by the caller). */
  enabled: boolean;
  onLocationChanged?: () => void;
}

/**
 * Non-blocking strip above the active panel asking where this computer is when the radio has
 * no GPS. Shows on every launch until confirmed or dismissed; hides once the radio reports a fix.
 */
export default function StartupLocationPrompt({
  ourPosition,
  enabled,
  onLocationChanged,
}: StartupLocationPromptProps) {
  const trust = useLocationTrust(ourPosition);
  const positionResolved = useLocationPromptStore((s) => s.positionResolved);
  const dismissed = useLocationPromptStore((s) => s.dismissedThisSession);
  const dismissForSession = useLocationPromptStore((s) => s.dismissForSession);

  if (!enabled || !positionResolved || dismissed || trust === 'trusted') return null;

  return (
    <div className="border-ink-700 border-b px-4 py-2">
      <SetLocationCard
        ourPosition={ourPosition}
        trust={trust}
        variant="startup"
        onLocationChanged={onLocationChanged}
        onDismiss={dismissForSession}
      />
    </div>
  );
}
