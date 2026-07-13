use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fmt,
};

const MAX_HOUSEHOLD_ID_LEN: usize = 48;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DashboardWidgetId {
    Trend,
    Spending,
    Recent,
    Cards,
}

const CANONICAL_WIDGET_ORDER: [DashboardWidgetId; 4] = [
    DashboardWidgetId::Trend,
    DashboardWidgetId::Spending,
    DashboardWidgetId::Recent,
    DashboardWidgetId::Cards,
];

fn valid_widget_layout(
    template: DashboardTemplate,
    order: &[DashboardWidgetId],
    hidden: &[DashboardWidgetId],
) -> bool {
    let order_set = order.iter().copied().collect::<HashSet<_>>();
    let hidden_set = hidden.iter().copied().collect::<HashSet<_>>();
    let eligible = match template {
        DashboardTemplate::CashFlow => vec![
            DashboardWidgetId::Trend,
            DashboardWidgetId::Recent,
            DashboardWidgetId::Cards,
        ],
        _ => CANONICAL_WIDGET_ORDER.to_vec(),
    };
    order.len() == CANONICAL_WIDGET_ORDER.len()
        && order_set.len() == CANONICAL_WIDGET_ORDER.len()
        && CANONICAL_WIDGET_ORDER
            .iter()
            .all(|widget| order_set.contains(widget))
        && hidden.len() < eligible.len()
        && hidden_set.len() == hidden.len()
        && hidden_set.iter().all(|widget| eligible.contains(widget))
}

