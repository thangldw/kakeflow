(async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke
  const waitFor = (read, description, timeoutMs = 8000) => new Promise((resolve, reject) => {
    const initial = read()
    if (initial) { resolve(initial); return }
    let observer
    const timer = setTimeout(() => {
      observer?.disconnect()
      reject(new Error(`Timed out waiting for ${description}`))
    }, timeoutMs)
    const check = () => {
      const value = read()
      if (!value) return
      clearTimeout(timer)
      observer.disconnect()
      resolve(value)
    }
    observer = new MutationObserver(check)
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true })
    check()
  })
  const visible = (element) => {
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  }
  let interactionCount = 0
  const mainHeading = () => document.querySelector('main h1')
  const bootstrap = await invoke('app_bootstrap')
  await invoke('packaged_smoke_progress', { stage: 'bootstrap' })

  const onboarding = await waitFor(
    () => document.querySelector('[role="dialog"][aria-labelledby="onboarding-title"]'),
    'onboarding dialog',
  )
  const onboardingTitle = onboarding.querySelector('h1')?.textContent?.trim() ?? ''
  await invoke('packaged_smoke_progress', { stage: 'onboarding-visible' })
  const householdInput = onboarding.querySelector('#household-name')
  const householdForm = onboarding.querySelector('form')
  if (!(householdInput instanceof HTMLInputElement) || !(householdForm instanceof HTMLFormElement)) {
    throw new Error('Onboarding controls are unavailable')
  }
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  valueSetter?.call(householdInput, 'Packaged Smoke Household')
  householdInput.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  householdForm.requestSubmit()
  interactionCount += 1
  await invoke('packaged_smoke_progress', { stage: 'onboarding-submitted' })

  await waitFor(() => !document.querySelector('#onboarding-title'), 'onboarding completion')
  await invoke('packaged_smoke_progress', { stage: 'onboarding-complete' })
  const sidebar = await waitFor(
    () => document.querySelector('aside[aria-label="メインナビゲーション"]'),
    'main navigation',
  )
  await invoke('packaged_smoke_progress', { stage: 'navigation-visible' })
  await waitFor(
    () => Array.from(sidebar.querySelectorAll('select[aria-label="世帯を切り替える"] option')).some((option) => option.textContent?.trim() === 'Packaged Smoke Household'),
    'created household selection',
  )
  await invoke('packaged_smoke_progress', { stage: 'household-selected' })
  const navigationButtons = Array.from(sidebar.querySelectorAll('nav button.nav-item'))
  const navigationLabels = navigationButtons.map((button) => button.textContent?.trim() ?? '')
  const heading = mainHeading()
  const main = document.querySelector('main')
  const homeButton = navigationButtons.find((button) => button.textContent?.trim() === 'ホーム')
  if (!(heading instanceof HTMLElement) || !(main instanceof HTMLElement) || !visible(main) || !visible(heading)) {
    throw new Error('Home page is not visibly rendered after onboarding')
  }
  const rect = main.getBoundingClientRect()
  const visitedPages = [{
    navigationLabel: 'ホーム',
    pageTitle: heading.textContent?.trim() ?? '',
    activeNavigation: homeButton instanceof HTMLButtonElement && homeButton.classList.contains('active'),
    mainWidth: Math.round(rect.width),
    mainHeight: Math.round(rect.height),
    interactiveElementCount: main.querySelectorAll('button, input, select, textarea, a[href]').length,
    renderedTextLength: main.innerText.trim().length,
  }]
  await invoke('packaged_smoke_progress', { stage: 'home-verified' })

  const visualEvidence = {
    onboardingTitle,
    householdName: 'Packaged Smoke Household',
    navigationLabels,
    visitedPages,
    interactionCount,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  }
  window.__KAKEFLOW_PACKAGED_SMOKE_EVIDENCE__ = visualEvidence
  await invoke('packaged_smoke_complete', {
    bootstrap: {
      ...bootstrap,
      visualEvidence,
    },
  })
})().catch(async (error) => {
  const evidence = window.__KAKEFLOW_PACKAGED_SMOKE_EVIDENCE__
  const detail = evidence ? `; evidence=${JSON.stringify(evidence)}` : ''
  const message = `${error instanceof Error ? error.message : String(error)}${detail}`
  console.error('packaged smoke failed', error)
  try {
    await window.__TAURI_INTERNALS__.invoke('packaged_smoke_progress', { stage: 'failed' })
    await window.__TAURI_INTERNALS__.invoke('packaged_smoke_failure', { message })
  } catch (reportError) {
    console.error('packaged smoke failure could not be reported', reportError)
  }
})
