// U-05: the smallest ZIP support the export/import needs.
//
// A canonical export has to stream attachments out without buffering a workspace in
// memory, and an import has to read archives other tools wrote (Notion exports are
// deflated ZIPs). Both sides stay on Node's own zlib: entries are STORE or DEFLATE,
// with data descriptors for streams. ZIP64, encryption and multi-disk archives are
// rejected with an explicit error instead of being half-read.
import fs from "node:fs";
import path from "node:path";
import { finished, pipeline } from "node:stream/promises";
import { PassThrough, Readable, Transform } from "node:stream";
import { createDeflateRaw, createInflateRaw, deflateRawSync } from "node:zlib";

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;
const DATA_DESCRIPTOR_SIG = 0x08074b50;
const UTF8_FLAG = 0x0800;
const DESCRIPTOR_FLAG = 0x0008;
const DEFLATE = 8;
const STORE = 0;

const MAX_ZIP_BYTES = 0xffff_ffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export class Crc32 {
  private value = 0xffff_ffff;

  update(chunk: Uint8Array): void {
    let crc = this.value;
    for (let i = 0; i < chunk.length; i++) {
      crc = CRC_TABLE[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
    }
    this.value = crc >>> 0;
  }

  digest(): number {
    return (this.value ^ 0xffff_ffff) >>> 0;
  }
}

function dosDateTime(date: Date): { time: number; day: number } {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function u16(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value & 0xffff, 0);
  return out;
}

function u32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0, 0);
  return out;
}

type Entry = {
  name: Buffer;
  flags: number;
  method: number;
  time: number;
  day: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
};

export type ZipSource = AsyncIterable<Buffer | string> | Readable;

async function* chunks(source: ZipSource): AsyncGenerator<Buffer> {
  for await (const chunk of source) {
    yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
  }
}

/**
 * Writes a ZIP file entry by entry. Every entry can stream, so an attachment never
 * has to be in memory; the central directory is written by `finish`.
 */
export class ZipWriter {
  private stream: fs.WriteStream;
  private offset = 0;
  private entries: Entry[] = [];
  private closed = false;
  private readonly timestamp: Date;

