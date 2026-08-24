import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const root = path.resolve(process.env.INIT_CWD || process.cwd())

export const PDF_REPORT_TYPES = [
  'monthly',
  'annual',
  'investment-performance',
  'portfolio-snapshot',
  'transaction-ledger',
]
export const V073_REQUIRED_REPORT_TYPES = [
  'monthly',
  'annual',
  'investment-performance',
  'portfolio-snapshot',
]

const MAX_PDF_BYTES = 32 * 1024 * 1024
const MAX_PAGES = 40
const MAX_PAGE_PIXELS = 25_000_000
const MAX_TOTAL_PIXELS = 200_000_000
const RENDER_DPI = 144

export function pdfQaExecutionPolicy(available, required) {
  if (available) return 'run'
  return required ? 'fail' : 'skip'
}

function parseInteger(value, field) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed)) throw new Error(`pdfinfo did not provide a valid ${field}`)
  return parsed
}

function parseNumber(value, field) {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) throw new Error(`pdfinfo did not provide a valid ${field}`)
  return parsed
}

export function parsePdfInfo(output) {
  const fields = new Map()
  for (const line of output.split(/\r?\n/u)) {
    const match = /^([^:]+):\s*(.*)$/u.exec(line)
    if (match) {
      const key = match[1].trim()
      // `pdfinfo` can repeat keys in nested PDF subtype metadata. Preserve the
      // top-level document value that appears first instead of letting a later
      // PDF/X descriptor replace the report title.
      if (!fields.has(key)) fields.set(key, match[2].trim())
    }
  }
  const pageSize = /^(\d+(?:\.\d+)?)\s+x\s+(\d+(?:\.\d+)?)\s+pts\b/u.exec(fields.get('Page size') ?? '')
  return {
    pages: parseInteger(fields.get('Pages') ?? '', 'page count'),
    encrypted: fields.get('Encrypted') ?? '',
    pageWidthPoints: pageSize ? parseNumber(pageSize[1], 'page width') : Number.NaN,
    pageHeightPoints: pageSize ? parseNumber(pageSize[2], 'page height') : Number.NaN,
    pdfVersion: fields.get('PDF version') ?? '',
    title: fields.get('Title') || null,
    creator: fields.get('Creator') || null,
    producer: fields.get('Producer') || null,
  }
}

export function validatePdfInfo(info) {
  if (!Number.isInteger(info.pages) || info.pages < 1 || info.pages > MAX_PAGES) {
    throw new Error(`PDF page count must be between 1 and ${MAX_PAGES}, received ${info.pages}`)
  }
  if (info.encrypted.toLowerCase() !== 'no') {
    throw new Error('PDF report must not be encrypted')
  }
  for (const [field, value] of [
    ['width', info.pageWidthPoints],
    ['height', info.pageHeightPoints],
  ]) {
    if (!Number.isFinite(value) || value < 200 || value > 2_000) {
      throw new Error(`PDF page ${field} must be between 200 and 2000 points, received ${value}`)
    }
  }
  if (!/^\d+\.\d+$/u.test(info.pdfVersion)) {
    throw new Error(`PDF version is missing or invalid: ${info.pdfVersion || 'empty'}`)
  }
  return info
}

