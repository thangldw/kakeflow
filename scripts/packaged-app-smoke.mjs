import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(process.env.INIT_CWD || process.cwd())
const defaultTimeoutMs = 45_000

export function executableForPlatform(platform = process.platform, repositoryRoot = root) {
  const release = path.join(repositoryRoot, 'src-tauri', 'target', 'release')
  if (platform === 'darwin') {
    return path.join(release, 'bundle', 'macos', 'KakeFlow.app', 'Contents', 'MacOS', 'kakeflow')
  }
  if (platform === 'win32') {
    return path.join(release, 'kakeflow.exe')
  }
  throw new Error(`Packaged app smoke is supported only on macOS and Windows, not ${platform}`)
}

export function validateSmokeResult(result) {
  if (
    result?.status !== 'ok' ||
    result.application !== 'KakeFlow' ||
    result.window !== 'main' ||
    result.ipc !== true ||
    result.databaseHealthy !== true ||
    !Number.isInteger(result.schemaVersion) ||
    result.schemaVersion <= 0
  ) {
    throw new Error(`Invalid packaged smoke result: ${JSON.stringify(result)}`)
  }
  return result
}

function launch(executable, dataRoot, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], {
      cwd: path.dirname(executable),
      env: {
        ...process.env,
        KAKEFLOW_PACKAGED_SMOKE: '1',
        KAKEFLOW_SMOKE_ROOT: dataRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-16_384)
    })
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-16_384)
    })

    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Packaged app did not finish within ${timeoutMs}ms`))
    }, timeoutMs)

    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(
          new Error(
            `Packaged app exited with code ${code ?? 'null'} signal ${signal ?? 'none'}\n${stdout}\n${stderr}`,
          ),
        )
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

export async function runPackagedSmoke({
  executable = process.env.KAKEFLOW_SMOKE_EXECUTABLE || executableForPlatform(),
  timeoutMs = defaultTimeoutMs,
  keepData = process.env.KAKEFLOW_KEEP_SMOKE_DATA === '1',
} = {}) {
  if (!existsSync(executable)) {
    throw new Error(`Packaged app executable does not exist: ${executable}`)
  }
  const executableStat = await stat(executable)
  if (!executableStat.isFile() || executableStat.size === 0) {
    throw new Error(`Packaged app executable is invalid: ${executable}`)
  }

  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'kakeflow-packaged-smoke-'))
  const resultPath = path.join(dataRoot, 'packaged-smoke-result.json')
  try {
    await launch(executable, dataRoot, timeoutMs)
    const result = validateSmokeResult(JSON.parse(await readFile(resultPath, 'utf8')))
    const databaseStat = await stat(path.join(dataRoot, 'database', 'kakeflow.db'))
    if (!databaseStat.isFile() || databaseStat.size === 0) {
      throw new Error('Packaged smoke database was not created')
    }
    console.log(
      `Packaged app smoke passed (${result.window} window, IPC, schema v${result.schemaVersion})`,
    )
    return { ...result, dataRoot }
  } finally {
    if (keepData) {
      console.log(`Packaged smoke data retained at ${dataRoot}`)
    } else {
      await rm(dataRoot, { recursive: true, force: true })
    }
  }
}

const isMain = process.argv[1] && path.basename(process.argv[1]) === 'packaged-app-smoke.mjs'
if (isMain) {
  runPackagedSmoke().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
