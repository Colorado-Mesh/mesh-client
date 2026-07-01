import { useCallback, useEffect, useRef, useState } from 'react';

export interface SvgPanZoomView {
  scale: number;
  x: number;
  y: number;
}

const MIN_SCALE = 0.35;
const MAX_SCALE = 3;
const ZOOM_SENSITIVITY = 0.0012;
const DEFAULT_VIEW: SvgPanZoomView = { scale: 1, x: 0, y: 0 };

export function useSvgPanZoom(initial: SvgPanZoomView = DEFAULT_VIEW) {
  const initialRef = useRef(initial);

  useEffect(() => {
    initialRef.current = initial;
  }, [initial]);

  const [view, setView] = useState<SvgPanZoomView>(() => ({ ...initial }));
  const elementRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });

  const resetView = useCallback(() => {
    setView({ ...initialRef.current });
  }, []);

  const handleWheel = useCallback((e: WheelEvent) => {
    const el = elementRef.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const delta = -e.deltaY * ZOOM_SENSITIVITY;
    setView((prev) => {
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * (1 + delta)));
      const ratio = nextScale / prev.scale;
      return {
        scale: nextScale,
        x: px - ratio * (px - prev.x),
        y: py - ratio * (py - prev.y),
      };
    });
  }, []);

  const bindSvgRef = useCallback(
    (el: SVGSVGElement | null) => {
      if (elementRef.current) {
        elementRef.current.removeEventListener('wheel', handleWheel);
      }
      elementRef.current = el;
      if (el) {
        el.addEventListener('wheel', handleWheel, { passive: false });
      }
    },
    [handleWheel],
  );

  useEffect(() => {
    return () => {
      elementRef.current?.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY, active: true };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    dragRef.current = { x: e.clientX, y: e.clientY, active: true };
    setView((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    dragRef.current.active = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const transform = `translate(${view.x},${view.y}) scale(${view.scale})`;

  return {
    view,
    transform,
    resetView,
    bindSvgRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
