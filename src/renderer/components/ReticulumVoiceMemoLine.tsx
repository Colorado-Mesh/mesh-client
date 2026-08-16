import { Pause, Play } from 'lucide-react-motion';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { computeWaveformFromOgg } from '@/renderer/lib/reticulum/computeWaveform';

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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  // Fetch bytes and decode
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await window.electronAPI.chat.readReticulumAttachmentBytes(attachmentPath);
        if (cancelled || !res.dataBase64) return;
        const waveform = await computeWaveformFromOgg(res.dataBase64, BAR_COUNT);
        if (cancelled) return;
        if (waveform) {
          setBars(waveform.bars);
          setResolvedDuration((prev) => (prev > 0 ? prev : waveform.durationSec));
        }
        // Build object URL for audio element
        const binary = atob(res.dataBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'audio/ogg' });
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        if (audioRef.current) {
          audioRef.current.src = url;
        }
      } catch {
        // catch-no-log-ok: attachment may be absent or path jailed — show error state
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [attachmentPath]);

  // RAF progress updater
  const updateProgress = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentSec(audio.currentTime);
    if (!audio.paused) {
      rafRef.current = requestAnimationFrame(updateProgress);
    }
  };

  const handlePlayPause = () => {
    const audio = audioRef.current;
    if (!audio || loadError) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || loadError || !resolvedDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * resolvedDuration;
    setCurrentSec(audio.currentTime);
  };

  const playedRatio = resolvedDuration > 0 ? Math.min(1, currentSec / resolvedDuration) : 0;
  const displaySec = playing ? currentSec : resolvedDuration;
  const modeLabel = audioMode === 16 ? 'Opus' : undefined;

  return (
    <div
      className="mt-1 flex min-w-0 items-center gap-2 rounded border border-gray-700/80 bg-slate-900/60 px-2 py-1.5"
      aria-label={t('chatPanel.voiceMemo.containerAria')}
    >
      {/* Playback uses Web Audio via the element; captions N/A for short voice memos. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- voice memo clip, not captioned media */}
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => {
          setPlaying(true);
          rafRef.current = requestAnimationFrame(updateProgress);
        }}
        onPause={() => {
          setPlaying(false);
          if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        }}
        onEnded={() => {
          setPlaying(false);
          setCurrentSec(0);
          if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        }}
      />

      {/* Play / Pause */}
      <button
        type="button"
        aria-label={
          playing ? t('chatPanel.voiceMemo.pauseAria') : t('chatPanel.voiceMemo.playAria')
        }
        onClick={handlePlayPause}
        disabled={loadError}
        className="shrink-0 rounded p-1 text-gray-300 hover:bg-slate-700 hover:text-white disabled:opacity-40"
      >
        {playing ? (
          <Pause aria-hidden className="h-4 w-4" size={16} />
        ) : (
          <Play aria-hidden className="h-4 w-4" size={16} />
        )}
      </button>

      {/* Waveform + seek */}
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
          const audio = audioRef.current;
          if (!audio || !resolvedDuration) return;
          if (e.key === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 2);
          if (e.key === 'ArrowRight')
            audio.currentTime = Math.min(resolvedDuration, audio.currentTime + 2);
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

      {/* Duration */}
      <span className="min-w-[3rem] shrink-0 text-right text-xs text-gray-400 tabular-nums">
        {formatDuration(displaySec)}
        {modeLabel ? <span className="ml-1 text-[10px] text-gray-500">{modeLabel}</span> : null}
      </span>
    </div>
  );
}
