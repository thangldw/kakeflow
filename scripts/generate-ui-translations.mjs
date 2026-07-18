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
    return entry.isFile() && /\.(?:ts|tsx)$/.test(target) && !target.endsWith('.test.ts') && !target.endsWith('.test.tsx') ? [target] : []
  })
}

const sources = new Set()
for (const file of walk(sourceRoot)) {
  const source = fs.readFileSync(file, 'utf8')
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const visit = (node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && japanese.test(node.text)) {
      sources.add(node.text)
    }
    if (ts.isJsxText(node) && japanese.test(node.text.trim())) {
      sources.add(node.text.trim())
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && (node.expression.text === 'localize' || node.expression.text === 'text')
      && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) && japanese.test(node.arguments[0].text)) {
      sources.add(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(syntax)
}

async function translateBatch(values, locale) {
  const markers = values.slice(1).map((_, index) => `__KF_${index + 1}__`)
  const input = values.map((value, index) => index === 0 ? value : `${markers[index - 1]}\n${value}`).join('\n')
  const url = new URL('https://translate.googleapis.com/translate_a/single')
  url.searchParams.set('client', 'gtx')
  url.searchParams.set('sl', 'ja')
  url.searchParams.set('tl', locale)
  url.searchParams.set('dt', 't')
  url.searchParams.set('q', input)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`translation request failed: ${response.status}`)
  const payload = await response.json()
  const translated = payload[0].map((part) => part[0]).join('')
  const pattern = new RegExp(`\\n?(?:${markers.join('|')})\\n?`, 'g')
  const parts = translated.split(pattern).map((value) => value.trim())
  if (parts.length !== values.length) throw new Error(`translation marker mismatch: expected ${values.length}, got ${parts.length}`)
  return parts
}

async function generate(locale) {
  const target = path.join(sourceRoot, 'locales', `${locale}.generated.json`)
  const catalog = JSON.parse(fs.readFileSync(target, 'utf8'))
  const pending = [...sources].filter((source) => !catalog[source]).sort()
  for (let index = 0; index < pending.length; index += 20) {
    const batch = pending.slice(index, index + 20)
    let translated
    try { translated = await translateBatch(batch, locale) }
    catch {
      translated = []
      for (const source of batch) translated.push((await translateBatch([source], locale))[0])
    }
    batch.forEach((source, offset) => { catalog[source] = translated[offset] })
    fs.writeFileSync(target, `${JSON.stringify(Object.fromEntries(Object.entries(catalog).sort(([left], [right]) => left.localeCompare(right, 'ja'))), null, 2)}\n`)
  }
}

await generate('en')
await generate('vi')
