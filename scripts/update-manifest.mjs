import path from 'node:path'

const TARGET_PATTERNS = [
  ['darwin-aarch64', /(?:aarch64|arm64).*\.app\.tar\.gz$/iu],
  ['darwin-x86_64', /(?:x86_64|x64).*\.app\.tar\.gz$/iu],
  ['windows-x86_64', /(?:x86_64|x64).*(?:\.nsis|\.msi)\.zip$/iu],
  ['windows-i686', /i686.*(?:\.nsis|\.msi)\.zip$/iu],
  ['linux-x86_64', /(?:x86_64|amd64).*\.AppImage\.tar\.gz$/u],
  ['linux-aarch64', /(?:aarch64|arm64).*\.AppImage\.tar\.gz$/u],
]

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

export function targetForUpdaterArtifact(filename) {
  return TARGET_PATTERNS.find(([, pattern]) => pattern.test(filename))?.[0] ?? null
}

export function buildUpdateManifest({ version, notes, pubDate, baseUrl, artifacts }) {
  assert(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version), 'Updater manifest version must be valid semver')
  assert(typeof baseUrl === 'string' && baseUrl.startsWith('https://'), 'Updater artifact base URL must use HTTPS')
  assert(Array.isArray(artifacts) && artifacts.length > 0, 'At least one signed updater artifact is required')

  const platforms = {}
  for (const artifact of artifacts) {
    const target = artifact.target ?? targetForUpdaterArtifact(artifact.filename)
    assert(target, `Unsupported updater artifact filename: ${artifact.filename}`)
    assert(!platforms[target], `More than one updater artifact targets ${target}`)
    assert(typeof artifact.signature === 'string' && artifact.signature.trim().length > 40, `Updater signature is missing for ${artifact.filename}`)
    platforms[target] = {
      signature: artifact.signature.trim(),
      url: `${baseUrl.replace(/\/$/u, '')}/${encodeURIComponent(path.basename(artifact.filename))}`,
    }
  }

  return {
    version,
    notes: typeof notes === 'string' ? notes.trim() : '',
    pub_date: pubDate,
    platforms,
  }
}
