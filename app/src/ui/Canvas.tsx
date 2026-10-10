import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Box } from '../project/layout';

type ViewBox = [x: number, y: number, width: number, height: number];
export type CanvasView = {
  /** World units per screen pixel, for strokes, badges and patterns of constant screen size. */
  upp: number;
};

/** A world box (y up) as an SVG box (y down), padded and stretched to the element's aspect ratio. */
function fitBox(box: Box, element: { width: number; height: number }, padding: number): ViewBox {
  const width = Math.max(box[2] - box[0], 1e-6);
  const height = Math.max(box[3] - box[1], 1e-6);
  const aspect = element.width / Math.max(element.height, 1);
  let w = width * (1 + 2 * padding);
  let h = height * (1 + 2 * padding);
  if (w / h < aspect) w = h * aspect;
  else h = w / aspect;
  const cx = (box[0] + box[2]) / 2;
  const cy = -(box[1] + box[3]) / 2;
  return [cx - w / 2, cy - h / 2, w, h];
}

/**
 * A pannable, zoomable drawing in world coordinates (millimetres, y up). Children draw with
 * `toScreen` coordinates: x as is, y negated. Drag to pan, scroll to zoom.
 */
export function Canvas({
  extent,
  focus,
  label,
  toolbar,
  overlay,
  onBackgroundClick,
  children,
}: {
  extent: Box;
  /** Zoom to this box whenever `key` changes. */
  focus?: { box: Box; key: string };
  label: string;
  toolbar?: ReactNode;
  overlay?: ReactNode;
  onBackgroundClick?: () => void;
  children: (view: CanvasView) => ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [view, setView] = useState<ViewBox>(() => fitBox(extent, size, 0.08));
  const drag = useRef<{ x: number; y: number; view: ViewBox; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback(() => setView(fitBox(extent, size, 0.08)), [extent, size]);
  const extentKey = extent.join(',');
  // Refit when the drawing or the element changes size.
  useEffect(fit, [extentKey, size.width, size.height]);

  useEffect(() => {
    if (!focus) return;
    const [x0, y0, x1, y1] = focus.box;
    // Frame the focused item with room around it, so its neighbours stay in view.
    const grow = Math.max(x1 - x0, y1 - y0) * 1.2;
    setView(fitBox([x0 - grow, y0 - grow, x1 + grow, y1 + grow], size, 0));
  }, [focus?.key]);

  const upp = view[2] / Math.max(size.width, 1);

  function zoom(factor: number, clientX?: number, clientY?: number) {
    const rect = container.current!.getBoundingClientRect();
    const fx = clientX === undefined ? 0.5 : (clientX - rect.left) / rect.width;
    const fy = clientY === undefined ? 0.5 : (clientY - rect.top) / rect.height;
    setView(([x, y, w, h]) => {
      const nw = w * factor;
      const nh = h * factor;
      return [x + (w - nw) * fx, y + (h - nh) * fy, nw, nh];
    });
  }

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    // A non-passive listener, so scrolling over the canvas zooms instead of scrolling the page.
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom(
        Math.exp(event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0015)),
        event.clientX,
        event.clientY,
      );
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);

  function down(event: ReactPointerEvent) {
    if (event.button !== 0 && event.button !== 1) return;
    drag.current = { x: event.clientX, y: event.clientY, view, moved: false };
  }
  function move(event: ReactPointerEvent) {
    const state = drag.current;
    if (!state) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.moved && Math.hypot(dx, dy) < 4) return;
    if (!state.moved) (event.currentTarget as Element).setPointerCapture(event.pointerId);
    state.moved = true;
    const scale = state.view[2] / size.width;
    setView([state.view[0] - dx * scale, state.view[1] - dy * scale, state.view[2], state.view[3]]);
  }
  function up() {
    suppressClick.current = !!drag.current?.moved;
    drag.current = null;
  }

  return (
    <section className="canvas" aria-label={label}>
      <div className="canvas-toolbar">
        {toolbar}
        <span className="spacer" />
        <button className="small" onClick={fit}>
          Fit
        </button>
        <button className="small" aria-label="Zoom out" onClick={() => zoom(1.25)}>
          −
        </button>
        <button className="small" aria-label="Zoom in" onClick={() => zoom(0.8)}>
          +
        </button>
      </div>
      <div
        ref={container}
        className="canvas-surface"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            event.stopPropagation();
            suppressClick.current = false;
          }
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget || (event.target as Element).tagName === 'svg')
            onBackgroundClick?.();
        }}
      >
        <svg viewBox={view.join(' ')} preserveAspectRatio="none" role="img" aria-label={label}>
          {children({ upp })}
        </svg>
        {overlay}
      </div>
    </section>
  );
}

/** SVG path data for rings in world coordinates, shifted by an offset and flipped to screen. */
export function ringsPath(rings: [number, number][][], dx = 0, dy = 0): string {
  return rings
    .map((ring) => `M${ring.map(([x, y]) => `${x + dx},${-(y + dy)}`).join('L')}Z`)
    .join('');
}
