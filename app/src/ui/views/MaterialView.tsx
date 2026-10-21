import { useMemo } from 'react';
import { arrangeMaterial, MATERIAL_PEEK, type Box } from '../../project/layout';
import { resolvedParts } from '../../project/model';
import { Canvas } from '../Canvas';
import { useStudio } from '../context';
import { DefaultsPanel, PartsList, usePartSelection, usePartsLayer } from './PartsView';
import { SheetsList, StripLayer, useSheetSelection, useSheetsLayer } from './SheetsView';

/** Room around the shapes in focus, as a share of their size. */
const PADDING = 0.06;

/**
 * The Parts and Sheets tabs, around one canvas: the parts above, and their material below, at one
 * scale. The tab's own shapes are in the middle of the view; the other tab's float faded at its
 * edge, and a click on one opens that tab with it chosen. Switching tabs slides the canvas from
 * one to the other: it stays as it is, as the tabs share it.
 */
export function MaterialView({ tab }: { tab: 'parts' | 'sheets' }) {
  const { project, unit, setTab } = useStudio();
  const parts = useMemo(() => resolvedParts(project), [project]);
  const place = useMemo(() => arrangeMaterial(parts, project.stock), [parts, project.stock]);
  const partSelection = usePartSelection();
  const sheetSelection = useSheetSelection();
  const onParts = tab === 'parts';
  const partsLayer = usePartsLayer({
    selection: partSelection,
    arrangement: place.parts,
    active: onParts,
    onPick: (id) => {
      partSelection.setSelected(id);
      setTab('parts');
    },
  });
  const sheetsLayer = useSheetsLayer({
    selection: sheetSelection,
    place: place.sheets,
    active: !onParts,
    onPick: (id) => {
      sheetSelection.select(id);
      setTab('sheets');
    },
  });
  // The view frames the tab's own shapes in its middle, and reaches past the gap into the other
  // tab's, above or below, so they show at its edge whatever the view's shape.
  const focused = onParts ? place.parts.extent : place.material;
  const [x0, y0, x1, y1] = focused;
  const pad = Math.max(x1 - x0, y1 - y0, 1) * PADDING;
  const gap = place.parts.extent[1] - place.material[3];
  const reach = gap + (y1 - y0) * MATERIAL_PEEK;
  const extent: Box = [x0 - pad, y0 - reach, x1 + pad, y1 + reach];
  const hint = onParts
    ? 'Parts and their material at one scale. Select either to change it.'
    : place.strip
      ? 'The strip is as wide as set; its length is open.'
      : sheetsLayer.hint;
  return (
    <div className="view">
      {onParts ? <PartsList selection={partSelection} /> : <SheetsList {...sheetSelection} />}
      <Canvas
        label="Parts and their material at one scale"
        extent={extent}
        focus={onParts ? partsLayer.focus : undefined}
        tool={sheetsLayer.tool}
        onBackgroundClick={() =>
          onParts ? partsLayer.clear() : !sheetSelection.tool && sheetSelection.select(undefined)
        }
        toolbar={hint && <span className="chip">{hint}</span>}
        overlay={partsLayer.overlay}
      >
        {({ upp }) => (
          <>
            <g className={onParts ? undefined : 'out-of-focus'}>{partsLayer.draw(upp)}</g>
            <g className={onParts ? 'out-of-focus' : undefined}>
              {place.strip ? (
                <StripLayer
                  place={place.strip}
                  upp={upp}
                  unit={unit}
                  active={!onParts}
                  onPick={() => setTab('sheets')}
                />
              ) : (
                sheetsLayer.draw(upp)
              )}
            </g>
          </>
        )}
      </Canvas>
      {onParts && <DefaultsPanel />}
    </div>
  );
}
