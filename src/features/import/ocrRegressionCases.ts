export interface OcrRegressionExpectation {
  readonly occurredOn: string
  readonly amountJpy: number
  readonly itemAmountsJpy: readonly number[]
  readonly taxAmountJpy: number
  readonly minimumConfidenceBps: number
}

export interface OcrRegressionCase {
  readonly id: string
  readonly fixtureFilename: string
  readonly imageUrl: string
  readonly expected: OcrRegressionExpectation
  readonly observedText: string
}

export const OCR_REGRESSION_CASES: readonly OcrRegressionCase[] = [
  {
    id: 'spaced-yen-total',
    fixtureFilename: 'receipt-spaced-yen.synthetic.jpg',
    imageUrl: new URL('./fixtures/ocr/receipt-spaced-yen.synthetic.jpg', import.meta.url).href,
    expected: { occurredOn: '2024-06-24', amountJpy: 233, itemAmountsJpy: [98, 118], taxAmountJpy: 17, minimumConfidenceBps: 8_500 },
    observedText: '匿名スパー\nTEL000-0000-0000\n2024/06/24(月)12:34\n練習商品A\n￥98\n練習商品B\n￥118\n小計\n￥216\n外税8%\n￥17\n合計\n￥233\n電子マネ\n￥233',
  },
  {
    id: 'leading-tax-marker',
    fixtureFilename: 'receipt-tax-marker.synthetic.jpg',
    imageUrl: new URL('./fixtures/ocr/receipt-tax-marker.synthetic.jpg', import.meta.url).href,
    expected: { occurredOn: '2022-09-06', amountJpy: 254, itemAmountsJpy: [138, 98], taxAmountJpy: 18, minimumConfidenceBps: 8_500 },
    observedText: '匿名コンビニ\nレジ#1\n2022年09月06日（火）18:18\n商品ードA001\n*138\n商品ドB002\n*98\n小計(税抜8%)\n￥236\n消費税等(8%)\n￥18\n合計\n￥254\nお預り\n￥500\nお釣\n￥246',
  },
]
