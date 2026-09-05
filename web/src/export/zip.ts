import type { Document, Result } from '../model';
import { solverInput } from '../import/sparrow';
import { exportProject } from '../import/project';
import { exportSVG } from './svg';

export type ZipEntry = { name: string; data: string | Uint8Array };

const encoder = new TextEncoder();
const u32 = (view: DataView, offset: number, value: number) => view.setUint32(offset, value >>> 0, true);

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pathName(name: string): string {
  if (!name || name.includes('\\') || name.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(name) || name.split('/').includes('..')) throw Error('ZIP entry names must be relative paths.');
  return name;
}

/** Create a deterministic ZIP using the store method, which is enough for the small download payloads. */
export function zip(entries: readonly ZipEntry[]): Uint8Array {
  if (!entries.length) throw Error('A ZIP archive needs at least one entry.');
  const names = new Set<string>();
  const prepared = entries.map(entry => {
    const path = pathName(entry.name);
    if (names.has(path)) throw Error('ZIP entry names must be unique.');
    names.add(path);
    const name = encoder.encode(path);
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : new Uint8Array(entry.data);
    if (data.byteLength > 0xffffffff) throw Error('ZIP entries cannot exceed 4 GiB.');
    return { name, data, crc: crc32(data) };
  });
  const localSize = prepared.reduce((total, entry) => total + 30 + entry.name.length + entry.data.length, 0);
  const centralSize = prepared.reduce((total, entry) => total + 46 + entry.name.length, 0);
  const totalSize = localSize + centralSize + 22;
  if (totalSize > 0xffffffff) throw Error('ZIP archive cannot exceed 4 GiB.');
  const output = new Uint8Array(totalSize), view = new DataView(output.buffer);
  let offset = 0, centralOffset = localSize;
  const localOffsets: number[] = [];
  for (const entry of prepared) {
    localOffsets.push(offset);
    u32(view, offset, 0x04034b50); view.setUint16(offset + 4, 10, true); view.setUint16(offset + 6, 0x800, true);
    view.setUint16(offset + 8, 0, true); view.setUint16(offset + 10, 0, true); view.setUint16(offset + 12, 33, true);
    u32(view, offset + 14, entry.crc); u32(view, offset + 18, entry.data.length); u32(view, offset + 22, entry.data.length);
    view.setUint16(offset + 26, entry.name.length, true); view.setUint16(offset + 28, 0, true);
    output.set(entry.name, offset + 30); output.set(entry.data, offset + 30 + entry.name.length);
    offset += 30 + entry.name.length + entry.data.length;
  }
  offset = centralOffset;
  prepared.forEach((entry, index) => {
    u32(view, offset, 0x02014b50); view.setUint16(offset + 4, 20, true); view.setUint16(offset + 6, 10, true);
    view.setUint16(offset + 8, 0x800, true); view.setUint16(offset + 10, 0, true); view.setUint16(offset + 12, 0, true); view.setUint16(offset + 14, 33, true);
    u32(view, offset + 16, entry.crc); u32(view, offset + 20, entry.data.length); u32(view, offset + 24, entry.data.length);
    view.setUint16(offset + 28, entry.name.length, true); view.setUint16(offset + 30, 0, true); view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true); view.setUint16(offset + 36, 0, true); u32(view, offset + 38, 0);
    u32(view, offset + 42, localOffsets[index]);
    output.set(entry.name, offset + 46);
    offset += 46 + entry.name.length;
  });
  offset = centralOffset + centralSize;
  u32(view, offset, 0x06054b50); view.setUint16(offset + 4, 0, true); view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, prepared.length, true); view.setUint16(offset + 10, prepared.length, true);
  u32(view, offset + 12, centralSize); u32(view, offset + 16, centralOffset); view.setUint16(offset + 20, 0, true);
  return output;
}

const ARCHIVE_README = `sparrow-studio archive

project.sparrow-project.json is the editable Studio project and preserves holes.
layout.svg and layout.dxf are checked-result exports and preserve holes when present.
sparrow-instance.json is the CLI-compatible solver input. The native CLI importer accepts simple_polygon items and currently ignores hole contours, so its footprint contains each outer contour only; use the Studio project or checked SVG/DXF when hole geometry matters.
`;

/** Package the editable project, CLI input, and optional checked-result exports. */
export function exportProjectArchive(document: Document, revision: number, result?: Result): Uint8Array {
  const entries: ZipEntry[] = [
    { name: 'project.sparrow-project.json', data: exportProject(document, revision, result) },
    { name: 'sparrow-instance.json', data: solverInput(document) },
    { name: 'README.txt', data: ARCHIVE_README },
  ];
  if (result) {
    const bundle = exportSVG(document, result);
    entries.push({ name: 'layout.svg', data: bundle.svg }, { name: 'layout.dxf', data: bundle.dxf });
  }
  return zip(entries);
}
