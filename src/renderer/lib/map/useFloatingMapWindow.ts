import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';

export interface FloatingMapPosition {
  x: number;
  y: number;
}
interface Size {
  width: number;
  height: number;
}

/** Keep the whole window reachable, including when its map or expanded size changes. */
export function clampFloatingMapPosition(
  position: FloatingMapPosition,
  map: Size,
  window: Size,
): FloatingMapPosition {
  const inset = 12;
  const minX = Math.min(inset, Math.max(0, map.width - window.width));
  const minY = Math.min(inset, Math.max(0, map.height - window.height));
  return {
    x: Math.max(minX, Math.min(position.x, map.width - window.width - inset)),
    y: Math.max(minY, Math.min(position.y, map.height - window.height - inset)),
  };
}

export function useFloatingMapWindow(
  mapRef: RefObject<HTMLDivElement | null>,
  windowRef: RefObject<HTMLElement | null>,
  active = true,
) {
  const [position, setPosition] = useState<FloatingMapPosition | null>(null);
  const anchor = useRef<{ x: number; bottom: number } | null>(null);
  const drag = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    origin: FloatingMapPosition;
    current: FloatingMapPosition;
  } | null>(null);

  function bounds(next: FloatingMapPosition): FloatingMapPosition {
    const map = mapRef.current?.getBoundingClientRect();
    const window = windowRef.current?.getBoundingClientRect();
    return map && window ? clampFloatingMapPosition(next, map, window) : next;
  }

  function currentPosition(): FloatingMapPosition {
    const map = mapRef.current?.getBoundingClientRect();
    const window = windowRef.current?.getBoundingClientRect();
    return map && window
      ? { x: window.left - map.left, y: window.top - map.top }
      : { x: 12, y: 12 };
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const origin = currentPosition();
    drag.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      origin,
      current: origin,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const next = bounds({
      x: active.origin.x + event.clientX - active.clientX,
      y: active.origin.y + event.clientY - active.clientY,
    });
    active.current = next;
    // Position the floating window directly while dragging; the map and packet renderer do not
    // need a React render for every pointer movement. Commit once when the gesture ends.
    if (windowRef.current)
      Object.assign(windowRef.current.style, {
        left: `${next.x}px`,
        top: `${next.y}px`,
        right: 'auto',
        bottom: 'auto',
      });
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    anchor.current = {
      x: active.current.x,
      bottom: active.current.y + (windowRef.current?.getBoundingClientRect().height ?? 0),
    };
    setPosition(active.current);
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 30 : 10;
    const offsets: Partial<Record<string, FloatingMapPosition>> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    event.stopPropagation();
    const current = position ?? currentPosition();
    const next = bounds({ x: current.x + offset.x, y: current.y + offset.y });
    anchor.current = {
      x: next.x,
      bottom: next.y + (windowRef.current?.getBoundingClientRect().height ?? 0),
    };
    setPosition(next);
  }

  useEffect(() => {
    if (!active) drag.current = null;
    const map = mapRef.current;
    const window = windowRef.current;
    if (!active || !map || !window || !position || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (drag.current) return;
      const size = window.getBoundingClientRect();
      const mapSize = map.getBoundingClientRect();
      if (size.width === 0 || size.height === 0 || mapSize.width === 0 || mapSize.height === 0)
        return;
      // The bottom edge is the dock anchor: expansion grows up, collapse returns to its bar.
      // Temporary clamping does not overwrite the anchor, so resizing can restore its place.
      const desired = anchor.current
        ? { x: anchor.current.x, y: anchor.current.bottom - size.height }
        : position;
      const next = clampFloatingMapPosition(desired, mapSize, size);
      setPosition((current) => (current?.x === next.x && current.y === next.y ? current : next));
    });
    observer.observe(map);
    observer.observe(window);
    return () => {
      observer.disconnect();
    };
  }, [mapRef, windowRef, position, active]);

  function reset() {
    drag.current = null;
    anchor.current = null;
    if (windowRef.current)
      Object.assign(windowRef.current.style, { left: '', top: '', right: '', bottom: '' });
    setPosition(null);
  }

  return { position, onPointerDown, onPointerMove, onPointerUp, onKeyDown, reset };
}
