ALTER TABLE transactions
ADD COLUMN calculation_target INTEGER NOT NULL DEFAULT 1
CHECK (calculation_target IN (0, 1));
