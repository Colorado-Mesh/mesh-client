let sharedAudioContext: AudioContext | null = null;

function getSharedAudioContext(): AudioContext | null {
  try {
    if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
      sharedAudioContext = new AudioContext();
    }
    return sharedAudioContext;
  } catch {
    // catch-no-log-ok: AudioContext unavailable in test/headless environments
    return null;
  }
}

/** @internal Test helper — reset singleton between tests. */
export function resetChatNotificationAudioContextForTests(): void {
  sharedAudioContext = null;
}

export function playMessageNotification(): void {
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch {
    // catch-no-log-ok: AudioContext unavailable in test/headless environments
  }
}
