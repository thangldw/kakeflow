// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { hasTranslation } from '../src/i18n'

const sourceRoot = path.resolve(process.cwd(), 'src')
const japanese = /[ぁ-んァ-ヶ一-龯]/

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(target)
    return entry.isFile() && target.endsWith('.tsx') && !target.endsWith('.test.tsx') && !target.endsWith(`${path.sep}i18n.tsx`) ? [target] : []
  })
}

function insideJsxExpression(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isJsxExpression(current)) return true
    if (ts.isStatement(current) || ts.isSourceFile(current)) return false
  }
  return false
}

function localizedCall(node: ts.StringLiteral): boolean {
  return ts.isCallExpression(node.parent)
    && ts.isIdentifier(node.parent.expression)
    && (node.parent.expression.text === 'localize' || node.parent.expression.text === 'text')
}

describe('UI localization catalog contract', () => {
  it('routes every static Japanese JSX string through the localization catalog', () => {
    const untranslated: string[] = []
    const sources = new Set<string>()
    for (const file of sourceFiles(sourceRoot)) {
      const content = fs.readFileSync(file, 'utf8')
      const syntax = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
          && (node.expression.text === 'localize' || node.expression.text === 'text')
          && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) && japanese.test(node.arguments[0].text)) {
          sources.add(node.arguments[0].text)
        }
        if (ts.isJsxText(node) && japanese.test(node.getText(syntax))) untranslated.push(`${path.relative(sourceRoot, file)}:${syntax.getLineAndCharacterOfPosition(node.getStart(syntax)).line + 1}`)
        if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer) && japanese.test(node.initializer.text)) untranslated.push(`${path.relative(sourceRoot, file)}:${syntax.getLineAndCharacterOfPosition(node.getStart(syntax)).line + 1}`)
        if (ts.isStringLiteral(node) && japanese.test(node.text) && insideJsxExpression(node) && !localizedCall(node)) untranslated.push(`${path.relative(sourceRoot, file)}:${syntax.getLineAndCharacterOfPosition(node.getStart(syntax)).line + 1}`)
        ts.forEachChild(node, visit)
      }
      visit(syntax)
    }
    expect(untranslated).toEqual([])
    expect([...sources].filter((source) => !hasTranslation('en', source))).toEqual([])
    expect([...sources].filter((source) => !hasTranslation('vi', source))).toEqual([])
  })
})
