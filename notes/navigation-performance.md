# Canvas navigation profiling

Measured on September 5, 2026 with Chromium, a 1440 × 900 viewport, and the bundled gardeyn3 dataset (100 shapes), using a separate browser context against the development server. Reproduce from `web/` with `node tests/measure-navigation.mjs http://127.0.0.1:4174/ /tmp/navigation.json`.

The harness dispatches four wheel events per animation frame for 120 frames, zooming in for half and out for half. It records frame intervals and Chromium CPU samples; the first two intervals are excluded. These are local observations, not hardware-independent performance thresholds.

| Measurement | Before | After |
| --- | ---: | ---: |
| Recorded frames | 118 | 118 |
| Median / 95th percentile interval | 16.67 / 16.67 ms | 16.67 / 16.67 ms |
| Maximum interval | 33.34 ms | 16.67 ms |
| Intervals over 25 ms | 3 | 0 |
| Maximum synchronous wheel handler batch | 0.55 ms | 0.37 ms |
| Samples in development JSX creation | 224 | 64 |

Camera updates previously serialized every shape path and recreated every shape element. Geometry and shape elements are now memoized, copy-label sizing follows an inherited CSS variable, and grid/ruler strokes use four SVG paths instead of individual tick elements. Native SVG transforms continue to determine pointer coordinates and ruler alignment.

The measurement also exposed dropped wheel deltas: events arriving before React committed used the same captured camera. Functional updates now retain each delta. Therefore the identical input stream follows a larger zoom trajectory after the fix; the figures should not be read as a controlled percentage speedup. The focused browser regression checks cumulative zoom, pointer anchoring, ruler alignment, and nonzero label font size in Chromium, Firefox and WebKit.
