-- Capture replayable household planning and configuration state. These records
-- intentionally remain local outbox envelopes; remote transport/apply is a
-- later milestone.

CREATE VIEW sync_monthly_budget_plan_payloads AS
SELECT h.id AS household_id,
       json(json_object(
         'recordKind','MONTHLY_BUDGET_PLAN',
         'householdId',h.id,
         'budgets',json(COALESCE((
           SELECT json_group_array(json_object(
             'householdId',b.household_id,
             'month',b.month,
             'categoryAccountId',b.category_account_id,
             'budgetJpy',b.budget_jpy,
             'createdAt',b.created_at,
             'updatedAt',b.updated_at
           ))
           FROM (
             SELECT household_id,month,category_account_id,budget_jpy,created_at,updated_at
             FROM monthly_category_budgets
             WHERE household_id=h.id
             ORDER BY month,category_account_id
           ) b
         ),'[]'))
       )) AS payload_json
FROM households h;

CREATE VIEW sync_classification_rule_payloads AS
SELECT r.household_id,
       r.id AS rule_id,
       json(json_object(
         'recordKind','CLASSIFICATION_RULE',
         'id',r.id,
         'householdId',r.household_id,
         'name',r.name,
         'priority',r.priority,
         'isEnabled',r.is_enabled,
         'merchantContains',r.merchant_contains,
         'descriptionContains',r.description_contains,
         'categoryAccountId',r.category_account_id,
         'labels',json(COALESCE((
           SELECT json_group_array(label)
           FROM (SELECT label FROM classification_rule_labels
                 WHERE rule_id=r.id ORDER BY label)
         ),'[]')),
         'tags',json(COALESCE((
           SELECT json_group_array(tag)
           FROM (SELECT tag FROM classification_rule_tags
                 WHERE rule_id=r.id ORDER BY tag)
         ),'[]')),
         'createdAt',r.created_at,
         'updatedAt',r.updated_at
       )) AS payload_json
FROM classification_rules r;

CREATE VIEW sync_account_group_payloads AS
SELECT g.household_id,
       g.id AS group_id,
       json(json_object(
         'recordKind','ACCOUNT_GROUP',
         'id',g.id,
         'householdId',g.household_id,
         'name',g.name,
         'groupKind',g.group_kind,
         'sortOrder',g.sort_order,
         'members',json(COALESCE((
           SELECT json_group_array(json_object(
             'householdId',m.household_id,
             'accountGroupId',m.account_group_id,
             'accountId',m.account_id,
             'sortOrder',m.sort_order
           ))
           FROM (
             SELECT household_id,account_group_id,account_id,sort_order
             FROM account_group_members
             WHERE account_group_id=g.id
             ORDER BY sort_order,account_id
           ) m
         ),'[]')),
         'createdAt',g.created_at,
         'updatedAt',g.updated_at
       )) AS payload_json
FROM account_groups g;

CREATE VIEW sync_parser_profile_payloads AS
SELECT p.household_id,
       p.id AS profile_id,
       json(json_object(
         'recordKind','DELIMITED_PARSER_PROFILE',
         'id',p.id,'householdId',p.household_id,'name',p.name,
         'delimiter',p.delimiter,'encoding',p.encoding,'headerRow',p.header_row,
         'dateColumn',p.date_column,'dateFormat',p.date_format,
         'descriptionColumn',p.description_column,'payeeColumn',p.payee_column,
         'amountMode',p.amount_mode,'signedPositiveDirection',p.signed_positive_direction,
         'signedAmountColumn',p.signed_amount_column,'debitColumn',p.debit_column,
         'creditColumn',p.credit_column,'externalIdColumn',p.external_id_column,
         'accountHintColumn',p.account_hint_column,'isEnabled',p.is_enabled,
         'priority',p.priority,'version',p.version,
         'createdAt',p.created_at,'updatedAt',p.updated_at
       )) AS payload_json
FROM delimited_parser_profiles p;

-- Bootstrap current state after schema-33 core dependencies. The drain
-- coalesces duplicates per entity, so installation upgrades remain idempotent.
INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
SELECT household_id,'MONTHLY_BUDGET_PLAN',household_id,'UPSERT',payload_json
FROM sync_monthly_budget_plan_payloads ORDER BY household_id;

INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
SELECT g.household_id,'SAVINGS_GOAL',g.id,'UPSERT',json(json_object(
  'recordKind','SAVINGS_GOAL','id',g.id,'householdId',g.household_id,'name',g.name,
  'targetJpy',g.target_jpy,'savedJpy',g.saved_jpy,'targetDate',g.target_date,
  'status',g.status,'createdAt',g.created_at,'updatedAt',g.updated_at
)) FROM savings_goals g ORDER BY g.household_id,g.id;

INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
SELECT household_id,'CLASSIFICATION_RULE',rule_id,'UPSERT',payload_json
FROM sync_classification_rule_payloads ORDER BY household_id,rule_id;

INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
SELECT household_id,'ACCOUNT_GROUP',group_id,'UPSERT',payload_json
FROM sync_account_group_payloads ORDER BY household_id,group_id;

INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
SELECT m.household_id,'CARD_SETTLEMENT_MAPPING',m.card_account_id,'UPSERT',json(json_object(
  'recordKind','CARD_SETTLEMENT_MAPPING','householdId',m.household_id,
  'cardAccountId',m.card_account_id,'bankAccountId',m.bank_account_id,
  'createdAt',m.created_at,'updatedAt',m.updated_at
)) FROM card_settlement_bank_mappings m ORDER BY m.household_id,m.card_account_id;

INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
SELECT p.household_id,'DASHBOARD_PREFERENCES',p.household_id,'UPSERT',json(json_object(
  'recordKind','DASHBOARD_PREFERENCES','householdId',p.household_id,
  'dashboardTemplate',p.dashboard_template,'theme',p.theme,'density',p.density,
  'createdAt',p.created_at,'updatedAt',p.updated_at
)) FROM dashboard_preferences p ORDER BY p.household_id;

INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
SELECT household_id,'DELIMITED_PARSER_PROFILE',profile_id,'UPSERT',payload_json
FROM sync_parser_profile_payloads ORDER BY household_id,profile_id;

CREATE TRIGGER trg_sync_capture_budget_insert AFTER INSERT ON monthly_category_budgets BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'MONTHLY_BUDGET_PLAN',household_id,'UPSERT',payload_json
  FROM sync_monthly_budget_plan_payloads WHERE household_id=NEW.household_id;
END;
CREATE TRIGGER trg_sync_capture_budget_update AFTER UPDATE ON monthly_category_budgets BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'MONTHLY_BUDGET_PLAN',household_id,'UPSERT',payload_json
  FROM sync_monthly_budget_plan_payloads WHERE household_id=NEW.household_id;
END;
CREATE TRIGGER trg_sync_budget_household_immutable BEFORE UPDATE OF household_id ON monthly_category_budgets
WHEN NEW.household_id!=OLD.household_id BEGIN SELECT RAISE(ABORT,'budget plan cannot move between households'); END;
CREATE TRIGGER trg_sync_capture_budget_delete AFTER DELETE ON monthly_category_budgets BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'MONTHLY_BUDGET_PLAN',household_id,'UPSERT',payload_json
  FROM sync_monthly_budget_plan_payloads WHERE household_id=OLD.household_id;
END;

CREATE TRIGGER trg_sync_capture_goal_insert AFTER INSERT ON savings_goals BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(NEW.household_id,'SAVINGS_GOAL',NEW.id,'UPSERT',json(json_object(
    'recordKind','SAVINGS_GOAL','id',NEW.id,'householdId',NEW.household_id,'name',NEW.name,
    'targetJpy',NEW.target_jpy,'savedJpy',NEW.saved_jpy,'targetDate',NEW.target_date,
    'status',NEW.status,'createdAt',NEW.created_at,'updatedAt',NEW.updated_at)));
END;
CREATE TRIGGER trg_sync_capture_goal_update AFTER UPDATE ON savings_goals BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(NEW.household_id,'SAVINGS_GOAL',NEW.id,'UPSERT',json(json_object(
    'recordKind','SAVINGS_GOAL','id',NEW.id,'householdId',NEW.household_id,'name',NEW.name,
    'targetJpy',NEW.target_jpy,'savedJpy',NEW.saved_jpy,'targetDate',NEW.target_date,
    'status',NEW.status,'createdAt',NEW.created_at,'updatedAt',NEW.updated_at)));
