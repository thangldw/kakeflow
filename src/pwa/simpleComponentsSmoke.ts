import { QuickAddSheet } from '../features/simple/QuickAddSheet'
import { SimpleHome } from '../features/simple/SimpleHome'
import { SimpleMorePage } from '../features/simple/SimpleMorePage'
import { SimpleTabBar } from '../features/simple/SimpleTabBar'

// Keeps the Simple components in the production PWA bundle so `npm run build:pwa` and the PWA contract prove they
// build without the desktop platform layer or the full desktop catalogs. Task 4 mounts them in PwaRoot and replaces
// this module.
export const simpleComponentsSmoke = { QuickAddSheet, SimpleHome, SimpleMorePage, SimpleTabBar } as const
