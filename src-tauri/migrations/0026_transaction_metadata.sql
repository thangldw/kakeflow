-- Transaction labels and tags were introduced with classification rules. These
-- indexes make them first-class filters without duplicating household scope in
-- the join tables (scope remains authoritative on transactions.household_id).
CREATE INDEX idx_transaction_labels_value_transaction
    ON transaction_labels (label, transaction_id);

CREATE INDEX idx_transaction_tags_value_transaction
    ON transaction_tags (tag, transaction_id);
