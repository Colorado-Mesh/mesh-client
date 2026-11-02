import {
  type CSSProperties,
  type InputEvent as ReactInputEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { emojiUnicodeFromEvent } from '@/renderer/lib/emojiPickerEvent';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { isReactionPickerEmojiGlyph, reactionGlyphFromPicker } from '@/renderer/lib/reactions';

export interface UseReactionPickerOptions<T> {
  /** Called once with the chosen emoji for the line the picker was opened on. */
  onPick: (glyph: string, target: T) => void;
  /** Puts focus back where typing belongs (the composer) after the picker closes. */
  restoreFocus?: () => void;
}

export interface ReactionPickerHiddenInputProps {
  ref: RefObject<HTMLInputElement | null>;
  /** Set while idle; `open` removes it before focusing the input and `close` puts it back. */
  'aria-hidden': true;
  'aria-label': string;
  tabIndex: -1;
  style: CSSProperties;
  onInput: (event: ReactInputEvent<HTMLInputElement>) => void;
  onBlur: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
}

export interface ReactionPicker<T> {
  /** Linux shows an inline `<emoji-picker>`; macOS and Windows open the OS emoji panel. */
  inline: boolean;
  /** Line the inline picker is open for; always null off Linux. */
  inlineTarget: T | null;
  open: (target: T) => void;
  close: (opts?: { restoreFocus?: boolean }) => void;
  /** Callback ref for the inline `<emoji-picker>` element. */
  inlinePickerRef: (el: HTMLElement | null) => void;
  /** Spread onto one visually hidden `<input>`; the OS emoji panel types into it. */
  hiddenInputProps: ReactionPickerHiddenInputProps;
}

const HIDDEN_INPUT_STYLE: CSSProperties = {
  position: 'absolute',
  opacity: 0,
  width: 0,
  height: 0,
  pointerEvents: 'none',
};

/**
 * Emoji reaction picker shared by chat surfaces. The OS panel cannot report which line it
 * was opened for, so the target is held in a ref until the emoji arrives.
 */
export function useReactionPicker<T>({
  onPick,
  restoreFocus,
}: UseReactionPickerOptions<T>): ReactionPicker<T> {
  const { t } = useTranslation();
  // OS-specific: only Linux lacks a system emoji panel that Electron can open.
  const [inline] = useState(() => window.electronAPI.getPlatform() === 'linux');
  const [inlineTarget, setInlineTarget] = useState<T | null>(null);
  const hiddenInputRef = useRef<HTMLInputElement | null>(null);
  const targetRef = useRef<T | null>(null);
  const pendingRef = useRef(false);
  const onPickRef = useRef(onPick);
  const restoreFocusRef = useRef(restoreFocus);
  useEffect(() => {
    onPickRef.current = onPick;
    restoreFocusRef.current = restoreFocus;
  }, [onPick, restoreFocus]);

  const close = useCallback((opts?: { restoreFocus?: boolean }) => {
    pendingRef.current = false;
    targetRef.current = null;
    setInlineTarget(null);
    const el = hiddenInputRef.current;
    if (el) {
      el.value = '';
      el.blur();
      el.setAttribute('aria-hidden', 'true');
    }
    if (opts?.restoreFocus) restoreFocusRef.current?.();
  }, []);

  const deliver = useCallback(
    (unicode: string) => {
      const target = targetRef.current;
      if (!pendingRef.current || target === null) return;
      const parsed = reactionGlyphFromPicker(unicode);
      if (!parsed || !isReactionPickerEmojiGlyph(parsed.glyph)) return;
      close({ restoreFocus: true });
      onPickRef.current(parsed.glyph, target);
    },
    [close],
  );

  const open = useCallback(
    (target: T) => {
      targetRef.current = target;
      pendingRef.current = true;
      if (inline) {
        setInlineTarget(target);
        return;
      }
      // Focus first so a keyboard-opened panel types into the capture input too. A focused
      // element must not be aria-hidden, so the input is exposed by name until close().
      const el = hiddenInputRef.current;
      el?.removeAttribute('aria-hidden');
      el?.focus();
      void window.electronAPI.showEmojiPanel().catch((e: unknown) => {
        console.debug('[useReactionPicker] showEmojiPanel failed ' + errLikeToLogString(e));
      });
    },
    [inline],
  );

  const inlineCleanupRef = useRef<(() => void) | null>(null);
  const inlinePickerRef = useCallback(
    (el: HTMLElement | null) => {
      inlineCleanupRef.current?.();
      inlineCleanupRef.current = null;
      if (!el) return;
      const handler = (event: Event) => {
        const unicode = emojiUnicodeFromEvent(event);
        if (unicode) deliver(unicode);
      };
      el.addEventListener('emoji-click', handler);
      inlineCleanupRef.current = () => {
        el.removeEventListener('emoji-click', handler);
      };
    },
    [deliver],
  );

  // The OS panel closing without a pick hands focus back to the window.
  useEffect(() => {
    const onWindowFocus = () => {
      if (pendingRef.current && !inline) close({ restoreFocus: true });
    };
    window.addEventListener('focus', onWindowFocus);
    return () => {
      window.removeEventListener('focus', onWindowFocus);
    };
  }, [close, inline]);

  useEffect(() => {
    if (inlineTarget === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close({ restoreFocus: true });
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [close, inlineTarget]);

  const onInput = useCallback(
    (event: ReactInputEvent<HTMLInputElement>) => {
      const value = event.currentTarget.value;
      event.currentTarget.value = '';
      if (value) deliver(value);
    },
    [deliver],
  );

  const onBlur = useCallback(() => {
    if (pendingRef.current) close();
  }, [close]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (!pendingRef.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close({ restoreFocus: true });
        return;
      }
      // Typing a letter means the user went back to writing; let it land in the composer.
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (!isReactionPickerEmojiGlyph(event.key)) close({ restoreFocus: true });
      }
    },
    [close],
  );

  return {
    inline,
    inlineTarget,
    open,
    close,
    inlinePickerRef,
    hiddenInputProps: {
      ref: hiddenInputRef,
      'aria-hidden': true,
      'aria-label': t('chatPanel.addReaction'),
      tabIndex: -1,
      style: HIDDEN_INPUT_STYLE,
      onInput,
      onBlur,
      onKeyDown,
    },
  };
}
