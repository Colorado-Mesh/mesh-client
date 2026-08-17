import { Pause, Play } from 'lucide-react-motion';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { computeWaveform, computeWaveformFromOgg } from '@/renderer/lib/reticulum/computeWaveform';

const BAR_COUNT = 40;
const BAR_MIN_HEIGHT = 2;

export interface ReticulumVoiceMemoLineProps {
  /** Local on-disk path of the jailed OggS audio file. */
  attachmentPath: string;
  /** Known duration in seconds (from ingest; may be 0 before decode). */
  durationSec?: number;
  /** LXMF audio mode (16 = AM_OPUS_OGG). */
  audioMode?: number;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(1, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Play/pause/seek for a cached LXMF voice memo.
 * Uses Web Audio (`decodeAudioData`) — Chromium's `<audio>` element is unreliable
 * for our Ratspeak-parity Ogg/Opus mux, and the plan targets decodeAudioData playback.
 */
export function ReticulumVoiceMemoLine({
  attachmentPath,
  durationSec = 0,
  audioMode,
}: Readonly<ReticulumVoiceMemoLineProps>) {
  const { t } = useTranslation();
  const [bars, setBars] = useState<number[]>(new Array<number>(BAR_COUNT).fill(0));
  const [resolvedDuration, setResolvedDuration] = useState(durationSec);
  const [playing, setPlaying] = useState(false);
  const [currentSec, setCurrentSec] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [ready, setReady] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startedAtRef = useRef(0);
  const offsetRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    bufferRef.current = null;

    void (async () => {
      try {
        const res = await window.electronAPI.chat.readReticulumAttachmentBytes(attachmentPath);
        if (cancelled) return;
        if (!res.dataBase64) {
          setLoadError(true);
          setReady(false);
          return;
        }
        const waveform = await computeWaveformFromOgg(res.dataBase64, BAR_COUNT);
        if (cancelled) return;

        const binary = atob(res.dataBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const buffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
        if (cancelled) {
          void ctx.close();
          return;
        }
        bufferRef.current = buffer;
        setLoadError(false);
        setResolvedDuration((prev) => (prev > 0 ? prev : buffer.duration));
        if (waveform) {
          setBars(waveform.bars);
        } else {
          setBars(computeWaveform(buffer.getChannelData(0), BAR_COUNT));
        }
        setReady(true);
      } catch {
        // catch-no-log-ok: attachment may be absent, jailed, or undecodable
        if (!cancelled) {
          setLoadError(true);
          setReady(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      try {
        sourceRef.current?.stop();
      } catch {
        // catch-no-log-ok: source may already be stopped
      }
      sourceRef.current = null;
      const ctx = audioCtxRef.current;
      audioCtxRef.current = null;
      bufferRef.current = null;
      if (ctx) void ctx.close();
    };
  }, [attachmentPath]);

  const stopProgress = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const tickProgress = () => {
    const ctx = audioCtxRef.current;
    const buffer = bufferRef.current;
    if (!ctx || !buffer) return;
    const elapsed = ctx.currentTime - startedAtRef.current + offsetRef.current;
    setCurrentSec(Math.min(buffer.duration, Math.max(0, elapsed)));
    if (sourceRef.current) {
      rafRef.current = requestAnimationFrame(tickProgress);
    }
  };

  const stopSource = (preserveOffset: boolean) => {
    stopProgress();
    const ctx = audioCtxRef.current;
    if (preserveOffset && ctx && sourceRef.current) {
      offsetRef.current = Math.min(
        bufferRef.current?.duration ?? offsetRef.current,
        Math.max(0, ctx.currentTime - startedAtRef.current + offsetRef.current),
      );
    }
    try {
      sourceRef.current?.stop();
    } catch {
      // catch-no-log-ok: source may already be stopped
    }
    sourceRef.current = null;
    setPlaying(false);
  };

  const startFromOffset = (offset: number) => {
    const ctx = audioCtxRef.current;
    const buffer = bufferRef.current;
    if (!ctx || !buffer || loadError) return;
    stopSource(false);
    offsetRef.current = Math.max(0, Math.min(buffer.duration, offset));
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      if (sourceRef.current !== source) return;
      sourceRef.current = null;
      offsetRef.current = 0;
      setCurrentSec(0);
      setPlaying(false);
      stopProgress();
    };
    startedAtRef.current = ctx.currentTime;
    sourceRef.current = source;
    source.start(0, offsetRef.current);
    setPlaying(true);
    rafRef.current = requestAnimationFrame(tickProgress);
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
  };

  const handlePlayPause = () => {
    if (!ready || loadError || !bufferRef.current) return;
    if (playing) {
      stopSource(true);
      setCurrentSec(offsetRef.current);
      return;
    }
    startFromOffset(offsetRef.current);
  };

  const seekToRatio = (ratio: number) => {
    if (!ready || loadError || !resolvedDuration) return;
    const next = Math.max(0, Math.min(1, ratio)) * resolvedDuration;
    setCurrentSec(next);
    if (playing) {
      startFromOffset(next);
    } else {
      offsetRef.current = next;
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seekToRatio((e.clientX - rect.left) / rect.width);
  };

  const playedRatio = resolvedDuration > 0 ? Math.min(1, currentSec / resolvedDuration) : 0;
  const displaySec = playing ? currentSec : resolvedDuration;
  const modeLabel = audioMode === 16 ? 'Opus' : undefined;

  return (
    <div
      className="mt-1 flex min-w-0 items-center gap-2 rounded border border-gray-700/80 bg-slate-900/60 px-2 py-1.5"
      aria-label={t('chatPanel.voiceMemo.containerAria')}
    >
      <button
        type="button"
        aria-label={
          playing ? t('chatPanel.voiceMemo.pauseAria') : t('chatPanel.voiceMemo.playAria')
        }
        onClick={handlePlayPause}
        disabled={loadError || !ready}
        className="shrink-0 rounded p-1 text-gray-300 hover:bg-slate-700 hover:text-white disabled:opacity-40"
      >
        {playing ? (
          <Pause aria-hidden className="h-4 w-4" size={16} />
        ) : (
          <Play aria-hidden className="h-4 w-4" size={16} />
        )}
      </button>

      <div
        role="slider"
        aria-label={t('chatPanel.voiceMemo.seekAria')}
        aria-valuemin={0}
        aria-valuemax={Math.round(resolvedDuration)}
        aria-valuenow={Math.round(currentSec)}
        tabIndex={0}
        className="flex h-8 flex-1 cursor-pointer items-end gap-px"
        onClick={handleSeek}
        onKeyDown={(e) => {
          if (!resolvedDuration) return;
          if (e.key === 'ArrowLeft') seekToRatio((currentSec - 2) / resolvedDuration);
          if (e.key === 'ArrowRight') seekToRatio((currentSec + 2) / resolvedDuration);
        }}
      >
        {bars.map((height, i) => {
          const played = i / BAR_COUNT < playedRatio;
          return (
            <div
              key={i}
              aria-hidden
              className={`w-1 min-w-0 rounded-sm transition-colors ${
                played ? 'bg-readable-green' : 'bg-gray-600'
              }`}
              style={{ height: `${Math.max(BAR_MIN_HEIGHT, Math.round(height * 28))}px` }}
            />
          );
        })}
      </div>

      <span className="min-w-[3rem] shrink-0 text-right text-xs text-gray-400 tabular-nums">
        {formatDuration(displaySec)}
        {modeLabel ? <span className="ml-1 text-[10px] text-gray-500">{modeLabel}</span> : null}
      </span>
    </div>
  );
}