export function pngDimensions(bytes) {
  const signature = '89504e470d0a1a0a'
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== signature) {
    throw new Error('Rendered page is not a valid PNG')
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (width < 1 || height < 1) throw new Error('Rendered PNG has invalid dimensions')
  return { width, height }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function safeReportDirectory(type) {
  if (!PDF_REPORT_TYPES.includes(type)) throw new Error(`Unsupported PDF report type: ${type}`)
  return type
}

async function renderReport({ type, source, stagingDirectory, pdfinfo, pdftoppm }) {
  const sourcePath = path.resolve(source)
  const sourceStat = await stat(sourcePath)
  if (!sourceStat.isFile() || sourceStat.size === 0 || sourceStat.size > MAX_PDF_BYTES) {
    throw new Error(`${type} PDF must be a non-empty file no larger than ${MAX_PDF_BYTES} bytes`)
  }
  const sourceBytes = await readFile(sourcePath)
  if (sourceBytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error(`${type} input is not a PDF file`)
  }

  const { stdout } = await execFile(pdfinfo, ['-box', sourcePath], { maxBuffer: 2 * 1024 * 1024 })
  const info = validatePdfInfo(parsePdfInfo(stdout))
  const reportDirectory = path.join(stagingDirectory, safeReportDirectory(type))
  await mkdir(reportDirectory, { recursive: true })
  const renderPrefix = path.join(reportDirectory, 'render')
  await execFile(pdftoppm, ['-png', '-r', String(RENDER_DPI), '-cropbox', sourcePath, renderPrefix], {
    maxBuffer: 8 * 1024 * 1024,
  })

  const rendered = (await readdir(reportDirectory))
    .map((filename) => ({ filename, match: /^render-(\d+)\.png$/u.exec(filename) }))
    .filter(({ match }) => match)
    .sort((left, right) => Number(left.match[1]) - Number(right.match[1]))
  if (rendered.length !== info.pages) {
    throw new Error(`${type} rendered ${rendered.length} PNG pages but pdfinfo reported ${info.pages}`)
  }

  let totalPixels = 0
  const pages = []
  for (let index = 0; index < rendered.length; index += 1) {
    const expectedPage = index + 1
    if (Number(rendered[index].match[1]) !== expectedPage) {
      throw new Error(`${type} rendered page sequence is not contiguous at page ${expectedPage}`)
    }
    const originalPath = path.join(reportDirectory, rendered[index].filename)
    const filename = `page-${String(expectedPage).padStart(4, '0')}.png`
    const destination = path.join(reportDirectory, filename)
    await rename(originalPath, destination)
    const bytes = await readFile(destination)
    const dimensions = pngDimensions(bytes)
    const pixels = dimensions.width * dimensions.height
    if (pixels > MAX_PAGE_PIXELS) {
      throw new Error(`${type} page ${expectedPage} exceeds the ${MAX_PAGE_PIXELS}-pixel render bound`)
    }
    totalPixels += pixels
    pages.push({
      page: expectedPage,
      file: `${type}/${filename}`,
      bytes: bytes.length,
      sha256: sha256(bytes),
      ...dimensions,
    })
  }
  if (totalPixels > MAX_TOTAL_PIXELS) {
    throw new Error(`${type} renders exceed the ${MAX_TOTAL_PIXELS}-pixel total bound`)
  }

  return {
    type,
    sourceFile: path.basename(sourcePath),
    sourceBytes: sourceStat.size,
    sourceSha256: sha256(sourceBytes),
    pages: info.pages,
    pageSizePoints: { width: info.pageWidthPoints, height: info.pageHeightPoints },
    pdfVersion: info.pdfVersion,
    metadata: { title: info.title, creator: info.creator, producer: info.producer },
    render: { dpi: RENDER_DPI, cropBox: true, totalPixels, pages },
  }
}

function visualChecklist(reports) {
  const lines = [
    '# PDF report visual review',
    '',
    'Automated structure and rendering passed. A release reviewer must inspect every PNG at 100% zoom.',
    '',
    '- [ ] Japanese glyphs render correctly; there are no tofu boxes, replacement glyphs, or mojibake.',
    '- [ ] No text, chart, table, header, footer, or page number is clipped or overlapping.',
    '- [ ] Typography, spacing, margins, colors, legends, and section hierarchy are consistent.',
    '- [ ] Negative, zero, blank, currency, date, and percentage values remain distinguishable.',
    '- [ ] Long labels and multi-page tables wrap or continue without losing meaning.',
    '- [ ] Every value can be associated with the report title, period, household scope, and accounting basis.',
  ]
  if (reports.some(({ type }) => type === 'annual')) {
    lines.push(
      '- [ ] The annual chart keeps January-December order with legible labels and one consistent scale/color meaning.',
      '- [ ] Partial-coverage months are distinguishable from complete or zero-activity months.',
    )
  }
  if (reports.some(({ type }) => type === 'investment-performance')) {
    lines.push(
      '- [ ] Investment amounts remain separated and visibly labeled by native currency; no mixed-currency total appears.',
      '- [ ] No consolidated return, ROI, TWR, IRR, unrealized return, or current valuation is invented.',
      '- [ ] Uncovered sales, skipped events, and unallocated corporate actions remain visible as exceptions.',
      '- [ ] Available source document/row evidence is readable, and unavailable lineage stays explicitly unavailable.',
    )
  }
  if (reports.some(({ type }) => type === 'portfolio-snapshot')) {
    lines.push(
      '- [ ] Portfolio identity matches the selected snapshot ID, account, as-of time, and source document.',
      '- [ ] Position native currencies and explicit source FX rows remain separate and visibly labeled.',
      '- [ ] Nullable quantity, cost, price, value, and P&L remain blank or unavailable instead of becoming zero.',
      '- [ ] Asset-class, position, and FX rows retain the snapshot source document plus positive source row.',
      '- [ ] No performance, return, trend, current quote, or live valuation is inferred from the snapshot.',
    )
  }
  if (reports.some(({ type }) => type === 'transaction-ledger')) {
    lines.push(
      '- [ ] Transaction rows preserve the selected date range, accounting basis, account group, and attribution scope.',
      '- [ ] Every visible transaction retains its ID, debit/credit accounts, category, calculation-target state, and attribution metadata.',
      '- [ ] Wrapped payee, description, category, account, and identifier text remains complete and does not collide with adjacent rows.',
    )
  }
  lines.push('', '## Pages', '')
  for (const report of reports) {
    for (const page of report.render.pages) lines.push(`- [ ] \`${page.file}\``)
  }
  lines.push('', 'Reviewer:', '', 'Review date:', '', 'Result: PASS / FAIL', '')
  return lines.join('\n')
}

export async function runPdfReportVisualQa({
  reports,
  outputDirectory,
  replace = false,
  requiredReportTypes = V073_REQUIRED_REPORT_TYPES,
  pdfinfo = process.env.KAKEFLOW_PDFINFO || 'pdfinfo',
  pdftoppm = process.env.KAKEFLOW_PDFTOPPM || 'pdftoppm',
} = {}) {
  const entries = Object.entries(reports ?? {}).sort(([left], [right]) => left.localeCompare(right))
  const actualTypes = entries.map(([type]) => type).sort()
  const requiredTypes = [...requiredReportTypes].sort()
  if (JSON.stringify(actualTypes) !== JSON.stringify(requiredTypes)) {
    throw new Error(`Expected PDF report types ${requiredTypes.join(', ')}, received ${actualTypes.join(', ') || 'none'}`)
  }
  const output = path.resolve(outputDirectory ?? path.join(root, 'tmp', 'pdfs', 'v073-report-qa'))
  if (existsSync(output)) {
    if (!replace) throw new Error(`PDF QA output already exists: ${output}; pass replace=true to regenerate it`)
    await rm(output, { recursive: true, force: true })
  }
  const staging = `${output}.staging-${process.pid}`
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  try {
    const results = []
    for (const [type, source] of entries) {
      results.push(await renderReport({ type, source, stagingDirectory: staging, pdfinfo, pdftoppm }))
    }
    results.sort((left, right) => PDF_REPORT_TYPES.indexOf(left.type) - PDF_REPORT_TYPES.indexOf(right.type))
    const manifest = {
      status: 'automated-pass',
      visualReview: 'required',
      reportTypes: results.map(({ type }) => type),
      reports: results,
    }
    await writeFile(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await writeFile(path.join(staging, 'VISUAL_REVIEW.md'), visualChecklist(results), 'utf8')
    await mkdir(path.dirname(output), { recursive: true })
    await rename(staging, output)
    return { ...manifest, outputDirectory: output }
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

function parseCliArguments(argv) {
  const reports = {}
  let outputDirectory
  let replace = false
  let requiredReportTypes = V073_REQUIRED_REPORT_TYPES
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--output') {
      outputDirectory = argv[index + 1]
      index += 1
    } else if (argument === '--replace') {
      replace = true
    } else if (argument === '--require') {
      requiredReportTypes = (argv[index + 1] ?? '').split(',').filter(Boolean)
      index += 1
      if (requiredReportTypes.length === 0 || new Set(requiredReportTypes).size !== requiredReportTypes.length) {
        throw new Error('--require must contain one or more unique comma-separated report types')
      }
      for (const type of requiredReportTypes) safeReportDirectory(type)
    } else {
      const separator = argument.indexOf('=')
      if (separator < 1) throw new Error(`Unknown argument: ${argument}`)
      const type = argument.slice(0, separator)
      if (Object.hasOwn(reports, type)) throw new Error(`Duplicate PDF report type: ${type}`)
      reports[type] = argument.slice(separator + 1)
    }
  }
  if (!outputDirectory) throw new Error('Missing required --output directory')
  return { reports, outputDirectory, replace, requiredReportTypes }
}

const isMain = process.argv[1] && path.basename(process.argv[1]) === 'pdf-report-visual-qa.mjs'
if (isMain) {
  runPdfReportVisualQa(parseCliArguments(process.argv.slice(2))).then(
    (result) => console.log(`PDF report QA rendered ${result.reports.reduce((sum, report) => sum + report.pages, 0)} pages to ${result.outputDirectory}`),
    (error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    },
  )
}
