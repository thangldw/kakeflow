CREATE TABLE dashboard_template_layouts (
    household_id TEXT NOT NULL,
    dashboard_template TEXT NOT NULL CHECK (dashboard_template IN (
        'FINANCIAL_OVERVIEW','HOUSEHOLD_LEDGER','ASSETS_LIABILITIES',
        'CARD_RECONCILIATION','CASH_FLOW'
    )),
    widget_order TEXT NOT NULL CHECK (
        json_valid(widget_order)
        AND json_type(widget_order) = 'array'
        AND json_array_length(widget_order) = 4
        AND json_type(widget_order, '$[0]') = 'text'
        AND json_type(widget_order, '$[1]') = 'text'
        AND json_type(widget_order, '$[2]') = 'text'
        AND json_type(widget_order, '$[3]') = 'text'
        AND json_extract(widget_order, '$[0]') IN ('TREND','SPENDING','RECENT','CARDS')
        AND json_extract(widget_order, '$[1]') IN ('TREND','SPENDING','RECENT','CARDS')
        AND json_extract(widget_order, '$[2]') IN ('TREND','SPENDING','RECENT','CARDS')
        AND json_extract(widget_order, '$[3]') IN ('TREND','SPENDING','RECENT','CARDS')
        AND json_extract(widget_order, '$[0]') != json_extract(widget_order, '$[1]')
        AND json_extract(widget_order, '$[0]') != json_extract(widget_order, '$[2]')
        AND json_extract(widget_order, '$[0]') != json_extract(widget_order, '$[3]')
        AND json_extract(widget_order, '$[1]') != json_extract(widget_order, '$[2]')
        AND json_extract(widget_order, '$[1]') != json_extract(widget_order, '$[3]')
        AND json_extract(widget_order, '$[2]') != json_extract(widget_order, '$[3]')
    ),
    hidden_widgets TEXT NOT NULL CHECK (
        json_valid(hidden_widgets)
        AND json_type(hidden_widgets) = 'array'
        AND json_array_length(hidden_widgets) BETWEEN 0 AND 3
        AND (json_array_length(hidden_widgets) < 1 OR (
            json_type(hidden_widgets, '$[0]') = 'text'
            AND json_extract(hidden_widgets, '$[0]') IN ('TREND','SPENDING','RECENT','CARDS')
        ))
        AND (json_array_length(hidden_widgets) < 2 OR (
            json_type(hidden_widgets, '$[1]') = 'text'
            AND json_extract(hidden_widgets, '$[1]') IN ('TREND','SPENDING','RECENT','CARDS')
            AND json_extract(hidden_widgets, '$[1]') != json_extract(hidden_widgets, '$[0]')
        ))
        AND (json_array_length(hidden_widgets) < 3 OR (
            json_type(hidden_widgets, '$[2]') = 'text'
            AND json_extract(hidden_widgets, '$[2]') IN ('TREND','SPENDING','RECENT','CARDS')
            AND json_extract(hidden_widgets, '$[2]') != json_extract(hidden_widgets, '$[0]')
            AND json_extract(hidden_widgets, '$[2]') != json_extract(hidden_widgets, '$[1]')
        ))
        AND (dashboard_template != 'CASH_FLOW' OR (
            json_array_length(hidden_widgets) BETWEEN 0 AND 2
            AND (json_array_length(hidden_widgets) < 1 OR json_extract(hidden_widgets, '$[0]') != 'SPENDING')
            AND (json_array_length(hidden_widgets) < 2 OR json_extract(hidden_widgets, '$[1]') != 'SPENDING')
        ))
    ),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (household_id, dashboard_template),
    FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
) STRICT;

-- A v0.47 row had one household-wide layout. Preserve it for the template
-- that was active at upgrade time and seed deterministic defaults for the
-- other four templates. Cash Flow did not expose SPENDING, so legacy hidden
-- state for that ineligible panel is removed; if all three eligible panels
-- were hidden, TREND is restored.
INSERT INTO dashboard_template_layouts (
    household_id,dashboard_template,widget_order,hidden_widgets,created_at,updated_at
)
SELECT household_id,dashboard_template,widget_order,
       CASE WHEN dashboard_template!='CASH_FLOW' THEN hidden_widgets
            WHEN EXISTS(SELECT 1 FROM json_each(hidden_widgets) WHERE value='TREND')
             AND EXISTS(SELECT 1 FROM json_each(hidden_widgets) WHERE value='RECENT')
             AND EXISTS(SELECT 1 FROM json_each(hidden_widgets) WHERE value='CARDS')
              THEN '["RECENT","CARDS"]'
            ELSE (SELECT json_group_array(value) FROM json_each(hidden_widgets)
                  WHERE value!='SPENDING') END,
       created_at,updated_at
FROM dashboard_preferences
UNION ALL
SELECT p.household_id,t.dashboard_template,t.widget_order,'[]',p.created_at,p.updated_at
FROM dashboard_preferences p
JOIN (
    SELECT 'FINANCIAL_OVERVIEW' dashboard_template,
           '["TREND","SPENDING","RECENT","CARDS"]' widget_order
    UNION ALL SELECT 'HOUSEHOLD_LEDGER','["SPENDING","RECENT","TREND","CARDS"]'
    UNION ALL SELECT 'ASSETS_LIABILITIES','["TREND","SPENDING","CARDS","RECENT"]'
    UNION ALL SELECT 'CARD_RECONCILIATION','["CARDS","RECENT","TREND","SPENDING"]'
    UNION ALL SELECT 'CASH_FLOW','["TREND","RECENT","CARDS","SPENDING"]'
) t ON t.dashboard_template!=p.dashboard_template;
