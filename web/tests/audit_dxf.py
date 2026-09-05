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
doc = ezdxf.readfile(args.file)
assert doc.dxfversion == "AC1015" and doc.units == 4
assert not doc.audit().has_errors, "Independent DXF structural audit failed"
outer, holes = [], []
for entity in doc.modelspace():
    assert entity.dxftype() == "LWPOLYLINE" and entity.closed
    assert entity.dxf.layer in ("PARTS", "HOLES")
    polygon = Polygon([(p[0], p[1]) for p in entity.get_points()])
    assert polygon.is_valid and polygon.area > 0
    (outer if entity.dxf.layer == "PARTS" else holes).append(polygon)
assert len(outer) == args.copies and len(holes) == args.holes
assert all(sum(part.contains(hole) for part in outer) == 1 for hole in holes)
overlap = max((a.intersection(b).area for i, a in enumerate(outer) for b in outer[:i]), default=0)
assert overlap <= 1e-8, overlap
net_area = sum(p.area for p in outer) - sum(p.area for p in holes)
assert abs(net_area - args.area) <= 1e-6, net_area
print(json.dumps({"reader": "ezdxf " + ezdxf.__version__, "copies": len(outer), "holes": len(holes), "netAreaMm2": net_area, "maximumOverlapMm2": overlap}))
