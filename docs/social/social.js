const copy = {
  vi: {
    eyebrow: 'LOCAL-FIRST PERSONAL FINANCE',
    title: 'Tài chính của bạn, ngay trên thiết bị.',
    lede: 'Đọc hóa đơn Nhật, quản lý ngân sách và đầu tư trong một ứng dụng riêng tư.',
    features: ['OCR hóa đơn Nhật', 'Ngân sách & cảnh báo', 'Tài sản & đầu tư', 'Không cần AI token'],
    footer: 'Miễn phí · Mã nguồn mở · macOS ARM64',
  },
  en: {
    eyebrow: 'LOCAL-FIRST PERSONAL FINANCE',
    title: 'Your finances, on your device.',
    lede: 'Japanese receipt OCR, budgets, and investments in one private desktop app.',
    features: ['Japanese receipt OCR', 'Budgets & alerts', 'Assets & investments', 'No AI token required'],
    footer: 'Free · Open source · macOS ARM64',
  },
  ja: {
    eyebrow: 'LOCAL-FIRST PERSONAL FINANCE',
    title: '家計を、あなたの端末で。',
    lede: '日本語レシートOCR、予算、資産運用を一つのプライベートなアプリで。',
    features: ['日本語レシートOCR', '予算とアラート', '資産と投資', 'AIトークン不要'],
    footer: '無料 · オープンソース · macOS ARM64',
  },
};

const params = new URLSearchParams(location.search);
const locale = copy[params.get('lang')] ? params.get('lang') : 'vi';
const format = params.get('format') === 'square' ? 'square' : 'linkedin';
const image = params.get('image') === 'ocr' ? 'ocr-import-vi.jpg' : 'overview-vi.jpg';
const selected = copy[locale];

document.documentElement.lang = locale;
document.querySelector('[data-card]').dataset.format = format;
document.querySelector('[data-copy="eyebrow"]').textContent = selected.eyebrow;
document.querySelector('[data-copy="title"]').textContent = selected.title;
document.querySelector('[data-copy="lede"]').textContent = selected.lede;
document.querySelector('[data-copy="footer"]').textContent = selected.footer;
document.querySelector('[data-product-image]').src = `../assets/demo/${image}`;

const list = document.querySelector('[data-copy="features"]');
selected.features.forEach((feature) => {
  const item = document.createElement('li');
  item.textContent = feature;
  list.append(item);
});
