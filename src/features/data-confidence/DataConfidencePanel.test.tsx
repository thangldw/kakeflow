import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DataConfidenceDto } from '../../platform/types'
import { DataConfidencePanel } from './DataConfidencePanel'

afterEach(cleanup)

const data: DataConfidenceDto = {
  month: '2026-11', totalTransactions: 4, totalAmountJpy: 10_000, evidencedShareBps: 7000,
  buckets: [
    { level: 'DOCUMENT_AND_IMPORT', transactions: 1, amountJpy: 4000 }, { level: 'DOCUMENT', transactions: 1, amountJpy: 2000 },
    { level: 'IMPORT', transactions: 1, amountJpy: 1000 }, { level: 'MANUAL', transactions: 1, amountJpy: 3000 },
  ],
}

describe('DataConfidencePanel', () => {
  it('shows the evidenced share and every level with its amount', async () => {
    render(<DataConfidencePanel month="2026-11" load={async () => data} />)
    expect(await screen.findByText('70%')).toBeTruthy()
    expect(screen.getByText('手入力のみ')).toBeTruthy()
    expect(screen.getByText('¥3,000')).toBeTruthy()
    expect(screen.getByText('原本と取り込みの両方あり')).toBeTruthy()
  })

  it('says so when the month has no spending', async () => {
    render(<DataConfidencePanel month="2026-11" load={async () => ({ ...data, totalTransactions: 0, totalAmountJpy: 0, evidencedShareBps: 0, buckets: data.buckets.map((bucket) => ({ ...bucket, transactions: 0, amountJpy: 0 })) })} />)
    expect(await screen.findByText('この月の支出はまだありません。')).toBeTruthy()
  })

  it('reloads when the month changes and shows an error when loading fails', async () => {
    const load = vi.fn().mockResolvedValueOnce(data).mockRejectedValueOnce(new Error('x'))
    const { rerender } = render(<DataConfidencePanel month="2026-11" load={load} />)
    await screen.findByText('70%')
    rerender(<DataConfidencePanel month="2026-10" load={load} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('lists large spending without a receipt and opens the transactions page', async () => {
    const onOpen = vi.fn()
    render(<DataConfidencePanel month="2026-11" load={async () => data} onOpenTransactions={onOpen}
      loadMissing={async () => [{ transactionId: 't1', occurredOn: '2026-11-02', payee: 'ホームセンター', amountJpy: 5000, hasImport: false }, { transactionId: 't2', occurredOn: '2026-11-03', payee: null, amountJpy: 4000, hasImport: true }]} />)
    expect(await screen.findByText('ホームセンター')).toBeTruthy()
    expect(screen.getByText('取り込み明細のみ')).toBeTruthy()
    expect(screen.getByText('¥5,000')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取引を開く' }))
    expect(onOpen).toHaveBeenCalled()
  })

  it('still shows the summary when the missing-receipt list cannot load', async () => {
    render(<DataConfidencePanel month="2026-11" load={async () => data} loadMissing={async () => { throw new Error('x') }} />)
    expect(await screen.findByText('70%')).toBeTruthy()
    expect(screen.queryByText('レシートを添付したい支出')).toBeNull()
  })
})
