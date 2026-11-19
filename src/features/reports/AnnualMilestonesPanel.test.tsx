import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AnnualMilestonesPanel } from './AnnualMilestonesPanel'

afterEach(cleanup)

describe('AnnualMilestonesPanel', () => {
  it('shows the next deadlines with days left and flags approximate ones', () => {
    render(<AnnualMilestonesPanel today="2026-03-10" limit={2} />)
    expect(screen.getByText('確定申告・所得税の納付期限')).toBeTruthy()
    expect(screen.getByText('あと5日')).toBeTruthy()
    expect(screen.getByText('住民税（第1期）の納付目安')).toBeTruthy()
    expect(screen.getByText('（目安）')).toBeTruthy()
  })

  it('says 今日 on the day itself', () => {
    render(<AnnualMilestonesPanel today="2026-12-31" limit={1} />)
    expect(screen.getByText('今日')).toBeTruthy()
  })
})
