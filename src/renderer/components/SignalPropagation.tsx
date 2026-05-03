import { useEffect, useMemo, useRef } from 'react';

import type { MeshProtocol } from '../lib/types';

export interface SignalPropagationProps {
  /** Active protocol — drives pulse accent (Meshtastic green vs MeshCore cyan). */
  protocol: MeshProtocol;
  /** Stable integer per pulse (e.g. timestamp) to pick which one-liner to reveal. */
  phraseSeed: number;
  /** Called once when the wave radius exceeds the viewport diagonal (plus glow padding). */
  onComplete?: () => void;
}

/** Time for the ring to expand from the origin to the viewport edge (same as original). */
const DURATION_MS = 2200;
/**
 * Fraction of the radial sweep [0,1] before the left→right text fade begins, so glyphs
 * linger after the ring passes before the readout-style wipe runs.
 */
const WIPE_DELAY_FRAC = 0.44;
/** Soft band width (CSS px) for the moving vertical fade edge (wider = gentler per glyph). */
const WIPE_SOFT_PX = 132;

/** Ease-in: fade edge creeps slowly across the phrase so each part stays readable longer. */
export function easeReadoutWipe(linear01: number): number {
  const x = Math.min(1, Math.max(0, linear01));
  return x ** 1.85;
}

/** Short, inclusive phrases shown when the collapsed sidebar logo triggers the pulse. */
export const INCLUSIVE_ONE_LINERS = [
  'Stay on the air',
  'Hello, operator',
  'Thanks for meshing',
  'Built for communities everywhere',
  'Stay connected',
  'Signals out',
  'Glad you are here',
  'Keep the mesh alive',
] as const;

export function pickInclusiveOneLiner(seed: number): string {
  const n = INCLUSIVE_ONE_LINERS.length;
  const idx = ((seed % n) + n) % n;
  return INCLUSIVE_ONE_LINERS[idx];
}

export interface SignalPulseTheme {
  illuminationStops: [number, string][];
  trailStroke: string;
  trailShadow: string;
  ringStroke: string;
  ringShadow: string;
  letterStroke: (alpha: number) => string;
  letterFill: (alpha: number) => string;
  letterGlow: (alpha: number) => string;
}

/** Smoothstep on [lo, hi]; returns 0 below lo, 1 above hi. Exported for tests. */
export function smoothstepEdge(lo: number, hi: number, x: number): number {
  if (hi === lo) return x >= hi ? 1 : 0;
  const t = (x - lo) / (hi - lo);
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
}

/**
 * Left→right “radar readout” fade: dimming sweeps along +x through the phrase.
 * wipeProgress is 0 (no wipe) … 1 (full phrase past the fade edge).
 */
export function horizontalReadoutFade(
  chCx: number,
  textLeft: number,
  fullW: number,
  wipeProgress: number,
  softPx: number,
): number {
  const edge = textLeft - softPx * 2 + wipeProgress * (fullW + softPx * 5);
  return smoothstepEdge(edge - softPx, edge + softPx, chCx);
}

export function getSignalPulseTheme(protocol: MeshProtocol): SignalPulseTheme {
  if (protocol === 'meshcore') {
    return {
      illuminationStops: [
        [0, 'rgba(34, 211, 238, 0)'],
        [0.42, 'rgba(34, 211, 238, 0.045)'],
        [0.52, 'rgba(165, 243, 252, 0.1)'],
        [0.62, 'rgba(34, 211, 238, 0.04)'],
        [1, 'rgba(34, 211, 238, 0)'],
      ],
      trailStroke: 'rgba(34, 211, 238, 0.2)',
      trailShadow: 'rgba(34, 211, 238, 0.35)',
      ringStroke: '#22d3ee',
      ringShadow: '#67e8f9',
      letterStroke: (a) => `rgba(8, 25, 35, ${Math.min(0.78, a * 0.8)})`,
      letterFill: (a) => `rgba(165, 243, 252, ${Math.min(0.95, a)})`,
      letterGlow: (a) => `rgba(103, 232, 249, ${Math.min(0.75, a * 0.85)})`,
    };
  }
  return {
    illuminationStops: [
      [0, 'rgba(0, 255, 0, 0)'],
      [0.42, 'rgba(120, 255, 140, 0.045)'],
      [0.52, 'rgba(200, 255, 200, 0.1)'],
      [0.62, 'rgba(120, 255, 140, 0.04)'],
      [1, 'rgba(0, 255, 0, 0)'],
    ],
    trailStroke: 'rgba(0, 255, 0, 0.2)',
    trailShadow: 'rgba(0, 255, 0, 0.35)',
    ringStroke: '#00FF00',
    ringShadow: '#66ff66',
    letterStroke: (a) => `rgba(2, 18, 8, ${Math.min(0.78, a * 0.8)})`,
    letterFill: (a) => `rgba(130, 255, 150, ${Math.min(0.95, a)})`,
    letterGlow: (a) => `rgba(80, 255, 110, ${Math.min(0.75, a * 0.85)})`,
  };
}

/**
 * Full-screen canvas pulse from the top-left (0, 0). Animation state lives in refs + rAF only.
 */
