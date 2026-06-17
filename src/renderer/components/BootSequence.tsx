import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useReduceMotion } from '@/renderer/lib/icons/iconMotionContext';
import {
  getSignalPulseTheme,
  pickInclusiveOneLinerKey,
} from '@/renderer/lib/signalPulseSplashUtils';

import type { IdentityId, MeshProtocol } from '../lib/types';
import { useConnectionStore } from '../stores/connectionStore';
import { useDeviceStore } from '../stores/deviceStore';
import { useIdentityStore } from '../stores/identityStore';
import { useNodeStore } from '../stores/nodeStore';

export interface BootSequenceProps {
  protocol: MeshProtocol;
  phraseSeed: number;
  identityId: IdentityId | null;
  onComplete?: () => void;
}

const CHAR_MS = 25;
const LINE_GAP_MS = 300;
const FADE_IN_MS = 160;
const PAUSE_BEFORE_ONELINER_MS = 450;
const PAUSE_BEFORE_CURSOR_MS = 50;
const CURSOR_BLINK_MS = 400;
const CURSOR_BLINKS = 2;
const SCAN_LINE_SPACING = 3;
export const REDUCED_MOTION_DURATION_MS = 1000;

const BOOT_FONT_FAMILY = `"JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace`;

export interface BootLine {
  prefix: string;
  message: string;
}

export function buildBootLines(protocol: MeshProtocol, identityId: IdentityId | null): BootLine[] {
  const nodeState = useNodeStore.getState();
  const deviceState = useDeviceStore.getState();
  const connState = useConnectionStore.getState();
  const identityState = useIdentityStore.getState();

  const nodeCount = identityId ? Object.keys(nodeState.nodes[identityId] ?? {}).length : 0;
  const device = identityId ? deviceState.devices[identityId] : undefined;
  const connection = identityId ? connState.connections[identityId] : undefined;
  const identity = identityId ? identityState.identities[identityId] : undefined;

  const hwModel = identity?.hardwareModel;
  const connType = connection?.connectionType;
  const channelCount = device?.channels?.length ?? 0;
  const contactCount = device?.meshcoreContacts?.length ?? 0;
  const selfInfo = device?.meshcoreSelfInfo;

  const lines: BootLine[] = [];
  lines.push({ prefix: '[ OK ]  ', message: 'Booting mesh stack...' });

  const ifaceLabel =
    connType === 'ble'
      ? 'BLE'
      : connType === 'serial'
        ? 'Serial'
        : connType === 'http'
          ? 'HTTP'
          : 'Radio';

  if (protocol === 'meshtastic') {
    lines.push({
      prefix: '[ OK ]  ',
      message: `LoRa: ${hwModel ?? 'radio interface'}`,
    });

    if (channelCount > 0) {
      lines.push({
        prefix: '[ OK ]  ',
        message: `Scanning channels... ${channelCount}`,
      });
    } else {
      lines.push({
        prefix: '[ OK ]  ',
        message: 'Scanning configured channels...',
      });
    }

    if (nodeCount > 0) {
      lines.push({
        prefix: '[ OK ]  ',
        message: `Database: ${nodeCount} ${nodeCount === 1 ? 'node' : 'nodes'} synced`,
      });
    } else {
      lines.push({
        prefix: '[ OK ]  ',
        message: 'Syncing mesh database...',
      });
    }
  } else {
    lines.push({
      prefix: '[ OK ]  ',
      message: `${ifaceLabel} interface ready`,
    });

    if (selfInfo) {
      const freqMhz = (selfInfo.radioFreq / 1_000_000).toFixed(0);
      const bwPart =
        selfInfo.radioBw != null ? ` | BW: ${(selfInfo.radioBw / 1000).toFixed(0)} kHz` : '';
      lines.push({
        prefix: '[ OK ]  ',
        message: `Freq: ${freqMhz} MHz${bwPart}`,
      });
    } else {
      lines.push({
        prefix: '[ OK ]  ',
        message: 'Configuring radio parameters...',
      });
    }

    if (contactCount > 0) {
      lines.push({
        prefix: '[ OK ]  ',
        message: `Contacts: ${contactCount} ${contactCount === 1 ? 'contact' : 'contacts'} loaded`,
      });
    } else {
      lines.push({
        prefix: '[ OK ]  ',
        message: 'Loading contact database...',
      });
    }

    if (nodeCount > 0) {
      lines.push({
        prefix: '[ OK ]  ',
        message: `Routes: ${nodeCount} node${nodeCount !== 1 ? 's' : ''} in mesh`,
      });
    }
  }

  lines.push({ prefix: '[ OK ]  ', message: 'Routes established' });
  lines.push({ prefix: '[ OK ]  ', message: 'Mesh network active' });

  return lines;
}

