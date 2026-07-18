(async () => {
  if (window.localStorage.getItem('kakeflow.locale') !== 'ja') {
    window.localStorage.setItem('kakeflow.locale', 'ja')
    window.location.reload()
    return
  }
  const invoke = window.__TAURI_INTERNALS__.invoke
  const waitFor = (read, description, timeoutMs = 8000) => new Promise((resolve, reject) => {
    const initial = read()
    if (initial) { resolve(initial); return }
    let observer
    const timer = setTimeout(() => {
      observer?.disconnect()
      const headings = Array.from(document.querySelectorAll('.topbar-context strong')).map((heading) => heading.textContent?.trim() ?? '')
      reject(new Error(`Timed out waiting for ${description}; workspace headings=${JSON.stringify(headings)}; document language=${document.documentElement.lang}`))
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
  const workspaceHeading = () => document.querySelector('.topbar-context strong')
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
  const navigationButtons = Array.from(sidebar.querySelectorAll('button.nav-item'))
  const navigationLabels = navigationButtons.map((button) => button.querySelector('span')?.textContent?.trim() ?? '')
  const main = document.querySelector('main')
  const expectedPages = navigationLabels.map((navigationLabel) => [navigationLabel, navigationLabel])
  if (!(main instanceof HTMLElement) || !visible(main)) {
    throw new Error('Home page is not visibly rendered after onboarding')
  }
  const visitedPages = []
  for (const [navigationLabel, pageTitle] of expectedPages) {
    const button = navigationButtons.find((candidate) => candidate.querySelector('span')?.textContent?.trim() === navigationLabel)
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Navigation is unavailable: ${navigationLabel}`)
    button.click()
    interactionCount += 1
    const heading = await waitFor(() => {
      const candidate = workspaceHeading()
      return candidate?.textContent?.trim() === pageTitle && visible(candidate) ? candidate : null
    }, `${navigationLabel} page`)
    const rect = main.getBoundingClientRect()
    visitedPages.push({ navigationLabel, pageTitle: heading.textContent?.trim() ?? '', activeNavigation: button.classList.contains('active'), headingVisible: visible(heading), mainWidth: Math.round(rect.width), mainHeight: Math.round(rect.height), interactiveElementCount: main.querySelectorAll('button, input, select, textarea, a[href]').length, renderedTextLength: main.innerText.trim().length })
    window.__KAKEFLOW_PACKAGED_SMOKE_EVIDENCE__ = { onboardingTitle, householdName: 'Packaged Smoke Household', navigationLabels, visitedPages: [...visitedPages], interactionCount, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, devicePixelRatio: window.devicePixelRatio }
    await invoke('packaged_smoke_progress', { stage: `page-${visitedPages.length}-verified` })
  }

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
