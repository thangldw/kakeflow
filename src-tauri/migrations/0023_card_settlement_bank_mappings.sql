CREATE TABLE card_settlement_bank_mappings (
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    card_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    bank_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (household_id, card_account_id),
    CHECK (card_account_id != bank_account_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_card_settlement_bank_mappings_bank
    ON card_settlement_bank_mappings (household_id, bank_account_id, card_account_id);

CREATE TRIGGER trg_card_settlement_mapping_insert_scope
BEFORE INSERT ON card_settlement_bank_mappings
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM accounts card, accounts bank
        WHERE card.id=NEW.card_account_id AND bank.id=NEW.bank_account_id
          AND card.household_id=NEW.household_id AND bank.household_id=NEW.household_id
          AND card.is_archived=0 AND card.account_kind='LIABILITY'
          AND card.account_subtype='CREDIT_CARD'
          AND bank.is_archived=0 AND bank.account_kind='ASSET'
          AND bank.account_subtype='BANK'
    ) THEN RAISE(ABORT, 'invalid card settlement mapping') END;
END;

CREATE TRIGGER trg_card_settlement_mapping_update_scope
BEFORE UPDATE ON card_settlement_bank_mappings
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM accounts card, accounts bank
        WHERE card.id=NEW.card_account_id AND bank.id=NEW.bank_account_id
          AND card.household_id=NEW.household_id AND bank.household_id=NEW.household_id
          AND card.is_archived=0 AND card.account_kind='LIABILITY'
          AND card.account_subtype='CREDIT_CARD'
          AND bank.is_archived=0 AND bank.account_kind='ASSET'
          AND bank.account_subtype='BANK'
    ) THEN RAISE(ABORT, 'invalid card settlement mapping') END;
END;

CREATE TRIGGER trg_card_settlement_mapping_card_account_update
BEFORE UPDATE OF household_id, account_kind, account_subtype, is_archived ON accounts
WHEN EXISTS (
    SELECT 1 FROM card_settlement_bank_mappings m WHERE m.card_account_id=OLD.id
)
AND (NEW.household_id != OLD.household_id OR NEW.account_kind != 'LIABILITY'
     OR NEW.account_subtype != 'CREDIT_CARD' OR NEW.is_archived != 0)
BEGIN
    SELECT RAISE(ABORT, 'mapped card account must remain active');
END;

CREATE TRIGGER trg_card_settlement_mapping_bank_account_update
BEFORE UPDATE OF household_id, account_kind, account_subtype, is_archived ON accounts
WHEN EXISTS (
    SELECT 1 FROM card_settlement_bank_mappings m WHERE m.bank_account_id=OLD.id
)
AND (NEW.household_id != OLD.household_id OR NEW.account_kind != 'ASSET'
     OR NEW.account_subtype != 'BANK' OR NEW.is_archived != 0)
BEGIN
    SELECT RAISE(ABORT, 'mapped bank account must remain active');
END;
