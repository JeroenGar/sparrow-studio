"""Audit the actual polygonal SVG export using Python's XML parser and GEOS.

uv run --with shapely==2.1.2 python tests/audit_export.py PATH/layout.svg
"""
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from shapely import Polygon


def audit(path):
    root = ET.fromstring(Path(path).read_text())
    width, height = float(root.attrib['width'].removesuffix('mm')), float(root.attrib['height'].removesuffix('mm'))
    assert root.attrib['viewBox'] == f'0 0 {root.attrib["width"][:-2]} {root.attrib["height"][:-2]}'
    group = root.find('{http://www.w3.org/2000/svg}g')
    assert group is not None
    assert group.attrib['transform'] == f'translate(0 {root.attrib["height"][:-2]}) scale(1 -1)'
    footprints = []
    net_area = 0
    for element in group:
        assert element.tag == '{http://www.w3.org/2000/svg}path'
        rings = []
        for contour in element.attrib['d'].split('Z'):
            if not contour:
                continue
            assert contour.startswith('M')
            points = [tuple(map(float, p.split(','))) for p in re.split('[ML]', contour)[1:]]
            # Apply the exported group transform. Reflection leaves distance/area
            # unchanged but is included to audit the actual SVG coordinate system.
            rings.append([(x, height-y) for x, y in points])
        polygon = Polygon(rings[0], rings[1:])
        assert polygon.is_valid, 'Invalid exported outer or hole'
        net_area += polygon.area
        footprints.append(Polygon(rings[0]))
    assert footprints, 'Empty export'
    max_boundary = max(max(0, -p.bounds[0], -p.bounds[1], p.bounds[2]-width, p.bounds[3]-height) for p in footprints)
    max_overlap = max((p.intersection(q).area for i,p in enumerate(footprints) for q in footprints[:i]), default=0)
    assert max_boundary <= 1e-6, f'Boundary violation {max_boundary}'
    assert max_overlap <= 1e-8, f'Overlap {max_overlap}'
    return {'copies': len(footprints), 'maxBoundaryViolationMm': max_boundary,
            'largestPairOverlapMm2': max_overlap, 'materialUtilization': net_area/(width*height)}


if __name__ == '__main__':
    print(json.dumps(audit(sys.argv[1]), indent=2))