fn valid_template_layouts(layouts: &DashboardTemplateLayouts) -> bool {
    layouts.iter().all(|(template, layout)| {
        valid_widget_layout(template, &layout.widget_order, &layout.hidden_widgets)
    })
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
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

const ALL_TEMPLATES: [DashboardTemplate; 5] = [
    DashboardTemplate::FinancialOverview,
    DashboardTemplate::HouseholdLedger,
    DashboardTemplate::AssetsLiabilities,
    DashboardTemplate::CardReconciliation,
    DashboardTemplate::CashFlow,
];

fn default_widget_order_for(template: DashboardTemplate) -> Vec<DashboardWidgetId> {
    use DashboardWidgetId::{Cards, Recent, Spending, Trend};
    match template {
        DashboardTemplate::FinancialOverview => vec![Trend, Spending, Recent, Cards],
        DashboardTemplate::HouseholdLedger => vec![Spending, Recent, Trend, Cards],
        DashboardTemplate::AssetsLiabilities => vec![Trend, Spending, Cards, Recent],
        DashboardTemplate::CardReconciliation => vec![Cards, Recent, Trend, Spending],
        DashboardTemplate::CashFlow => vec![Trend, Recent, Cards, Spending],
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
    pub template_layouts: DashboardTemplateLayouts,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DashboardPreferencesDto {
    pub household_id: String,
    pub template: DashboardTemplate,
    pub theme: DashboardTheme,
    pub density: DashboardDensity,
    pub template_layouts: DashboardTemplateLayouts,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DashboardWidgetLayout {
    pub widget_order: Vec<DashboardWidgetId>,
    pub hidden_widgets: Vec<DashboardWidgetId>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub struct DashboardTemplateLayouts {
    pub financial_overview: DashboardWidgetLayout,
    pub household_ledger: DashboardWidgetLayout,
    pub assets_liabilities: DashboardWidgetLayout,
    pub card_reconciliation: DashboardWidgetLayout,
    pub cash_flow: DashboardWidgetLayout,
}

impl DashboardTemplateLayouts {
    fn get(&self, template: DashboardTemplate) -> &DashboardWidgetLayout {
        match template {
            DashboardTemplate::FinancialOverview => &self.financial_overview,
            DashboardTemplate::HouseholdLedger => &self.household_ledger,
            DashboardTemplate::AssetsLiabilities => &self.assets_liabilities,
            DashboardTemplate::CardReconciliation => &self.card_reconciliation,
            DashboardTemplate::CashFlow => &self.cash_flow,
        }
    }

    fn iter(&self) -> impl Iterator<Item = (DashboardTemplate, &DashboardWidgetLayout)> {
        ALL_TEMPLATES
            .into_iter()
            .map(|template| (template, self.get(template)))
    }
}

fn default_template_layouts() -> DashboardTemplateLayouts {
    let layout = |template| DashboardWidgetLayout {
        widget_order: default_widget_order_for(template),
        hidden_widgets: Vec::new(),
    };
    DashboardTemplateLayouts {
        financial_overview: layout(DashboardTemplate::FinancialOverview),
        household_ledger: layout(DashboardTemplate::HouseholdLedger),
        assets_liabilities: layout(DashboardTemplate::AssetsLiabilities),
        card_reconciliation: layout(DashboardTemplate::CardReconciliation),
        cash_flow: layout(DashboardTemplate::CashFlow),
    }
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

type StoredPreferencesRow = (String, String, String, String, String, String, String);

fn parse_row(
    connection: &Connection,
    row: StoredPreferencesRow,
) -> Result<DashboardPreferencesDto, DashboardPreferencesError> {
    let (household_id, template, theme, density, widget_order, hidden_widgets, updated_at) = row;
    let legacy_widget_order = serde_json::from_str::<Vec<DashboardWidgetId>>(&widget_order)
        .map_err(|_| DashboardPreferencesError::Unavailable)?;
    let legacy_hidden_widgets = serde_json::from_str::<Vec<DashboardWidgetId>>(&hidden_widgets)
        .map_err(|_| DashboardPreferencesError::Unavailable)?;
    let template = DashboardTemplate::from_database(&template)
        .ok_or(DashboardPreferencesError::Unavailable)?;
    // The v0.47 projection was household-wide, so it may contain a widget
    // hidden while another template was active. Migration 40 normalizes the
    // authoritative per-template rows; validate the legacy projection against
    // its original all-widget domain only.
    if !valid_widget_layout(
        DashboardTemplate::FinancialOverview,
        &legacy_widget_order,
        &legacy_hidden_widgets,
    ) {
        return Err(DashboardPreferencesError::Unavailable);
    }
    let template_layouts = load_template_layouts(
        connection,
        &household_id,
        template,
        legacy_widget_order,
        legacy_hidden_widgets,
    )?;
    Ok(DashboardPreferencesDto {
        household_id,
        template,
        theme: DashboardTheme::from_database(&theme)
            .ok_or(DashboardPreferencesError::Unavailable)?,
        density: DashboardDensity::from_database(&density)
            .ok_or(DashboardPreferencesError::Unavailable)?,
        template_layouts,
        updated_at,
    })
}

fn load_template_layouts(
    connection: &Connection,
    household_id: &str,
    active_template: DashboardTemplate,
    legacy_widget_order: Vec<DashboardWidgetId>,
    legacy_hidden_widgets: Vec<DashboardWidgetId>,
) -> Result<DashboardTemplateLayouts, DashboardPreferencesError> {
    let mut statement = connection
        .prepare(
            "SELECT dashboard_template,widget_order,hidden_widgets
             FROM dashboard_template_layouts WHERE household_id=?1",
        )
        .map_err(|_| DashboardPreferencesError::Unavailable)?;
    let rows = statement
        .query_map([household_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|_| DashboardPreferencesError::Unavailable)?;
    let mut persisted = HashMap::new();
    for row in rows {
        let (template, widget_order, hidden_widgets) =
            row.map_err(|_| DashboardPreferencesError::Unavailable)?;
        let template = DashboardTemplate::from_database(&template)
            .ok_or(DashboardPreferencesError::Unavailable)?;
        let widget_order = serde_json::from_str::<Vec<DashboardWidgetId>>(&widget_order)
            .map_err(|_| DashboardPreferencesError::Unavailable)?;
        let hidden_widgets = serde_json::from_str::<Vec<DashboardWidgetId>>(&hidden_widgets)
            .map_err(|_| DashboardPreferencesError::Unavailable)?;
        if !valid_widget_layout(template, &widget_order, &hidden_widgets)
            || persisted
                .insert(
                    template,
                    DashboardWidgetLayout {
                        widget_order,
                        hidden_widgets,
                    },
                )
                .is_some()
        {
            return Err(DashboardPreferencesError::Unavailable);
        }
    }

    let mut take = |template| {
        persisted.remove(&template).unwrap_or_else(|| {
            if template == active_template {
                DashboardWidgetLayout {
                    widget_order: legacy_widget_order.clone(),
                    hidden_widgets: legacy_hidden_widgets.clone(),
                }
            } else {
                DashboardWidgetLayout {
                    widget_order: default_widget_order_for(template),
                    hidden_widgets: Vec::new(),
                }
            }
        })
    };
    let layouts = DashboardTemplateLayouts {
        financial_overview: take(DashboardTemplate::FinancialOverview),
        household_ledger: take(DashboardTemplate::HouseholdLedger),
        assets_liabilities: take(DashboardTemplate::AssetsLiabilities),
        card_reconciliation: take(DashboardTemplate::CardReconciliation),
        cash_flow: take(DashboardTemplate::CashFlow),
    };
    valid_template_layouts(&layouts)
        .then_some(layouts)
        .ok_or(DashboardPreferencesError::Unavailable)
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
            "SELECT household_id,dashboard_template,theme,density,widget_order,hidden_widgets,updated_at
             FROM dashboard_preferences WHERE household_id=?1",
            [household_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .optional()
        .map_err(|_| DashboardPreferencesError::Unavailable)?;

    match persisted {
        Some((
            household_id,
            template,
            theme,
            density,
            widget_order,
            hidden_widgets,
            updated_at,
        )) => parse_row(
            connection,
            (
                household_id,
                template,
                theme,
                density,
                widget_order,
                hidden_widgets,
                updated_at,
            ),
        ),
        None => {
            Ok(DashboardPreferencesDto {
                household_id: household_id.to_owned(),
                template: DashboardTemplate::FinancialOverview,
                theme: DashboardTheme::System,
                density: DashboardDensity::Comfortable,
                template_layouts: default_template_layouts(),
                // A stable sentinel keeps default reads deterministic and does not
                // pretend the user has saved a preference.
                updated_at: "1970-01-01T00:00:00.000Z".to_owned(),
            })
        }
    }
}

pub fn upsert(
    connection: &Connection,
    input: &UpsertDashboardPreferencesInput,
) -> Result<DashboardPreferencesDto, DashboardPreferencesError> {
    if !valid_identifier(&input.household_id) {
        return Err(DashboardPreferencesError::InvalidInput);
    }
    if !valid_template_layouts(&input.template_layouts) {
        return Err(DashboardPreferencesError::InvalidInput);
    }
    ensure_household(connection, &input.household_id)?;
    let transaction = Transaction::new_unchecked(connection, TransactionBehavior::Immediate)
        .map_err(|_| DashboardPreferencesError::Unavailable)?;
    let active_layout = input.template_layouts.get(input.template);
    transaction
        .execute(
            "INSERT INTO dashboard_preferences
               (household_id,dashboard_template,theme,density,widget_order,hidden_widgets)
             VALUES (?1,?2,?3,?4,?5,?6)
             ON CONFLICT(household_id) DO UPDATE SET
               dashboard_template=excluded.dashboard_template,
               theme=excluded.theme,
               density=excluded.density,
               widget_order=excluded.widget_order,
               hidden_widgets=excluded.hidden_widgets,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            params![
                input.household_id,
                input.template.as_str(),
                input.theme.as_str(),
                input.density.as_str(),
                serde_json::to_string(&active_layout.widget_order)
                    .map_err(|_| DashboardPreferencesError::InvalidInput)?,
                serde_json::to_string(&active_layout.hidden_widgets)
                    .map_err(|_| DashboardPreferencesError::InvalidInput)?,
            ],
        )
        .map_err(|_| DashboardPreferencesError::Unavailable)?;
    for (template, layout) in input.template_layouts.iter() {
        transaction
            .execute(
                "INSERT INTO dashboard_template_layouts
               (household_id,dashboard_template,widget_order,hidden_widgets)
             VALUES (?1,?2,?3,?4)
             ON CONFLICT(household_id,dashboard_template) DO UPDATE SET
               widget_order=excluded.widget_order,
               hidden_widgets=excluded.hidden_widgets,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
                params![
                    input.household_id,
                    template.as_str(),
                    serde_json::to_string(&layout.widget_order)
                        .map_err(|_| DashboardPreferencesError::InvalidInput)?,
                    serde_json::to_string(&layout.hidden_widgets)
                        .map_err(|_| DashboardPreferencesError::InvalidInput)?,
                ],
            )
            .map_err(|_| DashboardPreferencesError::Unavailable)?;
    }
    let saved = get(&transaction, &input.household_id)?;
    transaction
        .commit()
        .map_err(|_| DashboardPreferencesError::Unavailable)?;
    Ok(saved)
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
            .execute_batch(include_str!(
                "../migrations/0039_dashboard_widget_layout.sql"
            ))
            .expect("widget-layout migration");
        connection
            .execute_batch(include_str!(
                "../migrations/0040_dashboard_template_layouts.sql"
            ))
            .expect("template-layout migration");
        connection
    }

    fn input(template: DashboardTemplate) -> UpsertDashboardPreferencesInput {
        UpsertDashboardPreferencesInput {
            household_id: "family".to_owned(),
            template,
            theme: DashboardTheme::System,
            density: DashboardDensity::Comfortable,
            template_layouts: default_template_layouts(),
        }
    }

    #[test]
    fn default_read_is_deterministic_and_does_not_write() {
        let connection = database();
        let preferences = get(&connection, "family").expect("defaults");
        assert_eq!(preferences.template, DashboardTemplate::FinancialOverview);
        assert_eq!(preferences.theme, DashboardTheme::System);
        assert_eq!(preferences.density, DashboardDensity::Comfortable);
        assert_eq!(
            preferences.template_layouts.financial_overview.widget_order,
            CANONICAL_WIDGET_ORDER
        );
        assert!(preferences
            .template_layouts
            .financial_overview
            .hidden_widgets
            .is_empty());
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
        let mut request = input(DashboardTemplate::AssetsLiabilities);
        request.theme = DashboardTheme::Dark;
        request.density = DashboardDensity::Compact;
        request.template_layouts.assets_liabilities = DashboardWidgetLayout {
            widget_order: vec![
                DashboardWidgetId::Cards,
                DashboardWidgetId::Recent,
                DashboardWidgetId::Spending,
                DashboardWidgetId::Trend,
            ],
            hidden_widgets: vec![DashboardWidgetId::Recent, DashboardWidgetId::Cards],
        };
        let saved = upsert(&connection, &request).expect("save");
        assert_eq!(saved.template, DashboardTemplate::AssetsLiabilities);
        assert_eq!(saved.theme, DashboardTheme::Dark);
        assert_eq!(saved.density, DashboardDensity::Compact);
        assert_eq!(
            saved.template_layouts.assets_liabilities.widget_order[0],
            DashboardWidgetId::Cards
        );
        assert_eq!(
            saved.template_layouts.assets_liabilities.hidden_widgets,
            vec![DashboardWidgetId::Recent, DashboardWidgetId::Cards]
        );
        assert_ne!(saved.updated_at, "1970-01-01T00:00:00.000Z");
        assert_eq!(get(&connection, "family").expect("read"), saved);
    }

    #[test]
    fn cash_flow_template_round_trips() {
        let connection = database();
        let saved = upsert(
            &connection,
            &UpsertDashboardPreferencesInput {
                density: DashboardDensity::Compact,
                ..input(DashboardTemplate::CashFlow)
            },
        )
        .expect("save cash flow");
        assert_eq!(saved.template, DashboardTemplate::CashFlow);
        assert_eq!(get(&connection, "family").expect("read"), saved);
    }

    #[test]
    fn switching_templates_preserves_each_independent_layout() {
        let connection = database();
        let mut request = input(DashboardTemplate::FinancialOverview);
        request.template_layouts.financial_overview.widget_order = vec![
            DashboardWidgetId::Cards,
            DashboardWidgetId::Trend,
            DashboardWidgetId::Spending,
            DashboardWidgetId::Recent,
        ];
        request.template_layouts.financial_overview.hidden_widgets =
            vec![DashboardWidgetId::Spending];
        request.template_layouts.household_ledger.widget_order = vec![
            DashboardWidgetId::Recent,
            DashboardWidgetId::Spending,
            DashboardWidgetId::Trend,
            DashboardWidgetId::Cards,
        ];
        request.template_layouts.household_ledger.hidden_widgets = vec![DashboardWidgetId::Cards];
        upsert(&connection, &request).expect("first layout save");

        request.template = DashboardTemplate::HouseholdLedger;
        let saved = upsert(&connection, &request).expect("template switch");
        assert_eq!(
            saved.template_layouts.financial_overview.hidden_widgets,
            vec![DashboardWidgetId::Spending]
        );
        assert_eq!(
            saved.template_layouts.household_ledger.hidden_widgets,
            vec![DashboardWidgetId::Cards]
        );
        assert_eq!(
            saved.template_layouts.financial_overview.widget_order[0],
            DashboardWidgetId::Cards
        );
        assert_eq!(
            saved.template_layouts.household_ledger.widget_order[0],
            DashboardWidgetId::Recent
        );
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
    fn rejects_duplicate_incomplete_or_fully_hidden_widget_layouts() {
        let connection = database();
        for (template, widget_order, hidden_widgets) in [
            (
                DashboardTemplate::FinancialOverview,
                vec![
                    DashboardWidgetId::Trend,
                    DashboardWidgetId::Trend,
                    DashboardWidgetId::Recent,
                    DashboardWidgetId::Cards,
                ],
                Vec::new(),
            ),
            (
                DashboardTemplate::FinancialOverview,
                vec![
                    DashboardWidgetId::Trend,
                    DashboardWidgetId::Spending,
                    DashboardWidgetId::Recent,
                ],
                Vec::new(),
            ),
            (
                DashboardTemplate::FinancialOverview,
                CANONICAL_WIDGET_ORDER.to_vec(),
                CANONICAL_WIDGET_ORDER.to_vec(),
            ),
            (
                DashboardTemplate::FinancialOverview,
                CANONICAL_WIDGET_ORDER.to_vec(),
                vec![DashboardWidgetId::Cards, DashboardWidgetId::Cards],
            ),
            (
                DashboardTemplate::CashFlow,
                default_widget_order_for(DashboardTemplate::CashFlow),
                vec![DashboardWidgetId::Spending],
            ),
            (
                DashboardTemplate::CashFlow,
                default_widget_order_for(DashboardTemplate::CashFlow),
                vec![
                    DashboardWidgetId::Trend,
                    DashboardWidgetId::Recent,
                    DashboardWidgetId::Cards,
                ],
            ),
        ] {
            let mut request = input(template);
            *match template {
                DashboardTemplate::FinancialOverview => {
                    &mut request.template_layouts.financial_overview
                }
                DashboardTemplate::CashFlow => &mut request.template_layouts.cash_flow,
                _ => unreachable!(),
            } = DashboardWidgetLayout {
                widget_order,
                hidden_widgets,
            };
            assert_eq!(
                upsert(&connection, &request),
                Err(DashboardPreferencesError::InvalidInput)
            );
        }
    }

    #[test]
    fn migration_preserves_legacy_rows_with_canonical_layout_defaults() {
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
            .expect("preferences");
        connection
            .execute_batch(include_str!("../migrations/0030_cash_flow_dashboard.sql"))
            .expect("cash flow");
        connection
            .execute(
                "INSERT INTO dashboard_preferences(household_id,dashboard_template,theme,density)
                 VALUES ('family','CASH_FLOW','DARK','COMPACT')",
                [],
            )
            .expect("legacy row");
        connection
            .execute_batch(include_str!(
                "../migrations/0039_dashboard_widget_layout.sql"
            ))
            .expect("widget layout");
        connection
            .execute(
                "UPDATE dashboard_preferences SET widget_order='[\"CARDS\",\"TREND\",\"RECENT\",\"SPENDING\"]',
                 hidden_widgets='[\"SPENDING\",\"RECENT\"]' WHERE household_id='family'",
                [],
            )
            .expect("legacy custom layout");
        connection
            .execute_batch(include_str!(
                "../migrations/0040_dashboard_template_layouts.sql"
            ))
            .expect("template layouts");

        let saved = get(&connection, "family").expect("read migrated row");
        assert_eq!(saved.template, DashboardTemplate::CashFlow);
        assert_eq!(saved.theme, DashboardTheme::Dark);
        assert_eq!(saved.density, DashboardDensity::Compact);
        assert_eq!(
            saved.template_layouts.cash_flow.widget_order,
            vec![
                DashboardWidgetId::Cards,
                DashboardWidgetId::Trend,
                DashboardWidgetId::Recent,
                DashboardWidgetId::Spending,
            ]
        );
        assert_eq!(
            saved.template_layouts.cash_flow.hidden_widgets,
            vec![DashboardWidgetId::Recent]
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM dashboard_template_layouts",
                    [],
                    |row| row.get::<_, u64>(0)
                )
                .expect("layout count"),
            5
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
                theme: DashboardTheme::Light,
                ..input(DashboardTemplate::HouseholdLedger)
            },
        )
        .expect("save");

        for (column, value) in [
            ("widget_order", "[\"TREND\",\"TREND\",\"RECENT\",\"CARDS\"]"),
            ("widget_order", "[\"TREND\",\"SPENDING\",\"RECENT\"]"),
            (
                "hidden_widgets",
                "[\"TREND\",\"SPENDING\",\"RECENT\",\"CARDS\"]",
            ),
            ("hidden_widgets", "[\"TREND\",\"TREND\"]"),
        ] {
            assert!(connection
                .execute(
                    &format!(
                        "UPDATE dashboard_preferences SET {column}=?1 WHERE household_id='family'"
                    ),
                    [value],
                )
                .is_err());
        }
        connection
            .execute("DELETE FROM households WHERE id='family'", [])
            .expect("delete household");
        let count: u64 = connection
            .query_row("SELECT count(*) FROM dashboard_preferences", [], |row| {
                row.get(0)
            })
            .expect("count");
        assert_eq!(count, 0);
        let layout_count: u64 = connection
            .query_row(
                "SELECT count(*) FROM dashboard_template_layouts",
                [],
                |row| row.get(0),
            )
            .expect("layout count");
        assert_eq!(layout_count, 0);
    }
}
