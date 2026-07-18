import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const sourceRoot = path.join(root, 'src')
const japanese = /[ぁ-んァ-ヶ一-龯]/

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(target)
    return entry.isFile() && target.endsWith('.tsx') && !target.endsWith('.test.tsx') && !target.endsWith(`${path.sep}i18n.tsx`) ? [target] : []
  })
}

function insideJsxExpression(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isJsxExpression(current)) return true
    if (ts.isStatement(current) || ts.isSourceFile(current)) return false
  }
  return false
}

function alreadyLocalized(node) {
  const parent = node.parent
  return ts.isCallExpression(parent)
    && ts.isIdentifier(parent.expression)
    && (parent.expression.text === 'text' || parent.expression.text === 'localize')
}

function insideJsxAttribute(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isJsxAttribute(current)) return true
    if (ts.isJsxExpression(current) || ts.isStatement(current) || ts.isSourceFile(current)) return false
  }
  return false
}

function insideFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current)) return true
    if (ts.isSourceFile(current)) return false
  }
  return false
}

function semanticLiteral(node) {
  if (ts.isLiteralTypeNode(node.parent)) return true
  if (ts.isPropertyAssignment(node.parent) && node.parent.name === node) return true
  if (ts.isBinaryExpression(node.parent)
    && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(node.parent.operatorToken.kind)) return true
  if (ts.isCallExpression(node.parent) && ts.isPropertyAccessExpression(node.parent.expression)
    && ['has', 'includes', 'startsWith', 'endsWith', 'match', 'test'].includes(node.parent.expression.name.text)) return true
  return false
}

function importPath(file) {
  let relative = path.relative(path.dirname(file), path.join(sourceRoot, 'i18n')).replaceAll(path.sep, '/')
  if (!relative.startsWith('.')) relative = `./${relative}`
  return relative
}

function ensureImport(source, file) {
  const modulePath = importPath(file)
  const escaped = modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const existing = new RegExp(`import \\{([^}]+)\\} from ['\"]${escaped}['\"]`)
  const match = source.match(existing)
  if (match) {
    if (match[1].split(',').map((item) => item.trim()).includes('localize')) return source
    return source.replace(match[0], match[0].replace('{', '{ localize,'))
  }
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const imports = syntax.statements.filter(ts.isImportDeclaration)
  const end = imports.at(-1)?.getEnd()
  if (end == null) return `import { localize } from '${modulePath}'\n${source}`
  return `${source.slice(0, end)}\nimport { localize } from '${modulePath}'${source.slice(end)}`
}

for (const file of walk(sourceRoot)) {
  let source = fs.readFileSync(file, 'utf8')
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const replacements = []
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const raw = node.getText(syntax)
      const value = raw.trim()
      if (japanese.test(value)) {
        const leading = raw.slice(0, raw.indexOf(value))
        const trailing = raw.slice(raw.indexOf(value) + value.length)
        replacements.push({ start: node.getStart(syntax), end: node.getEnd(), value: `${leading}{localize(${JSON.stringify(value)})}${trailing}` })
        return
      }
    } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer) && japanese.test(node.initializer.text)) {
      replacements.push({ start: node.initializer.getStart(syntax), end: node.initializer.getEnd(), value: `{localize(${JSON.stringify(node.initializer.text)})}` })
      return
    } else if ((ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node))
      && japanese.test(node.getText(syntax)) && !alreadyLocalized(node) && !semanticLiteral(node)
      && ((insideJsxExpression(node) && !insideJsxAttribute(node)) || insideFunction(node))) {
      replacements.push({ start: node.getStart(syntax), end: node.getEnd(), value: `localize(${node.getText(syntax)})` })
      return
    } else if (ts.isStringLiteral(node) && japanese.test(node.text) && !alreadyLocalized(node) && !semanticLiteral(node)
      && ((insideJsxExpression(node) && !insideJsxAttribute(node)) || insideFunction(node))) {
      replacements.push({ start: node.getStart(syntax), end: node.getEnd(), value: `localize(${JSON.stringify(node.text)})` })
    }
    ts.forEachChild(node, visit)
  }
  visit(syntax)
  if (replacements.length === 0) continue
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    source = source.slice(0, replacement.start) + replacement.value + source.slice(replacement.end)
  }
  source = ensureImport(source, file)
  fs.writeFileSync(file, source)
}
