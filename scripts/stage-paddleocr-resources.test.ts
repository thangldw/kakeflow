import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const metadataModulePath = './paddleocr-resource-metadata.mjs'
const metadataModule = await import(metadataModulePath).catch(() => ({}))

describe('PaddleOCR staged metadata', () => {
  it('publishes deterministic bytes and does not rewrite unchanged effective build inputs', async () => {
    expect(metadataModule.writePaddleResourceMetadata).toBeTypeOf('function')
    if (typeof metadataModule.writePaddleResourceMetadata !== 'function') return
    const root = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-paddle-metadata-test-'))
    try {
      await mkdir(root, { recursive: true })
      const contract = {
        models: [{ filename: 'model 日本語.tar', bytes: 7, sha256: 'a'.repeat(64) }],
        ortFiles: ['runtime with space.wasm'],
      }
      await metadataModule.writePaddleResourceMetadata(root, contract)
      const manifest = path.join(root, 'manifest.json')
      const firstBytes = await readFile(manifest, 'utf8')
      const firstMtime = (await stat(manifest)).mtimeMs
      await new Promise((resolve) => setTimeout(resolve, 20))
      await metadataModule.writePaddleResourceMetadata(root, contract)
      expect(await readFile(manifest, 'utf8')).toBe(firstBytes)
      expect((await stat(manifest)).mtimeMs).toBe(firstMtime)
      expect(JSON.parse(firstBytes)).toEqual({
        engine: '@paddleocr/paddleocr-js',
        version: 'PP-OCRv5',
        models: contract.models,
        ortFiles: contract.ortFiles,
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
