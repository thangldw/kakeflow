const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u
const CARGO_PACKAGE_BLOCK = /^\[\[package\]\]\s*$([\s\S]*?)(?=^\[\[package\]\]\s*$|(?![\s\S]))/gmu
const CARGO_FIELD = (name) => new RegExp(`^${name}\\s*=\\s*"([^"]+)"`, 'mu')
const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a>/giu
const HREF = /\bhref\s*=\s*(["'])(.*?)\1/iu
const RELEASE_PREFIX = 'https://github.com/thangldw/kakeflow/releases/'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

export function assertReleaseVersion(version) {
  assert(typeof version === 'string' && SEMVER.test(version), `Invalid KakeFlow version: ${version}`)
  return version
}

export function macDmgArtifactName(version, architecture) {
  assertReleaseVersion(version)
  assert(architecture === 'aarch64', `Unsupported macOS DMG architecture: ${architecture}`)
  return `KakeFlow_${version}_${architecture}.dmg`
}

export function windowsInstallerArtifactName(version, architecture) {
  assertReleaseVersion(version)
  assert(architecture === 'x64', `Unsupported Windows installer architecture: ${architecture}`)
  return `KakeFlow_${version}_${architecture}-setup.exe`
}

function cargoPackageVersion(cargoToml) {
  const packageSection = /^\[package\]\s*$([\s\S]*?)(?=^\[[^[]|(?![\s\S]))/mu.exec(cargoToml)?.[1]
  return packageSection ? CARGO_FIELD('version').exec(packageSection)?.[1] : undefined
}

function cargoLockPackageVersion(cargoLock, packageName) {
  const matches = []
  for (const block of cargoLock.matchAll(CARGO_PACKAGE_BLOCK)) {
    if (CARGO_FIELD('name').exec(block[1])?.[1] === packageName) {
      matches.push(CARGO_FIELD('version').exec(block[1])?.[1])
    }
  }
  assert(matches.length === 1, `Cargo.lock must contain exactly one ${packageName} package entry`)
  return matches[0]
}

function firstChangelogVersion(changelog) {
  return /^##\s+(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s+(?:—|-)\s+/mu.exec(changelog)?.[1]
}

function readmeStableVersion(readme) {
  const matches = [...readme.matchAll(/^Version\s+(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s+is the current stable desktop milestone\./gmu)]
  assert(matches.length === 1, 'README must contain exactly one full-semver current stable desktop milestone')
  return matches[0][1]
}

function visibleText(html) {
  return html.replace(/<[^>]+>/gu, '').replace(/\s+/gu, ' ').trim()
}

export function validateProductionReleaseLinks(html, version) {
  assertReleaseVersion(version)
  const links = [...html.matchAll(ANCHOR)]
    .map((match) => ({ href: HREF.exec(match[1])?.[2], text: visibleText(match[2]) }))
    .filter(({ href }) => href?.startsWith(RELEASE_PREFIX))
  const tags = links.filter(({ href }) => href.startsWith(`${RELEASE_PREFIX}tag/`))
  const downloads = links.filter(({ href }) => href.startsWith(`${RELEASE_PREFIX}download/`))
  assert(tags.length + downloads.length === links.length, 'Project page contains an unclassified production release CTA')
  assert(tags.length > 0, 'Project page has no production release-note CTA')
  assert(downloads.length > 0, 'Project page has no production artifact CTA')

  const expectedTag = `https://github.com/thangldw/kakeflow/releases/tag/v${version}`
  for (const link of tags) {
    assert(link.href === expectedTag, `Stale or malformed production release-note CTA: ${link.href}`)
    assert(link.text.includes(`v${version}`), `Production release-note CTA text does not show v${version}`)
  }

  const allowedArtifacts = new Set([
    macDmgArtifactName(version, 'aarch64'),
    windowsInstallerArtifactName(version, 'x64'),
  ])
  for (const link of downloads) {
    const match = /\/releases\/download\/v([^/]+)\/([^/]+)$/u.exec(link.href)
    assert(match?.[1] === version, `Stale or malformed production artifact tag: ${link.href}`)
    assert(allowedArtifacts.has(match?.[2]), `Unexpected production artifact name: ${match?.[2] ?? link.href}`)
  }
  return { releaseNoteCtas: tags.length, artifactCtas: downloads.length }
}

export function validateReleaseVersionContract({
  packageJson,
  packageLock,
  tauriConfig,
  cargoToml,
  cargoLock,
  changelog,
  readme,
  projectPage,
}) {
  const version = assertReleaseVersion(packageJson?.version)
  const versions = {
    package: version,
    packageLock: packageLock?.version,
    packageLockRoot: packageLock?.packages?.['']?.version,
    tauri: tauriConfig?.version,
    cargo: cargoPackageVersion(cargoToml),
    cargoLock: cargoLockPackageVersion(cargoLock, 'kakeflow'),
    changelog: firstChangelogVersion(changelog),
    readme: readmeStableVersion(readme),
  }
  const mismatches = Object.entries(versions).filter(([, candidate]) => candidate !== version)
  assert(mismatches.length === 0, `KakeFlow release version mismatch: ${JSON.stringify(versions)}`)
  const projectPageLinks = validateProductionReleaseLinks(projectPage, version)
  return { version, versions, projectPageLinks }
}
