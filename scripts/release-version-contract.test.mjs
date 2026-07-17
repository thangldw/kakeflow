import { describe, expect, it } from 'vitest'

import {
  macDmgArtifactName,
  validateReleaseVersionContract,
  windowsInstallerArtifactName,
} from './release-version-contract.mjs'

function fixture(overrides = {}) {
  const version = '1.2.3'
  return {
    packageJson: { name: 'kakeflow', version },
    packageLock: { name: 'kakeflow', version, packages: { '': { name: 'kakeflow', version } } },
    tauriConfig: { version },
    cargoToml: `[package]\nname = "kakeflow"\nversion = "${version}"\n\n[dependencies]\nserde = "1"\n`,
    cargoLock: `version = 4\n\n[[package]]\nname = "another"\nversion = "9.0.0"\n\n[[package]]\nname = "kakeflow"\nversion = "${version}"\n`,
    changelog: `# Changelog\n\n## ${version} — 2026-07-15\n\n- Current.\n\n## 1.2.2 — 2026-07-14\n`,
    readme: `# KakeFlow\n\nVersion ${version} is the current stable desktop milestone.\nVersion 0.90 adds historical behavior.\n`,
    projectPage: `<a href="https://github.com/thangldw/kakeflow-releases/releases/download/v${version}/KakeFlow_${version}_aarch64.dmg">macOS</a>\n<a href="https://github.com/thangldw/kakeflow-releases/releases/tag/v${version}">v${version} release notes</a>\n<a href="https://github.com/thangldw/kakeflow-releases/releases/download/v${version}/KakeFlow_${version}_aarch64.dmg">Try macOS</a>\n<p>Planned v2.0.0. Historical v0.90.0.</p>`,
    ...overrides,
  }
}

describe('release version contract', () => {
  it('accepts aligned metadata, repeated valid CTAs, and unrelated roadmap/history prose', () => {
    expect(validateReleaseVersionContract(fixture())).toMatchObject({
      version: '1.2.3',
      projectPageLinks: { releaseNoteCtas: 1, artifactCtas: 2 },
    })
    expect(macDmgArtifactName('1.2.3', 'aarch64')).toBe('KakeFlow_1.2.3_aarch64.dmg')
    expect(windowsInstallerArtifactName('1.2.3', 'x64')).toBe('KakeFlow_1.2.3_x64-setup.exe')
    expect(() => macDmgArtifactName('1.2.3', 'x64')).toThrow('Unsupported macOS DMG architecture')
    expect(() => windowsInstallerArtifactName('1.2.3', 'arm64')).toThrow('Unsupported Windows installer architecture')
  })

  it('rejects drift in either package-lock version', () => {
    expect(() => validateReleaseVersionContract(fixture({
      packageLock: { version: '1.2.2', packages: { '': { version: '1.2.3' } } },
    }))).toThrow('release version mismatch')
    expect(() => validateReleaseVersionContract(fixture({
      packageLock: { version: '1.2.3', packages: { '': { version: '1.2.2' } } },
    }))).toThrow('release version mismatch')
  })

  it('rejects Cargo.lock drift or duplicate KakeFlow package entries', () => {
    expect(() => validateReleaseVersionContract(fixture({
      cargoLock: '[[package]]\nname = "kakeflow"\nversion = "1.2.2"\n',
    }))).toThrow('release version mismatch')
    expect(() => validateReleaseVersionContract(fixture({
      cargoLock: '[[package]]\nname = "kakeflow"\nversion = "1.2.3"\n\n[[package]]\nname = "kakeflow"\nversion = "1.2.3"\n',
    }))).toThrow('exactly one kakeflow')
  })

  it('rejects a stale first changelog release or README stable marker', () => {
    expect(() => validateReleaseVersionContract(fixture({
      changelog: '# Changelog\n\n## 1.2.2 — old\n\n## 1.2.3 — current\n',
    }))).toThrow('release version mismatch')
    expect(() => validateReleaseVersionContract(fixture({
      readme: 'Version 1.2.2 is the current stable desktop milestone.',
    }))).toThrow('release version mismatch')
  })

  it('rejects one stale CTA even when another repeated CTA is current', () => {
    const current = fixture().projectPage
    expect(() => validateReleaseVersionContract(fixture({
      projectPage: `${current}\n<a href='https://github.com/thangldw/kakeflow-releases/releases/download/v1.2.2/KakeFlow_1.2.2_aarch64.dmg'>stale</a>`,
    }))).toThrow('Stale or malformed production artifact tag')
  })

  it('rejects a tag/artifact mismatch and unsupported artifact naming', () => {
    expect(() => validateReleaseVersionContract(fixture({
      projectPage: '<a href="https://github.com/thangldw/kakeflow-releases/releases/tag/v1.2.2">v1.2.2 notes</a><a href="https://github.com/thangldw/kakeflow-releases/releases/download/v1.2.3/KakeFlow_1.2.3_aarch64.dmg">macOS</a>',
    }))).toThrow('release-note CTA')
    expect(() => validateReleaseVersionContract(fixture({
      projectPage: '<a href="https://github.com/thangldw/kakeflow-releases/releases/tag/v1.2.3">v1.2.3 notes</a><a href="https://github.com/thangldw/kakeflow-releases/releases/download/v1.2.3/KakeFlow-latest.dmg">macOS</a>',
    }))).toThrow('Unexpected production artifact name')
    for (const unsupported of ['KakeFlow_1.2.3_x64.dmg', 'KakeFlow_1.2.3_arm64-setup.exe']) {
      expect(() => validateReleaseVersionContract(fixture({
        projectPage: `<a href="https://github.com/thangldw/kakeflow-releases/releases/tag/v1.2.3">v1.2.3 notes</a><a href="https://github.com/thangldw/kakeflow-releases/releases/download/v1.2.3/${unsupported}">unsupported</a>`,
      }))).toThrow('Unexpected production artifact name')
    }
  })

  it('rejects GitHub release CTAs outside exact version tags and artifact downloads', () => {
    expect(() => validateReleaseVersionContract(fixture({
      projectPage: `${fixture().projectPage}<a href="https://github.com/thangldw/kakeflow-releases/releases/latest">latest</a>`,
    }))).toThrow('unclassified production release CTA')
  })
})
