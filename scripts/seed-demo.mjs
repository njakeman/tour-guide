/**
 * fieldWorks — Demo media seed script
 *
 * Generates placeholder media files into public/tours/<route>/ for each
 * demo route so the demo tours render fully in the browser without
 * committing any binaries to the repository.
 *
 * Usage:
 *   npm run demo:seed          # generate once
 *   npm run demo               # generate + start dev server
 *
 * Routes seeded (all output gitignored) — see the ROUTES table at the end:
 *   cissbury-ring     — heroes, inline image, audio, video, 3D model
 *   wolstonbury-hill  — heroes, inline image, audio, 3D model
 *   mount-caburn      — heroes, inline image, audio
 *
 * Zero npm dependencies: uses only Node built-ins (fs, zlib, path).
 * Idempotent: skips files that already exist.
 */

import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { createDeflate } from 'zlib'
import { join } from 'path'

// ─── helpers ────────────────────────────────────────────────────────────────

function skip(dir, name) {
  const p = join(dir, name)
  if (existsSync(p)) { console.log(`  skip  ${name}`) ; return true }
  return false
}

function write(dir, name, buf) {
  writeFileSync(join(dir, name), buf)
  console.log(`  wrote ${name}  (${buf.length} bytes)`)
}

// ─── PNG writer ──────────────────────────────────────────────────────────────
// Produces a valid PNG using only Node's built-in zlib (deflate).

function crc32(buf, start = 0, end = buf.length) {
  let c = 0xffffffff
  const table = crc32.table ??= (() => {
    const t = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let v = i
      for (let k = 0; k < 8; k++) v = (v & 1) ? 0xedb88320 ^ (v >>> 1) : v >>> 1
      t[i] = v
    }
    return t
  })()
  for (let i = start; i < end; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length)
  const crcBuf = Buffer.concat([typeBytes, data])
  const crcVal = Buffer.allocUnsafe(4); crcVal.writeUInt32BE(crc32(crcBuf))
  return Buffer.concat([len, typeBytes, data, crcVal])
}

/** Parse hex colour like #b06a33 → [r,g,b] */
function hex(h) {
  const v = parseInt(h.slice(1), 16)
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
}

