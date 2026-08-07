import path from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const width = 960
const pageHeight = 540
const screens = ['overview', 'ocr-import', 'budgets', 'investments']
const frameDelay = [2_400, 2_900, 2_700, 2_900]
const stories = {
  ja: [
    ['家計全体を確認', '田中家の収支と未確認項目をひと目で把握'],
    ['レシートを取り込む', '端末内OCRの候補を原本と照合してから記帳'],
    ['予算への影響を確認', '超過と貯蓄目標を同じ月次画面で判断'],
    ['資産形成までつなぐ', '家計と投資の評価額・配分を一緒に把握'],
  ],
  en: [
    ['Review household health', "See the Tanaka family's cash flow and pending actions"],
    ['Import a receipt', 'Verify on-device OCR against the source before posting'],
    ['Check the budget impact', 'Review overspending and savings goals for the month'],
    ['Connect daily finance to wealth', 'Track portfolio value and allocation with household cash flow'],
  ],
  vi: [
    ['Kiểm tra sức khỏe tài chính', 'Xem dòng tiền và việc cần xử lý của gia đình Tanaka'],
    ['Nhập biên lai', 'Đối chiếu OCR local với chứng từ trước khi ghi sổ'],
    ['Kiểm tra tác động ngân sách', 'Xem khoản vượt ngưỡng và mục tiêu tiết kiệm trong tháng'],
    ['Nối chi tiêu với tài sản', 'Theo dõi giá trị và phân bổ đầu tư cùng dòng tiền gia đình'],
  ],
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function storyOverlay(locale, index) {
  const [title, detail] = stories[locale][index]
  const progress = `${String(index + 1).padStart(2, '0')} / ${String(screens.length).padStart(2, '0')}`
  const dots = screens.map((_, dotIndex) => `<circle cx="${850 + dotIndex * 20}" cy="45" r="5" fill="${dotIndex === index ? '#f4b860' : '#758078'}"/>`).join('')
  return Buffer.from(`<svg width="${width}" height="${pageHeight}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="caption" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#17231d" stop-opacity="0"/><stop offset="0.32" stop-color="#17231d" stop-opacity="0.78"/><stop offset="1" stop-color="#17231d" stop-opacity="0.96"/></linearGradient></defs>
    <rect x="24" y="24" width="112" height="42" rx="21" fill="#17231d" fill-opacity="0.9"/>
    <text x="80" y="51" text-anchor="middle" fill="#fffefa" font-family="Arial, sans-serif" font-size="14" font-weight="700" letter-spacing="1.5">${progress}</text>
    <rect x="824" y="24" width="112" height="42" rx="21" fill="#17231d" fill-opacity="0.9"/>
    ${dots}
    <rect x="0" y="390" width="960" height="150" fill="url(#caption)"/>
    <text x="40" y="462" fill="#fffefa" font-family="Noto Sans JP, Noto Sans, Arial, sans-serif" font-size="28" font-weight="700">${escapeXml(title)}</text>
    <text x="40" y="497" fill="#dfe8e1" font-family="Noto Sans JP, Noto Sans, Arial, sans-serif" font-size="17" font-weight="500">${escapeXml(detail)}</text>
  </svg>`)
}

for (const locale of Object.keys(stories)) {
  const rawFrames = await Promise.all(screens.map(async (screen, index) => sharp(path.join(root, `docs/assets/demo/${screen}-${locale}.jpg`))
    .resize(width, pageHeight, { fit: 'cover' })
    .composite([{ input: storyOverlay(locale, index) }])
    .ensureAlpha()
    .raw()
    .toBuffer()))
  const output = path.join(root, `docs/assets/demo/kakeflow-feature-tour-${locale}.gif`)
  await sharp(Buffer.concat(rawFrames), {
    raw: { width, height: pageHeight * rawFrames.length, channels: 4, pageHeight },
  })
    .gif({ loop: 0, delay: frameDelay, colours: 160, dither: 0.7, effort: 6 })
    .toFile(output)
  console.log(`Landing demo GIF written to ${output}.`)
}
