import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const root = path.resolve(process.env.INIT_CWD || process.cwd())
const resourceRoot = path.resolve(process.env.KAKEFLOW_OCR_RESOURCE_ROOT || path.join(root, 'src-tauri', 'generated-resources', 'ocr'))
const expected = {
  target: 'macos-arm64',
  minimumSystemVersion: '12.0',
  triplet: 'arm64-osx-kakeflow',
  vcpkgCommit: 'b5229343b4b80264ed51e89c6a7dcd0cbe85e9cc',
  tesseractVersion: '5.5.2',
  tessdataVersion: '4.1.0',
  fixedHashes: {
    'tessdata/eng.traineddata': '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
    'tessdata/jpn.traineddata': '1f5de9236d2e85f5fdf4b3c500f2d4926f8d9449f28f5394472d9e8d83b91b4d',
    'tessdata/configs/tsv': '59d079bb75d8b3d7c839a3564580cb559e362c93a9d70f234e421c0c3e767e04',
  },
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex')
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

const manifest = JSON.parse(await readFile(path.join(resourceRoot, 'manifest.json'), 'utf8'))
assert(manifest.schemaVersion === 1, 'Unsupported OCR resource manifest')
for (const key of ['target', 'minimumSystemVersion', 'triplet', 'vcpkgCommit', 'tesseractVersion']) {
  assert(manifest[key] === expected[key], `Unexpected OCR ${key}: ${manifest[key]}`)
}
assert(manifest.tessdata?.repository === 'tessdata_fast' && manifest.tessdata?.version === expected.tessdataVersion, 'Unexpected tessdata source')
assert(JSON.stringify(manifest.tessdata.languages) === JSON.stringify(['eng', 'jpn']), 'Packaged OCR requires exactly eng and jpn models')
const actualFiles = (await filesBelow(resourceRoot)).sort()
const manifestedFiles = Object.keys(manifest.files ?? {}).sort()
assert(JSON.stringify(actualFiles) === JSON.stringify(manifestedFiles), 'OCR resource tree and manifest file list differ')

for (const [relative, metadata] of Object.entries(manifest.files ?? {})) {
  const absolute = path.resolve(resourceRoot, ...relative.split('/'))
  assert(absolute.startsWith(`${resourceRoot}${path.sep}`), `Unsafe OCR resource path: ${relative}`)
  const fileStat = await stat(absolute)
  assert(fileStat.isFile() && fileStat.size === metadata.bytes, `OCR resource size mismatch: ${relative}`)
  assert(await sha256(absolute) === metadata.sha256, `OCR resource checksum mismatch: ${relative}`)
}
for (const [relative, hash] of Object.entries(expected.fixedHashes)) {
  assert(manifest.files?.[relative]?.sha256 === hash, `Pinned OCR resource is missing or changed: ${relative}`)
}
for (const relative of ['tesseract', 'notices/tesseract-Apache-2.0.txt', 'notices/THIRD_PARTY_NOTICES.txt']) {
  assert(manifest.files?.[relative], `Required OCR resource is missing from manifest: ${relative}`)
}

const executable = path.join(resourceRoot, 'tesseract')
await access(executable)
assert(((await stat(executable)).mode & 0o111) !== 0, 'Packaged Tesseract is not executable')
if (process.platform === 'darwin') {
  const architectures = await execFile('/usr/bin/lipo', ['-archs', executable])
  assert(architectures.stdout.trim().split(/\s+/u).includes('arm64'), 'Packaged Tesseract does not contain arm64 code')
  const { stdout } = await execFile('/usr/bin/otool', ['-L', executable])
  const nonSystem = stdout.split(/\r?\n/u).slice(1).map((line) => line.trim().split(/\s+/u)[0]).filter(Boolean)
    .filter((dependency) => !dependency.startsWith('/usr/lib/') && !dependency.startsWith('/System/Library/') && !dependency.startsWith('@executable_path/') && !dependency.startsWith('@loader_path/'))
  assert(nonSystem.length === 0, `Packaged Tesseract has non-system dynamic dependencies: ${nonSystem.join(', ')}`)
}

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-ocr-resource-smoke-'))
try {
  const fixture = path.join(temporaryRoot, 'receipt.pgm')
  // A deterministic high-contrast E-ink-style line. The smoke checks engine/model/config execution,
  // not OCR accuracy; application-level extraction fixtures cover recognition semantics.
  const width = 720
  const height = 120
  const pixels = Buffer.alloc(width * height, 255)
  for (let y = 20; y < 100; y += 1) {
    for (let x = 30; x < 690; x += 1) {
      if ((x % 42 < 7) || (y % 34 < 6)) pixels[y * width + x] = 0
    }
  }
  await writeFile(fixture, Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`, 'ascii'), pixels]))
  const cleanEnvironment = { PATH: '/usr/bin:/bin', HOME: temporaryRoot, LANG: 'C' }
  const tessdata = path.join(resourceRoot, 'tessdata')
  const languages = await execFile(executable, ['--tessdata-dir', tessdata, '--list-langs'], { env: cleanEnvironment })
  assert(/(^|\n)eng(\n|$)/u.test(languages.stdout) && /(^|\n)jpn(\n|$)/u.test(languages.stdout), 'Packaged OCR models are not loadable')
  const result = await execFile(executable, [fixture, 'stdout', '--tessdata-dir', tessdata, '-l', 'jpn+eng', 'tsv'], { env: cleanEnvironment, maxBuffer: 4 * 1024 * 1024 })
  assert(result.stdout.startsWith('level\tpage_num\tblock_num\tpar_num\tline_num\tword_num'), 'Packaged OCR TSV smoke failed')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}

console.log(`Packaged OCR resources verified (Tesseract ${manifest.tesseractVersion}, eng+jpn, ${Object.keys(manifest.files).length} files)`)