export default function SignalPropagation({
  protocol,
  phraseSeed,
  onComplete,
}: SignalPropagationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef<number | null>(null);
  const maxRadiusRef = useRef(1);
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);

  const revealText = useMemo(() => pickInclusiveOneLiner(phraseSeed), [phraseSeed]);
  const theme = useMemo(() => getSignalPulseTheme(protocol), [protocol]);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const syncSize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const bw = Math.max(1, Math.floor(w * dpr));
      const bh = Math.max(1, Math.floor(h * dpr));
      canvas.width = bw;
      canvas.height = bh;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      maxRadiusRef.current = Math.hypot(w, h) + 96;
    };

    syncSize();

    const onResize = () => {
      syncSize();
    };
    window.addEventListener('resize', onResize);

    const draw = (radiusCssPx: number) => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Illumination: brief brightening as the wave front passes (radial band from origin).
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const innerG = Math.max(0, radiusCssPx - 140);
      const outerG = radiusCssPx + 120;
      const glow = ctx.createRadialGradient(0, 0, innerG, 0, 0, outerG);
      for (const [stop, color] of theme.illuminationStops) {
        glow.addColorStop(stop, color);
      }
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      // Trail: wider, softer ring slightly inside the leading edge (decay behind the pulse).
      const trailR = radiusCssPx - 22;
      if (trailR > 1) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.beginPath();
        ctx.arc(0, 0, trailR, 0, Math.PI * 2);
        ctx.strokeStyle = theme.trailStroke;
        ctx.lineWidth = 32;
        ctx.shadowBlur = 48;
        ctx.shadowColor = theme.trailShadow;
        ctx.stroke();
        ctx.restore();
      }

      // Primary ring + glow.
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(0, radiusCssPx), 0, Math.PI * 2);
      ctx.strokeStyle = theme.ringStroke;
      ctx.lineWidth = 3.5;
      ctx.shadowBlur = 32;
      ctx.shadowColor = theme.ringShadow;
      ctx.stroke();
      ctx.restore();

      // Per-letter reveal: each glyph appears only after the wave front passes its own position.
      const cx = w * 0.5;
      const cy = h * 0.5;
      let fontPx = Math.max(20, Math.round(Math.min(w, h) * 0.04));
      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${fontPx}px "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace`;
      ctx.globalCompositeOperation = 'screen';
      ctx.lineWidth = Math.max(1.5, fontPx * 0.07);

      let fullW = ctx.measureText(revealText).width;
      const maxTextW = w * 0.88;
      if (fullW > maxTextW && fullW > 0) {
        fontPx = Math.max(14, Math.floor((fontPx * maxTextW) / fullW));
        ctx.font = `600 ${fontPx}px "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace`;
        ctx.lineWidth = Math.max(1.5, fontPx * 0.07);
        fullW = ctx.measureText(revealText).width;
      }

      const maxR = maxRadiusRef.current;
      const sweepProgress = maxR > 0 ? radiusCssPx / maxR : 0;
      let wipeLinear = 0;
      if (sweepProgress > WIPE_DELAY_FRAC) {
        wipeLinear = (sweepProgress - WIPE_DELAY_FRAC) / (1 - WIPE_DELAY_FRAC);
      }
      const wipeProgress = wipeLinear <= 0 ? 0 : easeReadoutWipe(wipeLinear);

      const textLeft = cx - fullW / 2;
      let x = textLeft;
      for (const ch of revealText) {
        const chW = ctx.measureText(ch).width;
        const chCx = x + chW * 0.5;
        const chDist = Math.hypot(chCx, cy);
        const passedByPx = radiusCssPx - chDist;
        // Radial reveal from the sweep origin.
        const rise = Math.min(1, Math.max(0, passedByPx / 46));
        // Fade sweeps left→right along the baseline (radar readout), not by radius from corner.
        const fadeHoriz = horizontalReadoutFade(chCx, textLeft, fullW, wipeProgress, WIPE_SOFT_PX);
        const letterAlpha = rise * fadeHoriz;
        if (letterAlpha > 0.01) {
          ctx.strokeStyle = theme.letterStroke(letterAlpha);
          ctx.fillStyle = theme.letterFill(letterAlpha);
          ctx.shadowBlur = 14 + letterAlpha * 18;
          ctx.shadowColor = theme.letterGlow(letterAlpha);
          ctx.strokeText(ch, x, cy);
          ctx.fillText(ch, x, cy);
        }
        x += chW;
      }
      ctx.restore();
    };

    const finish = () => {
      if (completedRef.current) return;
      completedRef.current = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      onCompleteRef.current?.();
    };

    const tick = (now: number) => {
      if (completedRef.current) return;

      startTimeRef.current ??= now;

      const t = now - startTimeRef.current;
      const maxR = maxRadiusRef.current;
      const u = Math.min(1, t / DURATION_MS);
      // Ease-out so the leading edge stays crisp near the end.
      const eased = 1 - (1 - u) * (1 - u);
      const radiusCssPx = eased * maxR;

      draw(radiusCssPx);

      if (radiusCssPx >= maxR - 0.5) {
        finish();
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', onResize);
      if (!completedRef.current) {
        completedRef.current = true;
        onCompleteRef.current?.();
      }
    };
  }, [phraseSeed, protocol, revealText, theme]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[9999]"
    />
  );
}
