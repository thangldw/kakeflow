ALTER TABLE card_payments ADD COLUMN confirmed_at TEXT;

-- A legacy, explicitly reconciled payment is already confirmed. Suggested matches
-- remain unconfirmed until the user accepts them.
UPDATE card_payments
SET confirmed_at = COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
WHERE statement_id IS NOT NULL
  AND reconciliation_status IN ('FULLY_RECONCILED', 'PARTIALLY_RECONCILED', 'OVERPAID');

UPDATE card_statements
SET reconciliation_status = CASE
    WHEN (SELECT COALESCE(SUM(cp.payment_amount_jpy), 0)
          FROM card_payments cp
          WHERE cp.statement_id = card_statements.id AND cp.confirmed_at IS NOT NULL) = 0
        THEN 'UNMATCHED'
    WHEN (SELECT COALESCE(SUM(cp.payment_amount_jpy), 0)
          FROM card_payments cp
          WHERE cp.statement_id = card_statements.id AND cp.confirmed_at IS NOT NULL) < statement_amount_jpy
        THEN 'PARTIALLY_RECONCILED'
    WHEN (SELECT COALESCE(SUM(cp.payment_amount_jpy), 0)
          FROM card_payments cp
          WHERE cp.statement_id = card_statements.id AND cp.confirmed_at IS NOT NULL) = statement_amount_jpy
        THEN 'FULLY_RECONCILED'
    ELSE 'OVERPAID'
END;

CREATE INDEX idx_card_payments_statement_confirmed
    ON card_payments (statement_id, confirmed_at, payment_on, id);

CREATE TRIGGER card_payments_confirmed_shape_insert
BEFORE INSERT ON card_payments
WHEN NEW.confirmed_at IS NOT NULL
BEGIN
    SELECT CASE WHEN NEW.statement_id IS NULL
        THEN RAISE(ABORT, 'confirmed card payment requires statement') END;
    SELECT CASE WHEN NEW.confirmed_at NOT GLOB '????-??-??T??:??:??*Z'
        THEN RAISE(ABORT, 'confirmed card payment has invalid timestamp') END;
    SELECT CASE WHEN NEW.reconciliation_status != 'FULLY_RECONCILED'
        THEN RAISE(ABORT, 'confirmed card payment has invalid status') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM card_statements cs
        JOIN transactions t ON t.id = NEW.bank_transaction_id
        WHERE cs.id = NEW.statement_id
          AND cs.household_id = NEW.household_id
          AND cs.card_account_id = NEW.card_account_id
          AND t.household_id = NEW.household_id
          AND t.status = 'POSTED'
          AND t.transaction_type = 'CARD_PAYMENT'
          AND NEW.payment_amount_jpy = (
              SELECT COALESCE(SUM(je.amount_jpy), 0)
              FROM journal_entries je
              WHERE je.transaction_id = t.id
                AND je.account_id = cs.card_account_id
                AND je.entry_side = 'DEBIT'
          )
    ) THEN RAISE(ABORT, 'invalid confirmed card payment') END;
END;

CREATE TRIGGER card_payments_confirmed_shape_update
BEFORE UPDATE OF statement_id, household_id, bank_transaction_id, card_account_id,
                 payment_amount_jpy, payment_on, reconciliation_status, confirmed_at ON card_payments
WHEN NEW.confirmed_at IS NOT NULL
BEGIN
    SELECT CASE WHEN NEW.statement_id IS NULL
        THEN RAISE(ABORT, 'confirmed card payment requires statement') END;
    SELECT CASE WHEN NEW.confirmed_at NOT GLOB '????-??-??T??:??:??*Z'
        THEN RAISE(ABORT, 'confirmed card payment has invalid timestamp') END;
    SELECT CASE WHEN NEW.reconciliation_status != 'FULLY_RECONCILED'
        THEN RAISE(ABORT, 'confirmed card payment has invalid status') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM card_statements cs
        JOIN transactions t ON t.id = NEW.bank_transaction_id
        WHERE cs.id = NEW.statement_id
          AND cs.household_id = NEW.household_id
          AND cs.card_account_id = NEW.card_account_id
          AND t.household_id = NEW.household_id
          AND t.status = 'POSTED'
          AND t.transaction_type = 'CARD_PAYMENT'
          AND NEW.payment_amount_jpy = (
              SELECT COALESCE(SUM(je.amount_jpy), 0)
              FROM journal_entries je
              WHERE je.transaction_id = t.id
                AND je.account_id = cs.card_account_id
                AND je.entry_side = 'DEBIT'
          )
    ) THEN RAISE(ABORT, 'invalid confirmed card payment') END;
END;

CREATE TRIGGER card_payments_confirmed_link_immutable
BEFORE UPDATE OF statement_id, household_id, bank_transaction_id, card_account_id,
                 payment_amount_jpy, payment_on, reconciliation_status, confirmed_at ON card_payments
WHEN OLD.confirmed_at IS NOT NULL AND (
    NEW.statement_id IS NOT OLD.statement_id
    OR NEW.household_id != OLD.household_id
    OR NEW.bank_transaction_id != OLD.bank_transaction_id
    OR NEW.card_account_id != OLD.card_account_id
    OR NEW.payment_amount_jpy != OLD.payment_amount_jpy
    OR NEW.payment_on != OLD.payment_on
    OR NEW.reconciliation_status != OLD.reconciliation_status
    OR NEW.confirmed_at IS NOT OLD.confirmed_at
)
BEGIN
    SELECT RAISE(ABORT, 'confirmed card payment link is immutable');
END;
