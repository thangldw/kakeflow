import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const notices = [
  'PaddleOCR PP-OCRv5 mobile ONNX models',
  'Source: https://github.com/PaddlePaddle/PaddleOCR',
  'License: Apache-2.0',
  '',
  'ONNX Runtime Web',
  'Source: https://github.com/microsoft/onnxruntime',
  'License: MIT',
  '',
].join('\n')

async function writeIfChanged(destination, contents) {
  try {
    if (await readFile(destination, 'utf8') === contents) return false
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, contents)
  return true
}

export async function writePaddleResourceMetadata(targetRoot, { models, ortFiles }) {
  const manifest = `${JSON.stringify({
    engine: '@paddleocr/paddleocr-js',
    version: 'PP-OCRv5',
    models,
    ortFiles,
  }, null, 2)}\n`
  await Promise.all([
    writeIfChanged(path.join(targetRoot, 'manifest.json'), manifest),
    writeIfChanged(path.join(targetRoot, 'THIRD_PARTY_NOTICES.txt'), notices),
  ])
}
