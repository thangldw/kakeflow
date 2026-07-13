ALTER TABLE dashboard_preferences ADD COLUMN widget_order TEXT NOT NULL
    DEFAULT '["TREND","SPENDING","RECENT","CARDS"]'
    CHECK (
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
    );

ALTER TABLE dashboard_preferences ADD COLUMN hidden_widgets TEXT NOT NULL
    DEFAULT '[]'
    CHECK (
        json_valid(hidden_widgets)
        AND json_type(hidden_widgets) = 'array'
        AND json_array_length(hidden_widgets) BETWEEN 0 AND 3
        AND (
            json_array_length(hidden_widgets) < 1 OR (
                json_type(hidden_widgets, '$[0]') = 'text'
                AND json_extract(hidden_widgets, '$[0]') IN ('TREND','SPENDING','RECENT','CARDS')
            )
        )
        AND (
            json_array_length(hidden_widgets) < 2 OR (
                json_type(hidden_widgets, '$[1]') = 'text'
                AND json_extract(hidden_widgets, '$[1]') IN ('TREND','SPENDING','RECENT','CARDS')
                AND json_extract(hidden_widgets, '$[1]') != json_extract(hidden_widgets, '$[0]')
            )
        )
        AND (
            json_array_length(hidden_widgets) < 3 OR (
                json_type(hidden_widgets, '$[2]') = 'text'
                AND json_extract(hidden_widgets, '$[2]') IN ('TREND','SPENDING','RECENT','CARDS')
                AND json_extract(hidden_widgets, '$[2]') != json_extract(hidden_widgets, '$[0]')
                AND json_extract(hidden_widgets, '$[2]') != json_extract(hidden_widgets, '$[1]')
            )
        )
    );
