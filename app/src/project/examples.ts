import { scalePart } from '../engine/geometry/normalize';
import { netArea } from '../engine/geometry/world';
import type { Job } from '../engine/model';
import { geometryTask } from '../engine/workers/geometryTask';
import {
  addParts,
  commonRotations,
  newProject,
  type MachinePreset,
  type ProjectDocument,
} from './model';

export type Example = {
  id: string;
  file: string;
  group: string;
  continuous: boolean;
  partTypes: number;
  copies: number;
};

/** Benchmark coordinates have no physical unit; examples are scaled to a median part area of 10,000 mm². */
const MEDIAN_AREA_MM2 = 10_000;

const url = (path: string) => new URL(`examples/${path}`, document.baseURI);

let catalog: Promise<Example[]> | undefined;
export function loadCatalog(): Promise<Example[]> {
  catalog ??= fetch(url('catalog.json'))
    .then(async (response) => {
      if (!response.ok) throw Error('Could not load the examples.');
      const data = (await response.json()) as { datasets?: Example[] };
      if (!Array.isArray(data.datasets)) throw Error('Could not read the example list.');
      return data.datasets;
    })
    .catch((error: unknown) => {
      catalog = undefined;
      throw error;
    });
  return catalog;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function scaleExample(job: Job): Job {
  const factor = Math.sqrt(MEDIAN_AREA_MM2 / median(job.parts.map(netArea)));
  return {
    ...job,
    parts: job.parts.map((part) => scalePart(part, factor)),
    settings: { ...job.settings, materialWidthMm: job.settings.materialWidthMm * factor },
  };
}

export async function loadExample(file: string, machine?: MachinePreset): Promise<ProjectDocument> {
  const response = await fetch(url(file));
  if (!response.ok) throw Error(`Could not load ${file}.`);
  const text = await response.text();
  const reply = await geometryTask({
    type: 'import',
    runId: 0,
    documentRevision: 0,
    scale: 1,
    files: [{ name: file, text }],
  });
  if (reply.type !== 'import-review') throw Error(`Could not read ${file}.`);
  const job = scaleExample(reply.review.document);
  const project = newProject(`${file.replace(/\.json$/, '')} (example)`, machine);
  // Round up so every part that fitted before still fits.
  const width = Math.ceil(job.settings.materialWidthMm * 100) / 100;
  const rotations = commonRotations(job.parts, project.partDefaults.rotations);
  return addParts(
    {
      ...project,
      partDefaults: { ...project.partDefaults, rotations },
      stock: {
        ...project.stock,
        packing: 'strip',
        strip: { ...project.stock.strip, widthMm: width },
      },
    },
    job.parts,
  );
}
