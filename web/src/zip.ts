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

/** Read the editable payload from archives saved by Studio. */
export function projectArchiveText(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = () => { throw Error('Invalid project ZIP. Open an archive saved by sparrow/studio.'); };
  const range = (offset: number, size: number) => { if (offset < 0 || size < 0 || offset + size > bytes.length) fail(); };
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
  }
  if (end < 0) return fail();
  range(end, 22);
  if (view.getUint32(end, true) !== 0x06054b50 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) return fail();
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true), project: string | undefined;
  if (offset + view.getUint32(end + 12, true) !== end || count !== view.getUint16(end + 8, true)) return fail();
  for (let i = 0; i < count; i++) {
    range(offset, 46);
    if (view.getUint32(offset, true) !== 0x02014b50) return fail();
    const nameLength = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
    range(offset + 46, nameLength + extra + comment);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name === 'project.sparrow-project.json') {
      if (project !== undefined) return fail();
      // ponytail: Studio writes stored ZIPs; support deflate if opening repacked archives becomes useful.
      if (view.getUint16(offset + 10, true) !== 0 || view.getUint16(offset + 8, true) & 1) throw Error('Open the original ZIP saved by sparrow/studio, or extract and open project.sparrow-project.json.');
      const size = view.getUint32(offset + 24, true), local = view.getUint32(offset + 42, true);
      if (size > 10 * 1024 * 1024 || size !== view.getUint32(offset + 20, true)) return fail();
      range(local, 30);
      if (view.getUint32(local, true) !== 0x04034b50) return fail();
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      range(start, size);
      if (start + size > view.getUint32(end + 16, true)) return fail();
      const data = bytes.subarray(start, start + size);
      if (crc32(data) !== view.getUint32(offset + 16, true)) throw Error('The saved project is damaged (ZIP checksum mismatch).');
      project = new TextDecoder('utf-8', { fatal: true }).decode(data);
    }
    offset += 46 + nameLength + extra + comment;
  }
  if (offset !== end) return fail();
  if (project === undefined) throw Error('This ZIP does not contain a sparrow/studio project.');
  return project;
}
