import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const targetRoot = join(root, 'public', 'ocr', 'paddleocr')
const verifyOnly = process.argv.includes('--verify-only')

const MODELS = [
  {
    filename: 'PP-OCRv5_mobile_det.tar',
    url: 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_onnx_infer.tar',
    bytes: 4_843_520,
    sha256: '781056046c9ed77a15c94681605db6a0f62317c2e9cce6931c71da2478d4bc30',
  },
  {
    filename: 'PP-OCRv5_mobile_rec.tar',
    url: 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_rec_onnx_infer.tar',
    bytes: 16_701_440,
    sha256: 'f7e792bc836f36e7ef895ad47c426d75b0b75b1650caa6d63fe9418441ffba8c',
  },
]

const ORT_FILES = [
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jspi.mjs',
  'ort-wasm-simd-threaded.jspi.wasm',
]

function sha256(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const input = createReadStream(path)
    input.on('error', reject)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('end', () => resolve(hash.digest('hex')))
  })
}

async function validModel(path, model) {
  if (!existsSync(path)) return false
  const bytes = (await readFile(path)).byteLength
  return bytes === model.bytes && await sha256(path) === model.sha256
}

async function stageModel(model) {
  const target = join(targetRoot, 'models', model.filename)
  if (await validModel(target, model)) return
  if (verifyOnly) throw new Error(`Missing or invalid PaddleOCR model: ${model.filename}`)

  await mkdir(dirname(target), { recursive: true })
  const partial = `${target}.part`
  await rm(partial, { force: true })
  const response = await fetch(model.url)
  if (!response.ok) throw new Error(`Could not download ${model.filename}: HTTP ${response.status}`)
  await writeFile(partial, new Uint8Array(await response.arrayBuffer()))
  if (!await validModel(partial, model)) {
    await rm(partial, { force: true })
    throw new Error(`Checksum or size mismatch for ${model.filename}`)
  }
  await rename(partial, target)
}

async function stageOrtRuntime() {
  const sourceRoot = join(root, 'node_modules', 'onnxruntime-web', 'dist')
  for (const filename of ORT_FILES) {
    const source = join(sourceRoot, filename)
    const target = join(targetRoot, 'ort', filename)
    if (!existsSync(source)) throw new Error(`onnxruntime-web asset is missing: ${source}`)
    if (verifyOnly) {
      if (!existsSync(target) || await sha256(target) !== await sha256(source)) {
        throw new Error(`Missing or invalid bundled ONNX Runtime asset: ${filename}`)
      }
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    await copyFile(source, target)
  }
}

await Promise.all(MODELS.map(stageModel))
await stageOrtRuntime()

if (!verifyOnly) {
  const manifest = {
    engine: '@paddleocr/paddleocr-js',
    version: 'PP-OCRv5',
    generatedAt: new Date().toISOString(),
    models: MODELS.map(({ filename, bytes, sha256 }) => ({ filename, bytes, sha256 })),
    ortFiles: ORT_FILES,
  }
  await writeFile(join(targetRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(join(targetRoot, 'THIRD_PARTY_NOTICES.txt'), [
    'PaddleOCR PP-OCRv5 mobile ONNX models',
    'Source: https://github.com/PaddlePaddle/PaddleOCR',
    'License: Apache-2.0',
    '',
    'ONNX Runtime Web',
    'Source: https://github.com/microsoft/onnxruntime',
    'License: MIT',
    '',
  ].join('\n'))
}

console.log(`PaddleOCR resources ${verifyOnly ? 'verified' : 'staged'} at ${targetRoot}`)
