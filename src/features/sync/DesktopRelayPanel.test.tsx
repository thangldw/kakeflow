import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const relay = vi.hoisted(() => ({
  status: vi.fn(), save: vi.fn(), disconnect: vi.fn(), prepare: vi.fn(), accept: vi.fn(), register: vi.fn(), stage: vi.fn(),
  identify: vi.fn(), upload: vi.fn(), list: vi.fn(), download: vi.fn(),
}))

vi.mock('../../platform', () => ({ platformClient: {
  runtime: 'tauri', getDesktopRelayStatus: (...args: unknown[]) => relay.status(...args),
  saveDesktopRelayConnection: (...args: unknown[]) => relay.save(...args), disconnectDesktopRelay: (...args: unknown[]) => relay.disconnect(...args),
  prepareDesktopRelaySend: (...args: unknown[]) => relay.prepare(...args), acceptDesktopRelaySend: (...args: unknown[]) => relay.accept(...args),
  registerDesktopRelayInbound: (...args: unknown[]) => relay.register(...args), stageDesktopRelayInbound: (...args: unknown[]) => relay.stage(...args),
} }))
vi.mock('./desktopRelayHttp', () => ({
  identifyDesktopRelay: (...args: unknown[]) => relay.identify(...args), uploadDesktopRelayArtifact: (...args: unknown[]) => relay.upload(...args),
  listDesktopRelayArtifacts: (...args: unknown[]) => relay.list(...args), downloadDesktopRelayArtifact: (...args: unknown[]) => relay.download(...args),
}))

import { DesktopRelayPanel } from './DesktopRelayPanel'
import type { DesktopRelayStatusDto } from '../../platform/types'

const hash = 'a'.repeat(64)
const disconnected: DesktopRelayStatusDto = { householdId: 'family', connectionState: 'NOT_CONFIGURED', localDeviceId: 'device-local', remotePrincipalId: null, endpoint: null, outbound: { pendingEnvelopeCount: 2, totalEnvelopeCount: 8, deliveryState: 'IDLE', latestAcceptedAt: null }, inbound: [] }
const artifact = { artifactId: 'artifact-in', digest: hash, createdAt: '2026-07-13T00:00:00Z', originDeviceId: 'device-other', state: 'AVAILABLE' as const }
const connected = { ...disconnected, connectionState: 'CONNECTED' as const, remotePrincipalId: 'principal-remote', endpoint: 'https://relay.example', inbound: [artifact] }

describe('DesktopRelayPanel', () => {
  beforeEach(() => {
    relay.status.mockReset().mockResolvedValue(disconnected); relay.save.mockReset().mockResolvedValue(connected)
    relay.disconnect.mockReset().mockResolvedValue(disconnected); relay.prepare.mockReset().mockResolvedValue({ deliveryId: 'delivery', artifactId: 'artifact-out', digest: hash, householdId: 'family', originDeviceId: 'device-local', packageBytes: [1, 2, 3] })
    relay.accept.mockReset().mockResolvedValue({ ...connected, outbound: { ...connected.outbound, pendingEnvelopeCount: 0, deliveryState: 'ACCEPTED', latestAcceptedAt: '2026-07-13T00:01:00Z' } })
    relay.register.mockReset().mockResolvedValue(connected); relay.stage.mockReset().mockResolvedValue({ ...connected, inbound: [{ ...artifact, state: 'WAITING_FOR_REVIEW' }] })
    relay.identify.mockReset().mockResolvedValue('principal-remote'); relay.upload.mockReset().mockResolvedValue({ artifactId: 'artifact-out', digest: hash, acceptedAt: '2026-07-13T00:01:00Z' })
    relay.list.mockReset().mockResolvedValue([{ artifactId: artifact.artifactId, digest: artifact.digest, createdAt: artifact.createdAt, originDeviceId: artifact.originDeviceId }]); relay.download.mockReset().mockResolvedValue([1, 2, 3])
  })

  it('connects only after whoami and never passes the ephemeral token to IPC', async () => {
    render(<DesktopRelayPanel householdId="family" />)
    expect(await screen.findByText('未接続')).toBeInTheDocument()
    expect(screen.getByText(/接続、送信、受信だけでは台帳を変更しません/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('リレー エンドポイント'), { target: { value: 'https://relay.example' } })
    fireEvent.change(screen.getByLabelText('リレー接続トークン'), { target: { value: 'ephemeral-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'リレーを接続' }))
    await waitFor(() => expect(relay.identify).toHaveBeenCalledWith('https://relay.example', 'ephemeral-secret'))
    expect(relay.save).toHaveBeenCalledWith({ householdId: 'family', endpoint: 'https://relay.example', remotePrincipalId: 'principal-remote' })
    expect(JSON.stringify(relay.save.mock.calls)).not.toContain('ephemeral-secret')
    expect(await screen.findByText(/データはまだ送信されていません/)).toBeInTheDocument()
  })

  it('sends, refreshes and stages without claiming or triggering automatic apply', async () => {
    relay.status.mockResolvedValue(connected)
    const onReviewStaged = vi.fn(); render(<DesktopRelayPanel householdId="family" onReviewStaged={onReviewStaged} />)
    await screen.findByText('接続済み')
    fireEvent.change(screen.getByLabelText('リレー接続トークン'), { target: { value: 'session-token' } })
    fireEvent.click(screen.getByRole('button', { name: '未送信の変更を送る' }))
    await waitFor(() => expect(relay.accept).toHaveBeenCalledWith(expect.objectContaining({ deliveryId: 'delivery', acceptedAt: '2026-07-13T00:01:00Z' })))
    expect(await screen.findByText(/別端末での受信・反映完了を意味しません/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '受信を確認' }))
    await waitFor(() => expect(relay.list).toHaveBeenCalledWith('https://relay.example', 'session-token', 'family', 'device-local'))
    expect(relay.register).toHaveBeenCalledWith({ householdId: 'family', artifacts: [expect.objectContaining({ artifactId: 'artifact-in' })] })
    fireEvent.click(screen.getByRole('button', { name: '受信して確認' }))
    await waitFor(() => expect(relay.stage).toHaveBeenCalledWith({ householdId: 'family', artifactId: 'artifact-in', packageBytes: [1, 2, 3] }))
    expect(onReviewStaged).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/最終確定までは台帳へ反映されません/)).toBeInTheDocument()
  })

  it('shows retryable failures and ignores an old household response', async () => {
    relay.status.mockRejectedValueOnce(new Error('database')).mockResolvedValueOnce(disconnected)
    const view = render(<DesktopRelayPanel householdId="family" />)
    expect(await screen.findByText('リレーの状態を確認できませんでした。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '再試行' }))
    expect(await screen.findByText('未接続')).toBeInTheDocument()

    let finishOld: (value: DesktopRelayStatusDto) => void = () => undefined
    relay.status.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve })).mockResolvedValueOnce({ ...disconnected, householdId: 'other' })
    view.rerender(<DesktopRelayPanel householdId="old" />)
    view.rerender(<DesktopRelayPanel householdId="other" />)
    finishOld({ ...disconnected, householdId: 'old' })
    await waitFor(() => expect(relay.status).toHaveBeenCalledWith('other'))
    expect(screen.getByLabelText('リレー エンドポイント')).toHaveValue('')
  })
})
