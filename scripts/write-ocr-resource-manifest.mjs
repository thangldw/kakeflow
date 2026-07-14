import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const [stageRoot, vcpkgCommit, tesseractVersion, tessdataVersion, triplet] = process.argv.slice(2)
if (!stageRoot || !vcpkgCommit || !tesseractVersion || !tessdataVersion || !triplet) {
  throw new Error('Usage: write-ocr-resource-manifest.mjs STAGE VCPKG_COMMIT TESSERACT_VERSION TESSDATA_VERSION TRIPLET')
}

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
  schemaVersion: 1,
  target: 'macos-arm64',
  minimumSystemVersion: '12.0',
  triplet,
  vcpkgCommit,
  tesseractVersion,
  tessdata: { repository: 'tessdata_fast', version: tessdataVersion, languages: ['eng', 'jpn'] },
  files,
}
await writeFile(path.join(stageRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
