import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import enGenerated from './locales/en.generated.json'
import viGenerated from './locales/vi.generated.json'

export type AppLocale = 'ja' | 'en' | 'vi'

const STORAGE_KEY = 'kakeflow.locale'

const en: Record<string, string> = {
  ...enGenerated,
  'ホーム': 'Home', '取引': 'Transactions', 'インポート': 'Import', '撮影 Inbox': 'Capture Inbox',
  'カード照合': 'Card reconciliation', '資産・投資': 'Assets & investments',
  'カレンダー・レポート': 'Calendar & reports', '予算・目標': 'Budgets & goals',
  '分類ルール': 'Classification rules', '家族スペース': 'Family space', '設定': 'Settings',
  'メニュー': 'Menu', 'メニューを閉じる': 'Close menu', 'メニューを開く': 'Open menu',
  'メインナビゲーション': 'Main navigation', '世帯を切り替える': 'Switch household',
  '家計': 'Household', 'ローカル世帯': 'Local household', 'ブラウザプレビュー': 'Browser preview',
  'デスクトップ版で安全に保存': 'Save securely in the desktop app', 'データベース確認中': 'Checking database',
  '暗号化DB 接続済み': 'Encrypted database connected', '口座スコープ': 'Account scope',
  'すべての口座': 'All accounts', '家族集計範囲': 'Family scope', '世帯全体': 'Whole household',
  '世帯共通': 'Shared household', '対象月': 'Month', '言語': 'Language',
  'テーマ切替': 'Toggle theme', 'メイン': 'Main', '取り込み': 'Intake', '照合・資産': 'Reconcile & assets',
  '計画・分析': 'Plan & analyze', '世帯': 'Household',
  '世帯の状況・重要アクション・データ品質': 'Household status, key actions, and data quality',
  '確定済み元帳 — 検索・証跡・ドリルダウン': 'Confirmed ledger — search, evidence, and drill-down',
  'ファイル検出 → レビュー → 転記': 'Detect files → review → post',
  'レシート原本・端末内OCR・取込候補': 'Receipt sources, on-device OCR, and import candidates',
  '明細・引落口座・支払照合': 'Statements, settlement accounts, and payment matching',
  'スナップショット・保有・実現損益': 'Snapshots, holdings, and realized gains',
  '月次・年次・予測・固定費': 'Monthly, annual, forecast, and fixed costs',
  '計画値と確定台帳の比較': 'Compare plans with the confirmed ledger',
  '決定的で説明可能な分類ルール': 'Deterministic, explainable classification rules',
  '世帯メンバー・帰属・共有レビュー': 'Household members, attribution, and shared review',
  '口座・ローカルデータ・バックアップ': 'Accounts, local data, and backups',
  '日本語': 'Japanese', 'English': 'English', 'Tiếng Việt': 'Vietnamese',
  '家計の概要': 'Household overview', '取引台帳': 'Transaction ledger', 'すべての取引': 'All transactions',
  '確定した取引と元データを一か所で管理します。': 'Manage confirmed transactions and their source data in one place.',
  'データ取り込み': 'Data intake', 'インポート Inbox': 'Import Inbox',
  'ファイルから読み取った候補を確認して台帳へ反映します。': 'Review extracted candidates before posting them to the ledger.',
  'カード管理': 'Card management', 'カード引落・支払余力': 'Card settlements & payment capacity',
  '資産形成': 'Wealth building', '家計レビュー': 'Household review', 'プランニング': 'Planning',
  '予算・貯蓄目標': 'Budgets & savings goals', '自動化': 'Automation', 'ローカルデータ': 'Local data',
  '口座、暗号化データ、バックアップを管理します。': 'Manage accounts, encrypted data, and backups.',
  '純資産': 'Net worth', '今月の収入': 'Income this month', '今月の支出': 'Expenses this month',
  '貯蓄見込み': 'Projected savings', '資産': 'Assets', '負債': 'Liabilities',
  '収入': 'Income', '支出': 'Expenses', '入金': 'Cash in', '出金': 'Cash out',
  '発生ベース': 'Accrual basis', '資金移動': 'Cash movement', '収支の推移': 'Income and expense trend',
  '入出金の推移': 'Cash-flow trend', '支出の内訳': 'Expense breakdown', '今月のカテゴリー別': 'By category this month',
  '詳細を見る': 'View details', '合計': 'Total', '最近の取引': 'Recent transactions',
  '最近の資金移動': 'Recent cash movements', '確認済みの最新データ': 'Latest confirmed data',
  'すべて見る': 'View all', 'カード支払い': 'Card payments', '請求と口座引落の照合': 'Match statements with bank debits',
  '照合を開く': 'Open reconciliation', '請求額': 'Statement', '口座引落': 'Bank debit',
  '全額照合': 'Reconciled', '一部・候補あり': 'Partial / suggested', '引落待ち': 'Payment pending',
  'データ品質': 'Data quality', '確認待ちあり': 'Review required', '最終確定取込': 'Latest confirmed import',
  '原本データなし': 'No source data', '取込エラーあり': 'Import errors', '確認済みデータを反映': 'Confirmed data reflected',
  'この端末の原本・取込・確認状態': 'Source, import, and review status on this device',
  'ブラウザプレビュー用のサンプル状態': 'Sample status for browser preview',
  '原本とソース行': 'Sources and rows', '確認待ち候補': 'Pending candidates', '失敗した取込': 'Failed imports',
  'インポート Inboxを確認': 'Review Import Inbox', '計算対象': 'Included', '集計対象外': 'Excluded',
  '食費': 'Food', '住居・光熱': 'Housing & utilities', '交通': 'Transport', '日用品': 'Household goods',
  '交通費': 'Transport', '趣味・娯楽': 'Hobbies & entertainment', '衣服・美容': 'Clothing & personal care',
  '特別な支出': 'Special expenses', '交際費': 'Social expenses', '住宅': 'Housing', '水道・光熱費': 'Utilities',
  '自動車': 'Car', '保険': 'Insurance', '税・社会保障': 'Taxes & social security', '教養・教育': 'Education',
  '通信費': 'Communications', '健康・医療': 'Health & medical', 'その他': 'Other', '娯楽': 'Entertainment', '要確認': 'Needs review',
  '銀行': 'Bank', '現金': 'Cash', 'ウォレット': 'Wallet', 'クレジットカード': 'Credit card', '証券': 'Securities',
  '未収金': 'Receivable', '振替': 'Transfer', 'カード利用': 'Card purchase',
  'カード支払': 'Card payment', '返金': 'Refund', '手数料': 'Fee', '利息': 'Interest', '調整': 'Adjustment', '口座を選択': 'Select an account',
  '楽天カード': 'Rakuten Card', 'Amazon Mastercard': 'Amazon Mastercard',
  'ローカルフォルダー': 'Local folder', 'iCloud Drive': 'iCloud Drive', 'Google Drive': 'Google Drive', 'Gmail': 'Gmail',
  '手動アップロード': 'Manual upload', 'カメラ撮影': 'Camera capture', '主要証跡': 'Primary evidence',
  '資金側証跡': 'Funding evidence', 'ポイント側証跡': 'Reward evidence', '継続行': 'Continuation row', '補助証跡': 'Supporting evidence',
  '買付': 'Buy', '売却': 'Sell', '配当': 'Dividend', '税金': 'Tax', '株式分割': 'Stock split', '株式併合': 'Reverse split',
  '合併': 'Merger', 'スピンオフ': 'Spin-off', '新株予約権行使': 'Rights subscription', '端株現金交付': 'Cash in lieu',
  '所有者': 'Owner', 'メンバー': 'Member',
  '店舗、カテゴリー、口座を検索': 'Search merchants, categories, or accounts',
  '計算対象フィルター': 'Inclusion filter', 'すべて': 'All', '計上基準': 'Accounting basis',
  '条件に一致する取引はありません。': 'No transactions match these filters.',
  '台帳を読み込めませんでした。': 'The ledger could not be loaded.',
  '前へ': 'Previous', '次へ': 'Next', '件を表示': 'shown', '家計集計は計算対象のみ': 'household totals include eligible items only',
  '表示設定の保存はデスクトップ版で利用できます。': 'Display settings can be saved in the desktop app.',
  '資産・投資を見る': 'View assets & investments', 'カード照合を開く': 'Open card reconciliation',
  '資金移動を見る': 'View cash movements', 'ファイルを取り込む': 'Import files',
  '帰属': 'Attribution', '表示': 'Visibility', 'まだありません': 'Not available yet',
  '原本未登録': 'No source registered', '原本': 'sources', '行': 'rows', '種類': 'types', '件': 'items',
  '確定するまでダッシュボード集計外': 'Excluded from dashboards until confirmed',
  '再実行または原本確認が必要': 'Retry or inspect the source document',
  'レシート画像を端末内OCRで読み取ります。': 'The receipt image will be read with on-device OCR.',
  'PP-OCRv5で画像を読み取れませんでした。モデル資源、対応形式、画質を確認してください。': 'PP-OCRv5 could not read the image. Check the model resources, supported file format, and image quality.',
  'OCRで合計金額は読み取れましたが、日付が画像にありません。日付が写った原本を選択してください。': 'OCR read the total, but the image contains no date. Choose a source image that includes the date.',
  'OCRで日付は読み取れましたが、合計金額を確定できません。合計欄が鮮明な画像を選択してください。': 'OCR read the date, but could not confirm the total. Choose an image where the total is clear.',
  '確定済み履歴から提案': 'Suggested from confirmed history', 'ローカルキーワードから提案': 'Suggested from local keywords',
  '端末内だけで判定': 'Evaluated only on this device', 'ローカルカテゴリー候補を適用': 'Apply local category suggestion', '選択済み': 'Selected',
  'ローカル候補を適用しました。承認はまだ行われていません。': 'Applied the local suggestion. It has not been approved yet.',
  'ローカルカテゴリー候補': 'Local category suggestions',
  '保存済みルール、確定済み履歴、端末内キーワードの順で提案します。承認や台帳反映は自動で行いません。': 'Suggestions use saved rules, confirmed history, then on-device keywords. Nothing is approved or posted automatically.',
  '保存済みルールを読み込めませんでした。履歴とキーワードによる候補は引き続き利用できます。': 'Saved rules could not be loaded. History and keyword suggestions remain available.',
  '取引履歴を読み込めませんでした。保存済みルールとキーワードで提案します。': 'Transaction history could not be loaded. Suggestions will use saved rules and keywords.',
  '件にカテゴリー候補を適用しました。承認はまだ行われていません。': ' category suggestions applied. Nothing has been approved yet.',
  '高信頼度の未編集候補に一括適用（': 'Apply high-confidence untouched suggestions (',
}

