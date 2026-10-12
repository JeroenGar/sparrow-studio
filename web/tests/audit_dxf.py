"""Independent DXF reader and GEOS audit for exports of both studio apps; dependencies are development-only.

uv run --with ezdxf==1.4.3 --with shapely==2.1.2 python tests/audit_dxf.py FILE --copies 1 --holes 1 --area 5600
"""
import argparse
import json
import ezdxf
from shapely.geometry import Polygon

CREDITS = {"nested with sparrow/studio - https://sparrowstudio.app", "nested with sparrow studio - https://sparrowstudio.app"}

parser = argparse.ArgumentParser()
parser.add_argument("file")
parser.add_argument("--copies", type=int, required=True)
parser.add_argument("--holes", type=int, required=True)
parser.add_argument("--area", type=float, required=True)
args = parser.parse_args()

# ezdxf silently creates a missing saved view, so check the raw records first.
raw = open(args.file, encoding="ascii").read().split("\n")
pairs = list(zip(raw[0::2], raw[1::2]))
records, section = [], None  # (section, type, {code: [values]})
for code, value in pairs:
    if code == "0":
        section = None if value in ("SECTION", "ENDSEC") else section
        records.append((section, value, {}))
    else:
        records[-1][2].setdefault(code, []).append(value)
        if records[-1][1] == "SECTION" and code == "2":
            section = value
def find(section, kind, **fields):
    found = [r for s, t, r in records if s == section and t == kind and all(r.get(c, [None])[0] == v for c, v in fields.items())]
    assert len(found) == 1, f"Expected one {kind} {fields} in {section}"
    return found[0]
for name in ["HEADER", "CLASSES", "TABLES", "BLOCKS", "ENTITIES", "OBJECTS"]:
    find(None, "SECTION", **{"2": name})

doc = ezdxf.readfile(args.file)
assert doc.dxfversion == "AC1021" and doc.units == 4
auditor = doc.audit()
assert not auditor.has_errors and not auditor.has_fixes, "Independent DXF structural audit failed"
extmin, extmax = doc.header["$EXTMIN"], doc.header["$EXTMAX"]
# Autodesk Viewer clips the drawing to the saved view, so it must contain the extents.
active = find("TABLES", "VPORT", **{"2": "*Active"})
height = float(active["40"][0]); width = height * float(active["41"][0])
cx, cy = float(active["12"][0]), float(active["22"][0])
assert cx - width / 2 <= extmin[0] and cx + width / 2 >= extmax[0] and cy - height / 2 <= extmin[1] and cy + height / 2 >= extmax[1], "Saved view clips the drawing"

outer, holes, annotations, sheets = [], [], [], []
for entity in doc.modelspace():
    if entity.dxftype() == "TEXT":
        assert entity.dxf.layer == "SPARROW_INFO" and entity.dxf.text in CREDITS
        annotations.append(entity)
        continue
    assert entity.dxftype() == "LWPOLYLINE" and entity.closed
    assert entity.dxf.layer in ("SPARROW_SHEET", "PARTS", "HOLES")
    polygon = Polygon([(p[0], p[1]) for p in entity.get_points()])
    assert polygon.is_valid and polygon.area > 0
    {"SPARROW_SHEET": sheets, "PARTS": outer, "HOLES": holes}[entity.dxf.layer].append(polygon)
assert len(annotations) == 1 and len(sheets) == 1
assert all(extmin[0] <= x <= extmax[0] and extmin[1] <= y <= extmax[1] for p in sheets + outer for x, y in p.exterior.coords)
assert len(outer) == args.copies and len(holes) == args.holes
assert all(sum(part.contains(hole) for part in outer) == 1 for hole in holes)
overlap = max((a.intersection(b).area for i, a in enumerate(outer) for b in outer[:i]), default=0)
assert overlap <= 1e-8, overlap
net_area = sum(p.area for p in outer) - sum(p.area for p in holes)
assert abs(net_area - args.area) <= 1e-6, net_area
print(json.dumps({"reader": "ezdxf " + ezdxf.__version__, "sheet": sheets[0].bounds, "copies": len(outer), "holes": len(holes), "netAreaMm2": net_area, "maximumOverlapMm2": overlap}))