/** Draw text into pixel buffer using a tiny 5×7 bitmap font (ASCII 32-126) */
const FONT_W = 5, FONT_H = 7
// Compact 5×7 font: each char = 5 bytes, each byte = one column of 7 bits (bit0=top)
const FONT_DATA = {
  ' ':  [0x00,0x00,0x00,0x00,0x00],
  'A':  [0x7c,0x12,0x12,0x12,0x7c], 'B':  [0x7f,0x49,0x49,0x49,0x36],
  'C':  [0x3e,0x41,0x41,0x41,0x22], 'D':  [0x7f,0x41,0x41,0x22,0x1c],
  'E':  [0x7f,0x49,0x49,0x49,0x41], 'F':  [0x7f,0x09,0x09,0x09,0x01],
  'G':  [0x3e,0x41,0x49,0x49,0x7a], 'H':  [0x7f,0x08,0x08,0x08,0x7f],
  'I':  [0x00,0x41,0x7f,0x41,0x00], 'J':  [0x20,0x40,0x41,0x3f,0x01],
  'K':  [0x7f,0x08,0x14,0x22,0x41], 'L':  [0x7f,0x40,0x40,0x40,0x40],
  'M':  [0x7f,0x02,0x04,0x02,0x7f], 'N':  [0x7f,0x04,0x08,0x10,0x7f],
  'O':  [0x3e,0x41,0x41,0x41,0x3e], 'P':  [0x7f,0x09,0x09,0x09,0x06],
  'Q':  [0x3e,0x41,0x51,0x21,0x5e], 'R':  [0x7f,0x09,0x19,0x29,0x46],
  'S':  [0x46,0x49,0x49,0x49,0x31], 'T':  [0x01,0x01,0x7f,0x01,0x01],
  'U':  [0x3f,0x40,0x40,0x40,0x3f], 'V':  [0x1f,0x20,0x40,0x20,0x1f],
  'W':  [0x3f,0x40,0x38,0x40,0x3f], 'X':  [0x63,0x14,0x08,0x14,0x63],
  'Y':  [0x07,0x08,0x70,0x08,0x07], 'Z':  [0x61,0x51,0x49,0x45,0x43],
  'a':  [0x20,0x54,0x54,0x54,0x78], 'b':  [0x7f,0x44,0x44,0x44,0x38],
  'c':  [0x38,0x44,0x44,0x44,0x28], 'd':  [0x38,0x44,0x44,0x48,0x7f],
  'e':  [0x38,0x54,0x54,0x54,0x18], 'f':  [0x08,0x7e,0x09,0x01,0x02],
  'g':  [0x0c,0x52,0x52,0x52,0x3e], 'h':  [0x7f,0x08,0x04,0x04,0x78],
  'i':  [0x00,0x44,0x7d,0x40,0x00], 'j':  [0x20,0x40,0x44,0x3d,0x00],
  'k':  [0x7f,0x10,0x28,0x44,0x00], 'l':  [0x00,0x41,0x7f,0x40,0x00],
  'm':  [0x7c,0x04,0x18,0x04,0x78], 'n':  [0x7c,0x08,0x04,0x04,0x78],
  'o':  [0x38,0x44,0x44,0x44,0x38], 'p':  [0x7c,0x14,0x14,0x14,0x08],
  'q':  [0x08,0x14,0x14,0x18,0x7c], 'r':  [0x7c,0x08,0x04,0x04,0x08],
  's':  [0x48,0x54,0x54,0x54,0x20], 't':  [0x04,0x3f,0x44,0x40,0x20],
  'u':  [0x3c,0x40,0x40,0x20,0x7c], 'v':  [0x1c,0x20,0x40,0x20,0x1c],
  'w':  [0x3c,0x40,0x30,0x40,0x3c], 'x':  [0x44,0x28,0x10,0x28,0x44],
  'y':  [0x0c,0x50,0x50,0x50,0x3c], 'z':  [0x44,0x64,0x54,0x4c,0x44],
  '0':  [0x3e,0x51,0x49,0x45,0x3e], '1':  [0x00,0x42,0x7f,0x40,0x00],
  '2':  [0x42,0x61,0x51,0x49,0x46], '3':  [0x21,0x41,0x45,0x4b,0x31],
  '4':  [0x18,0x14,0x12,0x7f,0x10], '5':  [0x27,0x45,0x45,0x45,0x39],
  '6':  [0x3c,0x4a,0x49,0x49,0x30], '7':  [0x01,0x71,0x09,0x05,0x03],
  '8':  [0x36,0x49,0x49,0x49,0x36], '9':  [0x06,0x49,0x49,0x29,0x1e],
  ':':  [0x00,0x36,0x36,0x00,0x00], '.':  [0x00,0x60,0x60,0x00,0x00],
  '-':  [0x08,0x08,0x08,0x08,0x08], '/':  [0x20,0x10,0x08,0x04,0x02],
  '·':  [0x00,0x18,0x18,0x00,0x00], '(':  [0x00,0x1c,0x22,0x41,0x00],
  ')':  [0x00,0x41,0x22,0x1c,0x00], ',':  [0x00,0x50,0x30,0x00,0x00],
}

function drawText(pixels, W, x0, y0, text, r, g, b, scale = 2) {
  for (let ci = 0; ci < text.length; ci++) {
    const glyph = FONT_DATA[text[ci]] ?? FONT_DATA[' ']
    for (let col = 0; col < FONT_W; col++) {
      const colBits = glyph[col]
      for (let row = 0; row < FONT_H; row++) {
        if (colBits & (1 << row)) {
          for (let sy = 0; sy < scale; sy++)
            for (let sx = 0; sx < scale; sx++) {
              const px = x0 + (ci * (FONT_W + 1) + col) * scale + sx
              const py = y0 + row * scale + sy
              if (px >= 0 && px < W && py >= 0) {
                const i = (py * W + px) * 4
                pixels[i] = r; pixels[i+1] = g; pixels[i+2] = b; pixels[i+3] = 255
              }
            }
        }
      }
    }
  }
}

