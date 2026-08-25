import { useMemo, useState } from 'react'
import type { ConnectorSummaryDto, ConfigurationDestinationDto } from '../../platform/types'
import { useI18n } from '../../i18n'
import {
  aggregateConnectorSummaries,
  filterConnectorSummaries,
  primaryConnectorState,
} from './connectorControlModel'
import type { ConnectorControlFilter, ConnectorPrimaryState } from './connectorControlModel'
import './ConnectorControlCenter.css'

interface Props {
  readonly summaries: readonly ConnectorSummaryDto[]
  readonly loading: boolean
  readonly error: string | null
  readonly onConfigure: (destination: ConfigurationDestinationDto) => void
}

const FILTERS: readonly ConnectorControlFilter[] = ['ALL', 'STALE', 'NEEDS_ACTION']

const filterLabel: Readonly<Record<ConnectorControlFilter, string>> = {
  ALL: 'すべて',
  STALE: '古いデータ',
  NEEDS_ACTION: '要対応',
}

const stateLabel: Readonly<Record<ConnectorPrimaryState, string>> = {
  NEEDS_ACTION: '要対応',
  RUNNING: '更新中',
  RETRY_BACKOFF: '再試行待ち',
  STALE: '古いデータ',
  FRESH: '最新',
  MANUAL: '手動',
  NEVER_REFRESHED: '未更新',
  DISCONNECTED: '未接続',
}

export function ConnectorControlCenter({ summaries, loading, error, onConfigure }: Props) {
  const { localeCode, text } = useI18n()
  const [filter, setFilter] = useState<ConnectorControlFilter>('ALL')
  const totals = aggregateConnectorSummaries(summaries)
  const visible = filterConnectorSummaries(summaries, filter)
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(localeCode, { dateStyle: 'short', timeStyle: 'short' }), [localeCode])
  const formatDate = (value: string | null, emptyLabel: string) => value === null ? emptyLabel : dateFormatter.format(new Date(value))
  const formatPendingCount = (count: number) => text('{count}件').replace('{count}', count.toLocaleString(localeCode))

  return <section className="panel connector-control" aria-labelledby="connector-control-title">
    <div className="connector-control-heading">
      <div>
        <h2 id="connector-control-title">{text('コネクタ管理センター')}</h2>
        <p>{text('接続状態とレビュー待ちを一か所で確認します。認証、スケジュール、接続解除は各設定画面で管理します。')}</p>
      </div>
      <p className="connector-control-review-note">{text('更新はレビュー候補を作成します。台帳へ自動記帳されることはありません。')}</p>
    </div>

    <dl className="connector-control-totals">
      <div><dt>{text('接続済み')}</dt><dd>{totals.connected}</dd></div>
      <div><dt>{text('古いデータ')}</dt><dd>{totals.stale}</dd></div>
      <div><dt>{text('更新中')}</dt><dd>{totals.running}</dd></div>
      <div><dt>{text('要対応')}</dt><dd>{totals.needsAction}</dd></div>
    </dl>

    <div className="connector-control-filters" role="group" aria-label={text('コネクタを絞り込む')}>
      {FILTERS.map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{text(filterLabel[value])}</button>)}
    </div>

    {loading ? <p className="connector-control-state" role="status">{text('コネクタの状態を読み込んでいます…')}</p>
      : error !== null ? <p className="connector-control-state" role="alert">{text('コネクタの状態を読み込めませんでした。')}</p>
        : summaries.length === 0 ? <p className="connector-control-state">{text('表示できるコネクタはありません。')}</p>
          : visible.length === 0 ? <p className="connector-control-state">{text('この条件に一致するコネクタはありません。')}</p>
            : <div className="connector-control-list">{visible.map((summary) => {
              const primaryState = primaryConnectorState(summary)
              return <article className="connector-control-card" aria-label={summary.displayLabel} key={`${summary.connectorKind}:${summary.connectionKey}`}>
                <div className="connector-control-card-heading">
                  <div><h3>{summary.displayLabel}</h3><span className={`connector-control-badge connector-control-badge--${primaryState.toLowerCase()}`}>{text(stateLabel[primaryState])}</span></div>
                  <button className="secondary-btn" type="button" onClick={() => onConfigure(summary.configurationDestination)}>{text('設定を開く')}</button>
                </div>
                {summary.availability === 'RUNTIME_UNSUPPORTED' && <p className="connector-control-unavailable">{text('この実行環境では利用できません。デスクトップ版の設定を確認してください。')}</p>}
                {summary.availability === 'CONFIG_MISSING' && <p className="connector-control-unavailable">{text('このコネクタには追加設定が必要です。')}</p>}
                <dl className="connector-control-details">
                  <div><dt>{text('最後に成功した更新')}</dt><dd>{formatDate(summary.lastSuccessAt, text('成功した更新はまだありません'))}</dd></div>
                  <div><dt>{text('次回の予定更新')}</dt><dd>{formatDate(summary.nextDueAt, text('スケジュールなし'))}</dd></div>
                  <div><dt>{text('レビュー待ち')}</dt><dd>{formatPendingCount(summary.pendingReviewCount)}</dd></div>
                </dl>
              </article>
            })}</div>}
  </section>
}
