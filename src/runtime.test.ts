import { describe, expect, it } from 'vitest'

import { runtimeFromEnvironment } from './runtime'

describe('runtimeFromEnvironment', () => {
  it('selects the dedicated PWA runtime explicitly', () => {
    expect(runtimeFromEnvironment('pwa', {} as typeof globalThis)).toBe('pwa')
  })

  it('selects the synthetic demo runtime explicitly', () => {
    expect(runtimeFromEnvironment('demo', {} as typeof globalThis)).toBe('demo')
  })

  it('detects Tauri only when no runtime override exists', () => {
    const tauriScope = { __TAURI_INTERNALS__: {} } as unknown as typeof globalThis

    expect(runtimeFromEnvironment(undefined, tauriScope)).toBe('tauri')
    expect(runtimeFromEnvironment('', tauriScope)).toBe('tauri')
  })

  it('defaults an ordinary browser to the demo runtime', () => {
    expect(runtimeFromEnvironment(undefined, {} as typeof globalThis)).toBe('demo')
  })

  it('rejects unknown overrides instead of silently selecting a runtime', () => {
    expect(() => runtimeFromEnvironment('preview', {} as typeof globalThis)).toThrow(
      'Unsupported KakeFlow runtime: preview',
    )
  })
})
