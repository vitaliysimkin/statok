// Generates real PNG PWA icons with no external deps:
// node:zlib deflateSync (zlib format) + own CRC32 over a raw RGBA pixel buffer.
// Design: rounded blue square (#2563eb) with white rising bars + an up line.
// No text / fonts. Outputs icon-192, icon-512, maskable-512 into frontend/public/icons.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../frontend/public/icons')

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// CRC32 (PNG polynomial 0xEDB88320), own table.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

// Build a PNG (8-bit RGBA, color type 6) from a width*height*4 byte buffer.
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  // Prepend filter byte (0 = none) per scanline.
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = deflateSync(raw, { level: 9 })

  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const BG = [0x25, 0x63, 0xeb] // #2563eb
const WHITE = [0xff, 0xff, 0xff]

// Draw the icon into an RGBA buffer.
// inset: fraction of the side kept transparent around the rounded square
//   (0 => fills to the very edges, used for maskable so content sits in ~80% center).
// content: fraction of the side occupied by the bars/line glyph (centered).
function render(size, { inset, content }) {
  const buf = Buffer.alloc(size * size * 4) // all zero => transparent

  const pad = Math.round(size * inset)
  const sq = size - pad * 2 // rounded-square side
  const radius = Math.round(sq * 0.22)

  const inRoundedSquare = (x, y) => {
    const lx = x - pad
    const ly = y - pad
    if (lx < 0 || ly < 0 || lx >= sq || ly >= sq) return false
    // corner rounding
    const cx = lx < radius ? radius - lx : lx >= sq - radius ? lx - (sq - radius - 1) : 0
    const cy = ly < radius ? radius - ly : ly >= sq - radius ? ly - (sq - radius - 1) : 0
    if (cx > 0 && cy > 0) return cx * cx + cy * cy <= radius * radius
    return true
  }

  // Content geometry (bars + rising line), centered in the rounded square.
  const cArea = Math.round(sq * content)
  const cOff = pad + Math.round((sq - cArea) / 2)
  // three rising bars across the lower part of the content box
  const barCount = 3
  const gap = Math.round(cArea * 0.08)
  const barW = Math.round((cArea - gap * (barCount - 1)) / barCount)
  const baseY = cOff + cArea // bars sit on this baseline
  const barHeights = [0.42, 0.66, 0.92] // fractions of cArea, rising left->right

  const inBars = (x, y) => {
    for (let i = 0; i < barCount; i++) {
      const bx = cOff + i * (barW + gap)
      const bh = Math.round(cArea * barHeights[i])
      const topY = baseY - bh
      if (x >= bx && x < bx + barW && y >= topY && y < baseY) return true
    }
    return false
  }

  // Rising trend line above the bars: from bottom-left to top-right of content box.
  const lineThick = Math.max(2, Math.round(cArea * 0.07))
  const lx0 = cOff
  const ly0 = cOff + Math.round(cArea * 0.5)
  const lx1 = cOff + cArea
  const ly1 = cOff + Math.round(cArea * 0.06)
  const inLine = (x, y) => {
    if (x < lx0 || x > lx1) return false
    const t = (x - lx0) / (lx1 - lx0)
    const ly = ly0 + (ly1 - ly0) * t
    return Math.abs(y - ly) <= lineThick / 2
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4
      if (!inRoundedSquare(x, y)) continue
      const white = inBars(x, y) || inLine(x, y)
      const c = white ? WHITE : BG
      buf[idx] = c[0]
      buf[idx + 1] = c[1]
      buf[idx + 2] = c[2]
      buf[idx + 3] = 0xff
    }
  }
  return buf
}

mkdirSync(OUT_DIR, { recursive: true })

const targets = [
  { file: 'icon-192.png', size: 192, opts: { inset: 0.04, content: 0.6 } },
  { file: 'icon-512.png', size: 512, opts: { inset: 0.04, content: 0.6 } },
  // maskable: background to the very edges (inset 0), content within central ~80%.
  { file: 'maskable-512.png', size: 512, opts: { inset: 0, content: 0.5 } },
]

for (const t of targets) {
  const rgba = render(t.size, t.opts)
  const png = encodePng(t.size, t.size, rgba)
  writeFileSync(resolve(OUT_DIR, t.file), png)
  console.log(`wrote ${t.file} (${png.length} bytes, ${t.size}x${t.size})`)
}
