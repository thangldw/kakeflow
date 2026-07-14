//! Durable desktop inbox for immutable mobile receipt captures.

use base64::Engine as _;
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

use crate::document_extract::ExtractedDocument;
use crate::document_vault::DocumentVault;
use crate::import_workflow::{self, StartImport};
use crate::mobile_capture_capsule::{self, ParsedMobileCapture};

const MAX_INBOX_ITEMS: usize = 200;
type ExistingCaptureIdentity = (
    String,
    String,
    String,
    String,
    String,
    String,
    Option<String>,
);

#[derive(Debug, Error)]
pub enum MobileCaptureError {
    #[error("mobile capture input is invalid")]
    InvalidInput,
    #[error("mobile capture capsule is invalid")]
    InvalidCapsule,
    #[error("mobile capture immutable identity conflicts")]
    Conflict,
    #[error("mobile capture was not found")]
    NotFound,
    #[error("mobile capture state does not permit this operation")]
    InvalidState,
    #[error("mobile capture database operation failed")]
    Database,
    #[error("mobile capture vault operation failed")]
    Vault,
}
pub type Result<T> = std::result::Result<T, MobileCaptureError>;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IngestMobileCaptureInput {
    pub household_id: String,
    pub artifact_id: String,
    pub claimed_digest: String,
    pub origin_device_id: String,
    pub sender_membership_id: String,
    pub audience_visibility: String,
    pub audience_member_id: Option<String>,
    pub capsule_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MobileCaptureInboxItemDto {
    pub artifact_id: String,
    pub capture_id: String,
    pub original_filename: String,
    pub media_type: String,
    pub byte_size: u64,
    pub source_sha256: String,
    pub sender_membership_id: String,
    pub captured_at: Option<String>,
    pub received_at: String,
    pub audience_visibility: String,
    pub audience_member_id: Option<String>,
    pub state: String,
    pub latest_extraction_id: Option<String>,
    pub local_run_id: Option<String>,
    pub local_document_id: Option<String>,
    pub last_error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MobileCaptureStatusDto {
    pub endpoint: Option<String>,
    pub local_device_id: String,
    pub capture_inbound_cursor: u64,
    pub items: Vec<MobileCaptureInboxItemDto>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MobileCaptureImagePreviewDto {
    pub filename: String,
    pub media_type: String,
    pub byte_size: u64,
    pub data_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileCaptureOcrDto {
    pub item: MobileCaptureInboxItemDto,
    pub extraction_id: String,
    pub document: ExtractedDocument,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromoteMobileCaptureInput {
    pub household_id: String,
    pub artifact_id: String,
    pub extraction_id: String,
    pub import: StartImport,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MobileCapturePromotionDto {
    pub item: MobileCaptureInboxItemDto,
    pub run_id: String,
    pub document_id: String,
    pub reused_existing: bool,
}

pub fn ingest(
    connection: &Connection,
    vault: &DocumentVault,
    input: &IngestMobileCaptureInput,
) -> Result<MobileCaptureInboxItemDto> {
    validate_ingest(input)?;
    let parsed = mobile_capture_capsule::parse(&input.capsule_bytes)
        .map_err(|_| MobileCaptureError::InvalidCapsule)?;
    if parsed.capsule_sha256 != input.claimed_digest
        || parsed.manifest.household_id != input.household_id
        || parsed.manifest.origin_device_id != input.origin_device_id
        || parsed.manifest.audience.visibility != input.audience_visibility
        || parsed.manifest.audience.member_id != input.audience_member_id
    {
        return Err(MobileCaptureError::InvalidCapsule);
    }
    if let Some(item) = existing_exact(connection, input, &parsed)? {
        return Ok(item);
    }
    let stored = vault
        .put(&parsed.image_bytes, &parsed.manifest.media_type)
        .map_err(|_| MobileCaptureError::Vault)?;
    if stored.sha256 != parsed.manifest.image_sha256 {
        return Err(MobileCaptureError::InvalidCapsule);
    }
    let result = insert_receipt(connection, input, &parsed);
    if result.is_err() && !stored.deduplicated {
        let _ = vault.delete(&stored.sha256);
    }
    result
}

fn insert_receipt(
    connection: &Connection,
    input: &IngestMobileCaptureInput,
    parsed: &ParsedMobileCapture,
) -> Result<MobileCaptureInboxItemDto> {
    let tx = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)
        .map_err(|_| MobileCaptureError::Database)?;
    let household: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM households WHERE id=?1)",
            [&input.household_id],
            |r| r.get(0),
        )
        .map_err(|_| MobileCaptureError::Database)?;
    if !household {
        return Err(MobileCaptureError::InvalidInput);
    }
    tx.execute("INSERT INTO mobile_capture_receipts(household_id,artifact_id,sender_membership_id,origin_device_id,capture_id,capsule_sha256,source_sha256,source_media_type,source_byte_size,original_filename,captured_at,audience_visibility,audience_member_id,storage_path) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",params![input.household_id,input.artifact_id,input.sender_membership_id,input.origin_device_id,parsed.manifest.capture_id,parsed.capsule_sha256,parsed.manifest.image_sha256,parsed.manifest.media_type,parsed.manifest.image_byte_size,parsed.manifest.original_filename,parsed.manifest.captured_at,input.audience_visibility,input.audience_member_id,format!("vault://{}",parsed.manifest.image_sha256)]).map_err(|e|if e.sqlite_error_code()==Some(rusqlite::ErrorCode::ConstraintViolation){MobileCaptureError::Conflict}else{MobileCaptureError::Database})?;
    tx.execute(
        "INSERT INTO mobile_capture_inbox(household_id,artifact_id,state) VALUES(?1,?2,'RECEIVED')",
        params![input.household_id, input.artifact_id],
    )
    .map_err(|_| MobileCaptureError::Database)?;
    tx.commit().map_err(|_| MobileCaptureError::Database)?;
    get(connection, &input.household_id, &input.artifact_id)
}

fn existing_exact(
    connection: &Connection,
    input: &IngestMobileCaptureInput,
    parsed: &ParsedMobileCapture,
) -> Result<Option<MobileCaptureInboxItemDto>> {
    let existing: Option<ExistingCaptureIdentity> = connection.query_row("SELECT artifact_id,capture_id,capsule_sha256,sender_membership_id,origin_device_id,audience_visibility,audience_member_id FROM mobile_capture_receipts WHERE (household_id=?1 AND artifact_id=?2) OR (household_id=?1 AND sender_membership_id=?3 AND capture_id=?4)",params![input.household_id,input.artifact_id,input.sender_membership_id,parsed.manifest.capture_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))).optional().map_err(|_|MobileCaptureError::Database)?;
    if let Some(row) = existing {
        if row
            == (
                input.artifact_id.clone(),
                parsed.manifest.capture_id.clone(),
                parsed.capsule_sha256.clone(),
                input.sender_membership_id.clone(),
                input.origin_device_id.clone(),
                input.audience_visibility.clone(),
                input.audience_member_id.clone(),
            )
        {
            return get(connection, &input.household_id, &input.artifact_id).map(Some);
        }
        return Err(MobileCaptureError::Conflict);
    }
    Ok(None)
}

pub fn list(connection: &Connection, household_id: &str) -> Result<Vec<MobileCaptureInboxItemDto>> {
    valid_id(household_id)?;
    let mut statement = connection
        .prepare(&format!(
            "{} ORDER BY receipt.received_at DESC,receipt.artifact_id LIMIT {}",
            SELECT_ITEM,
            MAX_INBOX_ITEMS + 1
        ))
        .map_err(|_| MobileCaptureError::Database)?;
    let rows = statement
        .query_map([household_id], row_item)
        .map_err(|_| MobileCaptureError::Database)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|_| MobileCaptureError::Database)?;
    if rows.len() > MAX_INBOX_ITEMS {
        return Err(MobileCaptureError::InvalidState);
    }
    Ok(rows)
}

pub fn get(
    connection: &Connection,
    household_id: &str,
    artifact_id: &str,
) -> Result<MobileCaptureInboxItemDto> {
    connection
        .query_row(
            &format!(
                "{} WHERE receipt.household_id=?1 AND receipt.artifact_id=?2",
                SELECT_ITEM
            ),
            params![household_id, artifact_id],
            row_item,
        )
        .optional()
        .map_err(|_| MobileCaptureError::Database)?
        .ok_or(MobileCaptureError::NotFound)
}

const SELECT_ITEM:&str="SELECT receipt.artifact_id,receipt.capture_id,receipt.original_filename,receipt.source_media_type,receipt.source_byte_size,receipt.source_sha256,receipt.sender_membership_id,receipt.captured_at,receipt.received_at,receipt.audience_visibility,receipt.audience_member_id,inbox.state,inbox.latest_extraction_id,inbox.local_run_id,inbox.local_document_id,inbox.last_error_code FROM mobile_capture_receipts receipt JOIN mobile_capture_inbox inbox ON inbox.household_id=receipt.household_id AND inbox.artifact_id=receipt.artifact_id";
fn row_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<MobileCaptureInboxItemDto> {
    Ok(MobileCaptureInboxItemDto {
        artifact_id: row.get(0)?,
        capture_id: row.get(1)?,
        original_filename: row.get(2)?,
        media_type: row.get(3)?,
        byte_size: row.get(4)?,
        source_sha256: row.get(5)?,
        sender_membership_id: row.get(6)?,
        captured_at: row.get(7)?,
        received_at: row.get(8)?,
        audience_visibility: row.get(9)?,
        audience_member_id: row.get(10)?,
        state: row.get(11)?,
        latest_extraction_id: row.get(12)?,
        local_run_id: row.get(13)?,
        local_document_id: row.get(14)?,
        last_error_code: row.get(15)?,
    })
}

pub fn status(connection: &Connection, household_id: &str) -> Result<MobileCaptureStatusDto> {
    valid_id(household_id)?;
    let local = crate::sync_foundation::get_local_status(connection, household_id)
        .map_err(|_| MobileCaptureError::InvalidInput)?;
    let configured:Option<(String,i64,String)>=connection.query_row("SELECT endpoint,capture_inbound_cursor,state FROM family_delivery_connections WHERE household_id=?1",[household_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|_|MobileCaptureError::Database)?;
    let (endpoint, cursor) = match configured {
        Some((endpoint, cursor, state)) if state != "DISCONNECTED" => {
            (Some(endpoint), cursor.max(0) as u64)
        }
        _ => (None, 0),
    };
    Ok(MobileCaptureStatusDto {
        endpoint,
        local_device_id: local.device.id,
        capture_inbound_cursor: cursor,
        items: list(connection, household_id)?,
    })
}

pub fn update_cursor(
    connection: &Connection,
    household_id: &str,
    next_cursor: u64,
) -> Result<MobileCaptureStatusDto> {
    let next = i64::try_from(next_cursor).map_err(|_| MobileCaptureError::InvalidInput)?;
    let changed=connection.execute("UPDATE family_delivery_connections SET capture_inbound_cursor=?2,last_checked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?1 AND state!='DISCONNECTED' AND capture_inbound_cursor<=?2",params![household_id,next]).map_err(|_|MobileCaptureError::Database)?;
    if changed != 1 {
        return Err(MobileCaptureError::InvalidState);
    }
    status(connection, household_id)
}

pub fn image(
    connection: &Connection,
    vault: &DocumentVault,
    household_id: &str,
    artifact_id: &str,
) -> Result<(Vec<u8>, String)> {
    let item = get(connection, household_id, artifact_id)?;
    if matches!(
        item.state.as_str(),
        "PROMOTED" | "DUPLICATE" | "REJECTED_INVALID"
    ) {
        return Err(MobileCaptureError::InvalidState);
    }
    let stored = vault
        .read(&item.source_sha256)
        .map_err(|_| MobileCaptureError::Vault)?;
    if stored.mime_type != item.media_type {
        return Err(MobileCaptureError::Vault);
    }
    Ok((stored.bytes, stored.mime_type))
}

pub fn image_preview(
    connection: &Connection,
    vault: &DocumentVault,
    household_id: &str,
    artifact_id: &str,
) -> Result<MobileCaptureImagePreviewDto> {
    let item = get(connection, household_id, artifact_id)?;
    let stored = vault
        .read(&item.source_sha256)
        .map_err(|_| MobileCaptureError::Vault)?;
    if stored.mime_type != item.media_type || stored.bytes.len() as u64 != item.byte_size {
        return Err(MobileCaptureError::Vault);
    }
    Ok(MobileCaptureImagePreviewDto {
        filename: item.original_filename,
        media_type: item.media_type.clone(),
        byte_size: item.byte_size,
        data_url: format!(
            "data:{};base64,{}",
            item.media_type,
            base64::engine::general_purpose::STANDARD.encode(stored.bytes)
        ),
    })
}

pub fn latest_extraction(
    connection: &Connection,
    household_id: &str,
    artifact_id: &str,
) -> Result<Option<(String, ExtractedDocument)>> {
    let row:Option<(String,String)>=connection.query_row("SELECT id,extracted_payload_json FROM mobile_capture_extractions WHERE household_id=?1 AND artifact_id=?2 ORDER BY attempt_number DESC LIMIT 1",params![household_id,artifact_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|_|MobileCaptureError::Database)?;
    row.map(|(id, json)| decode_document(&json).map(|document| (id, document)))
        .transpose()
}

fn decode_document(json: &str) -> Result<ExtractedDocument> {
    let value: Value = serde_json::from_str(json).map_err(|_| MobileCaptureError::InvalidInput)?;
    let method = value
        .get("method")
        .and_then(Value::as_str)
        .ok_or(MobileCaptureError::InvalidInput)?;
    if method != "OCR" {
        return Err(MobileCaptureError::InvalidInput);
    }
    let text = value
        .get("text")
        .and_then(Value::as_str)
        .ok_or(MobileCaptureError::InvalidInput)?
        .to_owned();
    let confidence_bps = u16::try_from(
        value
            .get("confidenceBps")
            .and_then(Value::as_u64)
            .ok_or(MobileCaptureError::InvalidInput)?,
    )
    .map_err(|_| MobileCaptureError::InvalidInput)?;
    let mut issues = Vec::new();
    for issue in value
        .get("issues")
        .and_then(Value::as_array)
        .ok_or(MobileCaptureError::InvalidInput)?
    {
        match issue.as_str() {
            Some("LOW_OCR_CONFIDENCE") => issues.push("LOW_OCR_CONFIDENCE"),
            _ => return Err(MobileCaptureError::InvalidInput),
        }
    }
    let regions = serde_json::from_value(
        value
            .get("regions")
            .cloned()
            .ok_or(MobileCaptureError::InvalidInput)?,
    )
    .map_err(|_| MobileCaptureError::InvalidInput)?;
    Ok(ExtractedDocument {
        method: "OCR",
        text,
        confidence_bps,
        issues,
        regions,
    })
}

pub fn record_extraction(
    connection: &Connection,
    household_id: &str,
    artifact_id: &str,
    document: &ExtractedDocument,
) -> Result<(String, MobileCaptureInboxItemDto)> {
    let item = get(connection, household_id, artifact_id)?;
    if matches!(
        item.state.as_str(),
        "PROMOTED" | "DUPLICATE" | "REJECTED_INVALID"
    ) {
        return Err(MobileCaptureError::InvalidState);
    }
    let payload = serde_json::to_string(document).map_err(|_| MobileCaptureError::InvalidInput)?;
    let digest = mobile_capture_capsule::digest(payload.as_bytes());
    let tx = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)
        .map_err(|_| MobileCaptureError::Database)?;
    let existing:Option<String>=tx.query_row("SELECT id FROM mobile_capture_extractions WHERE household_id=?1 AND artifact_id=?2 AND payload_sha256=?3",params![household_id,artifact_id,digest],|r|r.get(0)).optional().map_err(|_|MobileCaptureError::Database)?;
    let id = if let Some(id) = existing {
        id
    } else {
        let attempt:i64=tx.query_row("SELECT coalesce(max(attempt_number),0)+1 FROM mobile_capture_extractions WHERE household_id=?1 AND artifact_id=?2",params![household_id,artifact_id],|r|r.get(0)).map_err(|_|MobileCaptureError::Database)?;
        let id = format!(
            "capture-extraction-{}",
            &mobile_capture_capsule::digest(
                format!("{household_id}\0{artifact_id}\0{attempt}\0{digest}").as_bytes()
            )[..32]
        );
        tx.execute("INSERT INTO mobile_capture_extractions(id,household_id,artifact_id,attempt_number,engine_id,engine_version,extracted_payload_json,payload_sha256) VALUES(?1,?2,?3,?4,'TESSERACT_OFFLINE','1',?5,?6)",params![id,household_id,artifact_id,attempt,payload,digest]).map_err(|_|MobileCaptureError::Database)?;
        id
    };
    tx.execute("UPDATE mobile_capture_inbox SET state='OCR_READY',latest_extraction_id=?3,last_error_code=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?1 AND artifact_id=?2",params![household_id,artifact_id,id]).map_err(|_|MobileCaptureError::Database)?;
    tx.commit().map_err(|_| MobileCaptureError::Database)?;
    Ok((id, get(connection, household_id, artifact_id)?))
}

pub fn mark_ocr_review_required(
    connection: &Connection,
    household_id: &str,
    artifact_id: &str,
) -> Result<MobileCaptureInboxItemDto> {
    let changed=connection.execute("UPDATE mobile_capture_inbox SET state='OCR_REVIEW_REQUIRED',last_error_code=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?1 AND artifact_id=?2 AND state IN ('RECEIVED','OCR_READY','OCR_REVIEW_REQUIRED','FAILED_RETRYABLE')",params![household_id,artifact_id]).map_err(|_|MobileCaptureError::Database)?;
    if changed != 1 {
        return Err(MobileCaptureError::InvalidState);
    }
    get(connection, household_id, artifact_id)
}

pub fn promote(
    connection: &Connection,
    input: &PromoteMobileCaptureInput,
) -> Result<MobileCapturePromotionDto> {
    validate_promotion(connection, input)?;
    let item = get(connection, &input.household_id, &input.artifact_id)?;
    let tx = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)
        .map_err(|_| MobileCaptureError::Database)?;
    if let Some((run,document))=tx.query_row("SELECT r.id,d.id FROM source_documents d JOIN import_runs r ON r.id=d.import_run_id WHERE d.household_id=?1 AND d.sha256=?2",params![input.household_id,item.source_sha256],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).optional().map_err(|_|MobileCaptureError::Database)? {
      tx.execute("UPDATE mobile_capture_inbox SET state='DUPLICATE',local_run_id=?3,local_document_id=?4,last_error_code=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?1 AND artifact_id=?2",params![input.household_id,input.artifact_id,run,document]).map_err(|_|MobileCaptureError::Database)?;
      tx.commit().map_err(|_|MobileCaptureError::Database)?; let updated=get(connection,&input.household_id,&input.artifact_id)?;
      return Ok(MobileCapturePromotionDto{item:updated,run_id:run,document_id:document,reused_existing:true});
    }
    let summary = import_workflow::start_import_in_transaction(
        &tx,
        &input.import,
        &format!("vault://{}", item.source_sha256),
    )
    .map_err(|_| MobileCaptureError::Conflict)?;
    if summary.reused_existing {
        return Err(MobileCaptureError::Conflict);
    }
    tx.execute("UPDATE mobile_capture_inbox SET state='PROMOTED',local_run_id=?3,local_document_id=?4,last_error_code=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE household_id=?1 AND artifact_id=?2 AND state IN ('OCR_READY','OCR_REVIEW_REQUIRED')",params![input.household_id,input.artifact_id,summary.run_id,summary.document_id]).map_err(|_|MobileCaptureError::Database)?;
    tx.commit().map_err(|_| MobileCaptureError::Database)?;
    let updated = get(connection, &input.household_id, &input.artifact_id)?;
    Ok(MobileCapturePromotionDto {
        item: updated,
        run_id: summary.run_id,
        document_id: summary.document_id,
        reused_existing: false,
    })
}

fn validate_promotion(connection: &Connection, input: &PromoteMobileCaptureInput) -> Result<()> {
    let item = get(connection, &input.household_id, &input.artifact_id)?;
    if !matches!(item.state.as_str(), "OCR_READY" | "OCR_REVIEW_REQUIRED")
        || item.latest_extraction_id.as_deref() != Some(&input.extraction_id)
    {
        return Err(MobileCaptureError::InvalidState);
    }
    let extracted:String=connection.query_row("SELECT extracted_payload_json FROM mobile_capture_extractions WHERE id=?1 AND household_id=?2 AND artifact_id=?3",params![input.extraction_id,input.household_id,input.artifact_id],|r|r.get(0)).optional().map_err(|_|MobileCaptureError::Database)?.ok_or(MobileCaptureError::InvalidInput)?;
    let import = &input.import;
    if import.household_id != input.household_id
        || import.source_type != "CAMERA_SCAN"
        || import.original_filename != item.original_filename
        || import.media_type != item.media_type
        || import.byte_size != item.byte_size as i64
        || import.sha256 != item.source_sha256
        || import.adapter_id.as_deref() != Some("receipt-text-v2")
        || import.records.len() != 1
        || import.candidates.len() != 1
        || !import.card_statements.is_empty()
        || import.audience_visibility.as_sql() != item.audience_visibility
        || import.audience_member_id != item.audience_member_id
    {
        return Err(MobileCaptureError::InvalidInput);
    }
    let payload: Value = serde_json::from_str(&import.records[0].payload_json)
        .map_err(|_| MobileCaptureError::InvalidInput)?;
    let expected: Value =
        serde_json::from_str(&extracted).map_err(|_| MobileCaptureError::InvalidInput)?;
    if payload.get("extraction") != Some(&expected)
        || import.records[0].row_number != 1
        || import.records[0].record_hash
            != mobile_capture_capsule::digest(import.records[0].payload_json.as_bytes())
        || import.candidates[0].evidence.len() != 1
        || import.candidates[0].evidence[0].source_record_id != import.records[0].id
        || import.candidates[0].evidence[0].role != "PRIMARY"
        || import.candidates[0].audience_visibility.as_sql() != item.audience_visibility
        || import.candidates[0].audience_member_id != item.audience_member_id
    {
        return Err(MobileCaptureError::InvalidInput);
    }
    Ok(())
}

fn validate_ingest(input: &IngestMobileCaptureInput) -> Result<()> {
    for id in [
        &input.household_id,
        &input.artifact_id,
        &input.origin_device_id,
        &input.sender_membership_id,
    ] {
        valid_id(id)?;
    }
    if input.claimed_digest.len() != 64
        || !input
            .claimed_digest
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        || !matches!(input.audience_visibility.as_str(), "SHARED" | "PERSONAL")
        || (input.audience_visibility == "SHARED") != input.audience_member_id.is_none()
    {
        return Err(MobileCaptureError::InvalidInput);
    }
    if let Some(id) = &input.audience_member_id {
        valid_id(id)?
    }
    Ok(())
}
fn valid_id(value: &str) -> Result<()> {
    if value.trim().is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
        Err(MobileCaptureError::InvalidInput)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mobile_capture_capsule::{
        build, digest, CaptureAudienceManifest, MobileCaptureManifest,
    };
    use crate::persistence::AppState;
    use tempfile::tempdir;
    fn capsule() -> Vec<u8> {
        let mut image = vec![
            137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, b'I', b'H', b'D', b'R',
        ];
        image.extend_from_slice(&1u32.to_be_bytes());
        image.extend_from_slice(&1u32.to_be_bytes());
        image.extend_from_slice(&[8, 2, 0, 0, 0]);
        let m = MobileCaptureManifest {
            format: "KAKEFLOW_MOBILE_RECEIPT_CAPTURE".into(),
            schema_version: 1,
            capture_id: "capture-1".into(),
            household_id: "family".into(),
            origin_device_id: "mobile-1".into(),
            captured_at: "2026-07-14T00:00:00Z".into(),
            original_filename: "receipt.png".into(),
            media_type: "image/png".into(),
            image_byte_size: image.len() as u64,
            image_sha256: digest(&image),
            audience: CaptureAudienceManifest {
                visibility: "SHARED".into(),
                member_id: None,
            },
        };
        build(&m, &image).unwrap()
    }
    fn setup() -> (AppState, DocumentVault, tempfile::TempDir) {
        let state = AppState::in_memory(&[4; 32]).unwrap();
        state
            .with_connection(|c| {
                c.execute(
                    "INSERT INTO households(id,name,base_currency) VALUES('family','Family','JPY')",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
        let temp = tempdir().unwrap();
        let vault = DocumentVault::new(temp.path(), &[9; 32]).unwrap();
        (state, vault, temp)
    }
    fn input(bytes: Vec<u8>) -> IngestMobileCaptureInput {
        IngestMobileCaptureInput {
            household_id: "family".into(),
            artifact_id: "artifact-1".into(),
            claimed_digest: digest(&bytes),
            origin_device_id: "mobile-1".into(),
            sender_membership_id: "membership-1".into(),
            audience_visibility: "SHARED".into(),
            audience_member_id: None,
            capsule_bytes: bytes,
        }
    }
    #[test]
    fn ingestion_is_immutable_idempotent_and_does_not_create_import() {
        let (state, vault, _) = setup();
        let input = input(capsule());
        let first = state
            .with_connection(|c| Ok(ingest(c, &vault, &input)))
            .unwrap()
            .unwrap();
        let second = state
            .with_connection(|c| Ok(ingest(c, &vault, &input)))
            .unwrap()
            .unwrap();
        assert_eq!(first, second);
        state
            .with_connection(|c| {
                assert_eq!(
                    c.query_row("SELECT count(*) FROM import_runs", [], |r| r
                        .get::<_, u64>(0))?,
                    0
                );
                Ok(())
            })
            .unwrap();
    }
    #[test]
    fn same_identity_with_changed_capsule_conflicts() {
        let (state, vault, _) = setup();
        let first = input(capsule());
        state
            .with_connection(|c| Ok(ingest(c, &vault, &first)))
            .unwrap()
            .unwrap();
        let mut bytes = capsule();
        bytes[20] ^= 1;
        let changed = input(bytes);
        assert!(matches!(
            state
                .with_connection(|c| Ok(ingest(c, &vault, &changed)))
                .unwrap(),
            Err(MobileCaptureError::InvalidCapsule | MobileCaptureError::Conflict)
        ));
    }
    #[test]
    fn promotion_is_atomic_review_only_and_never_posts() {
        use crate::import_workflow::{CandidateEvidence, ImportSourceRecord, NormalizedCandidate};
        use crate::record_scope::{AttributionKind, AudienceVisibility};
        let (state, vault, _) = setup();
        let source = input(capsule());
        let item = state
            .with_connection(|c| Ok(ingest(c, &vault, &source)))
            .unwrap()
            .unwrap();
        state.with_connection(|c|{c.execute("INSERT INTO accounts(id,household_id,name,account_kind,account_subtype) VALUES('cash','family','Cash','ASSET','CASH')",[])?;Ok(())}).unwrap();
        let document = ExtractedDocument {
            method: "OCR",
            text: "STORE\n2026/07/14\nTOTAL 1000".into(),
            confidence_bps: 9000,
            issues: vec![],
            regions: vec![],
        };
        let extraction_id = state
            .with_connection(|c| Ok(record_extraction(c, "family", "artifact-1", &document)))
            .unwrap()
            .unwrap()
            .0;
        let extraction = serde_json::to_value(&document).unwrap();
        let payload =
            serde_json::json!({"extraction":extraction,"receipt":{"total":1000}}).to_string();
        let import = StartImport {
            run_id: "run-mobile".into(),
            document_id: "document-mobile".into(),
            household_id: "family".into(),
            source_type: "CAMERA_SCAN".into(),
            original_filename: item.original_filename,
            media_type: item.media_type,
            byte_size: item.byte_size as i64,
            sha256: item.source_sha256,
            source_modified_at: None,
            adapter_id: Some("receipt-text-v2".into()),
            adapter_version: Some("2".into()),
            audience_visibility: AudienceVisibility::Shared,
            audience_member_id: None,
            records: vec![ImportSourceRecord {
                id: "record-mobile".into(),
                row_number: 1,
                record_hash: digest(payload.as_bytes()),
                payload_json: payload,
            }],
            candidates: vec![NormalizedCandidate {
                id: "candidate-mobile".into(),
                account_id: Some("cash".into()),
                occurred_on: "2026-07-14".into(),
                posted_on: None,
                amount_jpy: 1000,
                direction: "OUT".into(),
                description_raw: Some("Receipt document".into()),
                merchant_raw: Some("STORE".into()),
                external_transaction_id: None,
                external_source: None,
                external_fact_hash: None,
                calculation_target: true,
                suggested_transaction_type: None,
                institution_raw: None,
                category_major_raw: None,
                category_minor_raw: None,
                memo_raw: None,
                extraction_confidence_bps: Some(9000),
                normalization_confidence_bps: Some(9000),
                review_status: "PENDING".into(),
                attribution_kind: AttributionKind::Household,
                attributed_member_id: None,
                audience_visibility: AudienceVisibility::Shared,
                audience_member_id: None,
                evidence: vec![CandidateEvidence {
                    source_record_id: "record-mobile".into(),
                    role: "PRIMARY".into(),
                }],
            }],
            card_statements: vec![],
        };
        let promoted = state
            .with_connection(|c| {
                Ok(promote(
                    c,
                    &PromoteMobileCaptureInput {
                        household_id: "family".into(),
                        artifact_id: "artifact-1".into(),
                        extraction_id,
                        import,
                    },
                ))
            })
            .unwrap()
            .unwrap();
        assert_eq!(promoted.item.state, "PROMOTED");
        assert!(!promoted.reused_existing);
        state
            .with_connection(|c| {
                assert_eq!(
                    c.query_row(
                        "SELECT status FROM import_runs WHERE id='run-mobile'",
                        [],
                        |r| r.get::<_, String>(0)
                    )?,
                    "REVIEW_REQUIRED"
                );
                assert_eq!(
                    c.query_row("SELECT count(*) FROM transactions", [], |r| r
                        .get::<_, u64>(0))?,
                    0
                );
                Ok(())
            })
            .unwrap();
    }
}
