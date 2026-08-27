import type { ConnectorSummaryDto } from '../../platform/types'
import { aggregateConnectorSummaries } from './connectorControlModel'
import {
  ConnectorControlCard,
  ConnectorControlDetails,
  ConnectorControlFrame,
  ConnectorControlList,
  type ConnectorControlFrameLabels,
} from './ConnectorControlPresentation'

export interface ManualConnectorControlCopy {
  readonly frame: ConnectorControlFrameLabels
  readonly manualState: string
  readonly configure: string
  readonly lastSuccessLabel: string
  readonly noLastSuccess: string
  readonly nextDueLabel: string
  readonly noNextDue: string
  readonly pendingReviewLabel: string
  readonly pendingReview: (count: number) => string
  readonly bindingLabel: string
  readonly unboundBinding: string
  readonly bindingSummary: (allowedAccountCount: number, parserProfileConfigured: boolean, version: number) => string
  readonly formatDate: (value: string) => string
}

export function ManualConnectorControlCenter({ summary, copy, onConfigure }: {
  readonly summary: ConnectorSummaryDto
  readonly copy: ManualConnectorControlCopy
  readonly onConfigure: () => void
}) {
  const totals = aggregateConnectorSummaries([summary])
  return <ConnectorControlFrame labels={copy.frame} totals={totals}>
    <ConnectorControlList>
      <ConnectorControlCard
        label={summary.displayLabel}
        primaryState={summary.health}
        stateLabel={copy.manualState}
        actions={<button className="secondary-btn" data-connector-configure type="button" onClick={onConfigure}>{copy.configure}</button>}
      >
        <ConnectorControlDetails
          lastSuccessLabel={copy.lastSuccessLabel}
          lastSuccess={summary.lastSuccessAt === null ? copy.noLastSuccess : copy.formatDate(summary.lastSuccessAt)}
          nextDueLabel={copy.nextDueLabel}
          nextDue={summary.nextDueAt === null ? copy.noNextDue : copy.formatDate(summary.nextDueAt)}
          pendingReviewLabel={copy.pendingReviewLabel}
          pendingReview={copy.pendingReview(summary.pendingReviewCount)}
          bindingLabel={copy.bindingLabel}
          bindingSummary={summary.bindingSummary === null
            ? copy.unboundBinding
            : copy.bindingSummary(
                summary.bindingSummary.allowedAccountCount,
                summary.bindingSummary.parserProfileConfigured,
                summary.bindingSummary.version,
              )}
        />
      </ConnectorControlCard>
    </ConnectorControlList>
  </ConnectorControlFrame>
}
