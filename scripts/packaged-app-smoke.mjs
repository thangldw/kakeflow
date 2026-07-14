import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(process.env.INIT_CWD || process.cwd())
const defaultTimeoutMs = 90_000

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

export function launchArgumentsForPlatform(platform = process.platform) {
  // A previous interrupted GUI run can make AppKit show a modal crash-history
  // prompt before Tauri setup or the WebView starts. Packaged smoke is already
  // isolated and intentionally stateless, so suppress restoration for this
  // process instead of depending on machine-global saved application state.
  return platform === 'darwin' ? ['-ApplePersistenceIgnoreState', 'YES'] : []
}

export function validateSmokeResult(result) {
  const requiredPages = new Map([
    ['ホーム', 'Packaged Smoke Householdの家計'],
    ['取引', 'すべての取引'], ['インポート', 'インポート Inbox'],
    ['撮影 Inbox', '撮影 Inbox'],
    ['カード照合', 'カード引落・支払余力'], ['資産・投資', '資産・投資'],
    ['カレンダー・レポート', 'カレンダー・レポート'], ['予算・目標', '予算・貯蓄目標'],
    ['分類ルール', '分類ルール'], ['家族スペース', '家族スペース'], ['設定', '設定'],
  ])
  const evidence = result?.visualEvidence
  const pages = Array.isArray(evidence?.visitedPages) ? evidence.visitedPages : []
  const pagesValid = pages.length === requiredPages.size && [...requiredPages].every(([navigationLabel, pageTitle], index) => {
    const page = pages[index]
    return page?.navigationLabel === navigationLabel &&
      page.pageTitle === pageTitle &&
      page.activeNavigation === true &&
      page.headingVisible === true &&
      Number.isInteger(page.mainWidth) && page.mainWidth >= 600 &&
      Number.isInteger(page.mainHeight) && page.mainHeight > 0 &&
      Number.isInteger(page.interactiveElementCount) && page.interactiveElementCount >= 0 &&
      Number.isInteger(page.renderedTextLength) && page.renderedTextLength >= 20
  })
  if (
    result?.status !== 'ok' ||
    result.application !== 'KakeFlow' ||
    result.window !== 'main' ||
    result.ipc !== true ||
    result.databaseHealthy !== true ||
    !Number.isInteger(result.schemaVersion) ||
    result.schemaVersion <= 0 ||
    evidence?.onboardingTitle !== '家計簿をはじめましょう' ||
    evidence.householdName !== 'Packaged Smoke Household' ||
    !Array.isArray(evidence.navigationLabels) ||
    ![...requiredPages.keys()].every((label) => evidence.navigationLabels.includes(label)) ||
    !Number.isInteger(evidence.interactionCount) || evidence.interactionCount < requiredPages.size + 1 ||
    !Number.isInteger(evidence.viewportWidth) || evidence.viewportWidth < 800 ||
    !Number.isInteger(evidence.viewportHeight) || evidence.viewportHeight < 600 ||
    typeof evidence.devicePixelRatio !== 'number' || !Number.isFinite(evidence.devicePixelRatio) || evidence.devicePixelRatio <= 0 ||
    !pagesValid
  ) {
    throw new Error(`Invalid packaged smoke result: ${JSON.stringify(result)}`)
  }
  return result
}

export async function terminateChild(child, graceMs = 2_000) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGTERM')
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, graceMs))])
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await exited
  }
}

function launch(executable, dataRoot, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, launchArgumentsForPlatform(), {
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

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      void terminateChild(child).then(
        () => reject(new Error(`Packaged app did not finish within ${timeoutMs}ms`)),
        (error) => reject(new Error(`Packaged app timeout cleanup failed: ${error instanceof Error ? error.message : error}`)),
      )
    }, timeoutMs)

    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (timedOut) return
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
  artifactDirectory = process.env.KAKEFLOW_SMOKE_ARTIFACT_DIR,
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
    const artifactPaths = []
    if (artifactDirectory) {
      const destination = path.resolve(artifactDirectory)
      await mkdir(destination, { recursive: true })
      const resultArtifact = path.join(destination, `packaged-smoke-${process.platform}.json`)
      await copyFile(resultPath, resultArtifact)
      artifactPaths.push(resultArtifact)
    }
    console.log(
      `Packaged app smoke passed (${result.visualEvidence.visitedPages.length} visible page, ${result.visualEvidence.interactionCount} interaction, IPC, schema v${result.schemaVersion})`,
    )
    return { ...result, dataRoot, artifactPaths }
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
