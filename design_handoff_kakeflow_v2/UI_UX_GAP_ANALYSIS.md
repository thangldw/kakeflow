# KakeFlow v2 — UI/UX gap analysis

Đối chiếu ngày 2026-07-16 giữa `design_handoff_kakeflow_final` và application hiện tại.

## Đã đưa vào phase này

- Global shell theo handoff: title bar macOS/Windows, sidebar 232px, header workspace, content scroll riêng và desktop minimum width.
- Design tokens light/dark bằng CSS variables (warm paper, cobalt interaction, semantic green/orange/red), typography JP/mono, card radius, spacing, focus state.
- 11 workspace và navigation groups theo đúng information architecture của handoff.
- Scope/period popover, đóng khi click ngoài hoặc Escape; basis chỉ xuất hiện ở Transactions và Calendar/Reports; theme/language/density nằm trong Settings.
- Home: template chips, KPI basis chips, action center, trend/category/recent/card/data-quality blocks theo density của handoff.
- Transaction semantics quan trọng: confirmed ledger, card payment không phải expense, journal/evidence chain và SHA-256 lineage.
- Import review vẫn giữ review-before-post, explicit commit/rollback, immutable source và các blocking validation hiện có.
- Capture UI chuyển sang local-first intake; remote token controls không còn xuất hiện trong UI v2.
- Settings chuyển về bố cục account management + environment preferences như handoff; các phần nâng cao vẫn nằm phía dưới.

## Có trong thiết kế nhưng chưa implement hoặc mới partial

| Mức | Tính năng | Trạng thái hiện tại | Phase đề xuất |
|---|---|---|---|
| P1 | Home loading skeleton ~1.2s | Chưa có shimmer/skeleton gate | UI state phase |
| P1 | Home first-run empty state + quay lại sample household | Có onboarding tạo household riêng, chưa có empty dashboard/3 CTA đúng handoff | Onboarding phase |
| P1 | Capture local file DnD trực tiếp và watched-folder picker ngay tại Capture | UI local intake đã có; nút hiện chuyển sang Import, chưa ingest trực tiếp vào Capture Inbox | Capture local ingestion phase |
| P1 | Balance basis (`残高`) trong Transactions/Calendar | UI hiển thị disabled; backend `AccountingBasisDto` mới chỉ hỗ trợ `ACCRUAL` hoặc `CASH` | Accounting read-model phase |
| P1 | Transaction split editor đúng flow “remainder = ¥0” | Có journal line editor và receipt split khi import; chưa có UX remainder/apply riêng như handoff | Ledger editing phase |
| P1 | Import master-detail 330px + review/source viewer cùng màn hình | Workflow đã có nhưng layout production hiện vẫn theo khối tuần tự ở một số state | Import workspace phase |
| P1 | AEON revolving-payment blocking state đúng visual và actions | Adapter đã block `リボ/分割/...`; chưa có dedicated banner/state screen đúng handoff | Import error UX phase |
| P2 | Transaction type chips: income/expense/transfer-payment/refund | Hiện có calculation-target, labels và tag filters; type chip toolbar chưa đủ | Ledger filtering phase |
| P2 | Export CSV/XLSX/PDF ngay trong Transactions toolbar | Export đã implement trong Reports/Account Groups, chưa đặt ở Transactions | Export IA phase |
| P2 | Household popover với “+ 新しい世帯を作成…” | Hiện dùng native select; create household chỉ xuất hiện khi chưa có household | Household switching phase |
| P2 | Live pending badge cho Capture Inbox | Badge sample có ở web preview; chưa nối read model count ở desktop shell | Capture read-model phase |
| P2 | Home template widget sets đúng tuyệt đối từng preset | Preset và custom layout đã có; một số widget visibility/order khác handoff | Dashboard preset phase |
| P2 | Card reconciliation hỗ trợ/hiển thị đủ 8 status | Core reconciliation và các state chính đã có; cần matrix QA đủ 8 state | Reconciliation state phase |
| P2 | Calendar monthly/annual review chỉ còn 2 top-level tabs đúng handoff | Có calendar/monthly/annual và thêm nhiều report tab nâng cao | Reports IA phase |
| P2 | Rule explanation panel “なぜ一致したか” | Có deterministic rule builder/apply suggestion; chưa có fixed last-match explanation panel | Rules explainability phase |
| P2 | Global toast 2.6s cho post/apply/export | Hiện dùng inline status/notices ở nhiều flow | Feedback system phase |
| P2 | Localization completeness JA/EN/VI theo phạm vi handoff | Navigation và nhiều copy đã dịch; chưa có coverage test cho toàn bộ subtitle/scope/settings | Localization QA phase |
| P3 | Keyboard household popover + create-household row | Native select keyboard-accessible nhưng chưa đúng popover interaction spec | Accessibility polish |
| P3 | Windows-specific visual QA | Title bar đã implement; chưa có screenshot QA trên Windows runtime | Platform QA |

## Đã implement nhưng chưa có thiết kế UI/UX trong handoff

Các tính năng dưới đây được giữ nguyên về logic. Phase thiết kế sau cần quyết định vị trí trong IA, density, empty/error states và responsive behavior trước khi coi là v2-final.

| Nhóm | Tính năng đã có |
|---|---|
| Dashboard | Custom widget reorder/show-hide và reset layout |
| Transactions | Manual double-entry transaction; family attribution/audience; bulk labels/tags; advanced calculation-target filters |
| Import | Custom delimited parser profiles/rescue dialog; ZIP/EML; Money Forward mappings; brokerage-specific imports; Google Drive/Gmail/iCloud inboxes |
| Capture | Remote mobile capture relay, token receive và background polling (đã ẩn khỏi v2 UI vì handoff yêu cầu local-only) |
| Reports | Forecast/action views, financial intelligence, recurring preference, fixed-cost review, account-group export administration |
| Investments | FX summary, valuation summary, period report, aggregate asset history, market valuation and dedicated brokerage histories |
| Family/Sync | Desktop relay, family delivery packages, family snapshot review, local change packages, portable evidence bundles |
| Settings | Encrypted backup/restore forms; Google Drive/Gmail connectors; parser-profile administration; local sync panels |
| Source evidence | Protected PDF password flow, image/PDF evidence overlays và document evidence viewer nâng cao |

## Nguyên tắc cho phase sau

1. Không bỏ logic nghiệp vụ hiện có chỉ vì chưa có frame trong handoff; thiết kế thêm trước khi đổi IA.
2. Không hiển thị control giả hoạt động. `残高` đang disabled cho tới khi read model hỗ trợ thật.
3. Mọi flow import/capture tiếp tục review-before-post; không đưa candidate vào dashboard totals.
4. Ưu tiên tiếp theo: Capture local ingestion, Import master-detail, Transaction split, rồi Home loading/empty states.
