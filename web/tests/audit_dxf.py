"""Independent DXF reader and GEOS audit; dependencies are development-only.

uv run --with ezdxf==1.4.3 --with shapely==2.1.2 python tests/audit_dxf.py FILE --copies 1 --holes 1 --area 5600
"""
import argparse
import json
import ezdxf
from shapely.geometry import Polygon

parser = argparse.ArgumentParser()
parser.add_argument("file")
parser.add_argument("--copies", type=int, required=True)
parser.add_argument("--holes", type=int, required=True)
parser.add_argument("--area", type=float, required=True)
args = parser.parse_args()
# ezdxf silently creates a missing saved view, layouts or dimension style, so check the raw records first.
raw = open(args.file, encoding="ascii").read().split("\n")
pairs = list(zip(raw[0::2], raw[1::2]))
for structure in ["CLASSES", "OBJECTS", "*Active", "LAYOUT", "ACDBPLACEHOLDER", "$EXTMIN", "$EXTMAX"]:
    assert any(value == structure for _, value in pairs), f"Missing {structure}"
assert all("." in value for code, value in pairs if 10 <= int(code) <= 59 or 140 <= int(code) <= 149), "Real without decimal point"
doc = ezdxf.readfile(args.file)
assert doc.dxfversion == "AC1015" and doc.units == 4
auditor = doc.audit()
assert not auditor.has_errors and not auditor.has_fixes, "Independent DXF structural audit failed"
outer, holes, annotations, sheets = [], [], [], []
for entity in doc.modelspace():
    if entity.dxftype() == "TEXT":
        assert entity.dxf.layer == "SPARROW_INFO"
        assert "nested with sparrow/studio" in entity.dxf.text and "https://sparrowstudio.app" in entity.dxf.text
        assert doc.layers.get("SPARROW_INFO").dxf.plot == 0
        annotations.append(entity)
        continue
    assert entity.dxftype() == "LWPOLYLINE" and entity.closed
    assert entity.dxf.layer in ("SHEET", "PARTS", "HOLES")
    polygon = Polygon([(p[0], p[1]) for p in entity.get_points()])
    assert polygon.is_valid and polygon.area > 0
    {"SHEET": sheets, "PARTS": outer, "HOLES": holes}[entity.dxf.layer].append(polygon)
assert len(annotations) == 1 and len(sheets) == 1
extents = doc.header["$EXTMIN"], doc.header["$EXTMAX"]
assert all(extents[0][0] <= x <= extents[1][0] and extents[0][1] <= y <= extents[1][1] for p in sheets + outer for x, y in p.exterior.coords)
assert len(outer) == args.copies and len(holes) == args.holes
assert all(sum(part.contains(hole) for part in outer) == 1 for hole in holes)
overlap = max((a.intersection(b).area for i, a in enumerate(outer) for b in outer[:i]), default=0)
assert overlap <= 1e-8, overlap
net_area = sum(p.area for p in outer) - sum(p.area for p in holes)
assert abs(net_area - args.area) <= 1e-6, net_area
print(json.dumps({"reader": "ezdxf " + ezdxf.__version__, "sheet": sheets[0].bounds, "copies": len(outer), "holes": len(holes), "netAreaMm2": net_area, "maximumOverlapMm2": overlap}))
