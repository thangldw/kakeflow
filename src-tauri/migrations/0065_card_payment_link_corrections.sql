-- A confirmed card-payment link may be corrected by the user without changing
-- the underlying bank transaction or journal. Every local unlink is recorded
-- before the aggregate state is changed. Package application remains able to
-- materialize the portable CARD_PAYMENT state under its existing apply guard.

CREATE TABLE card_payment_link_corrections (
    id TEXT PRIMARY KEY NOT NULL
        CHECK (length(id) = 32 AND id NOT GLOB '*[^0-9a-f]*'),
    household_id TEXT NOT NULL
        CHECK (length(trim(household_id)) BETWEEN 1 AND 128),
    statement_id TEXT NOT NULL
        CHECK (length(trim(statement_id)) BETWEEN 1 AND 128),
    payment_id TEXT NOT NULL
        CHECK (length(trim(payment_id)) BETWEEN 1 AND 128),
    bank_transaction_id TEXT NOT NULL
        CHECK (length(trim(bank_transaction_id)) BETWEEN 1 AND 128),
    previous_confirmed_at TEXT NOT NULL
        CHECK (previous_confirmed_at GLOB '????-??-??T??:??:??*Z'),
    correction_kind TEXT NOT NULL DEFAULT 'UNLINK'
        CHECK (correction_kind = 'UNLINK'),
    corrected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        CHECK (corrected_at GLOB '????-??-??T??:??:??*Z'),
    UNIQUE (payment_id, previous_confirmed_at)
) STRICT;

CREATE INDEX idx_card_payment_link_corrections_household
    ON card_payment_link_corrections(household_id, corrected_at, payment_id);

CREATE TRIGGER card_payment_link_corrections_immutable_update
BEFORE UPDATE ON card_payment_link_corrections
BEGIN
    SELECT RAISE(ABORT, 'card payment link correction audit is immutable');
END;

CREATE TRIGGER card_payment_link_corrections_immutable_delete
BEFORE DELETE ON card_payment_link_corrections
BEGIN
    SELECT RAISE(ABORT, 'card payment link correction audit is immutable');
END;

DROP TRIGGER IF EXISTS card_payments_confirmed_link_immutable;

CREATE TRIGGER card_payments_confirmed_link_immutable
BEFORE UPDATE OF statement_id, household_id, bank_transaction_id, card_account_id,
                 payment_amount_jpy, payment_on, match_score_bps,
                 reconciliation_status, confirmed_at ON card_payments
WHEN OLD.confirmed_at IS NOT NULL AND (
    NEW.statement_id IS NOT OLD.statement_id
    OR NEW.household_id != OLD.household_id
    OR NEW.bank_transaction_id != OLD.bank_transaction_id
    OR NEW.card_account_id != OLD.card_account_id
    OR NEW.payment_amount_jpy != OLD.payment_amount_jpy
    OR NEW.payment_on != OLD.payment_on
    OR NEW.match_score_bps IS NOT OLD.match_score_bps
    OR NEW.reconciliation_status != OLD.reconciliation_status
    OR NEW.confirmed_at IS NOT OLD.confirmed_at
) AND NOT EXISTS (
    SELECT 1 FROM sync_apply_guard guard
    WHERE guard.household_id = OLD.household_id
) AND NOT (
    NEW.statement_id IS NULL
    AND NEW.household_id = OLD.household_id
    AND NEW.bank_transaction_id = OLD.bank_transaction_id
    AND NEW.card_account_id = OLD.card_account_id
    AND NEW.payment_amount_jpy = OLD.payment_amount_jpy
    AND NEW.payment_on = OLD.payment_on
    AND NEW.match_score_bps IS NULL
    AND NEW.reconciliation_status = 'UNMATCHED'
    AND NEW.confirmed_at IS NULL
    AND EXISTS (
        SELECT 1 FROM card_payment_link_corrections correction
        WHERE correction.household_id = OLD.household_id
          AND correction.statement_id = OLD.statement_id
          AND correction.payment_id = OLD.id
          AND correction.bank_transaction_id = OLD.bank_transaction_id
          AND correction.previous_confirmed_at = OLD.confirmed_at
          AND correction.correction_kind = 'UNLINK'
    )
)
BEGIN
    SELECT RAISE(ABORT, 'confirmed card payment link is immutable');
END;
