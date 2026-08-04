import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, DownloadCloud, RefreshCw, Rocket, ShieldCheck, X } from 'lucide-react'

import { localize, useI18n } from '../../i18n'
import { APP_VERSION } from '../../version'
import {
  checkForAppUpdate,
  installPendingAppUpdate,
  relaunchUpdatedApp,
  type AppUpdateProgress,
  type AppUpdateSummary,
} from './appUpdater'

type UpdateState = 'IDLE' | 'CHECKING' | 'AVAILABLE' | 'CURRENT' | 'DOWNLOADING' | 'INSTALLED' | 'ERROR'

export function AppUpdateMonitor({ enabled }: { readonly enabled: boolean }) {
  const { locale, text } = useI18n()
  const [available, setAvailable] = useState<AppUpdateSummary | null>(null)
  const [open, setOpen] = useState(false)
  const checked = useRef(false)

  useEffect(() => {
    if (!enabled || checked.current) return
    checked.current = true
    const timer = globalThis.setTimeout(() => {
      void checkForAppUpdate().then(setAvailable).catch(() => undefined)
    }, 2_500)
    return () => globalThis.clearTimeout(timer)
  }, [enabled])

  if (!available) return null
  return <>
    <aside className="app-update-banner" role="status">
      <Rocket size={17} />
      <span><strong>{locale === 'ja' ? `KakeFlow ${available.version} を利用できます` : locale === 'vi' ? `Đã có KakeFlow ${available.version}` : `KakeFlow ${available.version} is available`}</strong><small>{text("更新内容を確認して安全にインストールできます。")}</small></span>
      <button className="secondary-btn" onClick={() => setOpen(true)}>{text("更新を見る")}</button>
      <button className="icon-btn" aria-label={localize("更新通知を閉じる")} onClick={() => setAvailable(null)}><X size={14} /></button>
    </aside>
    {open && <div className="app-update-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}><div className="app-update-dialog" role="dialog" aria-modal="true" aria-label={localize("アプリの更新")}><button className="icon-btn app-update-close" aria-label={localize("更新画面を閉じる")} onClick={() => setOpen(false)}><X size={17} /></button><AppUpdatePanel enabled initialUpdate={available} /></div></div>}
  </>
}

export function AppUpdatePanel({ enabled, initialUpdate = null }: { readonly enabled: boolean; readonly initialUpdate?: AppUpdateSummary | null }) {
  const { locale, text } = useI18n()
  const [state, setState] = useState<UpdateState>(initialUpdate ? 'AVAILABLE' : 'IDLE')
  const [update, setUpdate] = useState<AppUpdateSummary | null>(initialUpdate)
  const [progress, setProgress] = useState<AppUpdateProgress | null>(null)

  const checkNow = async () => {
    if (!enabled) return
    setState('CHECKING'); setProgress(null)
    try {
      const next = await checkForAppUpdate()
      setUpdate(next)
      setState(next ? 'AVAILABLE' : 'CURRENT')
    } catch {
      setState('ERROR')
    }
  }

  const install = async () => {
    setState('DOWNLOADING'); setProgress(null)
    try {
      await installPendingAppUpdate(setProgress)
      setState('INSTALLED')
    } catch {
      setState('ERROR')
    }
  }

  const restart = async () => {
    try { await relaunchUpdatedApp() }
    catch { setState('ERROR') }
  }

  return <section className="panel settings-panel app-update-panel" aria-labelledby="app-update-title">
    <div>
      <span className="update-security-mark"><ShieldCheck size={18} /> {text("署名を検証")}</span>
      <h2 id="app-update-title">{text("アプリの更新")}</h2>
      <p>{text("KakeFlowは起動後に新しい安定版を確認します。更新ファイルはインストール前に暗号署名を検証します。")}</p>
      <small>{locale === 'ja' ? `現在のバージョン: ${APP_VERSION}` : locale === 'vi' ? `Phiên bản hiện tại: ${APP_VERSION}` : `Current version: ${APP_VERSION}`}</small>
    </div>
    <div className="app-update-actions">
      {state === 'AVAILABLE' && update && <div className="update-release-summary"><strong>v{update.version}</strong>{update.notes && <p>{update.notes}</p>}</div>}
      {state === 'DOWNLOADING' && <div className="update-progress" aria-live="polite"><span><b>{localize("更新をダウンロード中…")}</b><small>{progress?.percent == null ? localize("サイズを確認中") : `${progress.percent}%`}</small></span><progress max="100" value={progress?.percent ?? undefined} /></div>}
      {state === 'CURRENT' && <p className="update-state success"><CheckCircle2 size={16} /> {localize("最新バージョンです。")}</p>}
      {state === 'INSTALLED' && <p className="update-state success"><CheckCircle2 size={16} /> {localize("更新をインストールしました。再起動すると適用されます。")}</p>}
      {state === 'ERROR' && <p className="update-state error" role="alert">{localize("更新を確認またはインストールできませんでした。ネットワークを確認して再試行してください。")}</p>}
      {!enabled && <p className="update-state">{localize("更新確認はデスクトップ版で利用できます。")}</p>}
      <div className="update-buttons">
        {state === 'AVAILABLE' ? <button className="primary-btn" onClick={() => void install()}><DownloadCloud size={16} /> {localize("ダウンロードしてインストール")}</button>
          : state === 'INSTALLED' ? <button className="primary-btn" onClick={() => void restart()}><RefreshCw size={16} /> {localize("今すぐ再起動")}</button>
            : <button className="secondary-btn" disabled={!enabled || state === 'CHECKING' || state === 'DOWNLOADING'} onClick={() => void checkNow()}><RefreshCw className={state === 'CHECKING' ? 'is-spinning' : ''} size={16} /> {state === 'CHECKING' ? localize("更新を確認中…") : localize("更新を確認")}</button>}
      </div>
    </div>
  </section>
}
