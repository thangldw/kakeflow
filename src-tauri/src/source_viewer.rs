use crate::read_model::RepositoryError;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const MAX_ID_LEN: usize = 64;
const MAX_PAGE_SIZE: u32 = 200;
const MAX_TRANSACTION_RECORDS: usize = 1_024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceDocumentViewDto {
    pub id: String,
    pub household_id: String,
    pub import_run_id: String,
    pub source_type: String,
    pub original_filename: String,
    pub media_type: String,
    pub byte_size: u64,
    pub sha256: String,
    pub source_modified_at: Option<String>,
    pub imported_at: String,
    pub adapter_id: Option<String>,
    pub adapter_version: Option<String>,
    pub record_count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceRecordViewDto {
    pub id: String,
    pub source_document_id: String,
    pub row_number: u64,
    pub record_hash: String,
    /// Canonical JSON captured at import time. It may contain CSV/Excel fields,
    /// extracted text, receipt fields, and extraction confidence metadata.
    pub payload_json: String,
    pub created_at: String,
    pub evidence_role: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRecordPageRequest {
    pub household_id: String,
    pub source_document_id: String,
    pub page: u32,
    pub page_size: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceRecordPageDto {
    pub items: Vec<SourceRecordViewDto>,
    pub page: u32,
    pub page_size: u32,
    pub total_items: u64,
    pub total_pages: u64,
}

pub fn get_source_document(
    connection: &Connection,
    household_id: &str,
    document_id: &str,
) -> Result<SourceDocumentViewDto, RepositoryError> {
    validate_id(household_id)?;
    validate_id(document_id)?;
    connection
        .query_row(
            "SELECT sd.id, sd.household_id, sd.import_run_id, sd.source_type,
                    sd.original_filename, sd.media_type, sd.byte_size, sd.sha256,
                    sd.source_modified_at, sd.imported_at, ir.adapter_id,
                    ir.adapter_version,
                    (SELECT count(*) FROM source_records sr
                     WHERE sr.source_document_id = sd.id)
             FROM source_documents sd
             JOIN import_runs ir ON ir.id = sd.import_run_id
             WHERE sd.id = ?1 AND sd.household_id = ?2",
            params![document_id, household_id],
            |row| {
                let byte_size: i64 = row.get(6)?;
                let record_count: i64 = row.get(12)?;
                Ok(SourceDocumentViewDto {
                    id: row.get(0)?,
                    household_id: row.get(1)?,
                    import_run_id: row.get(2)?,
                    source_type: row.get(3)?,
                    original_filename: row.get(4)?,
                    media_type: row.get(5)?,
                    byte_size: u64::try_from(byte_size).unwrap_or(0),
                    sha256: row.get(7)?,
                    source_modified_at: row.get(8)?,
                    imported_at: row.get(9)?,
                    adapter_id: row.get(10)?,
                    adapter_version: row.get(11)?,
                    record_count: u64::try_from(record_count).unwrap_or(0),
                })
            },
        )
        .optional()
        .map_err(|_| RepositoryError::Unavailable)?
        .ok_or(RepositoryError::NotFound)
}

pub fn list_source_document_records(
    connection: &Connection,
    request: &SourceRecordPageRequest,
) -> Result<SourceRecordPageDto, RepositoryError> {
    validate_id(&request.household_id)?;
    validate_id(&request.source_document_id)?;
    if request.page == 0 || request.page_size == 0 || request.page_size > MAX_PAGE_SIZE {
        return Err(RepositoryError::InvalidInput(
            "Source record page is invalid",
        ));
    }
    // This tenant-scoped lookup also prevents document identifiers from being
    // used to infer another household's source metadata.
    get_source_document(
        connection,
        &request.household_id,
        &request.source_document_id,
    )?;

    let total: i64 = connection
        .query_row(
            "SELECT count(*) FROM source_records WHERE source_document_id = ?1",
            [&request.source_document_id],
            |row| row.get(0),
        )
        .map_err(|_| RepositoryError::Unavailable)?;
    let total_items = u64::try_from(total).map_err(|_| RepositoryError::Unavailable)?;
    let page_size = u64::from(request.page_size);
    let total_pages = total_items.saturating_add(page_size - 1) / page_size;
    let offset =
        u64::from(request.page - 1)
            .checked_mul(page_size)
            .ok_or(RepositoryError::InvalidInput(
                "Source record page is invalid",
            ))?;
    let offset = i64::try_from(offset)
        .map_err(|_| RepositoryError::InvalidInput("Source record page is invalid"))?;

    let mut statement = connection
        .prepare(
            "SELECT id, source_document_id, row_number, record_hash,
                    raw_payload_json, created_at
             FROM source_records
             WHERE source_document_id = ?1
             ORDER BY row_number, id
             LIMIT ?2 OFFSET ?3",
        )
        .map_err(|_| RepositoryError::Unavailable)?;
    let items = statement
        .query_map(
            params![
                request.source_document_id,
                i64::from(request.page_size),
                offset
            ],
            |row| {
                Ok(SourceRecordViewDto {
                    id: row.get(0)?,
                    source_document_id: row.get(1)?,
                    row_number: row.get(2)?,
                    record_hash: row.get(3)?,
                    payload_json: row.get(4)?,
                    created_at: row.get(5)?,
                    evidence_role: None,
                })
            },
        )
        .map_err(|_| RepositoryError::Unavailable)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| RepositoryError::Unavailable)?;

    Ok(SourceRecordPageDto {
        items,
        page: request.page,
        page_size: request.page_size,
        total_items,
        total_pages,
    })
}

pub fn list_transaction_source_records(
    connection: &Connection,
    household_id: &str,
    transaction_id: &str,
) -> Result<Vec<SourceRecordViewDto>, RepositoryError> {
    validate_id(household_id)?;
    validate_id(transaction_id)?;
    let exists = connection
        .query_row(
            "SELECT 1 FROM transactions WHERE id = ?1 AND household_id = ?2",
            params![transaction_id, household_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|_| RepositoryError::Unavailable)?
        .is_some();
    if !exists {
        return Err(RepositoryError::NotFound);
    }

    let mut statement = connection
        .prepare(
            "SELECT sr.id, sr.source_document_id, sr.row_number, sr.record_hash,
                    sr.raw_payload_json, sr.created_at,
                    COALESCE(cs.evidence_role, 'PRIMARY')
             FROM transaction_sources ts
             JOIN source_records sr ON sr.id = ts.source_record_id
             JOIN source_documents sd ON sd.id = sr.source_document_id
             LEFT JOIN candidate_sources cs
               ON cs.candidate_id = ts.candidate_id
              AND cs.source_record_id = ts.source_record_id
             WHERE ts.transaction_id = ?1 AND sd.household_id = ?2
             ORDER BY sd.imported_at, sd.id, sr.row_number, sr.id
             LIMIT ?3",
        )
        .map_err(|_| RepositoryError::Unavailable)?;
    let records = statement
        .query_map(
            params![
                transaction_id,
                household_id,
                i64::try_from(MAX_TRANSACTION_RECORDS + 1)
                    .expect("transaction source record limit fits SQLite")
            ],
            |row| {
                Ok(SourceRecordViewDto {
                    id: row.get(0)?,
                    source_document_id: row.get(1)?,
                    row_number: row.get(2)?,
                    record_hash: row.get(3)?,
                    payload_json: row.get(4)?,
                    created_at: row.get(5)?,
                    evidence_role: row.get(6)?,
                })
            },
        )
        .map_err(|_| RepositoryError::Unavailable)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| RepositoryError::Unavailable)?;
    if records.len() > MAX_TRANSACTION_RECORDS {
        return Err(RepositoryError::Unavailable);
    }
    Ok(records)
}

fn validate_id(value: &str) -> Result<(), RepositoryError> {
    if value.is_empty()
        || value.len() > MAX_ID_LEN
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(RepositoryError::InvalidInput("Identifier is invalid"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE households (id TEXT PRIMARY KEY);
                 CREATE TABLE import_runs (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL, adapter_id TEXT,
                   adapter_version TEXT);
                 CREATE TABLE source_documents (
                   id TEXT PRIMARY KEY, household_id TEXT NOT NULL, import_run_id TEXT NOT NULL,
                   source_type TEXT NOT NULL, original_filename TEXT NOT NULL,
                   media_type TEXT NOT NULL, byte_size INTEGER NOT NULL, sha256 TEXT NOT NULL,
                   storage_path TEXT NOT NULL, source_modified_at TEXT, imported_at TEXT NOT NULL);
                 CREATE TABLE source_records (
                   id TEXT PRIMARY KEY, source_document_id TEXT NOT NULL, row_number INTEGER NOT NULL,
                   record_hash TEXT NOT NULL, raw_payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
                 CREATE TABLE transactions (id TEXT PRIMARY KEY, household_id TEXT NOT NULL);
                 CREATE TABLE transaction_sources (
                   transaction_id TEXT NOT NULL, source_record_id TEXT NOT NULL,
                   candidate_id TEXT, PRIMARY KEY(transaction_id, source_record_id));
                 CREATE TABLE candidate_sources (
                   candidate_id TEXT NOT NULL, source_record_id TEXT NOT NULL,
                   evidence_role TEXT NOT NULL, PRIMARY KEY(candidate_id, source_record_id));
                 INSERT INTO households VALUES ('family'), ('other');
                 INSERT INTO import_runs VALUES ('run', 'family', 'bank-v1', '1');
                 INSERT INTO source_documents VALUES
                   ('document', 'family', 'run', 'MANUAL_UPLOAD', 'bank.csv', 'text/csv', 42,
                    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    'vault://hidden', NULL, '2026-07-13T00:00:00Z');
                 INSERT INTO source_records VALUES
                   ('record-1', 'document', 2,
                    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                    '{\"sourceRow\":2,\"rawFields\":[\"2026/07/12\",\"STORE\",\"1200\"]}',
                    '2026-07-13T00:00:00Z'),
                   ('record-2', 'document', 3,
                    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
                    '{\"extraction\":{\"text\":\"TOTAL 1200\",\"confidenceBps\":9000}}',
                    '2026-07-13T00:00:01Z');
                 INSERT INTO transactions VALUES ('transaction', 'family');
                 INSERT INTO transaction_sources VALUES ('transaction', 'record-1', 'candidate');
                 INSERT INTO candidate_sources VALUES ('candidate', 'record-1', 'SUPPORTING');",
            )
            .unwrap();
        connection
    }

    #[test]
    fn document_metadata_omits_internal_storage_path() {
        let document = get_source_document(&database(), "family", "document").unwrap();
        assert_eq!(document.original_filename, "bank.csv");
        assert_eq!(document.adapter_id.as_deref(), Some("bank-v1"));
        assert_eq!(document.record_count, 2);
    }

    #[test]
    fn returns_paginated_immutable_payloads_in_source_order() {
        let page = list_source_document_records(
            &database(),
            &SourceRecordPageRequest {
                household_id: "family".into(),
                source_document_id: "document".into(),
                page: 2,
                page_size: 1,
            },
        )
        .unwrap();
        assert_eq!(page.total_items, 2);
        assert_eq!(page.total_pages, 2);
        assert_eq!(page.items[0].row_number, 3);
        assert!(page.items[0].payload_json.contains("confidenceBps"));
        assert_eq!(page.items[0].evidence_role, None);
    }

    #[test]
    fn transaction_records_include_evidence_role() {
        let records =
            list_transaction_source_records(&database(), "family", "transaction").unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].row_number, 2);
        assert_eq!(records[0].evidence_role.as_deref(), Some("SUPPORTING"));
    }

    #[test]
    fn tenant_scope_and_page_bounds_are_enforced() {
        assert!(matches!(
            get_source_document(&database(), "other", "document"),
            Err(RepositoryError::NotFound)
        ));
        assert!(matches!(
            list_source_document_records(
                &database(),
                &SourceRecordPageRequest {
                    household_id: "family".into(),
                    source_document_id: "document".into(),
                    page: 1,
                    page_size: 201,
                }
            ),
            Err(RepositoryError::InvalidInput(_))
        ));
    }
}