const vi: Record<string, string> = {
  ...viGenerated,
  'ホーム': 'Trang chủ', '取引': 'Giao dịch', 'インポート': 'Nhập dữ liệu', '撮影 Inbox': 'Hộp thư ảnh',
  'カード照合': 'Đối soát thẻ', '資産・投資': 'Tài sản & đầu tư',
  'カレンダー・レポート': 'Lịch & báo cáo', '予算・目標': 'Ngân sách & mục tiêu',
  '定期取引・固定費': 'Định kỳ & chi phí cố định', '監査・証跡': 'Kiểm toán & chứng từ',
  '分類ルール': 'Quy tắc phân loại', '家族スペース': 'Không gian gia đình', '設定': 'Cài đặt',
  'メニュー': 'Menu', 'メニューを閉じる': 'Đóng menu', 'メニューを開く': 'Mở menu',
  'メインナビゲーション': 'Điều hướng chính', '世帯を切り替える': 'Chuyển hộ gia đình',
  '家計': 'Gia đình', 'ローカル世帯': 'Dữ liệu gia đình cục bộ', 'ブラウザプレビュー': 'Bản xem trước',
  'デスクトップ版で安全に保存': 'Lưu an toàn trong ứng dụng desktop', 'データベース確認中': 'Đang kiểm tra cơ sở dữ liệu',
  '暗号化DB 接続済み': 'Đã kết nối cơ sở dữ liệu mã hóa', '口座スコープ': 'Phạm vi tài khoản',
  'すべての口座': 'Tất cả tài khoản', '家族集計範囲': 'Phạm vi gia đình', '世帯全体': 'Toàn gia đình',
  '世帯共通': 'Dùng chung gia đình', '対象月': 'Tháng', '言語': 'Ngôn ngữ',
  'テーマ切替': 'Đổi giao diện', 'メイン': 'Chính', '取り込み': 'Tiếp nhận', '照合・資産': 'Đối soát & tài sản',
  '計画・分析': 'Kế hoạch & phân tích', '世帯': 'Gia đình',
  'サブスクリプションと固定費の変化': 'Theo dõi đăng ký và biến động chi phí cố định',
  '原本、レビュー、確定台帳の来歴': 'Truy vết chứng từ gốc, bước kiểm tra và sổ cái đã xác nhận',
  '口座グループ': 'Nhóm tài khoản', '帰属': 'Phân bổ',
  'スナップショット': 'Ảnh chụp tài sản', '実現損益（FIFO）': 'Lãi/lỗ đã thực hiện (FIFO)',
  '推移・評価': 'Diễn biến & định giá', '投資表示': 'Chế độ xem đầu tư',
  '表示するスナップショット': 'Ảnh chụp tài sản đang hiển thị',
  '最新への自動切替は行いません。評価日を明示して表示します。': 'Không tự chuyển sang bản mới nhất; ngày định giá luôn được hiển thị rõ ràng.',
  '世帯の状況・重要アクション・データ品質': 'Tình hình gia đình, tác vụ quan trọng và chất lượng dữ liệu',
  '確定済み元帳 — 検索・証跡・ドリルダウン': 'Sổ cái đã xác nhận — tìm kiếm, chứng từ và truy vết',
  'ファイル検出 → レビュー → 転記': 'Phát hiện tệp → kiểm tra → ghi sổ',
  'レシート原本・端末内OCR・取込候補': 'Biên lai gốc, OCR trên thiết bị và dữ liệu chờ nhập',
  '明細・引落口座・支払照合': 'Sao kê, tài khoản ghi nợ và đối soát thanh toán',
  'スナップショット・保有・実現損益': 'Ảnh chụp tài sản, danh mục và lãi lỗ đã thực hiện',
  '月次・年次・予測・固定費': 'Theo tháng, năm, dự báo và chi phí cố định',
  '計画値と確定台帳の比較': 'So sánh kế hoạch với sổ cái đã xác nhận',
  '決定的で説明可能な分類ルール': 'Quy tắc phân loại nhất quán, có thể giải thích',
  '世帯メンバー・帰属・共有レビュー': 'Thành viên, quyền sở hữu và kiểm tra dùng chung',
  '口座・ローカルデータ・バックアップ': 'Tài khoản, dữ liệu cục bộ và sao lưu',
  '日本語': 'Tiếng Nhật', 'English': 'Tiếng Anh', 'Tiếng Việt': 'Tiếng Việt',
  '家計の概要': 'Tổng quan tài chính gia đình', '取引台帳': 'Sổ giao dịch', 'すべての取引': 'Tất cả giao dịch',
  '確定した取引と元データを一か所で管理します。': 'Quản lý giao dịch đã xác nhận và dữ liệu nguồn tại một nơi.',
  'データ取り込み': 'Tiếp nhận dữ liệu', 'インポート Inbox': 'Hộp thư nhập dữ liệu',
  'ファイルから読み取った候補を確認して台帳へ反映します。': 'Kiểm tra dữ liệu trích xuất trước khi ghi vào sổ cái.',
  'カード管理': 'Quản lý thẻ', 'カード引落・支払余力': 'Thanh toán thẻ & khả năng chi trả',
  '資産形成': 'Tích lũy tài sản', '家計レビュー': 'Đánh giá tài chính', 'プランニング': 'Kế hoạch',
  '予算・貯蓄目標': 'Ngân sách & mục tiêu tiết kiệm', '自動化': 'Tự động hóa', 'ローカルデータ': 'Dữ liệu cục bộ',
  '口座、暗号化データ、バックアップを管理します。': 'Quản lý tài khoản, dữ liệu mã hóa và bản sao lưu.',
  '純資産': 'Tài sản ròng', '今月の収入': 'Thu nhập tháng này', '今月の支出': 'Chi tiêu tháng này',
  '貯蓄見込み': 'Tiết kiệm dự kiến', '資産': 'Tài sản', '負債': 'Nợ phải trả',
  '収入': 'Thu nhập', '支出': 'Chi tiêu', '入金': 'Tiền vào', '出金': 'Tiền ra',
  '発生ベース': 'Cơ sở phát sinh', '資金移動': 'Dòng tiền', '収支の推移': 'Xu hướng thu chi',
  '入出金の推移': 'Xu hướng dòng tiền', '支出の内訳': 'Cơ cấu chi tiêu', '今月のカテゴリー別': 'Theo danh mục tháng này',
  '詳細を見る': 'Xem chi tiết', '合計': 'Tổng', '最近の取引': 'Giao dịch gần đây',
  '最近の資金移動': 'Dòng tiền gần đây', '確認済みの最新データ': 'Dữ liệu xác nhận mới nhất',
  'すべて見る': 'Xem tất cả', 'カード支払い': 'Thanh toán thẻ', '請求と口座引落の照合': 'Đối chiếu sao kê và ghi nợ ngân hàng',
  '照合を開く': 'Mở đối soát', '請求額': 'Số tiền sao kê', '口座引落': 'Ghi nợ ngân hàng',
  '全額照合': 'Đã đối soát', '一部・候補あり': 'Một phần / có gợi ý', '引落待ち': 'Chờ thanh toán',
  'データ品質': 'Chất lượng dữ liệu', '確認待ちあり': 'Cần kiểm tra', '最終確定取込': 'Lần nhập xác nhận gần nhất',
  '原本データなし': 'Chưa có dữ liệu nguồn', '取込エラーあり': 'Có lỗi nhập dữ liệu', '確認済みデータを反映': 'Đã phản ánh dữ liệu xác nhận',
  'この端末の原本・取込・確認状態': 'Trạng thái nguồn, nhập và kiểm tra trên thiết bị này',
  'ブラウザプレビュー用のサンプル状態': 'Trạng thái mẫu cho bản xem trước',
  '原本とソース行': 'Nguồn và dòng dữ liệu', '確認待ち候補': 'Ứng viên chờ duyệt', '失敗した取込': 'Lần nhập thất bại',
  'インポート Inboxを確認': 'Kiểm tra hộp thư nhập', '計算対象': 'Được tính', '集計対象外': 'Không tổng hợp',
  '食費': 'Ăn uống', '住居・光熱': 'Nhà ở & tiện ích', '交通': 'Đi lại', '日用品': 'Đồ dùng hằng ngày',
  '交通費': 'Đi lại', '趣味・娯楽': 'Sở thích & giải trí', '衣服・美容': 'Quần áo & làm đẹp',
  '特別な支出': 'Chi tiêu đặc biệt', '交際費': 'Giao lưu & quà tặng', '住宅': 'Nhà ở', '水道・光熱費': 'Điện nước & tiện ích',
  '自動車': 'Ô tô', '保険': 'Bảo hiểm', '税・社会保障': 'Thuế & an sinh xã hội', '教養・教育': 'Giáo dục',
  '通信費': 'Viễn thông', '健康・医療': 'Sức khỏe & y tế', 'その他': 'Khác', '娯楽': 'Giải trí', '要確認': 'Cần kiểm tra',
  '銀行': 'Ngân hàng', '現金': 'Tiền mặt', 'ウォレット': 'Ví điện tử', 'クレジットカード': 'Thẻ tín dụng', '証券': 'Chứng khoán',
  '未収金': 'Khoản phải thu', '振替': 'Chuyển khoản', 'カード利用': 'Chi tiêu thẻ',
  'カード支払': 'Thanh toán thẻ', '返金': 'Hoàn tiền', '手数料': 'Phí', '利息': 'Lãi', '調整': 'Điều chỉnh', '口座を選択': 'Chọn tài khoản',
  '楽天カード': 'Thẻ Rakuten', 'Amazon Mastercard': 'Amazon Mastercard',
  'ローカルフォルダー': 'Thư mục cục bộ', 'iCloud Drive': 'iCloud Drive', 'Google Drive': 'Google Drive', 'Gmail': 'Gmail',
  '手動アップロード': 'Tải lên thủ công', 'カメラ撮影': 'Chụp bằng camera', '主要証跡': 'Chứng từ chính',
  '資金側証跡': 'Chứng từ nguồn tiền', 'ポイント側証跡': 'Chứng từ điểm thưởng', '継続行': 'Dòng tiếp theo', '補助証跡': 'Chứng từ bổ trợ',
  '買付': 'Mua', '売却': 'Bán', '配当': 'Cổ tức', '税金': 'Thuế', '株式分割': 'Chia tách cổ phiếu', '株式併合': 'Gộp cổ phiếu',
  '合併': 'Sáp nhập', 'スピンオフ': 'Tách công ty', '新株予約権行使': 'Thực hiện quyền mua', '端株現金交付': 'Thanh toán tiền cho cổ phiếu lẻ',
  '所有者': 'Chủ sở hữu', 'メンバー': 'Thành viên',
  '店舗、カテゴリー、口座を検索': 'Tìm cửa hàng, danh mục hoặc tài khoản',
  '計算対象フィルター': 'Bộ lọc tính toán', 'すべて': 'Tất cả', '計上基準': 'Cơ sở kế toán',
  '条件に一致する取引はありません。': 'Không có giao dịch phù hợp với bộ lọc.',
  '台帳を読み込めませんでした。': 'Không thể tải sổ giao dịch.',
  '前へ': 'Trước', '次へ': 'Sau', '件を表示': 'giao dịch đang hiển thị', '家計集計は計算対象のみ': 'tổng gia đình chỉ gồm khoản hợp lệ',
  '表示設定の保存はデスクトップ版で利用できます。': 'Có thể lưu thiết lập hiển thị trong ứng dụng desktop.',
  '資産・投資を見る': 'Xem tài sản & đầu tư', 'カード照合を開く': 'Mở đối soát thẻ',
  '資金移動を見る': 'Xem dòng tiền', 'ファイルを取り込む': 'Nhập tệp',
  '表示': 'Hiển thị', 'まだありません': 'Chưa có',
  '原本未登録': 'Chưa đăng ký nguồn', '原本': 'nguồn', '行': 'dòng', '種類': 'loại', '件': 'mục',
  '確定するまでダッシュボード集計外': 'Không tính vào dashboard cho đến khi xác nhận',
  '再実行または原本確認が必要': 'Cần chạy lại hoặc kiểm tra dữ liệu nguồn',
  'レシート画像を端末内OCRで読み取ります。': 'Ảnh biên lai sẽ được đọc bằng OCR ngay trên thiết bị.',
  'PP-OCRv5で画像を読み取れませんでした。モデル資源、対応形式、画質を確認してください。': 'PP-OCRv5 không thể đọc ảnh. Hãy kiểm tra tài nguyên mô hình, định dạng tệp được hỗ trợ và chất lượng ảnh.',
  'OCRで合計金額は読み取れましたが、日付が画像にありません。日付が写った原本を選択してください。': 'OCR đã đọc được tổng tiền nhưng trong ảnh không có ngày. Hãy chọn ảnh gốc có hiển thị ngày.',
  'OCRで日付は読み取れましたが、合計金額を確定できません。合計欄が鮮明な画像を選択してください。': 'OCR đã đọc được ngày nhưng chưa xác định được tổng tiền. Hãy chọn ảnh có phần tổng tiền rõ nét.',
  '確定済み履歴から提案': 'Đề xuất từ lịch sử đã xác nhận', 'ローカルキーワードから提案': 'Đề xuất từ từ khóa local',
  '端末内だけで判定': 'Chỉ phân tích trên thiết bị này', 'ローカルカテゴリー候補を適用': 'Áp dụng danh mục local được đề xuất', '選択済み': 'Đã chọn',
  'ローカル候補を適用しました。承認はまだ行われていません。': 'Đã áp dụng đề xuất local nhưng chưa xác nhận giao dịch.',
  'ローカルカテゴリー候補': 'Đề xuất danh mục local',
  '保存済みルール、確定済み履歴、端末内キーワードの順で提案します。承認や台帳反映は自動で行いません。': 'Ưu tiên quy tắc đã lưu, lịch sử đã xác nhận rồi đến từ khóa trên thiết bị. Không tự xác nhận hoặc ghi sổ.',
  '保存済みルールを読み込めませんでした。履歴とキーワードによる候補は引き続き利用できます。': 'Không tải được quy tắc đã lưu; vẫn có thể đề xuất từ lịch sử và từ khóa.',
  '取引履歴を読み込めませんでした。保存済みルールとキーワードで提案します。': 'Không tải được lịch sử giao dịch; sẽ đề xuất bằng quy tắc đã lưu và từ khóa.',
  '件にカテゴリー候補を適用しました。承認はまだ行われていません。': ' đề xuất danh mục đã được áp dụng nhưng chưa xác nhận.',
  '高信頼度の未編集候補に一括適用（': 'Áp dụng hàng loạt đề xuất chưa sửa có độ tin cậy cao (',
}

