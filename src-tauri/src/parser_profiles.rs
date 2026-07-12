use rusqlite::{params, Connection, ErrorCode, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fmt;

const MAX_ID_LEN: usize = 64;
const MAX_NAME_CHARS: usize = 120;
const MAX_COLUMN_CHARS: usize = 120;
const MAX_PROFILES_PER_HOUSEHOLD: u32 = 1_000;

#[derive(Debug)]
pub enum ParserProfileError {
    InvalidInput(&'static str),
    NotFound,
    Conflict,
    LimitExceeded,
    Unavailable,
}

impl ParserProfileError {
    pub fn public_message(&self) -> &'static str {
        match self {
            Self::InvalidInput(message) => message,
            Self::NotFound => "The parser profile was not found",
            Self::Conflict => "The parser profile changed; reload it and try again",
            Self::LimitExceeded => "The household has reached the parser profile limit",
            Self::Unavailable => "Parser profiles are temporarily unavailable",
        }
    }
}

impl fmt::Display for ParserProfileError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.public_message())
    }
}

fn db_error(error: rusqlite::Error) -> ParserProfileError {
    match &error {
        rusqlite::Error::SqliteFailure(details, _)
            if details.code == ErrorCode::ConstraintViolation =>
        {
            ParserProfileError::Conflict
        }
        _ => ParserProfileError::Unavailable,
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DelimiterMode {
    Auto,
    Comma,
    Tab,
    Semicolon,
}

impl DelimiterMode {
    fn as_sql(self) -> &'static str {
        match self {
            Self::Auto => "AUTO",
            Self::Comma => "COMMA",
            Self::Tab => "TAB",
            Self::Semicolon => "SEMICOLON",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EncodingMode {
    Auto,
    Utf8,
    Cp932,
}

impl EncodingMode {
    fn as_sql(self) -> &'static str {
        match self {
            Self::Auto => "AUTO",
            Self::Utf8 => "UTF8",
            Self::Cp932 => "CP932",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DateFormat {
    Auto,
    YyyyMmDd,
    Yyyymmdd,
    MmDdYyyy,
    DdMmYyyy,
}

impl DateFormat {
    fn as_sql(self) -> &'static str {
        match self {
            Self::Auto => "AUTO",
            Self::YyyyMmDd => "YYYY_MM_DD",
            Self::Yyyymmdd => "YYYYMMDD",
            Self::MmDdYyyy => "MM_DD_YYYY",
            Self::DdMmYyyy => "DD_MM_YYYY",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AmountMode {
    Signed,
    DebitCredit,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SignedPositiveDirection {
    In,
    Out,
}

impl SignedPositiveDirection {
    fn as_sql(self) -> &'static str {
        match self {
            Self::In => "IN",
            Self::Out => "OUT",
        }
    }
}

impl AmountMode {
    fn as_sql(self) -> &'static str {
        match self {
            Self::Signed => "SIGNED",
            Self::DebitCredit => "DEBIT_CREDIT",
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DelimitedParserProfileDto {
    pub id: String,
    pub household_id: String,
    pub name: String,
    pub delimiter: String,
    pub encoding: String,
    pub header_row: u32,
    pub date_column: String,
    pub date_format: String,
    pub description_column: Option<String>,
    pub payee_column: Option<String>,
    pub amount_mode: String,
    pub signed_positive_direction: Option<String>,
    pub signed_amount_column: Option<String>,
    pub debit_column: Option<String>,
    pub credit_column: Option<String>,
    pub external_id_column: Option<String>,
    pub account_hint_column: Option<String>,
    pub is_enabled: bool,
    pub priority: u32,
    pub version: u64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDelimitedParserProfileInput {
    pub id: String,
    pub household_id: String,
    pub name: String,
    pub delimiter: DelimiterMode,
    pub encoding: EncodingMode,
    pub header_row: u32,
    pub date_column: String,
    pub date_format: DateFormat,
    pub description_column: Option<String>,
    pub payee_column: Option<String>,
    pub amount_mode: AmountMode,
    pub signed_positive_direction: Option<SignedPositiveDirection>,
    pub signed_amount_column: Option<String>,
    pub debit_column: Option<String>,
    pub credit_column: Option<String>,
    pub external_id_column: Option<String>,
    pub account_hint_column: Option<String>,
    pub is_enabled: bool,
    pub priority: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDelimitedParserProfileInput {
    pub profile_id: String,
    pub household_id: String,
    pub expected_version: u64,
    pub name: String,
    pub delimiter: DelimiterMode,
    pub encoding: EncodingMode,
    pub header_row: u32,
    pub date_column: String,
    pub date_format: DateFormat,
    pub description_column: Option<String>,
    pub payee_column: Option<String>,
    pub amount_mode: AmountMode,
    pub signed_positive_direction: Option<SignedPositiveDirection>,
    pub signed_amount_column: Option<String>,
    pub debit_column: Option<String>,
    pub credit_column: Option<String>,
    pub external_id_column: Option<String>,
    pub account_hint_column: Option<String>,
    pub is_enabled: bool,
    pub priority: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteDelimitedParserProfileInput {
    pub household_id: String,
    pub profile_id: String,
    pub expected_version: u64,
}

struct ValidatedProfile<'a> {
    name: &'a str,
    date_column: &'a str,
    description_column: Option<&'a str>,
    payee_column: Option<&'a str>,
    signed_amount_column: Option<&'a str>,
    debit_column: Option<&'a str>,
    credit_column: Option<&'a str>,
    external_id_column: Option<&'a str>,
    account_hint_column: Option<&'a str>,
}

struct ProfileFields<'a> {
    name: &'a str,
    header_row: u32,
    date_column: &'a str,
    description_column: Option<&'a str>,
    payee_column: Option<&'a str>,
    amount_mode: AmountMode,
    signed_positive_direction: Option<SignedPositiveDirection>,
    signed_amount_column: Option<&'a str>,
    debit_column: Option<&'a str>,
    credit_column: Option<&'a str>,
    external_id_column: Option<&'a str>,
    account_hint_column: Option<&'a str>,
    priority: u32,
}

pub fn list_profiles(
    connection: &Connection,
    household_id: &str,
) -> Result<Vec<DelimitedParserProfileDto>, ParserProfileError> {
    validate_id(household_id)?;
    ensure_household(connection, household_id)?;
    let mut statement = connection
        .prepare(&format!(
            "{} WHERE household_id = ?1 ORDER BY is_enabled DESC, priority, name, id",
            profile_select()
        ))
        .map_err(db_error)?;
    let rows = statement
        .query_map([household_id], profile_from_row)
        .map_err(db_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
}

pub fn create_profile(
    connection: &Connection,
    input: &CreateDelimitedParserProfileInput,
) -> Result<DelimitedParserProfileDto, ParserProfileError> {
    validate_id(&input.id)?;
    validate_id(&input.household_id)?;
    let profile = validate_profile(ProfileFields {
        name: &input.name,
        header_row: input.header_row,
        date_column: &input.date_column,
        description_column: input.description_column.as_deref(),
        payee_column: input.payee_column.as_deref(),
        amount_mode: input.amount_mode,
        signed_positive_direction: input.signed_positive_direction,
        signed_amount_column: input.signed_amount_column.as_deref(),
        debit_column: input.debit_column.as_deref(),
        credit_column: input.credit_column.as_deref(),
        external_id_column: input.external_id_column.as_deref(),
        account_hint_column: input.account_hint_column.as_deref(),
        priority: input.priority,
    })?;
    let transaction = connection.unchecked_transaction().map_err(db_error)?;
    ensure_household(&transaction, &input.household_id)?;
    let count: u32 = transaction
        .query_row(
            "SELECT count(*) FROM delimited_parser_profiles WHERE household_id = ?1",
            [&input.household_id],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    if count >= MAX_PROFILES_PER_HOUSEHOLD {
        return Err(ParserProfileError::LimitExceeded);
    }
    transaction
        .execute(
            "INSERT INTO delimited_parser_profiles
             (id, household_id, name, delimiter, encoding, header_row, date_column,
              date_format, description_column, payee_column, amount_mode,
              signed_positive_direction, signed_amount_column, debit_column, credit_column, external_id_column,
              account_hint_column, is_enabled, priority)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                     ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            params![
                input.id,
                input.household_id,
                profile.name,
                input.delimiter.as_sql(),
                input.encoding.as_sql(),
                input.header_row,
                profile.date_column,
                input.date_format.as_sql(),
                profile.description_column,
                profile.payee_column,
                input.amount_mode.as_sql(),
                input.signed_positive_direction.map(SignedPositiveDirection::as_sql),
                profile.signed_amount_column,
                profile.debit_column,
                profile.credit_column,
                profile.external_id_column,
                profile.account_hint_column,
                input.is_enabled,
                input.priority
            ],
        )
        .map_err(db_error)?;
    transaction.commit().map_err(db_error)?;
    get_profile(connection, &input.household_id, &input.id)
}

pub fn update_profile(
    connection: &Connection,
    input: &UpdateDelimitedParserProfileInput,
) -> Result<DelimitedParserProfileDto, ParserProfileError> {
    validate_id(&input.profile_id)?;
    validate_id(&input.household_id)?;
    if input.expected_version == 0 {
        return Err(ParserProfileError::InvalidInput("Version is invalid"));
    }
    let profile = validate_profile(ProfileFields {
        name: &input.name,
        header_row: input.header_row,
        date_column: &input.date_column,
        description_column: input.description_column.as_deref(),
        payee_column: input.payee_column.as_deref(),
        amount_mode: input.amount_mode,
        signed_positive_direction: input.signed_positive_direction,
        signed_amount_column: input.signed_amount_column.as_deref(),
        debit_column: input.debit_column.as_deref(),
        credit_column: input.credit_column.as_deref(),
        external_id_column: input.external_id_column.as_deref(),
        account_hint_column: input.account_hint_column.as_deref(),
        priority: input.priority,
    })?;
    let changed = connection
        .execute(
            "UPDATE delimited_parser_profiles SET
               name = ?1, delimiter = ?2, encoding = ?3, header_row = ?4,
               date_column = ?5, date_format = ?6, description_column = ?7,
               payee_column = ?8, amount_mode = ?9, signed_positive_direction = ?10,
               signed_amount_column = ?11, debit_column = ?12, credit_column = ?13,
               external_id_column = ?14, account_hint_column = ?15, is_enabled = ?16, priority = ?17,
               version = version + 1,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?18 AND household_id = ?19 AND version = ?20",
            params![
                profile.name,
                input.delimiter.as_sql(),
                input.encoding.as_sql(),
                input.header_row,
                profile.date_column,
                input.date_format.as_sql(),
                profile.description_column,
                profile.payee_column,
                input.amount_mode.as_sql(),
                input.signed_positive_direction.map(SignedPositiveDirection::as_sql),
                profile.signed_amount_column,
                profile.debit_column,
                profile.credit_column,
                profile.external_id_column,
                profile.account_hint_column,
                input.is_enabled,
                input.priority,
                input.profile_id,
                input.household_id,
                input.expected_version
            ],
        )
        .map_err(db_error)?;
    if changed != 1 {
        return distinguish_missing_or_conflict(connection, &input.household_id, &input.profile_id);
    }
    get_profile(connection, &input.household_id, &input.profile_id)
}

pub fn delete_profile(
    connection: &Connection,
    input: &DeleteDelimitedParserProfileInput,
) -> Result<(), ParserProfileError> {
    validate_id(&input.household_id)?;
    validate_id(&input.profile_id)?;
    if input.expected_version == 0 {
        return Err(ParserProfileError::InvalidInput("Version is invalid"));
    }
    let changed = connection
        .execute(
            "DELETE FROM delimited_parser_profiles
             WHERE household_id = ?1 AND id = ?2 AND version = ?3",
            params![input.household_id, input.profile_id, input.expected_version],
        )
        .map_err(db_error)?;
    if changed == 1 {
        Ok(())
    } else {
        distinguish_missing_or_conflict(connection, &input.household_id, &input.profile_id)
    }
}

fn distinguish_missing_or_conflict<T>(
    connection: &Connection,
    household_id: &str,
    profile_id: &str,
) -> Result<T, ParserProfileError> {
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM delimited_parser_profiles
             WHERE household_id = ?1 AND id = ?2)",
            params![household_id, profile_id],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    if exists {
        Err(ParserProfileError::Conflict)
    } else {
        Err(ParserProfileError::NotFound)
    }
}

fn get_profile(
    connection: &Connection,
    household_id: &str,
    profile_id: &str,
) -> Result<DelimitedParserProfileDto, ParserProfileError> {
    connection
        .query_row(
            &format!("{} WHERE household_id = ?1 AND id = ?2", profile_select()),
            params![household_id, profile_id],
            profile_from_row,
        )
        .optional()
        .map_err(db_error)?
        .ok_or(ParserProfileError::NotFound)
}

fn profile_select() -> &'static str {
    "SELECT id, household_id, name, delimiter, encoding, header_row, date_column,
            date_format, description_column, payee_column, amount_mode,
            signed_positive_direction, signed_amount_column, debit_column, credit_column, external_id_column,
            account_hint_column, is_enabled, priority, version, created_at, updated_at
     FROM delimited_parser_profiles"
}

fn profile_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DelimitedParserProfileDto> {
    Ok(DelimitedParserProfileDto {
        id: row.get(0)?,
        household_id: row.get(1)?,
        name: row.get(2)?,
        delimiter: row.get(3)?,
        encoding: row.get(4)?,
        header_row: row.get(5)?,
        date_column: row.get(6)?,
        date_format: row.get(7)?,
        description_column: row.get(8)?,
        payee_column: row.get(9)?,
        amount_mode: row.get(10)?,
        signed_positive_direction: row.get(11)?,
        signed_amount_column: row.get(12)?,
        debit_column: row.get(13)?,
        credit_column: row.get(14)?,
        external_id_column: row.get(15)?,
        account_hint_column: row.get(16)?,
        is_enabled: row.get(17)?,
        priority: row.get(18)?,
        version: row.get(19)?,
        created_at: row.get(20)?,
        updated_at: row.get(21)?,
    })
}

fn validate_profile<'a>(
    fields: ProfileFields<'a>,
) -> Result<ValidatedProfile<'a>, ParserProfileError> {
    let name = validate_text(fields.name, MAX_NAME_CHARS, "Profile name is invalid")?;
    if !(1..=1000).contains(&fields.header_row) {
        return Err(ParserProfileError::InvalidInput("Header row is invalid"));
    }
    if fields.priority > 10_000 {
        return Err(ParserProfileError::InvalidInput("Priority is invalid"));
    }
    let date_column = validate_text(
        fields.date_column,
        MAX_COLUMN_CHARS,
        "Date column is invalid",
    )?;
    let description_column = validate_optional_column(fields.description_column)?;
    let payee_column = validate_optional_column(fields.payee_column)?;
    if description_column.is_none() && payee_column.is_none() {
        return Err(ParserProfileError::InvalidInput(
            "Description or payee column is required",
        ));
    }
    let signed_amount_column = validate_optional_column(fields.signed_amount_column)?;
    let debit_column = validate_optional_column(fields.debit_column)?;
    let credit_column = validate_optional_column(fields.credit_column)?;
    match fields.amount_mode {
        AmountMode::Signed
            if fields.signed_positive_direction.is_some()
                && signed_amount_column.is_some()
                && debit_column.is_none()
                && credit_column.is_none() => {}
        AmountMode::DebitCredit
            if fields.signed_positive_direction.is_none()
                && signed_amount_column.is_none()
                && debit_column.is_some()
                && credit_column.is_some() => {}
        _ => {
            return Err(ParserProfileError::InvalidInput(
                "Amount column mapping is invalid",
            ));
        }
    }
    let external_id_column = validate_optional_column(fields.external_id_column)?;
    let account_hint_column = validate_optional_column(fields.account_hint_column)?;
    let columns = [
        Some(date_column),
        description_column,
        payee_column,
        signed_amount_column,
        debit_column,
        credit_column,
        external_id_column,
        account_hint_column,
    ];
    let mut unique = HashSet::new();
    if columns
        .into_iter()
        .flatten()
        .any(|column| !unique.insert(column))
    {
        return Err(ParserProfileError::InvalidInput(
            "Each mapped role requires a different column",
        ));
    }
    Ok(ValidatedProfile {
        name,
        date_column,
        description_column,
        payee_column,
        signed_amount_column,
        debit_column,
        credit_column,
        external_id_column,
        account_hint_column,
    })
}

fn validate_optional_column(value: Option<&str>) -> Result<Option<&str>, ParserProfileError> {
    value
        .map(|value| validate_text(value, MAX_COLUMN_CHARS, "Column name is invalid"))
        .transpose()
}

fn validate_text<'a>(
    value: &'a str,
    max_chars: usize,
    message: &'static str,
) -> Result<&'a str, ParserProfileError> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > max_chars
        || trimmed.chars().any(char::is_control)
    {
        Err(ParserProfileError::InvalidInput(message))
    } else {
        Ok(trimmed)
    }
}

fn validate_id(value: &str) -> Result<(), ParserProfileError> {
    if value.is_empty()
        || value.len() > MAX_ID_LEN
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        Err(ParserProfileError::InvalidInput("Identifier is invalid"))
    } else {
        Ok(())
    }
}

fn ensure_household(connection: &Connection, household_id: &str) -> Result<(), ParserProfileError> {
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM households WHERE id = ?1)",
            [household_id],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    if exists {
        Ok(())
    } else {
        Err(ParserProfileError::NotFound)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE households(id TEXT PRIMARY KEY);
                 INSERT INTO households VALUES ('home'), ('other');",
            )
            .unwrap();
        connection
            .execute_batch(include_str!(
                "../migrations/0019_delimited_parser_profiles.sql"
            ))
            .unwrap();
        connection
    }

    fn signed(id: &str) -> CreateDelimitedParserProfileInput {
        CreateDelimitedParserProfileInput {
            id: id.into(),
            household_id: "home".into(),
            name: format!("Profile {id}"),
            delimiter: DelimiterMode::Auto,
            encoding: EncodingMode::Auto,
            header_row: 1,
            date_column: "Date".into(),
            date_format: DateFormat::Auto,
            description_column: Some("Description".into()),
            payee_column: None,
            amount_mode: AmountMode::Signed,
            signed_positive_direction: Some(SignedPositiveDirection::Out),
            signed_amount_column: Some("Amount".into()),
            debit_column: None,
            credit_column: None,
            external_id_column: Some("Transaction ID".into()),
            account_hint_column: None,
            is_enabled: true,
            priority: 10,
        }
    }

    fn update_from(profile: &DelimitedParserProfileDto) -> UpdateDelimitedParserProfileInput {
        UpdateDelimitedParserProfileInput {
            profile_id: profile.id.clone(),
            household_id: profile.household_id.clone(),
            expected_version: profile.version,
            name: profile.name.clone(),
            delimiter: DelimiterMode::Tab,
            encoding: EncodingMode::Utf8,
            header_row: 2,
            date_column: profile.date_column.clone(),
            date_format: DateFormat::YyyyMmDd,
            description_column: profile.description_column.clone(),
            payee_column: profile.payee_column.clone(),
            amount_mode: AmountMode::DebitCredit,
            signed_positive_direction: None,
            signed_amount_column: None,
            debit_column: Some("Debit".into()),
            credit_column: Some("Credit".into()),
            external_id_column: profile.external_id_column.clone(),
            account_hint_column: Some("Account".into()),
            is_enabled: false,
            priority: 20,
        }
    }

    #[test]
    fn crud_is_household_scoped_ordered_and_optimistically_versioned() {
        let connection = database();
        let first = create_profile(&connection, &signed("first")).unwrap();
        let mut second_input = signed("second");
        second_input.priority = 1;
        let second = create_profile(&connection, &second_input).unwrap();
        assert_eq!(first.version, 1);
        assert_eq!(list_profiles(&connection, "home").unwrap()[0].id, second.id);

        let update = update_from(&first);
        let updated = update_profile(&connection, &update).unwrap();
        assert_eq!(updated.version, 2);
        assert_eq!(updated.amount_mode, "DEBIT_CREDIT");
        assert_eq!(updated.delimiter, "TAB");
        assert!(!updated.is_enabled);
        assert!(matches!(
            update_profile(&connection, &update),
            Err(ParserProfileError::Conflict)
        ));
        let mut foreign = update_from(&updated);
        foreign.household_id = "other".into();
        assert!(matches!(
            update_profile(&connection, &foreign),
            Err(ParserProfileError::NotFound)
        ));
        assert!(matches!(
            delete_profile(
                &connection,
                &DeleteDelimitedParserProfileInput {
                    household_id: "home".into(),
                    profile_id: updated.id.clone(),
                    expected_version: 1,
                }
            ),
            Err(ParserProfileError::Conflict)
        ));
        delete_profile(
            &connection,
            &DeleteDelimitedParserProfileInput {
                household_id: "home".into(),
                profile_id: updated.id,
                expected_version: 2,
            },
        )
        .unwrap();
        assert_eq!(list_profiles(&connection, "home").unwrap().len(), 1);
    }

    #[test]
    fn rejects_ambiguous_columns_amount_shapes_and_invalid_bounds_atomically() {
        let connection = database();
        let mut invalid = signed("invalid");
        invalid.payee_column = Some("Date".into());
        assert!(matches!(
            create_profile(&connection, &invalid),
            Err(ParserProfileError::InvalidInput(_))
        ));
        invalid.payee_column = None;
        invalid.debit_column = Some("Debit".into());
        assert!(matches!(
            create_profile(&connection, &invalid),
            Err(ParserProfileError::InvalidInput(_))
        ));
        invalid.debit_column = None;
        invalid.signed_positive_direction = None;
        assert!(matches!(
            create_profile(&connection, &invalid),
            Err(ParserProfileError::InvalidInput(_))
        ));
        invalid.signed_positive_direction = Some(SignedPositiveDirection::Out);
        invalid.header_row = 0;
        assert!(matches!(
            create_profile(&connection, &invalid),
            Err(ParserProfileError::InvalidInput(_))
        ));
        invalid.header_row = 1;
        invalid.description_column = None;
        assert!(matches!(
            create_profile(&connection, &invalid),
            Err(ParserProfileError::InvalidInput(_))
        ));
        let count: u32 = connection
            .query_row(
                "SELECT count(*) FROM delimited_parser_profiles",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn enforces_the_per_household_profile_limit() {
        let connection = database();
        connection
            .execute_batch(
                "WITH RECURSIVE sequence(value) AS (
                   SELECT 1
                   UNION ALL
                   SELECT value + 1 FROM sequence WHERE value < 1000
                 )
                 INSERT INTO delimited_parser_profiles
                   (id, household_id, name, delimiter, encoding, header_row,
                    date_column, date_format, description_column, amount_mode,
                    signed_positive_direction, signed_amount_column, is_enabled, priority)
                 SELECT printf('profile-%04d', value), 'home',
                        printf('Profile %04d', value), 'AUTO', 'AUTO', 1,
                        'Date', 'AUTO', 'Description', 'SIGNED', 'OUT', 'Amount', 1, 10
                 FROM sequence;",
            )
            .unwrap();

        assert!(matches!(
            create_profile(&connection, &signed("overflow")),
            Err(ParserProfileError::LimitExceeded)
        ));
    }
}
