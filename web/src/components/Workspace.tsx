import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Document, Point, Result } from '../model';
import { bounds } from '../geometry/normalize';
import { pathData } from '../geometry/path';
import type { LiveGeometry } from '../geometry/live';
import { placementBounds, selectionBounds, type GeometryEdit } from '../geometry/manipulate';
import { moveDelta, resizeEdit, rotationEdit, screenTransform, pinchCamera, type Camera } from '../geometry/gestures';
import { documentPlacements, placementKey, type CopyRef } from '../geometry/placements';
import { displayLength, unitScale, type DisplayUnit } from '../units';
import './Workspace.css';
import { coordinateGrid } from '../geometry/grid';

type Gesture = {
  backgroundStart?: Point; pointer: number; start: Point;
  copies: { ref: CopyRef; position: Point }[]; delta: Point; anchor: Point;
  transform?: { kind: 'scale' | 'rotate'; pivot: Point; edit?: GeometryEdit };
};

import { colors } from '../colors';
export { colors } from '../colors';

export default function Workspace({ document: doc, result, live, selected, selectedCopies, onSelect, onSelectCopies, onMove, onTransform,
  disabled, optimizing, polygon, onDraw, fitRequest, unit: displayUnit = 'mm', materialWidthFocused = false }: {
  optimizing: boolean; materialWidthFocused?: boolean; unit?: DisplayUnit; fitRequest: number; document: Document; result?: Result;
  live?: LiveGeometry & { sequence: number }; selected: string[]; selectedCopies: CopyRef[];
  onSelect: (copy?: CopyRef, toggle?: boolean) => void;
  onSelectCopies: (copies: CopyRef[]) => void;
  onMove: (positions: { partId: string; copyIndex: number; position: Point }[]) => void | Promise<void>;
  disabled: boolean; onTransform: (edit: GeometryEdit, copies?: CopyRef[]) => void | Promise<void>;
  polygon?: Point[]; onDraw?: (point: Point) => void;
}) {
  const svg = useRef<SVGSVGElement>(null), space = useRef(false);
  const touches = useRef(new Map<number, Point>());
  const pinch = useRef<{ camera: Camera; size: { width: number; height: number }; start: [Point, Point] } | undefined>(undefined);
  const touchDraw = useRef<{ pointer: number; screen: Point; world: Point } | undefined>(undefined);
  const [normalOutlines, setNormalOutlines] = useState(false), [liveOutlines, setLiveOutlines] = useState(true);
  const liveGhost = optimizing && !!live;
  const outlines = liveGhost ? liveOutlines : normalOutlines;
  const setOutlines = liveGhost ? setLiveOutlines : setNormalOutlines;
  useEffect(() => { setLiveOutlines(true); }, [liveGhost]);
  const [snapping, setSnapping] = useState(true), [grid, setGrid] = useState(1), [angleStep, setAngleStep] = useState(15);
  const [size, setSize] = useState({ width: 800, height: 500 });
  const [camera, setCamera] = useState<Camera>({ x: -20, y: -120, w: 220, h: 160 });
  const [marquee,setMarquee]=useState<{pointer:number;start:Point;end:Point}>();
  const [drag, setDrag] = useState<Gesture>(), [pending, setPending] = useState<Gesture>();
  const displayedDrag = drag ?? pending;
  const selection = useMemo(()=>selectionBounds(doc, selected, selectedCopies),[doc,selected,selectedCopies]), unit = Math.max(camera.w / size.width, camera.h / size.height);
  const coordinates = coordinateGrid(camera, size.width, size.height, unitScale(displayUnit));
  const showWidth = materialWidthFocused && Number.isFinite(doc.settings.materialWidthMm) && doc.settings.materialWidthMm > 0;
  const preview = displayedDrag?.transform?.edit, hit = (size.width < 700 ? 22 : 11) * unit;

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(svg.current!);
    return () => observer.disconnect();
  }, []);

  const moved = useMemo(() => new Map(displayedDrag?.copies.map(copy => [placementKey(copy.ref),
    [copy.position[0] + displayedDrag.delta[0], copy.position[1] + displayedDrag.delta[1]] as Point])), [displayedDrag]);
  const placements = useMemo(() => result?.placements ?? documentPlacements(doc), [result, doc]);
  const world = !!result;
  const partPaths = useMemo(() => doc.parts.map(part => pathData([part.outer, ...part.holes])), [doc.parts]);
  const drawings = useMemo(() => {
    const parts = new Map(doc.parts.map((part, index) => [part.id, {part, index}]));
    return placements.slice().reverse().map(placement => {
      const {part, index} = parts.get(placement.partId)!;
      return {...placement, index, path:partPaths[index], outer:part.outer,
        box:bounds(part.outer) as [number,number,number,number], position:[placement.xMm,placement.yMm] as Point};
    });
  }, [placements, doc.parts, partPaths]);

  function fit() {
    const all: Point[] = [];
    for (const drawing of drawings) {
      const radians = drawing.angleDeg * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
      for (const [x, y] of drawing.outer) all.push([drawing.position[0] + x * c - y * s, -drawing.position[1] - (x * s + y * c)]);
    }
    if (world) all.push([0, 0], [result!.usedLengthMm, -doc.settings.materialWidthMm]);
    if (!all.length) return;
    const [x0, y0, x1, y1] = bounds(all), pad = Math.max(x1 - x0, y1 - y0) * .07 + 2;
    setCamera({ x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad });
  }
  // Manual moves and candidate updates preserve the camera. Fit is explicit,
  // and a project switch increments fitRequest even when it has the same part count.
  useEffect(fit, [doc.parts.length, fitRequest]);
  // Align once at solve start / first layout, and after viewport resizing.
  // Normalize the horizontal viewBox to account for SVG aspect-ratio padding.
  useEffect(() => {
    if (!optimizing || !size.width || !size.height) return;
    setCamera(previous => {
      const width = Math.max(previous.w / size.width, previous.h / size.height) * size.width;
      return { ...previous, x: -width * .1, w: width };
    });
  }, [optimizing, world, size.width, size.height]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setDrag(undefined); setMarquee(undefined); touches.current.clear(); pinch.current = undefined; touchDraw.current = undefined; }
      if (event.code === 'Space' && event.target === document.body) { space.current = true; event.preventDefault(); }
    };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') space.current = false; };
    const blur = () => { space.current = false; setDrag(undefined); setMarquee(undefined); touches.current.clear(); pinch.current = undefined; touchDraw.current = undefined; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);

  function point(x: number, y: number): Point {
    const transformed = new DOMPoint(x, y).matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return [transformed.x, transformed.y];
  }
  function zoom(factor: number, at: Point = [camera.x + camera.w / 2, camera.y + camera.h / 2]) {
    const fx = (at[0] - camera.x) / camera.w, fy = (at[1] - camera.y) / camera.h;
    setCamera(previous => previous.w * factor < .01 || previous.w * factor > 1e7 ? previous :
      ({ x: previous.x + fx * previous.w * (1 - factor), y: previous.y + fy * previous.h * (1 - factor),
        w: previous.w * factor, h: previous.h * factor }));
  }
  useEffect(() => {
    const element = svg.current!;
    const wheel = (event: WheelEvent) => { event.preventDefault(); zoom(Math.exp(Math.max(-1, Math.min(1, event.deltaY / 500))), point(event.clientX, event.clientY)); };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [camera]);

  const selectedSet = useMemo(() => new Set(selectedCopies.map(placementKey)), [selectedCopies]);
  const shapes = useMemo(() => drawings.map(drawing => {
    const index = drawing.index, key = placementKey(drawing), active = selectedSet.size ? selectedSet.has(key) : selected.includes(drawing.partId);
    const position = moved.get(key) ?? drawing.position, [x0, y0, x1, y1] = drawing.box;
    const fill = outlines ? 'light-dark(black, white)' : colors[index % colors.length], fillOpacity = outlines ? .1 : 1;
    const stroke = outlines ? (active ? 'var(--accent)' : 'var(--muted)') : active ? 'var(--ink)' :
      `light-dark(#64748b, color-mix(in srgb, ${colors[index % colors.length]} 60%, white))`;
    const strokeWidth = outlines ? (active ? 1.5 : 1) : (active ? 3 : 2);
    const opacity = selected.length && !active ? .5 : 1;
    const transform = `translate(${position[0]} ${-position[1]}) rotate(${-drawing.angleDeg}) scale(1 -1)`;
    return <g key={key} data-preparation-copy={!world ? drawing.copyIndex : undefined} data-placement-key={key} opacity={opacity}
      transform={preview?.kind==='scale' && selected.includes(drawing.partId)
        ? screenTransform(active ? preview : {...preview,pivot:position}) : active ? screenTransform(preview) : undefined}>
      <g data-part={drawing.partId} data-copy-index={drawing.copyIndex} transform={transform}>
        <path d={drawing.path} fillRule="evenodd" fill={fill} fillOpacity={fillOpacity} pointerEvents="all" stroke={stroke}
          strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
        {active && <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="none" stroke="var(--accent)"
          strokeDasharray="4 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
        <title>{doc.parts[index]?.name} · copy {drawing.copyIndex + 1}{active ? ' · selected' : ''}</title>
      </g>
    </g>;
  }), [drawings, selected, selectedSet, preview, moved, outlines, world, doc.parts]);

  return <div className="canvas-wrap">
    <div className="canvas-tools"><details className="cad-snapping"><summary>Snap{snapping ? ' on' : ' off'}</summary><div>
      <label className="checkbox"><input type="checkbox" checked={snapping} onChange={event => setSnapping(event.target.checked)} />Enable snapping</label>
      <label>Grid, {displayUnit}<select value={grid} onChange={event => setGrid(Number(event.target.value))}>{[.1, 1, 5, 10].map(value => <option key={value} value={value}>{displayLength(value, displayUnit)}</option>)}</select></label>
      <label>Angle step<select value={angleStep} onChange={event => setAngleStep(Number(event.target.value))}>{[1, 5, 15, 45, 90].map(value => <option key={value} value={value}>{value}°</option>)}</select></label>
      <small>Hold Alt to bypass. Numeric fields stay exact.</small>
    </div></details><button aria-pressed={outlines} title="Show outlines with a faint fill" onClick={() => setOutlines(!outlines)}>👻 mode</button>
      <button onClick={fit}>Fit</button><button aria-label="Zoom out" onClick={() => zoom(1.25)}>−</button><button aria-label="Zoom in" onClick={() => zoom(.8)}>+</button></div>
    <svg ref={svg} tabIndex={0} className="workspace-svg" aria-label={world ? (live ? 'Live nesting search' : 'Valid nesting result') : 'Preparation drawing'} role="img" data-live-sequence={live?.sequence}
      style={{ '--camera-unit': `${unit}px` } as CSSProperties} viewBox={`${camera.x} ${camera.y} ${camera.w} ${camera.h}`}
      onPointerDown={event => {
        event.currentTarget.focus({preventScroll:true});
        if (event.pointerType === 'touch') {
          if (touches.current.size >= 2) return;
          event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect();
          touches.current.set(event.pointerId, [event.clientX - rect.left, event.clientY - rect.top]); event.currentTarget.setPointerCapture(event.pointerId);
          if (touches.current.size === 2) { pinch.current = { camera, size, start: [...touches.current.values()] as [Point, Point] }; touchDraw.current = undefined; setDrag(undefined); return; }
          if (pinch.current) return;
        }
        if ((event.button !== 0 && event.button !== 1) || drag || pending) return;
        const handle = (event.target as Element).closest('[data-handle]')?.getAttribute('data-handle');
        if (handle && selection && !disabled && event.button === 0 && !space.current) {
          event.preventDefault(); const [x0, y0, x1, y1] = selection;
          const pivot: Point = handle === 'rotate' ? [(x0 + x1) / 2, (y0 + y1) / 2] :
            [handle.includes('e') ? x0 : x1, handle.includes('n') ? y0 : y1];
          const current = point(event.clientX, event.clientY);
          const start: Point = handle === 'rotate' ? [current[0], -current[1]] :
            [handle.includes('e') ? x1 : x0, handle.includes('n') ? y1 : y0];
          setDrag({ pointer: event.pointerId, start, copies: [], delta: [0, 0], anchor: [0, 0],
            transform: { kind: handle === 'rotate' ? 'rotate' : 'scale', pivot } }); event.currentTarget.setPointerCapture(event.pointerId); return;
        }
        const cursor = point(event.clientX, event.clientY), target = (event.target as Element).closest('[data-part]');
        const partId = target?.getAttribute('data-part') ?? undefined, rawCopy = target?.getAttribute('data-copy-index');
        const copyIndex = rawCopy === null || rawCopy === undefined ? NaN : Number(rawCopy);
        const ref = partId && Number.isInteger(copyIndex) ? { partId, copyIndex } : undefined;
        if(event.shiftKey&&!ref&&!polygon&&!disabled&&event.button===0) {
          event.preventDefault();setMarquee({pointer:event.pointerId,start:cursor,end:cursor});event.currentTarget.setPointerCapture(event.pointerId);return;
        }
        const outsideBin = !world || cursor[0] < 0 || cursor[0] > result!.usedLengthMm || cursor[1] > 0 || cursor[1] < -doc.settings.materialWidthMm;
        const pan = space.current || event.button === 1 || (!ref && !polygon && outsideBin);
        if (polygon && !pan) { const p = point(event.clientX, event.clientY); if (event.pointerType === 'touch') touchDraw.current = { pointer: event.pointerId, screen: [event.clientX, event.clientY], world: [p[0], -p[1]] }; else onDraw?.([p[0], -p[1]]); return; }
        if (!pan && event.shiftKey) { onSelect(ref, true); return; }
        if (!pan && (!ref || !selectedSet.has(placementKey(ref)))) onSelect(ref);
        if (pan || (!disabled && ref)) {
          event.preventDefault();
          const refs = pan ? [] : ref && selectedSet.has(placementKey(ref)) ? selectedCopies : ref ? [ref] : [];
          const copies = placements.filter(placement => refs.some(candidate => placementKey(candidate) === placementKey(placement)))
            .map(placement => ({ ref: { partId: placement.partId, copyIndex: placement.copyIndex }, position: [placement.xMm, placement.yMm] as Point }));
          const box = selectionBounds(doc, refs.map(candidate => candidate.partId), refs);
          setDrag({ backgroundStart: pan && !ref && event.button === 0 && !space.current ? [event.clientX, event.clientY] : undefined,
            pointer: event.pointerId, copies, start: point(event.clientX, event.clientY), delta: [0, 0], anchor: box ? [box[0], box[1]] : [0, 0] });
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      }}
      onPointerMove={event => {
        if(marquee?.pointer===event.pointerId){setMarquee({...marquee,end:point(event.clientX,event.clientY)});return;}
        if (touches.current.has(event.pointerId)) {
          const rect = event.currentTarget.getBoundingClientRect(); touches.current.set(event.pointerId, [event.clientX - rect.left, event.clientY - rect.top]);
          if (pinch.current) { if (touches.current.size === 2) setCamera(pinchCamera(pinch.current.camera, pinch.current.size, pinch.current.start, [...touches.current.values()] as [Point, Point])); return; }
          if (touchDraw.current && Math.hypot(event.clientX - touchDraw.current.screen[0], event.clientY - touchDraw.current.screen[1]) > 6) touchDraw.current = undefined;
        }
        if (!drag || event.pointerId !== drag.pointer) return;
        if (drag.transform) {
          const current = point(event.clientX, event.clientY), enabled = snapping && !event.altKey;
          const edit = drag.transform.kind === 'scale' ? resizeEdit(drag.start, [current[0], -current[1]], drag.transform.pivot, enabled ? grid : 0) : rotationEdit(drag.start, [current[0], -current[1]], drag.transform.pivot, enabled ? angleStep : 0);
          setDrag({ ...drag, transform: { ...drag.transform, edit } }); return;
        }
        const current = point(event.clientX, event.clientY), dx = current[0] - drag.start[0], dy = current[1] - drag.start[1];
        if (drag.copies.length) setDrag({ ...drag, delta: moveDelta([drag.start[0], -drag.start[1]], [current[0], -current[1]], drag.anchor, snapping && !event.altKey ? grid : 0) });
        else setCamera({ ...camera, x: camera.x - dx, y: camera.y - dy });
      }}
      onPointerUp={event => {
        if(marquee?.pointer===event.pointerId) {
          const x0=Math.min(marquee.start[0],marquee.end[0]),x1=Math.max(marquee.start[0],marquee.end[0]);
          const y0=-Math.max(marquee.start[1],marquee.end[1]),y1=-Math.min(marquee.start[1],marquee.end[1]);
          onSelectCopies(drawings.filter(copy=>{const b=placementBounds(doc.parts[copy.index],copy);return b[0]>=x0&&b[1]>=y0&&b[2]<=x1&&b[3]<=y1;}).map(({partId,copyIndex})=>({partId,copyIndex})));
          setMarquee(undefined);event.currentTarget.releasePointerCapture(event.pointerId);return;
        }
        touches.current.delete(event.pointerId);
        if (pinch.current) { if (!touches.current.size) pinch.current = undefined; setDrag(undefined); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); return; }
        if (touchDraw.current?.pointer === event.pointerId) { onDraw?.(touchDraw.current.world); touchDraw.current = undefined; }
        if (!drag || event.pointerId !== drag.pointer) return;
        const edit = drag.transform?.edit;
        if (drag.backgroundStart && Math.hypot(event.clientX - drag.backgroundStart[0], event.clientY - drag.backgroundStart[1]) < 3) onSelect();
        const transformed = edit && (edit.kind === 'scale' ? edit.factor !== 1 : edit.degrees !== 0), translated = drag.copies.length && drag.delta.some(value => value !== 0);
        if (transformed || translated) {
          setPending(drag);
          const positions = drag.copies.map(copy => ({ ...copy.ref, position: [copy.position[0] + drag.delta[0], copy.position[1] + drag.delta[1]] as Point }));
          void Promise.resolve(transformed ? onTransform(edit!, selectedCopies) : onMove(positions)).finally(() => setPending(undefined));
        }
        setDrag(undefined); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={event => { touches.current.delete(event.pointerId); if (!touches.current.size) pinch.current = undefined; touchDraw.current = undefined; setDrag(undefined); setMarquee(undefined); }}
      onLostPointerCapture={event => { touches.current.delete(event.pointerId); if (!touches.current.size) pinch.current = undefined; touchDraw.current = undefined; setDrag(undefined); setMarquee(undefined); }}>
      {world && <><rect x="0" y={-doc.settings.materialWidthMm} width={result!.usedLengthMm} height={doc.settings.materialWidthMm} fill={outlines ? 'none' : 'var(--material-fill)'} stroke="var(--secondary)" vectorEffect="non-scaling-stroke" />
        <text x="0" y={-doc.settings.materialWidthMm - 2} fontSize={camera.w / 70} fill="var(--muted)">{(result!.usedLengthMm / unitScale(displayUnit)).toFixed(2)} {displayUnit} × {displayLength(doc.settings.materialWidthMm, displayUnit)} {displayUnit}</text></>}
      {showWidth && <g className="material-width-band" data-material-width-band={doc.settings.materialWidthMm} pointerEvents="none" aria-hidden="true"><rect x={coordinates.left} y={-doc.settings.materialWidthMm} width={size.width * unit} height={doc.settings.materialWidthMm} /><path d={`M${coordinates.left},0h${size.width * unit}M${coordinates.left},${-doc.settings.materialWidthMm}h${size.width * unit}`} vectorEffect="non-scaling-stroke" /></g>}
      <g className="coordinate-grid" aria-hidden="true" pointerEvents="none" data-grid-step={coordinates.major}>{(['minor', 'major', 'origin'] as const).map(kind => <path key={kind} className={kind} fill="none" vectorEffect="non-scaling-stroke" d={[...coordinates.x.filter(t => (t.value === 0 ? 'origin' : t.major ? 'major' : 'minor') === kind).map(t => `M${t.mm},${coordinates.top}v${size.height * unit}`), ...coordinates.y.filter(t => (t.value === 0 ? 'origin' : t.major ? 'major' : 'minor') === kind).map(t => `M${coordinates.left},${-t.mm}h${size.width * unit}`)].join(' ')} />)}</g>
      {shapes}
      {marquee&&<rect data-selection-marquee x={Math.min(marquee.start[0],marquee.end[0])} y={Math.min(marquee.start[1],marquee.end[1])} width={Math.abs(marquee.end[0]-marquee.start[0])} height={Math.abs(marquee.end[1]-marquee.start[1])} fill="var(--accent)" fillOpacity=".12" stroke="var(--accent)" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" pointerEvents="none"/>}
      {showWidth && <g className="material-width-outside" pointerEvents="none" aria-hidden="true"><rect x={coordinates.left} y={coordinates.top} width={size.width * unit} height={Math.max(0, -doc.settings.materialWidthMm - coordinates.top)} /><rect x={coordinates.left} y="0" width={size.width * unit} height={Math.max(0, coordinates.top + size.height * unit)} /></g>}
      {!disabled && !polygon && selection && <g transform={screenTransform(preview)} className="cad-handles">
        <rect x={selection[0] + (drag?.copies.length ? drag.delta[0] : 0)} y={-selection[3] - (drag?.copies.length ? drag.delta[1] : 0)} width={selection[2] - selection[0]} height={selection[3] - selection[1]} fill="none" stroke="var(--accent)" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />
        {!drag?.copies.length && <>{(['sw', 'se', 'nw', 'ne'] as const).map(corner => { const x = corner.includes('e') ? selection[2] : selection[0], y = -(corner.includes('n') ? selection[3] : selection[1]); return <g key={corner} data-handle={corner} style={{ cursor: corner === 'ne' || corner === 'sw' ? 'nesw-resize' : 'nwse-resize' }}><rect x={x - hit} y={y - hit} width={2 * hit} height={2 * hit} fill="transparent" /><rect x={x - 4 * unit} y={y - 4 * unit} width={8 * unit} height={8 * unit} fill="var(--panel)" stroke="var(--accent)" vectorEffect="non-scaling-stroke" /><title>Resize {corner} corner</title></g>; })}
          <g data-handle="rotate" style={{ cursor: 'grab' }}><line x1={(selection[0] + selection[2]) / 2} x2={(selection[0] + selection[2]) / 2} y1={-selection[3]} y2={-selection[3] - 28 * unit} stroke="var(--accent)" vectorEffect="non-scaling-stroke" /><circle cx={(selection[0] + selection[2]) / 2} cy={-selection[3] - 28 * unit} r={hit} fill="transparent" /><circle cx={(selection[0] + selection[2]) / 2} cy={-selection[3] - 28 * unit} r={5 * unit} fill="var(--panel)" stroke="var(--accent)" vectorEffect="non-scaling-stroke" /><title>Rotate selection</title></g></>}
      </g>}
      {world && live && <g transform="scale(1 -1)" pointerEvents="none" aria-label="Overlapping areas">{live.overlaps.map((rings, index) => <path key={index} data-overlap="true" d={pathData(rings)} fillRule="evenodd" fill={outlines ? 'none' : '#e34e4e'} stroke="#c72b36" strokeWidth={outlines ? 2 : 1} vectorEffect="non-scaling-stroke" />)}</g>}
      {polygon && <g transform="scale(1 -1)"><polyline points={polygon.map(p => p.join(',')).join(' ')} fill="none" stroke="#176b58" strokeWidth="2" vectorEffect="non-scaling-stroke" />{polygon.map((p, index) => <circle key={index} cx={p[0]} cy={p[1]} r={camera.w / 250} fill="#176b58" />)}</g>}
    </svg>
    <svg className="coordinate-rulers" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-label={`Coordinate rulers, ${displayUnit}`} role="img"><rect x="0" y="0" width={size.width} height="20" /><rect x="0" y="0" width="20" height={size.height} /><path fill="none" d={[...coordinates.x.map(t => { const x = (t.mm - coordinates.left) / unit; return x < 22 ? '' : `M${x},${t.major ? 14 : 17}V20`; }), ...coordinates.y.map(t => { const y = (-t.mm - coordinates.top) / unit; return y < 22 ? '' : `M${t.major ? 14 : 17},${y}H20`; })].join(' ')} />{coordinates.x.filter(t => t.major).map(t => { const x = (t.mm - coordinates.left) / unit; return x < 22 ? null : <text key={t.value} x={x + 3} y="10" data-axis="x" data-value={t.value}>{t.value}</text>; })}{coordinates.y.filter(t => t.major).map(t => { const y = (-t.mm - coordinates.top) / unit; return y < 22 ? null : <text key={t.value} transform={`translate(10 ${y - 3}) rotate(-90)`} data-axis="y" data-value={t.value}>{t.value}</text>; })}<rect width="20" height="20" /><text x="10" y="12" textAnchor="middle">{displayUnit}</text></svg>
    <p className="canvas-hint">{polygon ? 'Click vertices · Enter to finish · Escape to cancel' : live ? 'Live search · overlapping areas shown in red.' : result ? 'Geometry checked. Select a copy to adjust it.' : 'Select a copy to adjust it. Drag to arrange.'} <span className="preparation-shortcuts"><kbd>R</kbd> next rotation · <kbd>+</kbd>/<kbd>−</kbd> copies</span> <span>Shift-drag to select · drag background to pan · scroll or pinch to zoom</span></p>
  </div>;
}
