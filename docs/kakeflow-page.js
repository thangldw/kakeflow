(() => {
  const translations = {
    ja: {
      skip: '本文へ移動', menu: 'メニュー', navDemo: 'デモ', navFeatures: '機能', navPrivacy: 'プライバシー', support: '応援する',
      status: 'v1.2.0 公開中 · AIトークン不要', heroTitle: '家計を、<br><em>あなたの端末で。</em>', heroLede: 'レシートOCR、予算、取引、投資を一つに。データを外部AIへ送らず、数字の根拠まで追跡できるデスクトップ家計簿です。',
      download: 'macOS ARM64 版をダウンロード', releaseNotes: 'v1.2.0 リリースノートを見る', releaseBoundary: 'macOS ARM64 対応。現在のバイナリはアドホック署名済み・未公証です。', trustLocal: '家計データは端末内で処理', trustOcr: '日本語レシートをローカル解析', trustReview: '確認前に台帳へ記帳しない', tourCaption: 'ダッシュボード、OCR取込、予算、投資管理を約9秒で紹介。',
      benefitOcrTitle: '日本語レシートOCR', benefitOcrBody: 'PP-OCRv5で日付、合計、税、品目を端末内で読み取ります。', benefitBudgetTitle: '予算とアラート', benefitBudgetBody: '月次予算、貯蓄目標、超過と変化を一画面で確認。', benefitInvestTitle: '資産と投資', benefitInvestBody: '保有、評価損益、配当、資産配分を家計と分けて管理。',
      demoTitle: '見るだけでなく、<br>根拠まで確かめる。', demoBody: '実際のKakeFlow画面です。タブを切り替えて、OCR取込、予算管理、投資ポートフォリオを確認できます。', tabOcr: 'OCR取込', tabOcrDetail: '候補と原本をレビュー', tabBudget: '予算', tabBudgetDetail: '超過と目標を追跡', tabInvest: '投資', tabInvestDetail: '評価額と配分を確認', ocrCaption: '抽出結果は候補として表示し、人が確認した後だけ台帳へ反映します。', budgetCaption: '予算消化率、超過、貯蓄目標を同じ月次画面で確認します。', investCaption: '評価額、含み損益、保有銘柄、資産配分をスナップショットとして管理します。',
      featuresTitle: '家計の入口から、<br>資産形成まで。', featuresBody: '取込、分類、予算、定期支出、カード照合、投資、監査ログを一つのローカル台帳につなぎます。', feature1Title: 'レシートをまとめて処理', feature1Body: '画像とスキャンPDFを読み取り、重複候補、日付、金額、税、品目をレビュー。', feature2Title: '予算と固定費を見張る', feature2Body: '予算閾値、貯蓄目標、定期支出の変化を、説明可能なローカル判定で通知。', feature3Title: '投資を家計と統合', feature3Body: 'スナップショット、FIFO実現損益、配当、資産配分、評価推移を追跡。', feature4Title: '数字から原本へ戻る', feature4Body: '取引、元ファイル、元行、レシート、監査ログをリンクして確認できます。',
      privacyTitle: 'AIトークンなし。<br>クラウド送信なし。', privacyBody: 'OCRとカテゴリ提案は端末内で実行。KakeFlowは支払いを開始せず、確認前の候補を確定取引として扱いません。', privacyItem1: '暗号化されたローカル台帳', privacyItem2: '署名を検証する安全な自動更新', privacyItem3: '日本語・英語・ベトナム語UI', closingTitle: '今日から、<br>自分のデータで始める。', downloadShort: '無料でダウンロード', supportWork: '開発を応援する', footerTagline: 'macOS向けローカルファースト家計簿。',
      supportTitle: 'Support my work', supportIntro: 'KakeFlowが役に立ったら、継続開発を応援していただけます。支援はいつでも任意です。', sponsorIntro: 'USDで支援方法と金額を選べます。', monthly: '毎月', oneTime: '一回', amount: '金額', continueGithub: 'GitHubで続ける', githubNote: 'GitHubで内容を確認して確定します。', bankTransfer: '銀行振込', qrHint: 'ベトナムの銀行アプリで読み取ってください。',
    },
    en: {
      skip: 'Skip to content', menu: 'Menu', navDemo: 'Demo', navFeatures: 'Features', navPrivacy: 'Privacy', support: 'Support',
      status: 'v1.2.0 available · No AI token required', heroTitle: 'Your finances,<br><em>on your device.</em>', heroLede: 'Receipt OCR, budgets, transactions, and investments in one desktop app. Keep data off external AI services and trace every number back to its source.',
      download: 'Download for macOS ARM64', releaseNotes: 'View v1.2.0 release notes', releaseBoundary: 'For macOS ARM64. The current binary is ad-hoc signed and not notarized.', trustLocal: 'Financial data stays on device', trustOcr: 'Japanese receipts read locally', trustReview: 'Nothing posts before review', tourCaption: 'A 9-second tour of the dashboard, OCR import, budgets, and investments.',
      benefitOcrTitle: 'Japanese receipt OCR', benefitOcrBody: 'PP-OCRv5 reads dates, totals, taxes, and items entirely on device.', benefitBudgetTitle: 'Budgets and alerts', benefitBudgetBody: 'See monthly budgets, savings goals, overspending, and changes in one place.', benefitInvestTitle: 'Assets and investments', benefitInvestBody: 'Track holdings, gains, dividends, and allocation separately from daily spending.',
      demoTitle: 'See the numbers.<br>Verify the source.', demoBody: 'These are real KakeFlow screens. Switch tabs to explore OCR import, budget planning, and the investment portfolio.', tabOcr: 'OCR import', tabOcrDetail: 'Review candidates and sources', tabBudget: 'Budgets', tabBudgetDetail: 'Track limits and goals', tabInvest: 'Investments', tabInvestDetail: 'Review value and allocation', ocrCaption: 'Extracted data stays a candidate and reaches the ledger only after human review.', budgetCaption: 'Review budget use, overspending, and savings goals in one monthly workspace.', investCaption: 'Manage value, unrealized gains, holdings, and allocation as dated snapshots.',
      featuresTitle: 'From intake<br>to wealth building.', featuresBody: 'Connect import, classification, budgets, recurring costs, card matching, investments, and audit history through one local ledger.', feature1Title: 'Process receipts in batches', feature1Body: 'Read images and scanned PDFs, then review duplicates, dates, totals, taxes, and line items.', feature2Title: 'Watch budgets and fixed costs', feature2Body: 'Use explainable local rules for budget thresholds, savings goals, and recurring-cost changes.', feature3Title: 'Unify investments and finance', feature3Body: 'Track snapshots, FIFO realized gains, dividends, allocation, and valuation trends.', feature4Title: 'Trace numbers to evidence', feature4Body: 'Move from a transaction to its original file, row, receipt, and audit log.',
      privacyTitle: 'No AI token.<br>No cloud upload.', privacyBody: 'OCR and category suggestions run on device. KakeFlow never initiates payments or treats unreviewed candidates as confirmed transactions.', privacyItem1: 'Encrypted local ledger', privacyItem2: 'Safe auto-update with signature verification', privacyItem3: 'Japanese, English, and Vietnamese UI', closingTitle: 'Start today,<br>with your own data.', downloadShort: 'Download free', supportWork: 'Support my work', footerTagline: 'Local-first household finance for macOS.',
      supportTitle: 'Support my work', supportIntro: 'If KakeFlow has been useful, your support helps me maintain it and build new features. Support is always optional.', sponsorIntro: 'Choose a contribution type and amount in USD.', monthly: 'Monthly', oneTime: 'One-time', amount: 'Amount', continueGithub: 'Continue on GitHub', githubNote: 'GitHub will open to review and confirm your sponsorship.', bankTransfer: 'Bank transfer', qrHint: 'Scan with a Vietnamese banking app.',
    },
    vi: {
      skip: 'Bỏ qua đến nội dung', menu: 'Menu', navDemo: 'Demo', navFeatures: 'Tính năng', navPrivacy: 'Riêng tư', support: 'Ủng hộ',
      status: 'Đã có v1.2.0 · Không cần AI token', heroTitle: 'Tài chính của bạn,<br><em>ngay trên thiết bị.</em>', heroLede: 'OCR biên lai, ngân sách, giao dịch và đầu tư trong một ứng dụng desktop. Không gửi dữ liệu tới AI bên ngoài, mọi con số đều truy ngược được về chứng từ.',
      download: 'Tải cho macOS ARM64', releaseNotes: 'Xem ghi chú phát hành v1.2.0', releaseBoundary: 'Dành cho macOS ARM64. Bản hiện tại được ký ad-hoc và chưa notarize.', trustLocal: 'Dữ liệu tài chính ở trên thiết bị', trustOcr: 'Đọc biên lai Nhật ngay trên máy', trustReview: 'Chỉ ghi sổ sau khi kiểm tra', tourCaption: '9 giây giới thiệu dashboard, OCR, ngân sách và đầu tư.',
      benefitOcrTitle: 'OCR biên lai tiếng Nhật', benefitOcrBody: 'PP-OCRv5 đọc ngày, tổng tiền, thuế và mặt hàng hoàn toàn trên thiết bị.', benefitBudgetTitle: 'Ngân sách & cảnh báo', benefitBudgetBody: 'Theo dõi ngân sách tháng, mục tiêu tiết kiệm, vượt ngưỡng và biến động tại một nơi.', benefitInvestTitle: 'Tài sản & đầu tư', benefitInvestBody: 'Theo dõi danh mục, lãi lỗ, cổ tức và phân bổ tách biệt với chi tiêu hằng ngày.',
      demoTitle: 'Không chỉ xem số.<br>Còn kiểm tra được nguồn.', demoBody: 'Đây là màn hình thật của KakeFlow. Chuyển tab để xem OCR, quản lý ngân sách và danh mục đầu tư.', tabOcr: 'Nhập bằng OCR', tabOcrDetail: 'Kiểm tra đề xuất và chứng từ', tabBudget: 'Ngân sách', tabBudgetDetail: 'Theo dõi ngưỡng và mục tiêu', tabInvest: 'Đầu tư', tabInvestDetail: 'Xem định giá và phân bổ', ocrCaption: 'Dữ liệu trích xuất chỉ là đề xuất và chỉ được ghi sổ sau khi bạn xác nhận.', budgetCaption: 'Theo dõi mức sử dụng ngân sách, khoản vượt ngưỡng và mục tiêu tiết kiệm theo tháng.', investCaption: 'Quản lý định giá, lãi lỗ chưa thực hiện, danh mục và phân bổ theo từng ảnh chụp.',
      featuresTitle: 'Từ lúc nhập dữ liệu<br>đến khi tích lũy tài sản.', featuresBody: 'Kết nối nhập dữ liệu, phân loại, ngân sách, chi phí định kỳ, đối soát thẻ, đầu tư và nhật ký kiểm toán trong một sổ cái local.', feature1Title: 'Xử lý biên lai hàng loạt', feature1Body: 'Đọc ảnh và PDF scan, sau đó kiểm tra trùng lặp, ngày, tổng tiền, thuế và từng mặt hàng.', feature2Title: 'Theo dõi ngân sách & cố định', feature2Body: 'Dùng quy tắc local dễ giải thích cho ngưỡng ngân sách, mục tiêu và biến động chi phí định kỳ.', feature3Title: 'Kết hợp đầu tư với tài chính', feature3Body: 'Theo dõi snapshot, lãi FIFO đã thực hiện, cổ tức, phân bổ và xu hướng định giá.', feature4Title: 'Truy ngược số liệu về chứng từ', feature4Body: 'Từ giao dịch mở lại tệp gốc, dòng dữ liệu, biên lai và nhật ký kiểm toán.',
      privacyTitle: 'Không AI token.<br>Không tải lên cloud.', privacyBody: 'OCR và đề xuất danh mục chạy ngay trên thiết bị. KakeFlow không thực hiện thanh toán và không coi dữ liệu chưa duyệt là giao dịch đã xác nhận.', privacyItem1: 'Sổ cái local được mã hóa', privacyItem2: 'Auto-update an toàn, có xác minh chữ ký', privacyItem3: 'Giao diện Việt, Anh và Nhật', closingTitle: 'Bắt đầu hôm nay,<br>bằng dữ liệu của bạn.', downloadShort: 'Tải miễn phí', supportWork: 'Ủng hộ dự án', footerTagline: 'Ứng dụng tài chính gia đình local-first cho macOS.',
      supportTitle: 'Ủng hộ công việc của tôi', supportIntro: 'Nếu KakeFlow hữu ích, sự ủng hộ của bạn sẽ giúp tôi duy trì dự án và phát triển thêm tính năng. Hoàn toàn tự nguyện.', sponsorIntro: 'Chọn hình thức và số tiền ủng hộ bằng USD.', monthly: 'Hằng tháng', oneTime: 'Một lần', amount: 'Số tiền', continueGithub: 'Tiếp tục trên GitHub', githubNote: 'GitHub sẽ mở để bạn kiểm tra và xác nhận.', bankTransfer: 'Chuyển khoản ngân hàng', qrHint: 'Quét bằng ứng dụng ngân hàng Việt Nam.',
    },
  };

  const screenData = {
    ocr: { file: 'ocr-import', alt: 'KakeFlow OCR import workspace', title: 'tabOcr', caption: 'ocrCaption' },
    budgets: { file: 'budgets', alt: 'KakeFlow budget and savings goals workspace', title: 'tabBudget', caption: 'budgetCaption' },
    investments: { file: 'investments', alt: 'KakeFlow investments workspace', title: 'tabInvest', caption: 'investCaption' },
  };
  const state = { locale: 'ja', screen: 'ocr' };
  const menuButton = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('#primary-nav');
  const tabs = [...document.querySelectorAll('[role="tab"][data-screen]')];
  const screenImage = document.querySelector('#screen-image');
  const screenCaption = document.querySelector('#screen-caption');
  const screenPanel = document.querySelector('#screen-panel');
  const tourImage = document.querySelector('#tour-image');

  function copy(key) { return translations[state.locale][key] ?? translations.ja[key] ?? key; }
  function selectScreen(tab, moveFocus = false) {
    const screen = screenData[tab.dataset.screen];
    if (!screen || !screenImage || !screenCaption || !screenPanel) return;
    state.screen = tab.dataset.screen;
    tabs.forEach((candidate) => { const selected = candidate === tab; candidate.setAttribute('aria-selected', String(selected)); candidate.tabIndex = selected ? 0 : -1; });
    screenImage.src = `assets/demo/${screen.file}-${state.locale}.jpg`; screenImage.alt = screen.alt;
    screenCaption.replaceChildren(Object.assign(document.createElement('b'), { textContent: copy(screen.title) }), Object.assign(document.createElement('span'), { textContent: copy(screen.caption) }));
    screenPanel.setAttribute('aria-labelledby', tab.id);
    if (moveFocus) tab.focus();
  }
  function setLocale(locale) {
    if (!translations[locale]) return;
    state.locale = locale; localStorage.setItem('kakeflow.site.locale', locale); document.documentElement.lang = locale;
    document.querySelectorAll('[data-i18n]').forEach((element) => { element.textContent = copy(element.dataset.i18n); });
    document.querySelectorAll('[data-i18n-html]').forEach((element) => { element.innerHTML = copy(element.dataset.i18nHtml); });
    document.querySelectorAll('[data-locale]').forEach((button) => { const active = button.dataset.locale === locale; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    if (tourImage) tourImage.src = `assets/demo/kakeflow-feature-tour-${locale}.gif`;
    const activeTab = tabs.find((tab) => tab.dataset.screen === state.screen); if (activeTab) selectScreen(activeTab);
    const title = locale === 'vi' ? 'KakeFlow — Tài chính của bạn, ngay trên thiết bị.' : locale === 'en' ? 'KakeFlow — Your finances, on your device.' : 'KakeFlow — 家計の流れを、正しくひとつに。';
    document.title = title; document.querySelector('meta[property="og:title"]')?.setAttribute('content', title);
  }
  function closeMenu() { menuButton?.setAttribute('aria-expanded', 'false'); navigation?.classList.remove('is-open'); }
  menuButton?.addEventListener('click', () => { const open = menuButton.getAttribute('aria-expanded') !== 'true'; menuButton.setAttribute('aria-expanded', String(open)); navigation?.classList.toggle('is-open', open); });
  navigation?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
  document.querySelectorAll('[data-locale]').forEach((button) => button.addEventListener('click', () => setLocale(button.dataset.locale)));
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectScreen(tab));
    tab.addEventListener('keydown', (event) => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); let next = index; if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length; if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length; if (event.key === 'Home') next = 0; if (event.key === 'End') next = tabs.length - 1; selectScreen(tabs[next], true); });
  });

  const supportBackdrop = document.querySelector('[data-support-backdrop]');
  const supportDialog = supportBackdrop?.querySelector('.support-dialog');
  const supportClose = supportBackdrop?.querySelector('[data-support-close]');
  let returnFocus = null;
  function openSupport(event) { returnFocus = event.currentTarget; supportBackdrop.hidden = false; document.body.classList.add('modal-open'); supportClose?.focus(); }
  function closeSupport() { supportBackdrop.hidden = true; document.body.classList.remove('modal-open'); returnFocus?.focus(); }
  document.querySelectorAll('[data-support-open]').forEach((button) => button.addEventListener('click', openSupport));
  supportClose?.addEventListener('click', closeSupport);
  supportBackdrop?.addEventListener('mousedown', (event) => { if (event.target === supportBackdrop) closeSupport(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && supportBackdrop && !supportBackdrop.hidden) closeSupport(); if (event.key === 'Tab' && supportBackdrop && !supportBackdrop.hidden && supportDialog) { const focusable = [...supportDialog.querySelectorAll('button, a, input')].filter((element) => !element.disabled); if (!focusable.length) return; const first = focusable[0]; const last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } });
  window.addEventListener('resize', () => { if (window.innerWidth > 820) closeMenu(); });
  const saved = localStorage.getItem('kakeflow.site.locale');
  const inferred = navigator.language.toLowerCase().startsWith('vi') ? 'vi' : navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
  setLocale(saved && translations[saved] ? saved : inferred);
})();
