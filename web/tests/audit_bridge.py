"""Independent GEOS audit of M0 swim callbacks, using original f64 coordinates.

uv run --with shapely==2.1.2 python tests/audit_bridge.py PATH/TO/candidates.json
"""
import json
import math
import sys
from collections import Counter
from pathlib import Path

from shapely import Polygon, box
from shapely.affinity import rotate, translate


def audit(instance, candidate):
    solution = candidate["solution"]
    items = {item["id"]: item for item in instance["items"]}
    placements = solution["layout"]["placed_items"]
    assert Counter(p["item_id"] for p in placements) == Counter({i["id"]: i["demand"] for i in items.values()})
    polygons = []
    max_boundary = 0
    for placement in placements:
        item = items[placement["item_id"]]
        assert item["shape"]["type"] == "simple_polygon", "M0 audit supports the swim fixture"
        transform = placement["transformation"]
        angle = transform["rotation"]
        assert any(abs((angle - allowed + 180) % 360 - 180) <= 0.0001 for allowed in item["allowed_orientations"])
        polygon = translate(rotate(Polygon(item["shape"]["data"]), angle, origin=(0, 0)), *transform["translation"])
        assert polygon.is_valid
        x0, y0, x1, y1 = polygon.bounds
        assert all(math.isfinite(v) for v in polygon.bounds)
        max_boundary = max(max_boundary, -x0, -y0, x1 - solution["strip_width"], y1 - instance["strip_height"])
        polygons.append(polygon)
    largest_overlap = 0
    worst_pair = None
    for i, polygon in enumerate(polygons):
        for j in range(i):
            overlap = polygon.intersection(polygons[j]).area
            if overlap > largest_overlap:
                largest_overlap = overlap
                worst_pair = [j, i]
    return {"sequence": candidate["sequence"], "report": candidate["report"],
            "passed": max_boundary <= 1e-6 and largest_overlap <= 1e-8,
            "maxBoundaryViolationMm": max_boundary, "largestPairOverlapMm2": largest_overlap,
            "worstPair": worst_pair}


if __name__ == "__main__":
    # The release policy must detect a 1e-7 mm² sliver.
    assert box(0, 0, 1, 1).intersection(box(1 - 1e-7, 0, 2, 1)).area > 1e-8
    instance = json.loads((Path(__file__).parent.parent / "public/examples/swim.json").read_text())
    diagnostics = json.loads(Path(sys.argv[1]).read_text())
    results = [audit(instance, c) for c in diagnostics["candidates"]]
    assert results, "No candidates to audit"
    print(json.dumps({"checked": len(results), "passed": sum(r["passed"] for r in results),
                      "first": results[0], "final": results[-1]}, indent=2))
    sys.exit(0 if all(r["passed"] for r in results) else 1)
