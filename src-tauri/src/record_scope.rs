use serde::{Deserialize, Serialize};

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