  constructor(filePath: string, options: { timestamp?: Date } = {}) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.stream = fs.createWriteStream(filePath);
    this.timestamp = options.timestamp ?? new Date();
  }

  private async write(buffer: Buffer): Promise<void> {
    if (this.closed) throw new Error("This archive is already closed");
    if (this.offset + buffer.length > MAX_ZIP_BYTES) {
      throw new Error("Export is larger than 4 GB. Split the workspace or export without attachments.");
    }
    // Await each write so a 1 GB attachment is never queued in memory behind the file.
    await new Promise<void>((resolve, reject) => {
      this.stream.write(buffer, (error) => (error ? reject(error) : resolve()));
    });
    this.offset += buffer.length;
  }

  private header(name: Buffer, flags: number, method: number, meta: { crc: number; compressedSize: number; size: number }): Buffer {
    const { time, day } = dosDateTime(this.timestamp);
    return Buffer.concat([
      u32(LOCAL_SIG),
      u16(20),
      u16(flags),
      u16(method),
      u16(time),
      u16(day),
      u32(meta.crc),
      u32(meta.compressedSize),
      u32(meta.size),
      u16(name.length),
      u16(0),
      name,
    ]);
  }

  async addBuffer(name: string, data: Buffer | string, options: { store?: boolean } = {}): Promise<void> {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    const nameBuffer = Buffer.from(name, "utf8");
    const crc = new Crc32();
    crc.update(buffer);
    const method = options.store ? STORE : DEFLATE;
    const body = method === STORE ? buffer : deflateRawSync(buffer);
    const offset = this.offset;
    await this.write(
      this.header(nameBuffer, UTF8_FLAG, method, {
        crc: crc.digest(),
        compressedSize: body.length,
        size: buffer.length,
      })
    );
    await this.write(body);
    this.entries.push({
      name: nameBuffer,
      flags: UTF8_FLAG,
      method,
      time: dosDateTime(this.timestamp).time,
      day: dosDateTime(this.timestamp).day,
      crc: crc.digest(),
      compressedSize: body.length,
      size: buffer.length,
      offset,
    });
  }

  async addStream(name: string, source: ZipSource, options: { store?: boolean } = {}): Promise<void> {
    const nameBuffer = Buffer.from(name, "utf8");
    const method = options.store ? STORE : DEFLATE;
    const { time, day } = dosDateTime(this.timestamp);
    const offset = this.offset;
    const flags = UTF8_FLAG | DESCRIPTOR_FLAG;
    await this.write(
      Buffer.concat([
        u32(LOCAL_SIG),
        u16(20),
        u16(flags),
        u16(method),
        u16(time),
        u16(day),
        u32(0),
        u32(0),
        u32(0),
        u16(nameBuffer.length),
        u16(0),
        nameBuffer,
      ])
    );

    const crc = new Crc32();
    let size = 0;
    let compressedSize = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        crc.update(chunk);
        size += chunk.length;
        callback(null, chunk);
      },
    });
    const input = Readable.from(chunks(source));
    const output = new PassThrough();
    const completion = pipeline(
      input,
      meter,
      ...(method === STORE ? [] : [createDeflateRaw()]),
      output
    );
    try {
      for await (const chunk of output) {
        compressedSize += chunk.length;
        await this.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      await completion;
    } catch (error) {
      input.destroy();
      output.destroy();
      await completion.catch(() => {});
      throw error;
    }
    const digest = crc.digest();
    await this.write(Buffer.concat([
      u32(DATA_DESCRIPTOR_SIG),
      u32(digest),
      u32(compressedSize),
      u32(size),
    ]));
    this.entries.push({
      name: nameBuffer,
      flags,
      method,
      time,
      day,
      crc: digest,
      compressedSize,
      size,
      offset,
    });
  }

  async finish(): Promise<{ bytes: number; entries: number }> {
    if (this.closed) throw new Error("This archive is already closed");
    if (this.entries.length > 0xffff) {
      throw new Error("Export has more than 65,535 files. Split the workspace into smaller exports.");
    }
    const centralOffset = this.offset;
    for (const entry of this.entries) {
      await this.write(
        Buffer.concat([
          u32(CENTRAL_SIG),
          u16(0x0314),
          u16(20),
          u16(entry.flags),
          u16(entry.method),
          u16(entry.time),
          u16(entry.day),
          u32(entry.crc),
          u32(entry.compressedSize),
          u32(entry.size),
          u16(entry.name.length),
          u16(0),
          u16(0),
          u16(0),
          u16(0),
          u32((0o100644 << 16) >>> 0),
          u32(entry.offset),
          entry.name,
        ])
      );
    }
    const centralSize = this.offset - centralOffset;
    await this.write(
      Buffer.concat([
        u32(END_SIG),
        u16(0),
        u16(0),
        u16(this.entries.length),
        u16(this.entries.length),
        u32(centralSize),
        u32(centralOffset),
        u16(0),
      ])
    );
    this.closed = true;
    this.stream.end();
    await finished(this.stream);
    return { bytes: this.offset, entries: this.entries.length };
  }

  abort(): void {
    if (this.closed) return;
    this.closed = true;
    this.stream.destroy();
  }
}

export type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  crc: number;
  localOffset: number;
  flags: number;
  directory: boolean;
};

export type ZipSourceEntry = ZipEntry & { dataOffset: number };

function ascii(buffer: Buffer): string {
  return buffer.toString("utf8");
}

/** Rejects names that could escape the extraction root. */
export function safeEntryName(name: string): string {
  const normalized = name.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) {
    throw new Error(`Unsafe ZIP entry: ${name}`);
  }
  const parts = normalized.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) throw new Error(`Unsafe ZIP entry: ${name}`);
  return parts.join("/");
}

export function isJunkEntry(name: string): boolean {
  return name.endsWith("/") || name.startsWith("__MACOSX/") || /(^|\/)\.DS_Store$/.test(name);
}

/**
 * Reads the central directory once, then exposes random access to compressed entries.
 * Standard 32-bit ZIPs only; that covers every export this server writes and Notion's
 * Markdown archives.
 */
export class ZipReader {
  private constructor(
    private readonly handle: fs.promises.FileHandle,
    readonly filePath: string,
    private readonly entries: ZipSourceEntry[],
    readonly bytes: number
  ) {}