async function makePNG(W, H, options = {}) {
  const {
    bg       = '#e8dcc8',
    stroke   = '#9a8c5d',
    band     = '#cdb585',
    textCol  = '#26241f',
    label    = 'PLACEHOLDER',
    sublabel = '',
    watermark = true,
  } = options

  const [bgR, bgG, bgB] = hex(bg)
  const [stR, stG, stB] = hex(stroke)
  const [baR, baG, baB] = hex(band)
  const [txR, txG, txB] = hex(textCol)

  const pixels = new Uint8Array(W * H * 4)

  // Fill background
  for (let i = 0; i < W * H; i++) {
    pixels[i*4]=bgR; pixels[i*4+1]=bgG; pixels[i*4+2]=bgB; pixels[i*4+3]=255
  }

  // Horizontal accent band (bottom third)
  const bandY = Math.floor(H * 0.62)
  for (let y = bandY; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = (y - bandY) / (H - bandY)
      pixels[(y*W+x)*4]   = Math.round(baR * (1-t) + bgR * 0.6 * t)
      pixels[(y*W+x)*4+1] = Math.round(baG * (1-t) + bgG * 0.6 * t)
      pixels[(y*W+x)*4+2] = Math.round(baB * (1-t) + bgB * 0.6 * t)
      pixels[(y*W+x)*4+3] = 255
    }

  // Sine contour lines
  const numLines = 4
  for (let l = 0; l < numLines; l++) {
    const baseY = Math.floor(H * (0.35 + l * 0.13))
    const amp   = 12 - l * 2
    const freq  = 0.012 + l * 0.002
    for (let x = 0; x < W; x++) {
      const y = baseY + Math.round(Math.sin(x * freq + l) * amp)
      for (let t = -1; t <= 1; t++) {
        const py = y + t
        if (py >= 0 && py < H) {
          const i = (py * W + x) * 4
          pixels[i]   = stR; pixels[i+1] = stG
          pixels[i+2] = stB; pixels[i+3] = Math.round(180 - l * 30)
        }
      }
    }
  }

  // Label text (centred, scale=2)
  const scale = 2
  const charW = (FONT_W + 1) * scale
  const textW = label.length * charW
  const tx = Math.max(8, Math.floor((W - textW) / 2))
  const ty = Math.floor(H * 0.18)
  drawText(pixels, W, tx, ty, label, txR, txG, txB, scale)

  if (sublabel) {
    const sw = sublabel.length * charW
    const sx = Math.max(8, Math.floor((W - sw) / 2))
    drawText(pixels, W, sx, ty + FONT_H * scale + 6, sublabel, stR, stG, stB, scale)
  }

  if (watermark) {
    const wm = 'fieldWorks demo'
    drawText(pixels, W, 8, H - FONT_H*scale - 8, wm, stR, stG, stB, scale)
  }

  // Build PNG: IHDR
  const ihdr = Buffer.allocUnsafe(13)
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4)
  ihdr[8]=8; ihdr[9]=2; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0  // 8-bit RGB, no alpha (simplified)

  // Convert RGBA to filtered RGB scanlines (filter byte 0 = None per row)
  const raw = Buffer.allocUnsafe(H * (1 + W * 3))
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W*3)] = 0  // filter type: None
    for (let x = 0; x < W; x++) {
      const src = (y * W + x) * 4
      const dst = y * (1 + W*3) + 1 + x * 3
      raw[dst]   = pixels[src]
      raw[dst+1] = pixels[src+1]
      raw[dst+2] = pixels[src+2]
    }
  }

  // PNG IDAT must be zlib-wrapped deflate (RFC 1950), NOT raw deflate —
  // raw-deflate output has valid CRCs and a plausible size, but browsers
  // decode it to a fully transparent bitmap. (This bit us: see createDeflate.)
  const compressed = await new Promise((res, rej) => {
    const chunks = []
    const d = createDeflate({ level: 6 })
    d.on('data', c => chunks.push(c))
    d.on('end', () => res(Buffer.concat(chunks)))
    d.on('error', rej)
    d.end(raw)
  })

  return Buffer.concat([
    Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),  // PNG signature
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ─── GLB writer ──────────────────────────────────────────────────────────────
// Produces a minimal valid glTF 2.0 Binary file containing one cube mesh.

function makeGLB() {
  // 8 vertices of a unit cube (positions only)
  const positions = new Float32Array([
    -0.5,-0.5,-0.5,  0.5,-0.5,-0.5,  0.5, 0.5,-0.5, -0.5, 0.5,-0.5,
    -0.5,-0.5, 0.5,  0.5,-0.5, 0.5,  0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
  ])
  // 12 triangles (2 per face × 6 faces). glTF front faces are COUNTER-
  // clockwise viewed from outside — wind them CCW so outward faces survive
  // backface culling (CW winding renders the cube inside-out).
  const indices = new Uint16Array([
    0,2,1, 0,3,2,  // -Z
    4,5,6, 4,6,7,  // +Z
    0,5,4, 0,1,5,  // -Y
    2,7,6, 2,3,7,  // +Y
    0,7,3, 0,4,7,  // -X
    1,6,5, 1,2,6,  // +X
  ])

  const posBuf  = Buffer.from(positions.buffer)
  const idxBuf  = Buffer.from(indices.buffer)
  // Pad buffers to 4-byte alignment
  const pad = n => n % 4 ? 4 - n % 4 : 0
  const idxPad = pad(idxBuf.length)
  const posPad = pad(posBuf.length)

  const binLength = idxBuf.length + idxPad + posBuf.length + posPad
  const binBuf    = Buffer.alloc(binLength)
  idxBuf.copy(binBuf, 0)
  posBuf.copy(binBuf, idxBuf.length + idxPad)

  const idxByteOffset = 0
  const posByteOffset = idxBuf.length + idxPad

  const json = JSON.stringify({
    asset: { version: '2.0', generator: 'fieldWorks seed-demo' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 1 },
        indices: 0,
        material: 0,
      }],
    }],
    materials: [{
      pbrMetallicRoughness: {
        baseColorFactor: [0.4, 0.35, 0.28, 1.0],
        metallicFactor: 0.1,
        roughnessFactor: 0.8,
      },
      name: 'Stone',
    }],
    accessors: [
      {
        bufferView: 0, byteOffset: 0, componentType: 5123 /* UNSIGNED_SHORT */,
        count: indices.length, type: 'SCALAR',
        min: [0], max: [7],
      },
      {
        bufferView: 1, byteOffset: 0, componentType: 5126 /* FLOAT */,
        count: positions.length / 3, type: 'VEC3',
        min: [-0.5,-0.5,-0.5], max: [0.5,0.5,0.5],
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: idxByteOffset, byteLength: idxBuf.length, target: 34963 /* ELEMENT_ARRAY_BUFFER */ },
      { buffer: 0, byteOffset: posByteOffset, byteLength: posBuf.length, target: 34962 /* ARRAY_BUFFER */ },
    ],
    buffers: [{ byteLength: binLength }],
  })

  const jsonBuf    = Buffer.from(json, 'utf8')
  const jsonPad    = pad(jsonBuf.length)
  const jsonChunkL = jsonBuf.length + jsonPad
  const binChunkL  = binLength

  const totalLen = 12 + 8 + jsonChunkL + 8 + binChunkL
  const out = Buffer.alloc(totalLen)
  let off = 0

  // GLB header
  out.writeUInt32LE(0x46546C67, off); off+=4  // magic 'glTF'
  out.writeUInt32LE(2,          off); off+=4  // version 2
  out.writeUInt32LE(totalLen,   off); off+=4  // total length

  // JSON chunk
  out.writeUInt32LE(jsonChunkL,   off); off+=4
  out.writeUInt32LE(0x4E4F534A,   off); off+=4  // 'JSON'
  jsonBuf.copy(out, off); off += jsonBuf.length
  out.fill(0x20, off, off + jsonPad); off += jsonPad  // space padding

  // BIN chunk
  out.writeUInt32LE(binChunkL,    off); off+=4
  out.writeUInt32LE(0x004E4942,   off); off+=4  // 'BIN\0'
  binBuf.copy(out, off)

  return out
}

