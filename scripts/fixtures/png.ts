import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** A greyscale PNG that looks like a scanned page: rows of dark "word" blobs on white. */
export function scannedPagePng(width = 850, height = 1100, seed = 1): Buffer {
  let s = seed;
  const rand = (): number => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const raw = Buffer.alloc((width + 1) * height, 255);
  for (let y = 0; y < height; y++) raw[y * (width + 1)] = 0; // filter byte
  for (let line = 90; line < height - 90; line += 28) {
    let x = 80;
    while (x < width - 80) {
      const w = 20 + Math.floor(rand() * 70);
      for (let yy = line; yy < line + 12; yy++) {
        for (let xx = x; xx < Math.min(x + w, width - 80); xx++) {
          raw[yy * (width + 1) + 1 + xx] = 40 + Math.floor(rand() * 60);
        }
      }
      x += w + 12;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
