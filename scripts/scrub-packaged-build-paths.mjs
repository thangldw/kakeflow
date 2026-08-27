import { readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  personalBuildPathFindings,
  scrubPersonalBuildRoots,
} from './packaged-app-smoke.mjs'

const root = path.resolve(process.env.INIT_CWD || process.cwd())
const executable = path.join(
  root,
  'src-tauri',
  'target',
  'release',
  process.platform === 'win32' ? 'kakeflow.exe' : 'kakeflow',
)
const original = await readFile(executable)
const scrubbed = scrubPersonalBuildRoots(original, [os.homedir()])
const findings = personalBuildPathFindings(scrubbed)
if (findings.length > 0) {
  throw new Error(`Packaged executable retains personal build roots: ${findings.join(', ')}`)
}
if (!scrubbed.equals(original)) {
  await writeFile(executable, scrubbed)
  console.log('Personal build root removed from packaged executable')
}