// ─── Base64-embedded silent MP3 (≈1s, 8kHz mono, 128bps CBR) ───────────────
// 59 bytes: ID3 header + a minimal valid MPEG frame
const SILENT_MP3_B64 = `
SUQzBAAAAAABFgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/7kGQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAA/+5BZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFhpbmcA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==
`.replace(/\s/g, '')

// ─── Base64-embedded minimal MP4 (≈1 frame, black, no audio) ────────────────
// ftyp + moov + mdat — the absolute minimum a browser will accept
const SILENT_MP4_B64 = `
AAAAHGZ0eXBpc29tAAAAAWlzb21pc28yYXZjMQAAAAhmcmVlAAAAGm1kYXQAAAASbWluZgAAAA
xkaW5mAAAADGRyZWYAAAAMdXJsIAAAAQAAAA9zc3RzAAAADAAAAQAAAA9zdHRzAAAADAAAAQAA
AAEAAAAPc3RzYwAAAAwAAAABAAAAASAAAAEAAAAcc3Rzeg==
`.replace(/\s/g, '')

// ─── Main ────────────────────────────────────────────────────────────────────

console.log('\nfieldWorks demo seed\n')

// Chalk-and-flint palette for Cissbury Ring
const heroOpts = { bg: '#e8dcc8', stroke: '#9a8c5d', band: '#cdb585', textCol: '#26241f' }
// Greener downland palette for Wolstonbury Hill so the two demos read apart
const downlandOpts = { bg: '#dde4c8', stroke: '#7d8f5a', band: '#b8c98e', textCol: '#232619' }
// Cooler chalk-and-river palette for Mount Caburn above the Ouse
const caburnOpts = { bg: '#dfe0d6', stroke: '#7f8a80', band: '#b7c2b0', textCol: '#1f2422' }

