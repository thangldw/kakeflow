import type { ReactNode } from 'react'

import type { ConnectorControlTotals, ConnectorPrimaryState } from './connectorControlModel'
import './ConnectorControlCenter.css'

export interface ConnectorControlCenterCopy {
  readonly localeCode: string
  readonly text: (source: string) => string
}

export interface ConnectorControlFrameLabels {
  readonly title: string
  readonly description: string
  readonly reviewNote: string
  readonly connected: string
  readonly stale: string
  readonly running: string
  readonly needsAction: string
}

export function ConnectorControlFrame({ labels, totals, children }: {
  readonly labels: ConnectorControlFrameLabels
  readonly totals: ConnectorControlTotals
  readonly children: ReactNode
}) {
  return <section className="panel connector-control" aria-labelledby="connector-control-title">
    <div className="connector-control-heading">
      <div>
        <h2 id="connector-control-title" tabIndex={-1}>{labels.title}</h2>
        <p>{labels.description}</p>
      </div>
      <p className="connector-control-review-note">{labels.reviewNote}</p>
    </div>

    <dl className="connector-control-totals">
      <div><dt>{labels.connected}</dt><dd>{totals.connected}</dd></div>
      <div><dt>{labels.stale}</dt><dd>{totals.stale}</dd></div>
      <div><dt>{labels.running}</dt><dd>{totals.running}</dd></div>
      <div><dt>{labels.needsAction}</dt><dd>{totals.needsAction}</dd></div>
    </dl>
    {children}
  </section>
}

export function ConnectorControlList({ children }: { readonly children: ReactNode }) {
  return <div className="connector-control-list">{children}</div>
}

export function ConnectorControlCard({ label, primaryState, stateLabel, actions, children }: {
  readonly label: string
  readonly primaryState: ConnectorPrimaryState
  readonly stateLabel: string
  readonly actions: ReactNode
  readonly children: ReactNode
}) {
  return <article className="connector-control-card" aria-label={label}>
    <div className="connector-control-card-heading">
      <div><h3>{label}</h3><span className={`connector-control-badge connector-control-badge--${primaryState.toLowerCase()}`}>{stateLabel}</span></div>
      <div className="connector-control-actions">{actions}</div>
    </div>
    {children}
  </article>
}

export function ConnectorControlDetails({ lastSuccessLabel, lastSuccess, nextDueLabel, nextDue, pendingReviewLabel, pendingReview }: {
  readonly lastSuccessLabel: string
  readonly lastSuccess: string
  readonly nextDueLabel: string
  readonly nextDue: string
  readonly pendingReviewLabel: string
  readonly pendingReview: string
}) {
  return <dl className="connector-control-details">
    <div><dt>{lastSuccessLabel}</dt><dd>{lastSuccess}</dd></div>
    <div><dt>{nextDueLabel}</dt><dd>{nextDue}</dd></div>
    <div><dt>{pendingReviewLabel}</dt><dd>{pendingReview}</dd></div>
  </dl>
}
