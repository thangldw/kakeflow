import { describe, expect, it } from 'vitest'

import { progressFromDownloadEvent } from './appUpdater'

describe('app updater progress', () => {
  it('tracks bounded download progress and completion', () => {
    const started = progressFromDownloadEvent({ event: 'Started', data: { contentLength: 1_000 } })
    const halfway = progressFromDownloadEvent({ event: 'Progress', data: { chunkLength: 500 } }, started)
    const bounded = progressFromDownloadEvent({ event: 'Progress', data: { chunkLength: 900 } }, halfway)
    const finished = progressFromDownloadEvent({ event: 'Finished' }, bounded)

    expect(started).toEqual({ downloadedBytes: 0, contentLength: 1_000, percent: 0, finished: false })
    expect(halfway.percent).toBe(50)
    expect(bounded.percent).toBe(100)
    expect(finished).toMatchObject({ percent: 100, finished: true })
  })

  it('keeps progress indeterminate when the server omits content length', () => {
    const started = progressFromDownloadEvent({ event: 'Started', data: {} })
    expect(progressFromDownloadEvent({ event: 'Progress', data: { chunkLength: 256 } }, started)).toMatchObject({
      downloadedBytes: 256, contentLength: null, percent: null, finished: false,
    })
  })
})
