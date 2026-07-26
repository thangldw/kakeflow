# KakeFlow architecture / Kiến trúc / アーキテクチャ

```mermaid
%%{init: {"theme":"base","themeVariables":{"background":"#FFFFFF","fontFamily":"Arial, sans-serif","lineColor":"#667085","primaryTextColor":"#172B4D"}}}%%
flowchart LR
    I["Imports & OCR<br/>Nhập / 取込"]:::yellow
    E["Immutable evidence<br/>Bằng chứng / 証拠"]:::blue
    Q["Review queue<br/>Duyệt / 確認"]:::pink
    L["Encrypted ledger<br/>Sổ cái / 台帳"]:::purple
    R["Reports & family<br/>Báo cáo / 共有"]:::green
    I --> E --> Q --> L --> R
    classDef yellow fill:#FFF4A3,stroke:#C9A227,stroke-width:2px,color:#172B4D
    classDef blue fill:#D9EAFD,stroke:#4C78A8,stroke-width:2px,color:#172B4D
    classDef pink fill:#FFE1E6,stroke:#C96A7B,stroke-width:2px,color:#172B4D
    classDef purple fill:#E9DDF7,stroke:#8064A2,stroke-width:2px,color:#172B4D
    classDef green fill:#DDF5E3,stroke:#4F9D69,stroke-width:2px,color:#172B4D
```

## English

The React/TypeScript frontend runs inside Tauri 2. Rust commands own local encrypted persistence, import parsing, evidence lineage and accounting boundaries. Extracted candidates enter a review queue; only confirmed records reach the double-entry ledger. Connectors and OCR fail closed on incomplete semantics.

## Tiếng Việt

Frontend React/TypeScript chạy trong Tauri 2. Rust command quản lý lưu trữ mã hóa local, parser import, evidence lineage và ranh giới kế toán. Candidate trích xuất vào hàng đợi duyệt; chỉ record đã xác nhận mới vào sổ kép. Connector/OCR fail-closed khi semantics chưa đủ.

## 日本語

React/TypeScript frontend は Tauri 2 内で動作します。Rust command がローカル暗号化保存、取込解析、証拠来歴、会計境界を担当します。抽出候補は確認キューに入り、承認済み記録だけが複式簿記台帳へ反映されます。意味が不完全な connector／OCR は fail-closed です。
