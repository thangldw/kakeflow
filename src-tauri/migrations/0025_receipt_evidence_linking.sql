ALTER TABLE transaction_candidates ADD COLUMN receipt_resolution_status TEXT
    CHECK (receipt_resolution_status IS NULL OR receipt_resolution_status IN ('LINKED', 'DECLINED'));
ALTER TABLE transaction_candidates ADD COLUMN receipt_resolved_at TEXT;

CREATE INDEX idx_candidates_receipt_resolution
    ON transaction_candidates (household_id, receipt_resolution_status, occurred_on DESC);

CREATE TRIGGER trg_receipt_resolution_shape_insert
BEFORE INSERT ON transaction_candidates
WHEN (NEW.receipt_resolution_status IS NULL) != (NEW.receipt_resolved_at IS NULL)
  OR NEW.receipt_resolution_status IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'invalid receipt resolution');
END;

CREATE TRIGGER trg_receipt_resolution_shape_update
BEFORE UPDATE OF receipt_resolution_status, receipt_resolved_at ON transaction_candidates
WHEN (NEW.receipt_resolution_status IS NULL) != (NEW.receipt_resolved_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'invalid receipt resolution');
END;

CREATE TRIGGER trg_receipt_resolution_link_update
BEFORE UPDATE OF receipt_resolution_status ON transaction_candidates
WHEN NEW.receipt_resolution_status = 'LINKED'
 AND NOT EXISTS (
   SELECT 1 FROM receipt_candidate_links rcl WHERE rcl.candidate_id = NEW.id
 )
BEGIN
  SELECT RAISE(ABORT, 'missing receipt evidence link');
END;

CREATE TABLE receipt_candidate_links (
    candidate_id TEXT PRIMARY KEY NOT NULL REFERENCES transaction_candidates(id) ON DELETE RESTRICT,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (household_id, transaction_id, candidate_id)
) STRICT;

CREATE INDEX idx_receipt_candidate_links_transaction
    ON receipt_candidate_links (household_id, transaction_id);

CREATE TRIGGER trg_receipt_candidate_link_insert_scope
BEFORE INSERT ON receipt_candidate_links
WHEN NOT EXISTS (
    SELECT 1 FROM transaction_candidates c JOIN transactions t ON t.id=NEW.transaction_id
    WHERE c.id=NEW.candidate_id AND c.household_id=NEW.household_id
      AND c.review_status IN ('PENDING','READY')
      AND t.household_id=NEW.household_id AND t.status='POSTED'
      AND t.transaction_type IN ('EXPENSE','CARD_PURCHASE')
      AND abs(julianday(t.occurred_on)-julianday(c.occurred_on))<=3
      AND EXISTS (
        SELECT 1 FROM candidate_sources cs
        JOIN source_records sr ON sr.id=cs.source_record_id
        JOIN source_documents sd ON sd.id=sr.source_document_id
        JOIN import_runs ir ON ir.id=sd.import_run_id
        WHERE cs.candidate_id=c.id AND ir.adapter_id='receipt-text-v2'
      )
      AND (
        SELECT COALESCE(SUM(CASE WHEN a.account_kind='EXPENSE' AND je.entry_side='DEBIT'
                            THEN je.amount_jpy ELSE 0 END),0)
        FROM journal_entries je JOIN accounts a ON a.id=je.account_id
        WHERE je.transaction_id=t.id
      )=c.amount_jpy
)
BEGIN
    SELECT RAISE(ABORT, 'invalid receipt evidence link');
END;

CREATE TRIGGER trg_receipt_candidate_link_update_scope
BEFORE UPDATE ON receipt_candidate_links
BEGIN
    SELECT RAISE(ABORT, 'receipt evidence links are immutable');
END;
