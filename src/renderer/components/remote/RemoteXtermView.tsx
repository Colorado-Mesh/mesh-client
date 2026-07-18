import '@xterm/xterm/css/xterm.css';

import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';

import { useRnshSessionStore } from '@/renderer/stores/rnshSessionStore';

export interface RemoteXtermViewProps {
  sessionId: string;
  /** Hidden tabs stay mounted (keep-alive scrollback) but skip fit() while offscreen. */
  hidden?: boolean;
  readOnly?: boolean;
  onInputBase64: (base64Data: string) => void;
  onResize: (rows: number, cols: number) => void;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary);
}

/** One rnsh session's terminal — xterm instance persists across tab switches via `hidden`. */
export function RemoteXtermView({
  sessionId,
  hidden,
  readOnly,
  onInputBase64,
  onResize,
}: Readonly<RemoteXtermViewProps>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Session mounts as connecting (readOnly=true) then flips to active without remounting —
  // keep refs so onData/onResize see the latest values without re-creating the Terminal.
  const readOnlyRef = useRef(readOnly);
  const onInputBase64Ref = useRef(onInputBase64);
  const onResizeRef = useRef(onResize);

  useEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);
  useEffect(() => {
    onInputBase64Ref.current = onInputBase64;
  }, [onInputBase64]);
  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      theme: { background: '#0b0f14' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {
      // catch-no-log-ok container may have zero size while hidden on first mount
    }

    const dataDisposable = term.onData((data) => {
      if (readOnlyRef.current) return;
      onInputBase64Ref.current(bytesToBase64(new TextEncoder().encode(data)));
    });
    const resizeDisposable = term.onResize(({ rows, cols }) => {
      onResizeRef.current(rows, cols);
    });

    const unsubscribe = useRnshSessionStore.getState().subscribeOutput(sessionId, (chunk) => {
      term.write(chunk.data);
    });

    return () => {
      dataDisposable.dispose();
      resizeDisposable.dispose();
      unsubscribe();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId]);

  const fitNow = () => {
    try {
      fitRef.current?.fit();
    } catch {
      // catch-no-log-ok layout not yet settled (e.g. tab still hidden)
    }
  };

  useEffect(() => {
    if (hidden) return;
    const raf = requestAnimationFrame(fitNow);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [hidden]);

  useEffect(() => {
    window.addEventListener('resize', fitNow);
    return () => {
      window.removeEventListener('resize', fitNow);
    };
  }, []);

  return (
    <div
      className="h-full w-full min-w-0 bg-[#0b0f14] p-2"
      hidden={hidden}
      data-testid={`remote-xterm-${sessionId}`}
    >
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
