import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';

import {
  LIVE_TRAFFIC_ARRIVAL_DURATION_MS,
  LiveTrafficAnimationScheduler,
  type LiveTrafficHop,
} from '@/renderer/lib/map/liveTrafficAnimation';
import { liveTrafficPointKey } from '@/renderer/lib/map/liveTrafficGroups';
import {
  LIVE_TRAFFIC_MAX_AGE_MS,
  type LiveTrafficEvent,
  liveTrafficLongitudeNear,
  type LiveTrafficPoint,
  type LiveTrafficSegment,
} from '@/renderer/lib/map/liveTrafficModel';
import { readReduceMotion, subscribeReduceMotion } from '@/renderer/lib/reduceMotionPreference';
import { MS_PER_SECOND } from '@/shared/timeConstants';

export const LIVE_TRAFFIC_MAX_ANIMATIONS = 64;
export const LIVE_TRAFFIC_MAX_FPS = 60;
const MAX_DEVICE_PIXEL_RATIO = 1.5;
export const LIVE_TRAFFIC_MAX_SEGMENTS_PER_GROUP = 128;
const MAX_SEEN_EVENTS = 512;
const MAX_SEEN_POINTS = 16_384;
const MAX_INGRESS_EVENTS = 512;
const HOP_FADE_MS = 468;
const FRESH_EVENT_WINDOW_MS = 10 * MS_PER_SECOND;
const VIEWPORT_MARGIN = 48;

export interface LiveTrafficCanvasProps {
  events: readonly LiveTrafficEvent[];
  paused: boolean;
  /** Remounted views inspect retained reports without replaying traffic received while away. */
  skipInitialAnimation?: boolean;
  /** Frozen view data for inspection; events still consumes live ingress to prevent resume replay. */
  inspectionEvents?: readonly LiveTrafficEvent[];
  selectedId?: string | null;
  speed?: number;
  onSelect?: (id: string) => void;
}

interface PixelPoint {
  x: number;
  y: number;
}

interface ProjectedSegment {
  from: PixelPoint;
  to: PixelPoint;
  visible: boolean;
}

interface PointPulse {
  key: string;
  eventId: string;
  point: LiveTrafficPoint;
  startedAt: number;
}

interface PacketColors {
  line: string;
  outline: string;
}

function pointBetween(from: PixelPoint, to: PixelPoint, progress: number): PixelPoint {
  return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
}

/** Packet identity determines color, so all observed branches remain visually related. */
export function liveTrafficPacketColors(identity: string): PacketColors {
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index += 1) {
    hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619) >>> 0;
  }
  const hue = hash % 360;
  const saturation = 72 + ((hash >>> 8) % 15);
  const lightness = 60 + ((hash >>> 16) % 10);
  return {
    line: `hsl(${hue} ${saturation}% ${lightness}%)`,
    outline: `hsl(${hue} 65% 15%)`,
  };
}

