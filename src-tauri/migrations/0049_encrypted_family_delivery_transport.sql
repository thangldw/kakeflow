-- Persist the outer encrypted transport independently from the immutable
-- audience-partition artifact. Existing V1-V3 rows remain legacy plaintext
-- transports with every new column NULL.

ALTER TABLE family_delivery_deliveries ADD COLUMN envelope_schema TEXT
  CHECK (envelope_schema IS NULL OR length(trim(envelope_schema)) BETWEEN 1 AND 128);
ALTER TABLE family_delivery_deliveries ADD COLUMN transport_sha256 TEXT
  CHECK (transport_sha256 IS NULL OR (
    length(transport_sha256)=64 AND transport_sha256 NOT GLOB '*[^0-9a-f]*'
  ));
ALTER TABLE family_delivery_deliveries ADD COLUMN recipient_set_digest TEXT
  CHECK (recipient_set_digest IS NULL OR (
    length(recipient_set_digest)=64 AND recipient_set_digest NOT GLOB '*[^0-9a-f]*'
  ));
ALTER TABLE family_delivery_deliveries ADD COLUMN envelope_bytes BLOB
  CHECK (envelope_bytes IS NULL OR length(envelope_bytes) BETWEEN 1 AND 67108864);

CREATE TRIGGER trg_family_delivery_envelope_insert_consistent
BEFORE INSERT ON family_delivery_deliveries
WHEN (
  NEW.state='RELAY_ACCEPTED'
  AND ((NEW.envelope_schema IS NOT NULL) + (NEW.transport_sha256 IS NOT NULL)
       + (NEW.recipient_set_digest IS NOT NULL) + (NEW.envelope_bytes IS NOT NULL)) NOT IN (0,3)
) OR (
  NEW.state!='RELAY_ACCEPTED'
  AND ((NEW.envelope_schema IS NOT NULL) + (NEW.transport_sha256 IS NOT NULL)
       + (NEW.recipient_set_digest IS NOT NULL) + (NEW.envelope_bytes IS NOT NULL)) NOT IN (0,4)
)
BEGIN
  SELECT RAISE(ABORT,'inconsistent family delivery envelope cache');
END;

CREATE TRIGGER trg_family_delivery_envelope_update_consistent
BEFORE UPDATE OF state,envelope_schema,transport_sha256,recipient_set_digest,envelope_bytes
ON family_delivery_deliveries
WHEN (
  NEW.state='RELAY_ACCEPTED'
  AND ((NEW.envelope_schema IS NOT NULL) + (NEW.transport_sha256 IS NOT NULL)
       + (NEW.recipient_set_digest IS NOT NULL) + (NEW.envelope_bytes IS NOT NULL)) NOT IN (0,3)
) OR (
  NEW.state!='RELAY_ACCEPTED'
  AND ((NEW.envelope_schema IS NOT NULL) + (NEW.transport_sha256 IS NOT NULL)
       + (NEW.recipient_set_digest IS NOT NULL) + (NEW.envelope_bytes IS NOT NULL)) NOT IN (0,4)
)
BEGIN
  SELECT RAISE(ABORT,'inconsistent family delivery envelope cache');
END;

ALTER TABLE family_delivery_inbound ADD COLUMN envelope_schema TEXT
  CHECK (envelope_schema IS NULL OR length(trim(envelope_schema)) BETWEEN 1 AND 128);
ALTER TABLE family_delivery_inbound ADD COLUMN transport_sha256 TEXT
  CHECK (transport_sha256 IS NULL OR (
    length(transport_sha256)=64 AND transport_sha256 NOT GLOB '*[^0-9a-f]*'
  ));
ALTER TABLE family_delivery_inbound ADD COLUMN recipient_set_digest TEXT
  CHECK (recipient_set_digest IS NULL OR (
    length(recipient_set_digest)=64 AND recipient_set_digest NOT GLOB '*[^0-9a-f]*'
  ));

CREATE TRIGGER trg_family_delivery_inbound_transport_insert_consistent
BEFORE INSERT ON family_delivery_inbound
WHEN ((NEW.envelope_schema IS NOT NULL) + (NEW.transport_sha256 IS NOT NULL)
      + (NEW.recipient_set_digest IS NOT NULL)) NOT IN (0,3)
BEGIN
  SELECT RAISE(ABORT,'inconsistent family inbound transport metadata');
END;

CREATE TRIGGER trg_family_delivery_inbound_transport_update_consistent
BEFORE UPDATE OF envelope_schema,transport_sha256,recipient_set_digest
ON family_delivery_inbound
WHEN ((NEW.envelope_schema IS NOT NULL) + (NEW.transport_sha256 IS NOT NULL)
      + (NEW.recipient_set_digest IS NOT NULL)) NOT IN (0,3)
BEGIN
  SELECT RAISE(ABORT,'inconsistent family inbound transport metadata');
END;
