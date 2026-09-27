export type AnnouncePoliteness = 'polite' | 'assertive';

export const APP_ANNOUNCER_ASSERTIVE_ID = 'app-announcer';
export const APP_ANNOUNCER_POLITE_ID = 'app-announcer-polite';

/** Screen readers skip a live region whose text is set to the same value twice. */
const REANNOUNCE_DELAY_MS = 50;
const ANNOUNCED_TEXT_MAX_CHARS = 200;

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Write `text` to the App-level live region (`#app-announcer` / `#app-announcer-polite`). */
export function announce(text: string, politeness: AnnouncePoliteness = 'polite'): void {
  const id = politeness === 'assertive' ? APP_ANNOUNCER_ASSERTIVE_ID : APP_ANNOUNCER_POLITE_ID;
  const region = document.getElementById(id);
  if (!region) return;
  const prior = pendingTimers.get(id);
  if (prior) clearTimeout(prior);
  region.textContent = '';
  pendingTimers.set(
    id,
    setTimeout(() => {
      pendingTimers.delete(id);
      region.textContent = text;
    }, REANNOUNCE_DELAY_MS),
  );
}

export function truncateForAnnouncement(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length > ANNOUNCED_TEXT_MAX_CHARS
    ? `${trimmed.slice(0, ANNOUNCED_TEXT_MAX_CHARS - 1)}…`
    : trimmed;
}

export interface AnnouncedMessage {
  sender: string;
  text: string;
}

export interface BatchedMessageAnnouncerOptions {
  windowMs: number;
  formatOne: (message: AnnouncedMessage) => string;
  formatMany: (count: number) => string;
  announce?: (text: string) => void;
}

export interface BatchedMessageAnnouncer {
  push: (messages: readonly AnnouncedMessage[]) => void;
  dispose: () => void;
}

/**
 * Announces the first burst immediately, then at most once per `windowMs`; messages that
 * arrive inside the window collapse into one "N new messages" line.
 */
export function createBatchedMessageAnnouncer(
  opts: BatchedMessageAnnouncerOptions,
): BatchedMessageAnnouncer {
  const say =
    opts.announce ??
    ((text: string) => {
      announce(text, 'polite');
    });
  let pending: AnnouncedMessage[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const emit = (batch: readonly AnnouncedMessage[]) => {
    if (batch.length === 0) return;
    say(batch.length === 1 ? opts.formatOne(batch[0]) : opts.formatMany(batch.length));
  };

  const startWindow = () => {
    timer = setTimeout(() => {
      timer = null;
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      emit(batch);
      startWindow();
    }, opts.windowMs);
  };

  return {
    push(messages) {
      if (messages.length === 0) return;
      if (timer == null) {
        emit(messages);
        startWindow();
        return;
      }
      pending = [...pending, ...messages];
    },
    dispose() {
      if (timer != null) clearTimeout(timer);
      timer = null;
      pending = [];
    },
  };
}
