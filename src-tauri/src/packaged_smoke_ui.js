(async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke
  const waitFor = async (read, description, timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const value = read()
      if (value) return value
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`Timed out waiting for ${description}`)
  }
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
  await waitFor(
    () => Array.from(sidebar.querySelectorAll('select[aria-label="世帯を切り替える"] option')).some((option) => option.textContent?.trim() === 'Packaged Smoke Household'),
    'created household selection',
  )
  const navigationButtons = Array.from(sidebar.querySelectorAll('nav button.nav-item'))
  const navigationLabels = navigationButtons.map((button) => button.textContent?.trim() ?? '')

  const visit = async (navigationLabel, expectedTitle) => {
    const button = navigationButtons.find((candidate) => candidate.textContent?.trim() === navigationLabel)
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing navigation item ${navigationLabel}`)
    button.click()
    interactionCount += 1
    const heading = await waitFor(
      () => {
        const candidate = mainHeading()
        return candidate?.textContent?.trim() === expectedTitle ? candidate : null
      },
      `${navigationLabel} page`,
    )
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const main = document.querySelector('main')
    if (!(main instanceof HTMLElement) || !visible(main) || !visible(heading)) {
      throw new Error(`${navigationLabel} page is not visibly rendered`)
    }
    const rect = main.getBoundingClientRect()
    await invoke('packaged_smoke_progress', { stage: `visited-${visitedPages.length + 1}` })
    return {
      navigationLabel,
      pageTitle: heading.textContent?.trim() ?? '',
      activeNavigation: button.classList.contains('active'),
      mainWidth: Math.round(rect.width),
      mainHeight: Math.round(rect.height),
      interactiveElementCount: main.querySelectorAll('button, input, select, textarea, a[href]').length,
      renderedTextLength: main.innerText.trim().length,
    }
  }

  const visitedPages = []
  visitedPages.push(await visit('ホーム', 'Packaged Smoke Householdの家計'))
  visitedPages.push(await visit('取引', 'すべての取引'))
  visitedPages.push(await visit('インポート', 'インポート Inbox'))
  visitedPages.push(await visit('カレンダー・レポート', 'カレンダー・レポート'))

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
    await window.__TAURI_INTERNALS__.invoke('packaged_smoke_failure', { message })
  } catch (reportError) {
    console.error('packaged smoke failure could not be reported', reportError)
  }
})
