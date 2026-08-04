import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const frames = [
  'docs/assets/demo/overview-vi.jpg',
  'docs/assets/demo/ocr-import-vi.jpg',
  'docs/assets/demo/budgets-vi.jpg',
  'docs/assets/demo/investments-vi.jpg',
]
const width = 960
const pageHeight = 540
const rawFrames = await Promise.all(frames.map((frame) => sharp(path.join(root, frame))
  .resize(width, pageHeight, { fit: 'cover' })
  .ensureAlpha()
  .raw()
  .toBuffer()))

const output = path.join(root, 'docs/assets/demo/kakeflow-feature-tour.gif')
await sharp(Buffer.concat(rawFrames), {
  raw: { width, height: pageHeight * rawFrames.length, channels: 4, pageHeight },
})
  .gif({ loop: 0, delay: [2_200, 2_400, 2_200, 2_400], colours: 128, dither: 0.7, effort: 6 })
  .toFile(output)

console.log(`Landing demo GIF written to ${output}.`)