END;
CREATE TRIGGER trg_sync_goal_household_immutable BEFORE UPDATE OF household_id ON savings_goals
WHEN NEW.household_id!=OLD.household_id BEGIN SELECT RAISE(ABORT,'savings goal cannot move between households'); END;
CREATE TRIGGER trg_sync_goal_id_immutable BEFORE UPDATE OF id ON savings_goals
WHEN NEW.id!=OLD.id BEGIN SELECT RAISE(ABORT,'savings goal id is immutable'); END;
CREATE TRIGGER trg_sync_capture_goal_delete AFTER DELETE ON savings_goals
WHEN EXISTS(SELECT 1 FROM households h WHERE h.id=OLD.household_id) BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(OLD.household_id,'SAVINGS_GOAL',OLD.id,'DELETE',json(json_object(
    'recordKind','SAVINGS_GOAL','householdId',OLD.household_id,'id',OLD.id)));
END;

CREATE TRIGGER trg_sync_capture_rule_insert AFTER INSERT ON classification_rules BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'CLASSIFICATION_RULE',rule_id,'UPSERT',payload_json
  FROM sync_classification_rule_payloads WHERE rule_id=NEW.id;
END;
CREATE TRIGGER trg_sync_capture_rule_update AFTER UPDATE ON classification_rules BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'CLASSIFICATION_RULE',rule_id,'UPSERT',payload_json
  FROM sync_classification_rule_payloads WHERE rule_id=NEW.id;
END;
CREATE TRIGGER trg_sync_rule_household_immutable BEFORE UPDATE OF household_id ON classification_rules
WHEN NEW.household_id!=OLD.household_id BEGIN SELECT RAISE(ABORT,'classification rule cannot move between households'); END;
CREATE TRIGGER trg_sync_rule_id_immutable BEFORE UPDATE OF id ON classification_rules
WHEN NEW.id!=OLD.id BEGIN SELECT RAISE(ABORT,'classification rule id is immutable'); END;
CREATE TRIGGER trg_sync_capture_rule_delete AFTER DELETE ON classification_rules
WHEN EXISTS(SELECT 1 FROM households h WHERE h.id=OLD.household_id) BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(OLD.household_id,'CLASSIFICATION_RULE',OLD.id,'DELETE',json(json_object(
    'recordKind','CLASSIFICATION_RULE','householdId',OLD.household_id,'id',OLD.id)));
END;
CREATE TRIGGER trg_sync_capture_rule_label_insert AFTER INSERT ON classification_rule_labels BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'CLASSIFICATION_RULE',rule_id,'UPSERT',payload_json
  FROM sync_classification_rule_payloads WHERE rule_id=NEW.rule_id;
END;
CREATE TRIGGER trg_sync_capture_rule_label_update AFTER UPDATE ON classification_rule_labels BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'CLASSIFICATION_RULE',rule_id,'UPSERT',payload_json
  FROM sync_classification_rule_payloads
  WHERE rule_id=OLD.rule_id AND OLD.rule_id!=NEW.rule_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'CLASSIFICATION_RULE',rule_id,'UPSERT',payload_json
  FROM sync_classification_rule_payloads WHERE rule_id=NEW.rule_id;
END;
CREATE TRIGGER trg_sync_capture_rule_label_delete AFTER DELETE ON classification_rule_labels BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'CLASSIFICATION_RULE',rule_id,'UPSERT',payload_json
  FROM sync_classification_rule_payloads WHERE rule_id=OLD.rule_id;
END;
CREATE TRIGGER trg_sync_capture_rule_tag_insert AFTER INSERT ON classification_rule_tags BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'CLASSIFICATION_RULE',rule_id,'UPSERT',payload_json
  FROM sync_classification_rule_payloads WHERE rule_id=NEW.rule_id;
END;
CREATE TRIGGER trg_sync_capture_rule_tag_update AFTER UPDATE ON classification_rule_tags BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'CLASSIFICATION_RULE',rule_id,'UPSERT',payload_json
  FROM sync_classification_rule_payloads
  WHERE rule_id=OLD.rule_id AND OLD.rule_id!=NEW.rule_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'CLASSIFICATION_RULE',rule_id,'UPSERT',payload_json
  FROM sync_classification_rule_payloads WHERE rule_id=NEW.rule_id;
END;
CREATE TRIGGER trg_sync_capture_rule_tag_delete AFTER DELETE ON classification_rule_tags BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'CLASSIFICATION_RULE',rule_id,'UPSERT',payload_json
  FROM sync_classification_rule_payloads WHERE rule_id=OLD.rule_id;
END;