  static async open(filePath: string): Promise<ZipReader> {
    const handle = await fs.promises.open(filePath, "r");
    try {
      const stat = await handle.stat();
      if (stat.size < 22) throw new Error("This file is not a ZIP archive");
      const tailLength = Math.min(stat.size, 65_557);
      const tail = Buffer.alloc(tailLength);
      await handle.read(tail, 0, tailLength, stat.size - tailLength);
      let end = -1;
      for (let at = tail.length - 22; at >= 0; at--) {
        if (tail.readUInt32LE(at) === END_SIG) {
          end = at;
          break;
        }
      }
      if (end < 0) throw new Error("This file is not a ZIP archive");
      const count = tail.readUInt16LE(end + 10);
      const centralSize = tail.readUInt32LE(end + 12);
      const centralOffset = tail.readUInt32LE(end + 16);
      if (count === 0xffff || centralSize === 0xffff_ffff || centralOffset === 0xffff_ffff) {
        throw new Error("ZIP64 archives are not supported. Re-zip the folder without ZIP64.");
      }
      if (centralOffset + centralSize > stat.size) throw new Error("The ZIP archive is truncated");
      const central = Buffer.alloc(centralSize);
      await handle.read(central, 0, centralSize, centralOffset);
      const entries: ZipSourceEntry[] = [];
      let cursor = 0;
      for (let index = 0; index < count; index++) {
        if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== CENTRAL_SIG) {
          throw new Error("The ZIP archive's directory is damaged");
        }
        const flags = central.readUInt16LE(cursor + 8);
        const method = central.readUInt16LE(cursor + 10);
        const crc = central.readUInt32LE(cursor + 16);
        const compressedSize = central.readUInt32LE(cursor + 20);
        const uncompressedSize = central.readUInt32LE(cursor + 24);
        const nameLength = central.readUInt16LE(cursor + 28);
        const extraLength = central.readUInt16LE(cursor + 30);
        const commentLength = central.readUInt16LE(cursor + 32);
        const localOffset = central.readUInt32LE(cursor + 42);
        const rawName = central.subarray(cursor + 46, cursor + 46 + nameLength);
        const name = ascii(rawName);
        cursor += 46 + nameLength + extraLength + commentLength;

        if (localOffset + 30 > stat.size) throw new Error("The ZIP archive is truncated");
        const local = Buffer.alloc(30);
        await handle.read(local, 0, 30, localOffset);
        if (local.readUInt32LE(0) !== LOCAL_SIG) throw new Error("The ZIP archive's entry is damaged");
        const localNameLength = local.readUInt16LE(26);
        const localExtraLength = local.readUInt16LE(28);
        const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
        if (dataOffset + compressedSize > stat.size) throw new Error("The ZIP archive is truncated");
        if (method !== DEFLATE && method !== STORE) {
          throw new Error(`Unsupported ZIP compression method ${method}. Re-zip the folder with standard compression.`);
        }
        if (flags & 1) throw new Error("Password-protected ZIP archives are not supported");
        const directory = name.endsWith("/") || name.endsWith("\\");
        entries.push({
          name,
          method,
          compressedSize,
          uncompressedSize,
          crc,
          localOffset,
          dataOffset,
          flags,
          directory,
        });
      }
      return new ZipReader(handle, filePath, entries, stat.size);
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  list(): ZipSourceEntry[] {
    return this.entries;
  }

  private source(entry: ZipSourceEntry): Readable {
    if (entry.compressedSize === 0) return Readable.from([]);
    const raw = fs.createReadStream(this.filePath, {
      start: entry.dataOffset,
      end: entry.dataOffset + entry.compressedSize - 1,
    });
    return entry.method === STORE ? raw : raw.pipe(createInflateRaw());
  }

  async *stream(entry: ZipSourceEntry): AsyncGenerator<Buffer> {
    for await (const chunk of this.source(entry)) {
      yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    }
  }

  async read(entry: ZipSourceEntry, maxBytes = 64 * 1024 * 1024): Promise<Buffer> {
    if (entry.uncompressedSize > maxBytes) {
      throw new Error(`"${entry.name}" is too large to read (${Math.ceil(entry.uncompressedSize / 1024 / 1024)} MB)`);
    }
    const chunks: Buffer[] = [];
    const crc = new Crc32();
    let size = 0;
    for await (const chunk of this.stream(entry)) {
      size += chunk.length;
      if (size > maxBytes) throw new Error(`"${entry.name}" is larger than its directory entry says`);
      crc.update(chunk);
      chunks.push(chunk);
    }
    if (size !== entry.uncompressedSize) throw new Error(`"${entry.name}" is truncated`);
    if (entry.crc !== 0 && crc.digest() !== entry.crc) throw new Error(`"${entry.name}" failed its checksum`);
    return Buffer.concat(chunks);
  }

  async close(): Promise<void> {
    await this.handle.close();
  }
}
