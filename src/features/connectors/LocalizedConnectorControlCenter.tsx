import { useMemo } from 'react'

import { useI18n } from '../../i18n'
import {
  ConnectorControlCenter as ConnectorControlCenterView,
  type ConnectorControlCenterProps,
} from './ConnectorControlCenter'

export type {
  ConnectorBindingManagement,
  ConnectorControlCenterCopy,
  ConnectorControlCenterProps,
  ConnectorRefreshManagement,
} from './ConnectorControlCenter'

export function ConnectorControlCenter(props: ConnectorControlCenterProps) {
  const { localeCode, text } = useI18n()
  const copy = useMemo(() => ({ localeCode, text }), [localeCode, text])
  return <ConnectorControlCenterView {...props} copy={copy} />
}
