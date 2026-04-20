import { useEffect, useRef } from 'react';

export interface SignalPropagationProps {
  /** Called once when the wave radius exceeds the viewport diagonal (plus glow padding). */
  onComplete?: () => void;
}

const DURATION_MS = 2200;
const REVEAL_TEXT = 'Colorado Mesh';

/**
 * Full-screen canvas pulse from the top-left (0, 0). Animation state lives in refs + rAF only.
 */
export default function SignalPropagation({ onComplete }: SignalPropagationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef<number | null>(null);
  const maxRadiusRef = useRef(1);
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);

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
      glow.addColorStop(0, 'rgba(0, 255, 0, 0)');
      glow.addColorStop(0.42, 'rgba(120, 255, 140, 0.045)');
      glow.addColorStop(0.52, 'rgba(200, 255, 200, 0.1)');
      glow.addColorStop(0.62, 'rgba(120, 255, 140, 0.04)');
      glow.addColorStop(1, 'rgba(0, 255, 0, 0)');
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
        ctx.strokeStyle = 'rgba(0, 255, 0, 0.2)';
        ctx.lineWidth = 32;
        ctx.shadowBlur = 48;
        ctx.shadowColor = 'rgba(0, 255, 0, 0.35)';
        ctx.stroke();
        ctx.restore();
      }

      // Primary ring: Meshtastic green + glow.
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(0, radiusCssPx), 0, Math.PI * 2);
      ctx.strokeStyle = '#00FF00';
      ctx.lineWidth = 3.5;
      ctx.shadowBlur = 32;
      ctx.shadowColor = '#66ff66';
      ctx.stroke();
      ctx.restore();

      // Per-letter reveal: each glyph appears only after the wave front passes its own position.
      const cx = w * 0.5;
      const cy = h * 0.5;
      const fontPx = Math.max(20, Math.round(Math.min(w, h) * 0.04));
      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${fontPx}px "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace`;
      ctx.globalCompositeOperation = 'screen';
      ctx.lineWidth = Math.max(1.5, fontPx * 0.07);
      const fullW = ctx.measureText(REVEAL_TEXT).width;
      let x = cx - fullW / 2;
      for (const ch of REVEAL_TEXT) {
        const chW = ctx.measureText(ch).width;
        const chCx = x + chW * 0.5;
        const chDist = Math.hypot(chCx, cy);
        const passedByPx = radiusCssPx - chDist;
        // Quick pop when crossed, then smooth fade.
        const rise = Math.min(1, Math.max(0, passedByPx / 46));
        const fade = Math.max(0, 1 - Math.max(0, passedByPx) / 440);
        const letterAlpha = rise * fade;
        if (letterAlpha > 0.01) {
          ctx.strokeStyle = `rgba(2, 18, 8, ${Math.min(0.78, letterAlpha * 0.8)})`;
          ctx.fillStyle = `rgba(130, 255, 150, ${Math.min(0.95, letterAlpha)})`;
          ctx.shadowBlur = 14 + letterAlpha * 18;
          ctx.shadowColor = `rgba(80, 255, 110, ${Math.min(0.75, letterAlpha * 0.85)})`;
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
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[9999]"
    />
  );
}
