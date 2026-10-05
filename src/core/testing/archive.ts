// Archives as other tools write them, for tests: each entry deflated (as Excel, LibreOffice and most ZIP tools pack
// them) or stored, and, for the archive reader's bounds (core/project/zip.ts), an entry whose header declares a size
// or a path its bytes do not have.
import { crc32 } from '../project/zip.ts';

export interface ArchivePart {
  readonly path: string;
  readonly bytes: Uint8Array;
  // stored instead of deflated
  readonly stored?: boolean;
  // the unpacked size the headers declare, when it is not the bytes' own (an archive that lies)
  readonly declaredSize?: number;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice().buffer]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// The archive's bytes: its parts in their order, then the central directory and its end record.
export async function archiveOf(parts: readonly ArchivePart[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const part of parts) {
    const name = encoder.encode(part.path);
    const packed = part.stored === true ? part.bytes : await deflate(part.bytes);
    const method = part.stored === true ? 0 : 8;
    const size = part.declaredSize ?? part.bytes.length;
    const crc = crc32(part.bytes);
    const local = new Uint8Array(30 + name.length + packed.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(8, method, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, packed.length, true);
    l.setUint32(22, size, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(packed, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(10, method, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, packed.length, true);
    c.setUint32(24, size, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const directory = centrals.reduce((n, entry) => n + entry.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, centrals.length, true);
  e.setUint16(10, centrals.length, true);
  e.setUint32(12, directory, true);
  e.setUint32(16, offset, true);
  const archive = new Uint8Array(offset + directory + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    archive.set(part, at);
    at += part.length;
  }
  return archive;
}
