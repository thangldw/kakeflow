use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fmt;

const MAX_HOUSEHOLD_ID_LEN: usize = 48;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DashboardTemplate {
    FinancialOverview,
    HouseholdLedger,
    AssetsLiabilities,
    CardReconciliation,
    CashFlow,
}

impl DashboardTemplate {
    fn as_str(self) -> &'static str {
        match self {
            Self::FinancialOverview => "FINANCIAL_OVERVIEW",
            Self::HouseholdLedger => "HOUSEHOLD_LEDGER",
            Self::AssetsLiabilities => "ASSETS_LIABILITIES",
            Self::CardReconciliation => "CARD_RECONCILIATION",
            Self::CashFlow => "CASH_FLOW",
        }
    }

    fn from_database(value: &str) -> Option<Self> {
        match value {
            "FINANCIAL_OVERVIEW" => Some(Self::FinancialOverview),
            "HOUSEHOLD_LEDGER" => Some(Self::HouseholdLedger),
            "ASSETS_LIABILITIES" => Some(Self::AssetsLiabilities),
            "CARD_RECONCILIATION" => Some(Self::CardReconciliation),
            "CASH_FLOW" => Some(Self::CashFlow),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DashboardTheme {
    System,
    Light,
    Dark,
}

impl DashboardTheme {
    fn as_str(self) -> &'static str {
        match self {
            Self::System => "SYSTEM",
            Self::Light => "LIGHT",
            Self::Dark => "DARK",
        }
    }

    fn from_database(value: &str) -> Option<Self> {
        match value {
            "SYSTEM" => Some(Self::System),
            "LIGHT" => Some(Self::Light),
            "DARK" => Some(Self::Dark),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DashboardDensity {
    Comfortable,
    Compact,
}

impl DashboardDensity {
    fn as_str(self) -> &'static str {
        match self {
            Self::Comfortable => "COMFORTABLE",
            Self::Compact => "COMPACT",
        }
    }

    fn from_database(value: &str) -> Option<Self> {
        match value {
            "COMFORTABLE" => Some(Self::Comfortable),
            "COMPACT" => Some(Self::Compact),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpsertDashboardPreferencesInput {
    pub household_id: String,
    pub template: DashboardTemplate,
    pub theme: DashboardTheme,
    pub density: DashboardDensity,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DashboardPreferencesDto {
    pub household_id: String,
    pub template: DashboardTemplate,
    pub theme: DashboardTheme,
    pub density: DashboardDensity,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DashboardPreferencesError {
    InvalidInput,
    NotFound,
    Unavailable,
}

impl DashboardPreferencesError {
    pub fn public_message(self) -> &'static str {
        match self {
            Self::InvalidInput => "Dashboard preference input is invalid",
            Self::NotFound => "The household was not found",
            Self::Unavailable => "Dashboard preferences are temporarily unavailable",
        }
    }
}

impl fmt::Display for DashboardPreferencesError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.public_message())
    }
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_HOUSEHOLD_ID_LEN
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn ensure_household(
    connection: &Connection,
    household_id: &str,
) -> Result<(), DashboardPreferencesError> {
    let exists = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM households WHERE id=?1)",
            [household_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|_| DashboardPreferencesError::Unavailable)?;
    exists
        .then_some(())
        .ok_or(DashboardPreferencesError::NotFound)
}

fn parse_row(
    household_id: String,
    template: String,
    theme: String,
    density: String,
    updated_at: String,
) -> Result<DashboardPreferencesDto, DashboardPreferencesError> {
    Ok(DashboardPreferencesDto {
        household_id,
        template: DashboardTemplate::from_database(&template)
            .ok_or(DashboardPreferencesError::Unavailable)?,
        theme: DashboardTheme::from_database(&theme)
            .ok_or(DashboardPreferencesError::Unavailable)?,
        density: DashboardDensity::from_database(&density)
            .ok_or(DashboardPreferencesError::Unavailable)?,
        updated_at,
    })
}

pub fn get(
    connection: &Connection,
    household_id: &str,
) -> Result<DashboardPreferencesDto, DashboardPreferencesError> {
    if !valid_identifier(household_id) {
        return Err(DashboardPreferencesError::InvalidInput);
    }
    ensure_household(connection, household_id)?;
    let persisted = connection
        .query_row(
            "SELECT household_id,dashboard_template,theme,density,updated_at
             FROM dashboard_preferences WHERE household_id=?1",
            [household_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()
        .map_err(|_| DashboardPreferencesError::Unavailable)?;

    match persisted {
        Some((household_id, template, theme, density, updated_at)) => {
            parse_row(household_id, template, theme, density, updated_at)
        }
        None => Ok(DashboardPreferencesDto {
            household_id: household_id.to_owned(),
            template: DashboardTemplate::FinancialOverview,
            theme: DashboardTheme::System,
            density: DashboardDensity::Comfortable,
            // A stable sentinel keeps default reads deterministic and does not
            // pretend the user has saved a preference.
            updated_at: "1970-01-01T00:00:00.000Z".to_owned(),
        }),
    }
}

pub fn upsert(
    connection: &Connection,
    input: &UpsertDashboardPreferencesInput,
) -> Result<DashboardPreferencesDto, DashboardPreferencesError> {
    if !valid_identifier(&input.household_id) {
        return Err(DashboardPreferencesError::InvalidInput);
    }
    ensure_household(connection, &input.household_id)?;
    connection
        .execute(
            "INSERT INTO dashboard_preferences
               (household_id,dashboard_template,theme,density)
             VALUES (?1,?2,?3,?4)
             ON CONFLICT(household_id) DO UPDATE SET
               dashboard_template=excluded.dashboard_template,
               theme=excluded.theme,
               density=excluded.density,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            params![
                input.household_id,
                input.template.as_str(),
                input.theme.as_str(),
                input.density.as_str(),
            ],
        )
        .map_err(|_| DashboardPreferencesError::Unavailable)?;
    get(connection, &input.household_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().expect("database");
        connection
            .execute_batch(
                "PRAGMA foreign_keys=ON;
                 CREATE TABLE households(id TEXT PRIMARY KEY NOT NULL) STRICT;
                 INSERT INTO households(id) VALUES ('family');",
            )
            .expect("households");
        connection
            .execute_batch(include_str!("../migrations/0029_dashboard_preferences.sql"))
            .expect("migration");
        connection
            .execute_batch(include_str!("../migrations/0030_cash_flow_dashboard.sql"))
            .expect("cash-flow migration");
        connection
    }

    #[test]
    fn default_read_is_deterministic_and_does_not_write() {
        let connection = database();
        let preferences = get(&connection, "family").expect("defaults");
        assert_eq!(preferences.template, DashboardTemplate::FinancialOverview);
        assert_eq!(preferences.theme, DashboardTheme::System);
        assert_eq!(preferences.density, DashboardDensity::Comfortable);
        assert_eq!(preferences.updated_at, "1970-01-01T00:00:00.000Z");
        let count: u64 = connection
            .query_row("SELECT count(*) FROM dashboard_preferences", [], |row| {
                row.get(0)
            })
            .expect("count");
        assert_eq!(count, 0);
    }

    #[test]
    fn upsert_round_trips_each_preference() {
        let connection = database();
        let saved = upsert(
            &connection,
            &UpsertDashboardPreferencesInput {
                household_id: "family".to_owned(),
                template: DashboardTemplate::AssetsLiabilities,
                theme: DashboardTheme::Dark,
                density: DashboardDensity::Compact,
            },
        )
        .expect("save");
        assert_eq!(saved.template, DashboardTemplate::AssetsLiabilities);
        assert_eq!(saved.theme, DashboardTheme::Dark);
        assert_eq!(saved.density, DashboardDensity::Compact);
        assert_ne!(saved.updated_at, "1970-01-01T00:00:00.000Z");
        assert_eq!(get(&connection, "family").expect("read"), saved);
    }

    #[test]
    fn cash_flow_template_round_trips() {
        let connection = database();
        let saved = upsert(
            &connection,
            &UpsertDashboardPreferencesInput {
                household_id: "family".to_owned(),
                template: DashboardTemplate::CashFlow,
                theme: DashboardTheme::System,
                density: DashboardDensity::Compact,
            },
        )
        .expect("save cash flow");
        assert_eq!(saved.template, DashboardTemplate::CashFlow);
        assert_eq!(get(&connection, "family").expect("read"), saved);
    }

    #[test]
    fn rejects_invalid_or_unknown_households() {
        let connection = database();
        assert_eq!(
            get(&connection, "../../family"),
            Err(DashboardPreferencesError::InvalidInput)
        );
        assert_eq!(
            get(&connection, "missing"),
            Err(DashboardPreferencesError::NotFound)
        );
    }

    #[test]
    fn database_constraints_reject_invalid_domains_and_delete_with_household() {
        let connection = database();
        assert!(connection
            .execute(
                "INSERT INTO dashboard_preferences(household_id,dashboard_template,theme,density)
                 VALUES ('family','UNKNOWN','SYSTEM','COMFORTABLE')",
                [],
            )
            .is_err());
        upsert(
            &connection,
            &UpsertDashboardPreferencesInput {
                household_id: "family".to_owned(),
                template: DashboardTemplate::HouseholdLedger,
                theme: DashboardTheme::Light,
                density: DashboardDensity::Comfortable,
            },
        )
        .expect("save");
        connection
            .execute("DELETE FROM households WHERE id='family'", [])
            .expect("delete household");
        let count: u64 = connection
            .query_row("SELECT count(*) FROM dashboard_preferences", [], |row| {
                row.get(0)
            })
            .expect("count");
        assert_eq!(count, 0);
    }
}
