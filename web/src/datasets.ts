import type { ImportReview } from './import/sparrow';
import type { Part } from './model';
import { geometryTask } from './workers/geometryTask';

export type Dataset = {
  id: string;
  file: string;
  group: string;
  continuous: boolean;
  partTypes: number;
  copies: number;
  bytes: number;
  sha256: string;
};

const catalogUrl = () => new URL('examples/catalog.json', document.baseURI);
const datasetUrl = (file: string) => new URL(`examples/${file}`, document.baseURI);
const fileName = (dataset: Dataset | string) => typeof dataset === 'string' ? dataset : dataset.file;
const label = (dataset: Dataset | string) => typeof dataset === 'string' ? dataset : dataset.id;

const catalogRequests = new Map<string, Promise<Dataset[]>>();
const textRequests = new Map<string, Promise<string>>();
const exampleRequests = new Map<string, Promise<ImportReview>>();
const libraryRequests = new Map<string, Promise<Part[]>>();

function cached<T>(requests:Map<string,Promise<T>>,key:string,load:()=>Promise<T>):Promise<T> {
  const existing=requests.get(key);if(existing)return existing;
  const request=load();requests.set(key,request);
  request.catch(()=>{if(requests.get(key)===request)requests.delete(key);});
  return request;
}

export function loadCatalog(): Promise<Dataset[]> {
  return cached(catalogRequests,'catalog',()=>fetch(catalogUrl())
    .then(async response => {
      if (!response.ok) throw Error('Could not load datasets.');
      const data = await response.json() as { datasets?: unknown };
      if (!Array.isArray(data.datasets)) throw Error('Could not read the dataset catalog.');
      return data.datasets as Dataset[];
    }));
}

export function loadDatasetText(dataset: Dataset | string, signal?: AbortSignal): Promise<string> {
  const file = fileName(dataset);
  return cached(textRequests,file,()=>fetch(datasetUrl(file), { signal })
    .then(async response => {
      if (!response.ok) throw Error(`Could not load ${label(dataset)}.`);
      return response.text();
    }));
}

export function loadExample(dataset: Dataset | string, signal?: AbortSignal): Promise<ImportReview> {
  const file = fileName(dataset);
  return cached(exampleRequests,file,()=>loadDatasetText(dataset, signal).then(async text => {
    const reply = await geometryTask({ type: 'import', runId: 0, documentRevision: 0, scale: 1,
      files: [{ name: file, text }] });
    if (reply.type !== 'import-review') throw Error(`Could not read ${label(dataset)}.`);
    if (reply.review.issues?.length) throw Error(reply.review.issues.join(' '));
    return reply.review;
  }));
}

export function loadLibrary(dataset: Dataset | string): Promise<Part[]> {
  const file = fileName(dataset);
  return cached(libraryRequests,file,()=>loadDatasetText(dataset).then(async text => {
    const reply = await geometryTask({ type: 'library', runId: 0, documentRevision: 0, text, fileName: file });
    if (reply.type !== 'normalized') throw Error(`Could not read ${label(dataset)}.`);
    return reply.document.parts;
  }));
}