type I18nValue = {
  locale: AppLocale
  localeCode: string
  setLocale: (locale: AppLocale) => void
  text: (source: string) => string
}

const defaultValue: I18nValue = {
  locale: 'ja',
  localeCode: 'ja-JP',
  setLocale: () => undefined,
  text: (source) => source,
}

const I18nContext = createContext<I18nValue>(defaultValue)
let activeLocale: AppLocale = 'ja'
const interpolationEntries = {
  en: Object.entries(en).sort(([left], [right]) => right.length - left.length),
  vi: Object.entries(vi).sort(([left], [right]) => right.length - left.length),
} as const

// Exported beside the provider so catalog coverage tests use the exact runtime dictionaries.
// eslint-disable-next-line react-refresh/only-export-components
export function hasTranslation(locale: Exclude<AppLocale, 'ja'>, source: string): boolean {
  return Object.hasOwn(locale === 'vi' ? vi : en, source)
}

// eslint-disable-next-line react-refresh/only-export-components
export function translateText(locale: AppLocale, source: string): string {
  if (locale === 'ja') return source
  const dictionary = locale === 'vi' ? vi : en
  const exact = dictionary[source]
  if (exact) return exact
  if (!/[ぁ-んァ-ヶ一-龯]/.test(source)) return source
  return interpolationEntries[locale]
    .filter(([token]) => source.includes(token))
    .reduce((translated, [token, replacement]) => translated.replaceAll(token, replacement), source)
}

// Static UI modules use this function; App consumes the context and rerenders the tree after a locale change.
// eslint-disable-next-line react-refresh/only-export-components
export function localize(source: string): string {
  return translateText(activeLocale, source)
}

function savedLocale(): AppLocale {
  const value = globalThis.localStorage?.getItem(STORAGE_KEY)
  return value === 'en' || value === 'vi' ? value : 'ja'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(savedLocale)
  activeLocale = locale
  const setLocale = useCallback((next: AppLocale) => {
    globalThis.localStorage?.setItem(STORAGE_KEY, next)
    setLocaleState(next)
  }, [])
  useEffect(() => {
    document.documentElement.lang = locale === 'ja' ? 'ja' : locale === 'vi' ? 'vi' : 'en'
  }, [locale])
  const value = useMemo<I18nValue>(() => ({
    locale,
    localeCode: locale === 'ja' ? 'ja-JP' : locale === 'vi' ? 'vi-VN' : 'en-US',
    setLocale,
    text: (source) => translateText(locale, source),
  }), [locale, setLocale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

// The hook intentionally lives beside its provider so locale behavior has one public module.
// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): I18nValue {
  return useContext(I18nContext)
}
