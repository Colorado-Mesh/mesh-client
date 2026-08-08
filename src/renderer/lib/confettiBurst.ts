/**
 * Lightweight canvas confetti burst — no external deps.
 *
 * Ported in spirit from Ratspeak's `dashboard/static/js/confetti.js` (`rsConfetti`):
 * a fixed, full-viewport, pointer-transparent canvas that fires a short particle
 * burst and removes itself when done. Single-flight so overlapping calls (e.g. a
 * rapid win + re-render) cannot stack canvases.
 *
 * Skips entirely when the user prefers reduced motion (app setting via the
 * `data-reduce-motion` document flag, or OS `prefers-reduced-motion`).
 */

export interface ConfettiBurstOptions {
  /** Origin x in viewport px. Defaults to horizontal center. */
  x?: number;
  /** Origin y in viewport px. Defaults to ~upper third (h / 2.4). */
  y?: number;
  /** Particle colors (CSS color strings). Defaults to theme greens + accents. */
  colors?: string[];
  /** Particle count (clamped 10..80). Default 40. */
  count?: number;
  /** Lifetime in ms (clamped 600..4000). Default 1600. */
  duration?: number;
}

const COUNT_MIN = 10;
const COUNT_MAX = 80;
const COUNT_DEFAULT = 40;
const DURATION_MIN = 600;
const DURATION_MAX = 4000;
const DURATION_DEFAULT = 1600;

const GRAVITY = 0.18;
const DRAG = 0.992;
const CANVAS_Z_INDEX = 10_000;

let active = false;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
  shape: 0 | 1;
}

/** Clamp requested particle count into the safe range. */
export function clampConfettiCount(count: number | undefined): number {
  const n = typeof count === 'number' && Number.isFinite(count) ? count : COUNT_DEFAULT;
  return Math.max(COUNT_MIN, Math.min(COUNT_MAX, Math.round(n)));
}

/** Clamp requested duration (ms) into the safe range. */
export function clampConfettiDuration(duration: number | undefined): number {
  const ms =
    typeof duration === 'number' && Number.isFinite(duration) ? duration : DURATION_DEFAULT;
  return Math.max(DURATION_MIN, Math.min(DURATION_MAX, Math.round(ms)));
}

/** True when motion should be suppressed (app reduce-motion flag or OS preference). */
export function shouldSkipConfetti(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.dataset.reduceMotion === 'true') {
    return true;
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    } catch {
      // catch-no-log-ok matchMedia can throw in restricted/test environments
    }
  }
  return false;
}

/** Resolve default palette from theme CSS custom properties, with hard fallbacks. */
function resolveColors(custom: string[] | undefined): string[] {
  if (custom && custom.length > 0) return custom.slice();
  const fallback = ['#86efac', '#15803d', '#0e9aa7', '#d4a72c', '#ffffff'];
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
    return fallback;
  }
  try {
    const cs = getComputedStyle(document.documentElement);
    const pick = (name: string, fb: string): string => {
      const v = cs.getPropertyValue(name).trim();
      return v.length > 0 ? v : fb;
    };
    return [
      pick('--color-brand-green', '#86efac'),
      pick('--color-readable-green', '#15803d'),
      pick('--color-bright-green', '#9ae6b4'),
      '#d4a72c',
      '#ffffff',
    ];
  } catch {
    // catch-no-log-ok getComputedStyle unavailable; use fallback palette
    return fallback;
  }
}

/** True while a burst is animating (test/introspection helper). */
export function isConfettiActive(): boolean {
  return active;
}

/**
 * Fire a one-shot confetti burst. No-op when reduced motion is preferred, when a
 * burst is already in flight, or when no canvas 2D context is available.
 */
export function burstConfetti(opts: ConfettiBurstOptions = {}): void {
  if (active) return;
  if (typeof document === 'undefined') return;
  if (typeof requestAnimationFrame !== 'function') return;
  if (shouldSkipConfetti()) return;

  const w = typeof window !== 'undefined' ? window.innerWidth : 0;
  const h = typeof window !== 'undefined' ? window.innerHeight : 0;
  if (w <= 0 || h <= 0) return;

  const count = clampConfettiCount(opts.count);
  const duration = clampConfettiDuration(opts.duration);
  const colors = resolveColors(opts.colors);
  const originX = typeof opts.x === 'number' && Number.isFinite(opts.x) ? opts.x : w / 2;
  const originY = typeof opts.y === 'number' && Number.isFinite(opts.y) ? opts.y : h / 2.4;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.style.cssText = `position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:${CANVAS_Z_INDEX};`;
  canvas.setAttribute('aria-hidden', 'true');

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  document.body.appendChild(canvas);
  active = true;

  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.PI * 2 * (i / count) + (Math.random() - 0.5) * 0.6;
    const speed = 4 + Math.random() * 5;
    particles.push({
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 3,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      size: 6 + Math.random() * 5,
      color: colors[i % colors.length],
      shape: (i % 2) as 0 | 1,
    });
  }

  const startedAt = performance.now();

  const frame = (now: number): void => {
    const elapsed = now - startedAt;
    const life = 1 - elapsed / duration;
    if (life <= 0) {
      canvas.parentNode?.removeChild(canvas);
      active = false;
      return;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = Math.max(0, Math.min(1, life * 1.2));
    for (const p of particles) {
      p.vx *= DRAG;
      p.vy = p.vy * DRAG + GRAVITY;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 0) {
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}
