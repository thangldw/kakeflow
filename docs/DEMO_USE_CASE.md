# Demo use case: one receipt to the whole financial picture

## Persona and boundary

The Tanaka family is a synthetic four-person, dual-income household in Japan. The demo uses JPY and covers salaries, bank accounts, cards, daily spending, budgets, and investments. Every name, amount, account suffix, document, and transaction is fictional.

KakeFlow runs the workflow locally. OCR results remain review candidates until the user confirms them; the application does not initiate payments.

```mermaid
flowchart LR
    A["Review household health"] --> B["Import Japanese receipt"]
    B --> C["Verify OCR candidate"]
    C --> D["Update budget"]
    D --> E["Review investments"]
```

## Scenario

After a household purchase, a family member wants to record the receipt, understand its effect on the monthly budget, and check whether the household remains aligned with its savings and investment plan.

## Demo flow

1. Review household health on the overview: current income, spending, budget status, and pending review work.
2. Import a Japanese receipt. Run on-device OCR and compare the extracted date, total, tax, and items with the source image.
3. Approve the candidate. Only the reviewed entry reaches the ledger; budget use and savings progress can then be reassessed.
4. Review the investment snapshot alongside household cash flow: portfolio value, unrealized gains, holdings, and allocation.

## Expected outcome

The presenter can explain daily spending, monthly planning, and long-term assets from one verified local ledger, while tracing imported values back to their source evidence.

## Published assets

The landing-page animation is generated in Japanese, English, and Vietnamese by `npm run landing:demo`:

- `docs/assets/demo/kakeflow-feature-tour-ja.gif`
- `docs/assets/demo/kakeflow-feature-tour-en.gif`
- `docs/assets/demo/kakeflow-feature-tour-vi.gif`

The generator uses localized product screenshots and localized narrative overlays. Do not replace these assets with personal financial data.

The three GIFs are 960 × 540, contain four frames, and are generated from the same story definition in `scripts/build-landing-demo.mjs`. `src/projectPage.test.ts` verifies their presence, dimensions, frame count and locale switching.

## Tiếng Việt

Use case dùng dữ liệu tổng hợp của gia đình Tanaka bốn người. Flow demo đi từ tổng quan tài chính, nhập và duyệt OCR biên lai Nhật, cập nhật ngân sách đến kiểm tra đầu tư. Tất cả tên, giao dịch, số tiền và hậu tố tài khoản đều là hư cấu; không dùng dữ liệu cá nhân hoặc lịch sử mua sắm thật.

## 日本語

この use case は、4 人世帯の田中家を表す合成データだけを使用します。家計全体の確認、日本語レシート OCR の取込・確認、予算更新、投資確認までを一つの flow として示します。氏名、取引、金額、口座末尾はすべて架空で、個人データや実際の購買履歴は含みません。
