import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater'

export interface AppUpdateSummary {
  readonly currentVersion: string
  readonly version: string
  readonly date: string | null
  readonly notes: string | null
}

export interface AppUpdateProgress {
  readonly downloadedBytes: number
  readonly contentLength: number | null
  readonly percent: number | null
  readonly finished: boolean
}

let pendingUpdate: Update | null = null

function summary(update: Update): AppUpdateSummary {
  return {
    currentVersion: update.currentVersion,
    version: update.version,
    date: update.date ?? null,
    notes: update.body?.trim() || null,
  }
}

export function progressFromDownloadEvent(
  event: DownloadEvent,
  previous: AppUpdateProgress = { downloadedBytes: 0, contentLength: null, percent: null, finished: false },
): AppUpdateProgress {
  if (event.event === 'Started') {
    return { downloadedBytes: 0, contentLength: event.data.contentLength ?? null, percent: 0, finished: false }
  }
  if (event.event === 'Finished') {
    return { ...previous, percent: 100, finished: true }
  }
  const downloadedBytes = previous.downloadedBytes + Math.max(0, event.data.chunkLength)
  const percent = previous.contentLength && previous.contentLength > 0
    ? Math.min(100, Math.round((downloadedBytes / previous.contentLength) * 100))
    : null
  return { ...previous, downloadedBytes, percent, finished: false }
}

export async function checkForAppUpdate(): Promise<AppUpdateSummary | null> {
  pendingUpdate?.close().catch(() => undefined)
  const { check } = await import('@tauri-apps/plugin-updater')
  pendingUpdate = await check({ timeout: 15_000 })
  return pendingUpdate ? summary(pendingUpdate) : null
}

export async function installPendingAppUpdate(onProgress: (progress: AppUpdateProgress) => void): Promise<void> {
  if (!pendingUpdate) throw new Error('NO_PENDING_UPDATE')
  let progress: AppUpdateProgress = { downloadedBytes: 0, contentLength: null, percent: null, finished: false }
  await pendingUpdate.downloadAndInstall((event) => {
    progress = progressFromDownloadEvent(event, progress)
    onProgress(progress)
  }, { timeout: 120_000 })
}

export async function relaunchUpdatedApp(): Promise<void> {
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
}

export function resetAppUpdaterForTesting(): void {
  pendingUpdate = null
}
