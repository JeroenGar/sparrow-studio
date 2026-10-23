import type { Input } from '../../src/api/client';

/** A small strip packing job in the API's format: two part types, solved in a second. */
export const stripInput: Input = {
  schema_version: 1,
  geometries: [
    {
      id: 'plate',
      shape: {
        outer: { type: 'rectangle', x_min: 0, y_min: 0, width: 40, height: 20 },
        holes: [{ type: 'circle', center: [10, 10], radius: 4 }],
      },
    },
    {
      id: 'wedge',
      shape: {
        outer: {
          type: 'path',
          start: [0, 0],
          segments: [
            { type: 'line', to: [30, 0] },
            { type: 'arc', to: [0, 30], bulge: 0.4142135623730951 },
          ],
        },
      },
    },
  ],
  parts: [
    {
      id: 'plate',
      geometry_id: 'plate',
      quantity: 3,
      orientation: { rotation: { type: 'discrete', angles: [0, 180] } },
    },
    {
      id: 'wedge',
      geometry_id: 'wedge',
      quantity: 2,
      orientation: { rotation: { type: 'discrete', angles: [0, 90, 180, 270] } },
    },
  ],
  minimum_separation_distance: { parts: 1, boundary: 1 },
  problem: { type: 'minimize_strip_length', height: 60 },
};
