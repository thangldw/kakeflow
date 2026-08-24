import type { VaultKdfParameters } from './vaultTypes'

interface DeriveRequest {
  readonly kind: 'DERIVE_ARGON2ID'
  readonly requestId: string
  readonly passphrase: Uint8Array
  readonly salt: Uint8Array
  readonly parameters: Omit<VaultKdfParameters, 'algorithm' | 'saltBase64' | 'outputBytes'>
}

interface DeriveResponse {
  readonly requestId: string
  readonly keyBytes?: Uint8Array
  readonly error?: 'KEY_DERIVATION_FAILED'
}

interface WorkerScopeLike {
  addEventListener(type: 'message', listener: (event: MessageEvent<DeriveRequest>) => void): void
  postMessage(message: DeriveResponse): void
}

let corePromise: Promise<typeof import('./core-wasm/kakeflow_core.js')> | undefined

async function loadCore() {
  corePromise ??= import('./core-wasm/kakeflow_core.js').then(async (core) => {
    await core.default()
    return core
  })
  return corePromise
}

async function deriveDirect(request: DeriveRequest): Promise<Uint8Array> {
  const core = await loadCore()
  return core.derive_key_argon2id(
    request.passphrase,
    request.salt,
    request.parameters.memoryKib,
    request.parameters.iterations,
    request.parameters.parallelism,
  )
}

const workerScope = globalThis as unknown as Partial<WorkerScopeLike>
const runsInsideWorker = typeof document === 'undefined'
  && typeof workerScope.addEventListener === 'function'
  && typeof workerScope.postMessage === 'function'

if (runsInsideWorker) {
  const dedicatedWorkerScope = workerScope as WorkerScopeLike
  dedicatedWorkerScope.addEventListener('message', (event) => {
    const request = event.data
    void deriveDirect(request)
      .then((keyBytes) => {
        dedicatedWorkerScope.postMessage({ requestId: request.requestId, keyBytes })
        keyBytes.fill(0)
      })
      .catch(() => {
        dedicatedWorkerScope.postMessage({
          requestId: request.requestId,
          error: 'KEY_DERIVATION_FAILED',
        })
      })
      .finally(() => {
        request.passphrase.fill(0)
      })
  })
}

export async function deriveArgon2idInWorker(
  passphrase: Uint8Array,
  salt: Uint8Array,
  parameters: VaultKdfParameters,
): Promise<Uint8Array> {
  const request: DeriveRequest = {
    kind: 'DERIVE_ARGON2ID',
    requestId: crypto.randomUUID(),
    passphrase: passphrase.slice(),
    salt: salt.slice(),
    parameters: {
      memoryKib: parameters.memoryKib,
      iterations: parameters.iterations,
      parallelism: parameters.parallelism,
    },
  }
  if (typeof Worker === 'undefined') {
    try {
      return await deriveDirect(request)
    } finally {
      request.passphrase.fill(0)
    }
  }

  const worker = new Worker(new URL('./argonWorker.ts', import.meta.url), {
    type: 'module',
    name: 'kakeflow-argon2id',
  })
  return new Promise<Uint8Array>((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.terminate()
      request.passphrase.fill(0)
      reject(new Error('Key derivation timed out'))
    }, 120_000)
    worker.onmessage = (event: MessageEvent<DeriveResponse>) => {
      if (event.data.requestId !== request.requestId) return
      clearTimeout(timeout)
      worker.terminate()
      request.passphrase.fill(0)
      if (event.data.error || !event.data.keyBytes) {
        reject(new Error('Key derivation failed'))
        return
      }
      resolve(new Uint8Array(event.data.keyBytes))
    }
    worker.onerror = () => {
      clearTimeout(timeout)
      worker.terminate()
      request.passphrase.fill(0)
      reject(new Error('Key derivation failed'))
    }
    worker.postMessage(request)
  })
}
