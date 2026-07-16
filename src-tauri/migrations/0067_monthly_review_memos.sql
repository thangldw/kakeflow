CREATE TABLE monthly_review_memos (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  month TEXT NOT NULL CHECK(length(month)=7 AND substr(month,5,1)='-'),
  memo TEXT NOT NULL CHECK(length(memo)<=1200),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (household_id, month)
);
