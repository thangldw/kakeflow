import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const workflowsDirectory = resolve(root, '.github/workflows')
const immutableActionPattern = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40}$/u

function workflowActions(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .flatMap((line) => {
      const match = line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+).*$/u)
      if (!match) return []

      const action = match[1].replace(/^['"]|['"]$/gu, '')
      return action.startsWith('./') || action.startsWith('docker://') ? [] : [action]
    })
}

describe('GitHub Actions workflow pins', () => {
  it('uses immutable SHAs for every external action', () => {
    const violations = readdirSync(workflowsDirectory)
      .filter((name) => /\.ya?ml$/u.test(name))
      .flatMap((name) => {
        const path = resolve(workflowsDirectory, name)
        return workflowActions(path)
          .filter((action) => !immutableActionPattern.test(action))
          .map((action) => `${name}: ${action}`)
      })

    expect(violations, `Mutable GitHub Action references:\n${violations.join('\n')}`).toEqual([])
  })
})
