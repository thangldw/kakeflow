use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, Error, PartialEq, Eq)]
pub enum AttributionScopeValidationError {
    #[error("Attribution member identifier is invalid")]
    InvalidMemberId,
    #[error("Attribution member was not found in the household")]
    MemberNotFound,
    #[error("Attribution scope could not be validated")]
    Database,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AttributionScope {
    #[default]
    All,
    HouseholdCommon,
    Member {
        #[serde(rename = "memberId")]
        member_id: String,
    },
}

impl AttributionScope {
    pub fn sql_kind(&self) -> &'static str {
        match self {
            Self::All => "ALL",
            Self::HouseholdCommon => "HOUSEHOLD_COMMON",
            Self::Member { .. } => "MEMBER",
        }
    }

    pub fn member_id(&self) -> Option<&str> {
        match self {
            Self::Member { member_id } => Some(member_id),
            Self::All | Self::HouseholdCommon => None,
        }
    }
}

pub fn validate_attribution_scope(
    connection: &rusqlite::Connection,
    household_id: &str,
    scope: &AttributionScope,
) -> Result<(), AttributionScopeValidationError> {
    let Some(member_id) = scope.member_id() else {
        return Ok(());
    };
    if member_id.is_empty()
        || member_id.len() > 64
        || !member_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(AttributionScopeValidationError::InvalidMemberId);
    }
    let belongs: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM household_members
             WHERE id = ?1 AND household_id = ?2)",
            rusqlite::params![member_id, household_id],
            |row| row.get(0),
        )
        .map_err(|_| AttributionScopeValidationError::Database)?;
    if belongs {
        Ok(())
    } else {
        Err(AttributionScopeValidationError::MemberNotFound)
    }
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AttributionKind {
    #[default]
    Household,
    Member,
}

impl AttributionKind {
    pub fn as_sql(self) -> &'static str {
        match self {
            Self::Household => "HOUSEHOLD",
            Self::Member => "MEMBER",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AudienceVisibility {
    #[default]
    Shared,
    Personal,
}

impl AudienceVisibility {
    pub fn as_sql(self) -> &'static str {
        match self {
            Self::Shared => "SHARED",
            Self::Personal => "PERSONAL",
        }
    }
}

pub fn attribution_shape_is_valid(kind: AttributionKind, member_id: Option<&str>) -> bool {
    matches!(
        (kind, member_id),
        (AttributionKind::Household, None) | (AttributionKind::Member, Some(_))
    )
}

pub fn audience_shape_is_valid(visibility: AudienceVisibility, member_id: Option<&str>) -> bool {
    matches!(
        (visibility, member_id),
        (AudienceVisibility::Shared, None) | (AudienceVisibility::Personal, Some(_))
    )
}