CREATE TRIGGER trg_sync_capture_group_insert AFTER INSERT ON account_groups BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'ACCOUNT_GROUP',group_id,'UPSERT',payload_json
  FROM sync_account_group_payloads WHERE group_id=NEW.id;
END;
CREATE TRIGGER trg_sync_capture_group_update AFTER UPDATE ON account_groups BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'ACCOUNT_GROUP',group_id,'UPSERT',payload_json
  FROM sync_account_group_payloads WHERE group_id=NEW.id;
END;
CREATE TRIGGER trg_sync_group_household_immutable BEFORE UPDATE OF household_id ON account_groups
WHEN NEW.household_id!=OLD.household_id BEGIN SELECT RAISE(ABORT,'account group cannot move between households'); END;
CREATE TRIGGER trg_sync_group_id_immutable BEFORE UPDATE OF id ON account_groups
WHEN NEW.id!=OLD.id BEGIN SELECT RAISE(ABORT,'account group id is immutable'); END;
CREATE TRIGGER trg_sync_capture_group_delete AFTER DELETE ON account_groups
WHEN EXISTS(SELECT 1 FROM households h WHERE h.id=OLD.household_id) BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(OLD.household_id,'ACCOUNT_GROUP',OLD.id,'DELETE',json(json_object(
    'recordKind','ACCOUNT_GROUP','householdId',OLD.household_id,'id',OLD.id)));
END;
CREATE TRIGGER trg_sync_capture_group_member_insert AFTER INSERT ON account_group_members BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'ACCOUNT_GROUP',group_id,'UPSERT',payload_json
  FROM sync_account_group_payloads WHERE group_id=NEW.account_group_id;
END;
CREATE TRIGGER trg_sync_capture_group_member_update AFTER UPDATE ON account_group_members BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'ACCOUNT_GROUP',group_id,'UPSERT',payload_json
  FROM sync_account_group_payloads
  WHERE group_id=OLD.account_group_id AND OLD.account_group_id!=NEW.account_group_id;
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'ACCOUNT_GROUP',group_id,'UPSERT',payload_json
  FROM sync_account_group_payloads WHERE group_id=NEW.account_group_id;
END;
CREATE TRIGGER trg_sync_capture_group_member_delete AFTER DELETE ON account_group_members BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'ACCOUNT_GROUP',group_id,'UPSERT',payload_json
  FROM sync_account_group_payloads WHERE group_id=OLD.account_group_id;
END;

CREATE TRIGGER trg_sync_capture_mapping_insert AFTER INSERT ON card_settlement_bank_mappings BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(NEW.household_id,'CARD_SETTLEMENT_MAPPING',NEW.card_account_id,'UPSERT',json(json_object(
    'recordKind','CARD_SETTLEMENT_MAPPING','householdId',NEW.household_id,
    'cardAccountId',NEW.card_account_id,'bankAccountId',NEW.bank_account_id,
    'createdAt',NEW.created_at,'updatedAt',NEW.updated_at)));
END;
CREATE TRIGGER trg_sync_capture_mapping_update AFTER UPDATE ON card_settlement_bank_mappings BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(NEW.household_id,'CARD_SETTLEMENT_MAPPING',NEW.card_account_id,'UPSERT',json(json_object(
    'recordKind','CARD_SETTLEMENT_MAPPING','householdId',NEW.household_id,
    'cardAccountId',NEW.card_account_id,'bankAccountId',NEW.bank_account_id,
    'createdAt',NEW.created_at,'updatedAt',NEW.updated_at)));
END;
CREATE TRIGGER trg_sync_mapping_identity_immutable
BEFORE UPDATE OF household_id,card_account_id ON card_settlement_bank_mappings
WHEN NEW.household_id!=OLD.household_id OR NEW.card_account_id!=OLD.card_account_id
BEGIN SELECT RAISE(ABORT,'card settlement mapping identity is immutable'); END;
CREATE TRIGGER trg_sync_capture_mapping_delete AFTER DELETE ON card_settlement_bank_mappings
WHEN EXISTS(SELECT 1 FROM households h WHERE h.id=OLD.household_id) BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(OLD.household_id,'CARD_SETTLEMENT_MAPPING',OLD.card_account_id,'DELETE',json(json_object(
    'recordKind','CARD_SETTLEMENT_MAPPING','householdId',OLD.household_id,
    'cardAccountId',OLD.card_account_id)));
END;