/** A single bounded canvas. Packet metadata remains accessible in the adjacent traffic list. */
export function LiveTrafficCanvas(props: LiveTrafficCanvasProps) {
  const map = useMap();
  const { events, paused, inspectionEvents, selectedId, speed, skipInitialAnimation } = props;
  const controllerRef = useRef<{ update: (next: LiveTrafficCanvasProps) => void } | null>(null);

  useEffect(() => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.dataset.liveTraffic = 'true';
    Object.assign(canvas.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '450',
    });
    map.getContainer().appendChild(canvas);

    const scheduler = new LiveTrafficAnimationScheduler({
      maxFlights: LIVE_TRAFFIC_MAX_ANIMATIONS,
    });
    let current: LiveTrafficCanvasProps = { events: [], paused: false };
    let points: PointPulse[] = [];
    let selected: LiveTrafficEvent | undefined;
    let reducedSnapshot: LiveTrafficEvent | undefined;
    const colors = new Map<string, PacketColors>();
    const seenPoints = new Map<string, { keys: Set<string>; lastPresent: number }>();
    let seenPointCount = 0;
    const projected = new Map<string, ProjectedSegment>();
    const projectedPoints = new Map<string, PixelPoint>();
    let cachedFlights = scheduler.flights;
    let cachedPoints = points;
    let selectedGeometry: { segments: ProjectedSegment[]; points: PixelPoint[] } | null = null;
    let width = 0;
    let height = 0;
    let frame: number | null = null;
    let lastFrame = -Infinity;
    let animationNow = 0;
    let lastClock = performance.now();
    let wasHidden = document.hidden;
    let observedSince = skipInitialAnimation ? Date.now() : -Infinity;
    const motionQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    let reducedMotion = readReduceMotion() || (motionQuery?.matches ?? false);

    function clock(now: number) {
      const rate = Number.isFinite(current.speed) ? Math.max(0.25, Math.min(4, current.speed!)) : 1;
      animationNow += Math.max(0, now - lastClock) * rate;
      lastClock = now;
      return animationNow;
    }

    function canAnimate() {
      return !current.paused && !document.hidden && !reducedMotion;
    }

    function cancelFrame() {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
    }

    function inView(point: PixelPoint) {
      return (
        point.x >= -VIEWPORT_MARGIN &&
        point.x <= width + VIEWPORT_MARGIN &&
        point.y >= -VIEWPORT_MARGIN &&
        point.y <= height + VIEWPORT_MARGIN
      );
    }

    function projectPoint(point: LiveTrafficPoint) {
      return map.latLngToContainerPoint([
        point.lat,
        liveTrafficLongitudeNear(point.lon, map.getCenter().lng),
      ]);
    }

    function projectSegment(segment: LiveTrafficSegment): ProjectedSegment {
      // Keep a dateline hop short, then place both ends in the nearest world copy.
      const destinationLongitude = liveTrafficLongitudeNear(segment.to.lon, segment.from.lon);
      const midpoint = (segment.from.lon + destinationLongitude) / 2;
      const shift = liveTrafficLongitudeNear(midpoint, map.getCenter().lng) - midpoint;
      const from = map.latLngToContainerPoint([segment.from.lat, segment.from.lon + shift]);
      const to = map.latLngToContainerPoint([segment.to.lat, destinationLongitude + shift]);
      return {
        from,
        to,
        visible:
          Math.max(from.x, to.x) >= -VIEWPORT_MARGIN &&
          Math.min(from.x, to.x) <= width + VIEWPORT_MARGIN &&
          Math.max(from.y, to.y) >= -VIEWPORT_MARGIN &&
          Math.min(from.y, to.y) <= height + VIEWPORT_MARGIN,
      };
    }

    function invalidateProjection() {
      projected.clear();
      projectedPoints.clear();
      selectedGeometry = null;
    }

    function circle(point: PixelPoint, radius: number, fill = false) {
      context!.beginPath();
      context!.arc(point.x, point.y, radius, 0, Math.PI * 2);
      if (fill) context!.fill();
      else context!.stroke();
    }

    function line(from: PixelPoint, to: PixelPoint) {
      context!.beginPath();
      context!.moveTo(from.x, from.y);
      context!.lineTo(to.x, to.y);
      context!.stroke();
    }

    function drawStatic(event: LiveTrafficEvent, emphasis: boolean) {
      selectedGeometry ??= {
        segments: event.segments.slice(-LIVE_TRAFFIC_MAX_SEGMENTS_PER_GROUP).map(projectSegment),
        points: event.points.slice(-LIVE_TRAFFIC_MAX_SEGMENTS_PER_GROUP).map(projectPoint),
      };
      context!.strokeStyle = colors.get(event.id)!.line;
      context!.fillStyle = context!.strokeStyle;
      context!.globalAlpha = emphasis ? 0.5 : 0.3;
      context!.lineWidth = emphasis ? 1.5 : 1;
      for (const segment of selectedGeometry.segments) {
        if (segment.visible) line(segment.from, segment.to);
      }
      for (const point of selectedGeometry.points) {
        if (inView(point)) circle(point, emphasis ? 4 : 3);
      }
    }

    function drawArrival(point: PixelPoint, elapsed: number, color: string) {
      if (elapsed < 0 || elapsed >= LIVE_TRAFFIC_ARRIVAL_DURATION_MS || !inView(point)) return;
      const seconds = elapsed / MS_PER_SECOND;
      context!.strokeStyle = color;
      context!.lineWidth = 1;
      context!.globalAlpha = Math.max(0, 0.9 - seconds * 1.15);
      circle(point, 2 + seconds * 58);
      context!.globalAlpha = Math.max(0, 0.95 - seconds * 1.35);
      circle(point, 6 + seconds * 20);
    }

    function drawHop(hop: LiveTrafficHop, geometry: ProjectedSegment, now: number) {
      if (!geometry.visible || now < hop.startedAt) return;
      const palette = colors.get(hop.eventId)!;
      const progress = Math.min(1, (now - hop.startedAt) / (hop.endsAt - hop.startedAt));
      const age = now - hop.endsAt;
      const head = pointBetween(geometry.from, geometry.to, progress);
      const opacity = age < 0 ? 0.9 : Math.max(0, 1 - age / HOP_FADE_MS) * 0.9;
      if (opacity > 0) {
        // Reveal the traveled portion only. The wider stroke is a low-alpha contrail, not a blur.
        context!.strokeStyle = palette.line;
        context!.globalAlpha = opacity * 0.2;
        context!.lineWidth = 6;
        line(geometry.from, head);
        context!.globalAlpha = opacity;
        context!.lineWidth = 2;
        line(geometry.from, head);
      }
      if (age < 0) {
        context!.globalAlpha = 1;
        context!.fillStyle = palette.line;
        circle(head, 3.5, true);
        context!.strokeStyle = palette.outline;
        context!.lineWidth = 1.5;
        circle(head, 3.5);
      }
      drawArrival(geometry.to, age, palette.line);
    }

    function prune(now: number) {
      scheduler.prune(now);
      if (points.some((pulse) => now - pulse.startedAt >= LIVE_TRAFFIC_ARRIVAL_DURATION_MS))
        points = points.filter((pulse) => now - pulse.startedAt < LIVE_TRAFFIC_ARRIVAL_DURATION_MS);
      if (cachedFlights !== scheduler.flights) {
        cachedFlights = scheduler.flights;
        const hopKeys = new Set(cachedFlights.map((hop) => hop.key));
        for (const key of projected.keys()) if (!hopKeys.has(key)) projected.delete(key);
      }
      if (cachedPoints !== points) {
        cachedPoints = points;
        const pointKeys = new Set(points.map((pulse) => pulse.key));
        for (const key of projectedPoints.keys())
          if (!pointKeys.has(key)) projectedPoints.delete(key);
      }
    }

    function draw(now: number) {
      prune(now);
      context!.clearRect(0, 0, width, height);
      // Full geometry is available only through explicit inspection or reduced-motion mode.
      if (selected) drawStatic(selected, true);
      else if (reducedMotion && reducedSnapshot) drawStatic(reducedSnapshot, false);
      let visible = false;
      if (canAnimate()) {
        for (const hop of scheduler.flights) {
          let geometry = projected.get(hop.key);
          if (!geometry) {
            geometry = projectSegment(hop.segment);
            projected.set(hop.key, geometry);
          }
          visible ||= geometry.visible;
          drawHop(hop, geometry, now);
        }
        for (const pulse of points) {
          let geometry = projectedPoints.get(pulse.key);
          if (!geometry) {
            geometry = projectPoint(pulse.point);
            projectedPoints.set(pulse.key, geometry);
          }
          visible ||= inView(geometry);
          drawArrival(geometry, now - pulse.startedAt, colors.get(pulse.eventId)!.line);
        }
      }
      context!.globalAlpha = 1;
      return visible;
    }

    function tick(now: number) {
      frame = null;
      if (!canAnimate()) return;
      if (now - lastFrame < MS_PER_SECOND / LIVE_TRAFFIC_MAX_FPS - 0.5) {
        frame = window.requestAnimationFrame(tick);
        return;
      }
      lastFrame = now;
      if (draw(clock(now))) frame = window.requestAnimationFrame(tick);
    }

    function redraw() {
      if (document.hidden) return;
      cancelFrame();
      if (draw(clock(performance.now())) && canAnimate())
        frame = window.requestAnimationFrame(tick);
    }

    function mapMoved() {
      invalidateProjection();
      redraw();
    }

    function resize() {
      const size = map.getSize();
      width = size.x;
      height = size.y;
      const scale = Math.min(MAX_DEVICE_PIXEL_RATIO, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context!.setTransform(scale, 0, 0, scale, 0, 0);
      context!.lineCap = 'round';
      mapMoved();
    }

    function stopMotion() {
      scheduler.discard();
      points = [];
      cancelFrame();
      invalidateProjection();
    }

    function visibilityChanged() {
      if (wasHidden && !document.hidden) observedSince = Date.now();
      wasHidden = document.hidden;
      stopMotion();
      redraw();
    }

    function motionChanged() {
      const previouslyReduced = reducedMotion;
      reducedMotion = readReduceMotion() || (motionQuery?.matches ?? false);
      if (previouslyReduced && !reducedMotion) observedSince = Date.now();
      stopMotion();
      redraw();
    }

    controllerRef.current = {
      update(next) {
        const now = clock(performance.now());
        const wallNow = Date.now();
        if (current.paused && !next.paused) observedSince = wallNow;
        current = next;
        const incoming = next.events.slice(-MAX_INGRESS_EVENTS);
        const inspection = next.paused && next.inspectionEvents ? next.inspectionEvents : incoming;
        selected = inspection.find((event) => event.id === next.selectedId);
        reducedSnapshot = inspection.at(-1);
        selectedGeometry = null;
        colors.clear();
        for (const event of incoming)
          colors.set(event.id, liveTrafficPacketColors(event.packetHash ?? event.id));
        if (selected)
          colors.set(selected.id, liveTrafficPacketColors(selected.packetHash ?? selected.id));
        if (reducedSnapshot)
          colors.set(
            reducedSnapshot.id,
            liveTrafficPacketColors(reducedSnapshot.packetHash ?? reducedSnapshot.id),
          );
        const visiblePointKeys = new Set<string>();
        for (const event of incoming) {
          if (event.segments.length > 0) continue;
          for (const point of event.points.slice(-LIVE_TRAFFIC_MAX_SEGMENTS_PER_GROUP))
            visiblePointKeys.add(JSON.stringify([event.id, liveTrafficPointKey(point)]));
        }
        points = points.filter((pulse) => visiblePointKeys.has(pulse.key));
        if (!canAnimate()) stopMotion();
        prune(now);
        scheduler.update(
          incoming,
          now,
          wallNow,
          canAnimate(),
          LIVE_TRAFFIC_MAX_ANIMATIONS - points.length,
          observedSince,
        );
        for (const event of incoming) {
          if (event.segments.length > 0) continue;
          const previous = seenPoints.get(event.id);
          const expired = previous && wallNow - previous.lastPresent > LIVE_TRAFFIC_MAX_AGE_MS;
          if (expired) seenPointCount -= previous.keys.size;
          const keys = previous && !expired ? previous.keys : new Set<string>();
          seenPoints.delete(event.id);
          seenPoints.set(event.id, { keys, lastPresent: wallNow });
          for (const point of event.points.slice(-LIVE_TRAFFIC_MAX_SEGMENTS_PER_GROUP)) {
            const key = JSON.stringify([event.id, liveTrafficPointKey(point)]);
            if (keys.has(key)) continue;
            keys.add(key);
            seenPointCount += 1;
            if (
              canAnimate() &&
              event.ts >= wallNow - FRESH_EVENT_WINDOW_MS &&
              event.ts >= observedSince &&
              scheduler.flights.length + points.length < LIVE_TRAFFIC_MAX_ANIMATIONS
            )
              points.push({ key, eventId: event.id, point, startedAt: now });
          }
        }
        while (seenPoints.size > MAX_SEEN_EVENTS || seenPointCount > MAX_SEEN_POINTS) {
          const oldestId = seenPoints.keys().next().value;
          if (oldestId === undefined) break;
          seenPointCount -= seenPoints.get(oldestId)!.keys.size;
          seenPoints.delete(oldestId);
        }
        redraw();
      },
    };
    resize();
    map.on('move zoom', mapMoved);
    map.on('resize', resize);
    document.addEventListener('visibilitychange', visibilityChanged);
    motionQuery?.addEventListener('change', motionChanged);
    const unsubscribeMotion = subscribeReduceMotion(motionChanged);
    return () => {
      controllerRef.current = null;
      cancelFrame();
      map.off('move zoom', mapMoved);
      map.off('resize', resize);
      document.removeEventListener('visibilitychange', visibilityChanged);
      motionQuery?.removeEventListener('change', motionChanged);
      unsubscribeMotion();
      canvas.remove();
    };
  }, [map, skipInitialAnimation]);

  useEffect(() => {
    controllerRef.current?.update({ events, paused, inspectionEvents, selectedId, speed });
  }, [map, events, paused, inspectionEvents, selectedId, speed]);

  return null;
}