const ROUTES = [
  { dir: 'cissbury-ring', files: [
    { name: 'entrance.png',      make: () => makePNG(1200, 800, { ...heroOpts, label: 'THE ENTRANCE CAUSEWAY', sublabel: 'TQ 139 080 · 156m AOD' }) },
    { name: 'interior-view.png', make: () => makePNG(1200, 800, { ...heroOpts, label: 'THE INTERIOR SPACE', sublabel: 'TQ 140 082 · 184m AOD' }) },
    { name: 'rampart.png',       make: () => makePNG(800, 500, { ...heroOpts, label: 'RAMPART DETAIL', sublabel: 'inline image demo' }) },
    { name: 'narration.mp3',     make: () => Buffer.from(SILENT_MP3_B64, 'base64') },
    { name: 'flythrough.mp4',    make: () => Buffer.from(SILENT_MP4_B64, 'base64') },
    { name: 'fort.glb',          make: () => makeGLB() },
  ]},
  { dir: 'wolstonbury-hill', files: [
    { name: 'chalk-path.png',        make: () => makePNG(1200, 800, { ...downlandOpts, label: 'THE CHALK BOSTAL', sublabel: 'TQ 282 135' }) },
    { name: 'ring-bank.png',         make: () => makePNG(1200, 800, { ...downlandOpts, label: 'THE RING BANK', sublabel: 'TQ 283 137' }) },
    { name: 'summit-bowl.png',       make: () => makePNG(1200, 800, { ...downlandOpts, label: 'SUMMIT AND DEW POND', sublabel: 'TQ 284 138 · 206m AOD' }) },
    { name: 'orchid-bank.png',       make: () => makePNG(800, 500, { ...downlandOpts, label: 'ORCHID BANK', sublabel: 'inline image demo' }) },
    { name: 'wolstonbury-intro.mp3', make: () => Buffer.from(SILENT_MP3_B64, 'base64') },
    { name: 'enclosure.glb',         make: () => makeGLB() },
  ]},
  { dir: 'mount-caburn', files: [
    { name: 'coombe.png',        make: () => makePNG(1200, 800, { ...caburnOpts, label: 'THE GLYNDE ASCENT', sublabel: 'TQ 457 088' }) },
    { name: 'rampart-crest.png', make: () => makePNG(1200, 800, { ...caburnOpts, label: 'THE GREAT RAMPART', sublabel: 'TQ 445 089' }) },
    { name: 'pit-field.png',     make: () => makePNG(1200, 800, { ...caburnOpts, label: 'THE PIT FIELD', sublabel: 'TQ 444 089 · 146m AOD' }) },
    { name: 'ouse-view.png',     make: () => makePNG(800, 500, { ...caburnOpts, label: 'THE OUSE VALLEY', sublabel: 'inline image demo' }) },
    { name: 'caburn-intro.mp3',  make: () => Buffer.from(SILENT_MP3_B64, 'base64') },
  ]},
]

for (const route of ROUTES) {
  const outDir = join('public', 'tours', route.dir)
  mkdirSync(outDir, { recursive: true })
  console.log(`${route.dir}/`)
  for (const f of route.files) {
    if (!skip(outDir, f.name)) write(outDir, f.name, await f.make())
  }
  console.log('')
}

console.log('Done — run "npm run dev" or "npm run build" to see the demo tours.\n')