export interface BootTiming {
  lineStarts: number[];
  lineEnds: number[];
  oneLinerStart: number;
  oneLinerEnd: number;
  cursorStart: number;
  totalMs: number;
}

export function computeTiming(bootLines: BootLine[], oneLinerLen: number): BootTiming {
  if (bootLines.length === 0) {
    const oneLinerStart = PAUSE_BEFORE_ONELINER_MS;
    const oneLinerEnd = oneLinerStart + oneLinerLen * CHAR_MS;
    const cursorStart = oneLinerEnd + PAUSE_BEFORE_CURSOR_MS;
    return {
      lineStarts: [],
      lineEnds: [],
      oneLinerStart,
      oneLinerEnd,
      cursorStart,
      totalMs: cursorStart + CURSOR_BLINKS * CURSOR_BLINK_MS * 2,
    };
  }

  const lineStarts = bootLines.map((_, i) => FADE_IN_MS + i * LINE_GAP_MS);
  const lineEnds = bootLines.map((line, i) => lineStarts[i] + line.message.length * CHAR_MS);
  const oneLinerStart = Math.max(...lineEnds) + PAUSE_BEFORE_ONELINER_MS;
  const oneLinerEnd = oneLinerStart + oneLinerLen * CHAR_MS;
  const cursorStart = oneLinerEnd + PAUSE_BEFORE_CURSOR_MS;
  const totalMs = cursorStart + CURSOR_BLINKS * CURSOR_BLINK_MS * 2;

  return { lineStarts, lineEnds, oneLinerStart, oneLinerEnd, cursorStart, totalMs };
}

export interface BootCanvasLayout {
  fontPx: number;
  font: string;
  lineWidth: number;
  prefixWidth: number;
  maxMsgWidth: number;
  oneLinerWidth: number;
  lineHeight: number;
  startX: number;
  startY: number;
}

export function computeBootCanvasLayout(
  w: number,
  h: number,
  bootLines: BootLine[],
  oneLinerText: string,
  measure: (text: string, font: string) => number,
): BootCanvasLayout {
  let fontPx = Math.max(13, Math.round(Math.min(w, h) * 0.028));
  let font = `600 ${fontPx}px ${BOOT_FONT_FAMILY}`;
  let lineWidth = Math.max(1, fontPx * 0.07);

  const prefixWidth = measure('[ OK ]  ', font);
  const maxMsgWidth = Math.max(0, ...bootLines.map((l) => measure(l.message, font)));
  const maxLineWidth = prefixWidth + maxMsgWidth;
  const maxAllowedWidth = w * 0.8;

  if (maxLineWidth > maxAllowedWidth && maxLineWidth > 0) {
    fontPx = Math.max(10, Math.floor((fontPx * maxAllowedWidth) / maxLineWidth));
    font = `600 ${fontPx}px ${BOOT_FONT_FAMILY}`;
    lineWidth = Math.max(1, fontPx * 0.07);
  }

  const resolvedPrefixWidth = measure('[ OK ]  ', font);
  const resolvedMaxMsgWidth = Math.max(0, ...bootLines.map((l) => measure(l.message, font)));
  const oneLinerWidth = measure(oneLinerText, font);
  const lineHeight = fontPx * 1.7;
  const bootBlockHeight = bootLines.length * lineHeight + lineHeight + fontPx * 2.2;
  const startY = (h - bootBlockHeight) / 2 + fontPx * 1.5;
  const startX = Math.max(
    w * 0.08,
    (w - (resolvedPrefixWidth + resolvedMaxMsgWidth)) / 2 - fontPx * 2,
  );

  return {
    fontPx,
    font,
    lineWidth,
    prefixWidth: resolvedPrefixWidth,
    maxMsgWidth: resolvedMaxMsgWidth,
    oneLinerWidth,
    lineHeight,
    startX,
    startY,
  };
}