CREATE TRIGGER trg_sync_capture_dashboard_insert AFTER INSERT ON dashboard_preferences BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(NEW.household_id,'DASHBOARD_PREFERENCES',NEW.household_id,'UPSERT',json(json_object(
    'recordKind','DASHBOARD_PREFERENCES','householdId',NEW.household_id,
    'dashboardTemplate',NEW.dashboard_template,'theme',NEW.theme,'density',NEW.density,
    'createdAt',NEW.created_at,'updatedAt',NEW.updated_at)));
END;
CREATE TRIGGER trg_sync_capture_dashboard_update AFTER UPDATE ON dashboard_preferences BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(NEW.household_id,'DASHBOARD_PREFERENCES',NEW.household_id,'UPSERT',json(json_object(
    'recordKind','DASHBOARD_PREFERENCES','householdId',NEW.household_id,
    'dashboardTemplate',NEW.dashboard_template,'theme',NEW.theme,'density',NEW.density,
    'createdAt',NEW.created_at,'updatedAt',NEW.updated_at)));
END;
CREATE TRIGGER trg_sync_dashboard_household_immutable BEFORE UPDATE OF household_id ON dashboard_preferences
WHEN NEW.household_id!=OLD.household_id BEGIN SELECT RAISE(ABORT,'dashboard preferences cannot move between households'); END;
CREATE TRIGGER trg_sync_capture_dashboard_delete AFTER DELETE ON dashboard_preferences
WHEN EXISTS(SELECT 1 FROM households h WHERE h.id=OLD.household_id) BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(OLD.household_id,'DASHBOARD_PREFERENCES',OLD.household_id,'DELETE',json(json_object(
    'recordKind','DASHBOARD_PREFERENCES','householdId',OLD.household_id)));
END;

CREATE TRIGGER trg_sync_capture_parser_insert AFTER INSERT ON delimited_parser_profiles BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'DELIMITED_PARSER_PROFILE',profile_id,'UPSERT',payload_json
  FROM sync_parser_profile_payloads WHERE profile_id=NEW.id;
END;
CREATE TRIGGER trg_sync_capture_parser_update AFTER UPDATE ON delimited_parser_profiles BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  SELECT household_id,'DELIMITED_PARSER_PROFILE',profile_id,'UPSERT',payload_json
  FROM sync_parser_profile_payloads WHERE profile_id=NEW.id;
END;
CREATE TRIGGER trg_sync_parser_household_immutable BEFORE UPDATE OF household_id ON delimited_parser_profiles
WHEN NEW.household_id!=OLD.household_id BEGIN SELECT RAISE(ABORT,'parser profile cannot move between households'); END;
CREATE TRIGGER trg_sync_parser_id_immutable BEFORE UPDATE OF id ON delimited_parser_profiles
WHEN NEW.id!=OLD.id BEGIN SELECT RAISE(ABORT,'parser profile id is immutable'); END;
CREATE TRIGGER trg_sync_capture_parser_delete AFTER DELETE ON delimited_parser_profiles
WHEN EXISTS(SELECT 1 FROM households h WHERE h.id=OLD.household_id) BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(OLD.household_id,'DELIMITED_PARSER_PROFILE',OLD.id,'DELETE',json(json_object(
    'recordKind','DELIMITED_PARSER_PROFILE','householdId',OLD.household_id,'id',OLD.id)));
END;

-- Core child tombstones must also stay out of the capture table while their
-- household is cascading away; the capture table itself is household-scoped.
DROP TRIGGER trg_sync_capture_account_delete;
CREATE TRIGGER trg_sync_capture_account_delete BEFORE DELETE ON accounts
WHEN EXISTS(SELECT 1 FROM households h WHERE h.id=OLD.household_id) BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(OLD.household_id,'ACCOUNT',OLD.id,'DELETE',json(json_object(
    'recordKind','ACCOUNT','householdId',OLD.household_id,'id',OLD.id)));
END;

DROP TRIGGER trg_sync_capture_transaction_delete;
CREATE TRIGGER trg_sync_capture_transaction_delete AFTER DELETE ON transactions
WHEN EXISTS(SELECT 1 FROM households h WHERE h.id=OLD.household_id) BEGIN
  INSERT INTO sync_local_change_capture(household_id,entity_kind,entity_id,operation,payload_json)
  VALUES(OLD.household_id,'TRANSACTION',OLD.id,'DELETE',json(json_object(
    'recordKind','TRANSACTION_AGGREGATE','householdId',OLD.household_id,'id',OLD.id)));
END;
