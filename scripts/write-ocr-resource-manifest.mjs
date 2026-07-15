import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ocrTargetContract } from './ocr-resource-contract.mjs'

const [stageRoot, target] = process.argv.slice(2)
if (!stageRoot || !target) {
  throw new Error('Usage: write-ocr-resource-manifest.mjs STAGE TARGET')
}
const contract = ocrTargetContract(target)

async function filesBelow(directory, prefix = '') {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.gitkeep' || entry.name === 'manifest.json') continue
    const relative = path.posix.join(prefix, entry.name)
    if (entry.isDirectory()) result.push(...await filesBelow(path.join(directory, entry.name), relative))
    else if (entry.isFile()) result.push(relative)
  }
  return result
}

const files = {}
for (const relative of (await filesBelow(stageRoot)).sort()) {
  const absolute = path.join(stageRoot, ...relative.split('/'))
  const bytes = await readFile(absolute)
  files[relative] = {
    bytes: (await stat(absolute)).size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

const manifest = {
  schemaVersion: 2,
  target: contract.target,
  minimumSystemVersion: contract.minimumSystemVersion,
  triplet: contract.triplet,
  vcpkgCommit: contract.vcpkgCommit,
  tesseractVersion: contract.tesseractVersion,
  linkage: { libraries: contract.libraryLinkage, crt: contract.crtLinkage },
  tessdata: { repository: 'tessdata_fast', version: contract.tessdataVersion, languages: ['eng', 'jpn'] },
  files,
}
await writeFile(path.join(stageRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
