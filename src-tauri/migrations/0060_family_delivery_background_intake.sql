-- Separate, explicit consent for downloading, decrypting, and staging one
-- encrypted inbound family artifact after metadata discovery. Existing users
-- remain metadata-only because this opt-in defaults to off.

ALTER TABLE family_delivery_schedules ADD COLUMN intake_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (intake_enabled IN (0,1));
ALTER TABLE family_delivery_schedules ADD COLUMN last_intake_result TEXT NOT NULL DEFAULT 'NEVER'
    CHECK (last_intake_result IN (
        'NEVER','DISABLED','NO_AVAILABLE','REVIEW_PENDING','STAGED_FOR_REVIEW',
        'FAILED_RETRYABLE','REJECTED_INVALID','AUDIENCE_DENIED'
    ));
ALTER TABLE family_delivery_schedules ADD COLUMN last_staged_count INTEGER NOT NULL DEFAULT 0
    CHECK (last_staged_count BETWEEN 0 AND 1);
ALTER TABLE family_delivery_schedules ADD COLUMN last_intake_error_code TEXT
    CHECK (last_intake_error_code IS NULL OR
           length(trim(last_intake_error_code)) BETWEEN 1 AND 64);
