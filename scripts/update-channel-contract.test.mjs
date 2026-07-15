import { describe, expect, it } from 'vitest'
import { validateUpdateChannelContract } from './update-channel-contract.mjs'

const endpoint = 'https://updates.example.test/{{target}}/{{arch}}/{{current_version}}'
const publicKey = `untrusted comment: minisign public key\n${'R'.repeat(72)}`

function disabled(overrides = {}) {
  return {
    descriptor: {
      schemaVersion: 1,
      channel: 'stable',
      status: 'DISABLED_UNCONFIGURED',
      reason: 'PRODUCTION_SIGNING_KEY_AND_ENDPOINT_NOT_CONFIGURED',
      endpoint: null,
      publicKey: null,
    },
    tauriConfig: { bundle: { createUpdaterArtifacts: false } },
    packageJson: { dependencies: { '@tauri-apps/api': '2' } },
    cargoToml: '[dependencies]\ntauri = "2"\n',
    capabilities: [{ permissions: ['core:default'] }],
    ...overrides,
  }
}

function enabled(overrides = {}) {
  const base = {
    descriptor: { schemaVersion: 1, channel: 'stable', status: 'ENABLED', reason: null, endpoint, publicKey },
    tauriConfig: {
      bundle: { createUpdaterArtifacts: true },
      plugins: { updater: { pubkey: publicKey, endpoints: [endpoint], dangerousInsecureTransportProtocol: false } },
    },
    packageJson: { dependencies: { '@tauri-apps/plugin-updater': '2' } },
    cargoToml: '[dependencies]\ntauri-plugin-updater = "2"\n',
    capabilities: [{ permissions: ['core:default', 'updater:default'] }],
  }
  return { ...base, ...overrides }
}

describe('update channel contract', () => {
  it('accepts only a completely inert disabled channel', () => {
    expect(validateUpdateChannelContract(disabled())).toEqual({ channel: 'stable', status: 'DISABLED_UNCONFIGURED' })
  })

  it.each([
    ['an endpoint', { descriptor: { ...disabled().descriptor, endpoint } }],
    ['a public key', { descriptor: { ...disabled().descriptor, publicKey } }],
    ['updater artifacts', { tauriConfig: { bundle: { createUpdaterArtifacts: true } } }],
    ['plugin configuration', { tauriConfig: { bundle: { createUpdaterArtifacts: false }, plugins: { updater: {} } } }],
    ['the JavaScript dependency', { packageJson: { dependencies: { '@tauri-apps/plugin-updater': '2' } } }],
    ['the Rust dependency', { cargoToml: '[dependencies]\ntauri-plugin-updater = "2"\n' }],
    ['an updater permission', { capabilities: [{ permissions: ['updater:allow-check'] }] }],
  ])('rejects disabled state containing %s', (_label, override) => {
    expect(() => validateUpdateChannelContract(disabled(override))).toThrow()
  })

  it('accepts an atomically configured future enabled channel', () => {
    expect(validateUpdateChannelContract(enabled())).toEqual({ channel: 'stable', status: 'ENABLED' })
  })

  it('accepts an HTTPS static latest.json endpoint without template variables', () => {
    const fixture = enabled()
    fixture.descriptor.endpoint = 'https://github.com/example/kakeflow/releases/latest/download/latest.json'
    fixture.tauriConfig.plugins.updater.endpoints = [fixture.descriptor.endpoint]
    expect(validateUpdateChannelContract(fixture)).toEqual({ channel: 'stable', status: 'ENABLED' })
  })

  it.each([
    ['artifact generation', { tauriConfig: { ...enabled().tauriConfig, bundle: { createUpdaterArtifacts: false } } }],
    ['JavaScript dependency', { packageJson: { dependencies: {} } }],
    ['Rust dependency', { cargoToml: '[dependencies]\ntauri = "2"\n' }],
    ['default capability', { capabilities: [{ permissions: ['core:default'] }] }],
    ['plugin configuration', { tauriConfig: { bundle: { createUpdaterArtifacts: true } } }],
  ])('rejects enabled state missing %s', (_label, override) => {
    expect(() => validateUpdateChannelContract(enabled(override))).toThrow()
  })

  it('rejects insecure, incomplete, or custom-variable endpoints', () => {
    for (const badEndpoint of [
      'http://updates.example.test/{{target}}/{{arch}}/{{current_version}}',
      'https://updates.example.test/{{target}}/{{current_version}}',
      'https://updates.example.test/{{target}}/{{arch}}/{{current_version}}/{{channel}}',
      'https://updates.example.test/releases/current.json',
      'https://updates.example.test/{{target}}/{{arch}}/{{arch}}/{{current_version}}',
    ]) {
      const fixture = enabled()
      fixture.descriptor.endpoint = badEndpoint
      fixture.tauriConfig.plugins.updater.endpoints = [badEndpoint]
      expect(() => validateUpdateChannelContract(fixture)).toThrow()
    }
    const dangerous = enabled()
    dangerous.tauriConfig.plugins.updater.dangerousInsecureTransportProtocol = true
    expect(() => validateUpdateChannelContract(dangerous)).toThrow('must not allow insecure transport')
  })

  it('rejects placeholder, short, or path-based public keys', () => {
    for (const badKey of ['<YOUR_PUBLIC_KEY>', 'short', './keys/update.pub', 'C:\\keys\\update.pem']) {
      const fixture = enabled()
      fixture.descriptor.publicKey = badKey
      fixture.tauriConfig.plugins.updater.pubkey = badKey
      expect(() => validateUpdateChannelContract(fixture)).toThrow('inline public key')
    }
  })

  it('rejects configuration drift between the descriptor and Tauri', () => {
    const endpointDrift = enabled()
    endpointDrift.tauriConfig.plugins.updater.endpoints = [`${endpoint}?mirror=1`]
    expect(() => validateUpdateChannelContract(endpointDrift)).toThrow('endpoint differs')
    const keyDrift = enabled()
    keyDrift.tauriConfig.plugins.updater.pubkey = `${publicKey}x`
    expect(() => validateUpdateChannelContract(keyDrift)).toThrow('public key differs')
  })
})
