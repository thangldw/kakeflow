export type KakeFlowRuntime = 'tauri' | 'pwa' | 'demo'

type RuntimeScope = typeof globalThis & {
  __TAURI_INTERNALS__?: unknown
}

export function runtimeFromEnvironment(
  value: string | undefined,
  scope: typeof globalThis = globalThis,
): KakeFlowRuntime {
  const override = value?.trim()
  if (override === 'pwa' || override === 'demo') return override
  if (override) throw new Error(`Unsupported KakeFlow runtime: ${override}`)

  const tauriInternals = (scope as RuntimeScope).__TAURI_INTERNALS__
  return typeof tauriInternals === 'object' && tauriInternals !== null ? 'tauri' : 'demo'
}