function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const maxDim = Math.max(w, h);
  const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, maxDim * 0.55);
  gradient.addColorStop(0, 'rgba(2, 6, 35, 0)');
  gradient.addColorStop(0.7, 'rgba(2, 6, 35, 0)');
  gradient.addColorStop(1, 'rgba(2, 6, 35, 0.55)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

function drawScanLines(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.07)';
  for (let y = 0; y < h; y += SCAN_LINE_SPACING) {
    ctx.fillRect(0, y, w, 1);
  }
  ctx.restore();
}

export default function BootSequence({
  protocol,
  phraseSeed,
  identityId,
  onComplete,
}: BootSequenceProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const layoutRef = useRef<BootCanvasLayout | null>(null);

  const bootLines = useMemo(() => buildBootLines(protocol, identityId), [protocol, identityId]);
  const oneLinerKey = useMemo(() => pickInclusiveOneLinerKey(phraseSeed), [phraseSeed]);
  const oneLinerText = useMemo(() => `> ${t(oneLinerKey)}`, [oneLinerKey, t]);
  const theme = useMemo(() => getSignalPulseTheme(protocol), [protocol]);
  const isReducedMotion = useReduceMotion();

  const timing = useMemo(
    () => computeTiming(bootLines, oneLinerText.length),
    [bootLines, oneLinerText.length],
  );

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: true }) ?? null;

    const syncSize = () => {
      if (!canvas || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      layoutRef.current = computeBootCanvasLayout(w, h, bootLines, oneLinerText, (text, font) => {
        ctx.font = font;
        return ctx.measureText(text).width;
      });
    };

    if (canvas && ctx) {
      syncSize();
      window.addEventListener('resize', syncSize);
    }

    const draw = (elapsed: number) => {
      if (!ctx) return;
      const layout = layoutRef.current;
      if (!layout) return;

      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, w, h);

      ctx.font = layout.font;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = layout.lineWidth;

      const { prefixWidth, oneLinerWidth, lineHeight, startX, startY, fontPx } = layout;

      for (let i = 0; i < bootLines.length; i++) {
        const lineStart = timing.lineStarts[i];
        if (elapsed < lineStart) continue;

        const { prefix, message } = bootLines[i];
        const y = startY + i * lineHeight;
        const revealMs = elapsed - lineStart;
        const charCount = Math.min(message.length, Math.max(0, Math.floor(revealMs / CHAR_MS)));

        const prefixAlpha = Math.min(0.55, (elapsed - lineStart) / FADE_IN_MS);
        ctx.save();
        ctx.strokeStyle = theme.letterStroke(prefixAlpha * 0.6);
        ctx.fillStyle = theme.letterFill(prefixAlpha * 0.6);
        ctx.shadowBlur = 0;
        ctx.strokeText(prefix, startX, y);
        ctx.fillText(prefix, startX, y);
        ctx.restore();

        if (charCount > 0) {
          const revealed = message.slice(0, charCount);
          const msgX = startX + prefixWidth;
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.strokeStyle = theme.letterStroke(1);
          ctx.fillStyle = theme.letterFill(1);
          ctx.shadowBlur = 12;
          ctx.shadowColor = theme.letterGlow(1);
          ctx.strokeText(revealed, msgX, y);
          ctx.fillText(revealed, msgX, y);
          ctx.restore();
        }
      }

      if (elapsed >= timing.oneLinerStart) {
        const revealMs = elapsed - timing.oneLinerStart;
        const charCount = Math.min(
          oneLinerText.length,
          Math.max(0, Math.floor(revealMs / CHAR_MS)),
        );
        const revealed = oneLinerText.slice(0, charCount);
        const oneLinerX = (w - oneLinerWidth) / 2;
        const oneLinerY = startY + bootLines.length * lineHeight + lineHeight;
        const alpha = Math.min(1, revealMs / (CHAR_MS * 4));

        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.strokeStyle = theme.letterStroke(alpha);
        ctx.fillStyle = theme.letterFill(alpha);
        ctx.shadowBlur = 18 + alpha * 14;
        ctx.shadowColor = theme.letterGlow(alpha);
        ctx.strokeText(revealed, oneLinerX, oneLinerY);
        ctx.fillText(revealed, oneLinerX, oneLinerY);
        ctx.restore();

        if (charCount >= oneLinerText.length && elapsed >= timing.cursorStart) {
          const cursorElapsed = elapsed - timing.cursorStart;
          const totalBlinkMs = CURSOR_BLINKS * CURSOR_BLINK_MS * 2;
          if (cursorElapsed < totalBlinkMs) {
            const inBlink = cursorElapsed % (CURSOR_BLINK_MS * 2) < CURSOR_BLINK_MS;
            if (inBlink) {
              const cursorX = oneLinerX + oneLinerWidth + 4;
              ctx.save();
              ctx.globalCompositeOperation = 'screen';
              ctx.fillStyle = theme.letterFill(1);
              ctx.shadowBlur = 10;
              ctx.shadowColor = theme.letterGlow(1);
              ctx.fillRect(cursorX, oneLinerY - fontPx * 0.5, fontPx * 0.55, fontPx * 0.9);
              ctx.restore();
            }
          }
        }
      }

      drawVignette(ctx, w, h);
      drawScanLines(ctx, w, h);
    };

    const drawReduced = (elapsed: number) => {
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, w, h);

      const fontPx = Math.max(16, Math.round(Math.min(w, h) * 0.04));
      ctx.font = `600 ${fontPx}px ${BOOT_FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(1.5, fontPx * 0.07);

      const alpha = Math.min(1, elapsed / 200);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.strokeStyle = theme.letterStroke(alpha);
      ctx.fillStyle = theme.letterFill(alpha);
      ctx.shadowBlur = 20;
      ctx.shadowColor = theme.letterGlow(alpha);
      ctx.strokeText(oneLinerText, w / 2, h / 2);
      ctx.fillText(oneLinerText, w / 2, h / 2);
      ctx.restore();
    };

    const finish = () => {
      if (completedRef.current) return;
      completedRef.current = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      onCompleteRef.current?.();
    };

    if (ctx && canvas) {
      if (isReducedMotion) {
        const tick = (now: number) => {
          if (completedRef.current) return;
          startTimeRef.current ??= now;
          const elapsed = now - startTimeRef.current;
          drawReduced(elapsed);
          if (elapsed >= REDUCED_MOTION_DURATION_MS) {
            finish();
            return;
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } else {
        const tick = (now: number) => {
          if (completedRef.current) return;
          startTimeRef.current ??= now;
          const elapsed = now - startTimeRef.current;
          draw(elapsed);
          if (elapsed >= timing.totalMs) {
            finish();
            return;
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', syncSize);
      if (!completedRef.current) {
        completedRef.current = true;
        onCompleteRef.current?.();
      }
    };
  }, [bootLines, oneLinerText, theme, timing, isReducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[9999]"
    />
  );
}
