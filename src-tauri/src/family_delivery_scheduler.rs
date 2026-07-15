//! Opt-in inbound family-delivery discovery and bounded encrypted intake while
//! KakeFlow is open. Intake has separate consent and stages at most one item
//! for manual review; it never resolves conflicts or applies ledger changes.

use crate::{
    document_vault::DocumentVault,
    family_delivery_credentials::{FamilyDeliveryCredentialBinding, FamilyDeliveryCredentialStore},
    family_delivery_http::{
        ArtifactSchema, AudienceVisibility, EncryptionPublicIdentity, FamilyDeliveryHttpClient,
        FamilyDeliveryHttpError, FamilyDeliveryTransport, PublicationBatch, RemoteMembership,
        RemotePublication,
    },
    family_delivery_schedule,
    family_delivery_transport::{
        self, FamilyMembershipDto, RegisterFamilyInboundInput, RegisterRemoteStateInput,
        RemoteFamilyArtifactInput,
    },
    family_encrypted_envelope::FamilyEnvelopeMetadata,
    family_envelope_identity::FamilyEnvelopeIdentityState,
    persistence::{AppState, PersistenceError},
};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    sync::{Arc, Condvar, Mutex},
    thread::{self, JoinHandle},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

pub const EVENT_NAME: &str = "kakeflow://family-delivery-discovered";
const WORKER_INTERVAL: Duration = Duration::from_secs(15);

#[derive(Debug, Clone)]
pub struct FamilyDeliveryConnectionContext {
    pub household_id: String,
    pub endpoint: String,
    pub remote_principal_id: String,
    pub local_member_id: String,
    pub local_member_name: String,
    pub local_device_id: String,
    pub inbound_cursor: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FamilyDeliveryDiscoveryEvent {
    household_id: String,
    discovered_count: u64,
    result: String,
    intake_result: String,
    staged_count: u32,
}

#[derive(Default)]
struct StopSignal {
    stopped: Mutex<bool>,
    changed: Condvar,
}

impl StopSignal {
    fn is_stopped(&self) -> bool {
        self.stopped.lock().map_or(true, |stopped| *stopped)
    }

    fn wait(&self, duration: Duration) -> bool {
        let Ok(stopped) = self.stopped.lock() else {
            return true;
        };
        if *stopped {
            return true;
        }
        self.changed
            .wait_timeout(stopped, duration)
            .map_or(true, |(stopped, _)| *stopped)
    }

    fn stop(&self) {
        if let Ok(mut stopped) = self.stopped.lock() {
            *stopped = true;
            self.changed.notify_all();
        }
    }
}

/// Process-scoped supervisor. No daemon, login item, or tray process is
/// installed; dropping the Tauri application stops and joins the worker.
pub struct BackgroundFamilyDeliveryDiscovery {
    stop: Arc<StopSignal>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl BackgroundFamilyDeliveryDiscovery {
    pub fn start(app: AppHandle) -> Self {
        let stop = Arc::new(StopSignal::default());
        let worker_stop = Arc::clone(&stop);
        let worker = thread::Builder::new()
            .name("kakeflow-family-delivery-discovery".to_owned())
            .spawn(move || run_worker(app, worker_stop))
            .ok();
        Self {
            stop,
            worker: Mutex::new(worker),
        }
    }
}

impl Drop for BackgroundFamilyDeliveryDiscovery {
    fn drop(&mut self) {
        self.stop.stop();
        if let Ok(mut worker) = self.worker.lock() {
            if let Some(worker) = worker.take() {
                let _ = worker.join();
            }
        }
    }
}

fn run_worker(app: AppHandle, stop: Arc<StopSignal>) {
    while !stop.wait(WORKER_INTERVAL) {
        let state = app.state::<AppState>();
        let lease = state.with_connection(|connection| {
            family_delivery_schedule::claim_next_due(connection)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        });
        let Ok(Some(lease)) = lease else {
            continue;
        };
        let result = run_claimed_household_guarded(
            &state,
            &app.state::<FamilyDeliveryCredentialStore>(),
            &app.state::<FamilyEnvelopeIdentityState>(),
            &app.state::<DocumentVault>(),
            &lease.household_id,
            &lease.lease_token,
            || stop.is_stopped(),
        );
        finish_lease(
            &app,
            &state,
            &lease.household_id,
            &lease.lease_token,
            result,
        );
    }
}

fn finish_lease(
    app: &AppHandle,
    state: &AppState,
    household_id: &str,
    lease_token: &str,
    result: Result<u64, DiscoveryFailure>,
) {
    let completed = state.with_connection(|connection| {
        finish_claimed(connection, household_id, lease_token, result)
    });
    if let Ok(status) = completed {
        let _ = app.emit(
            EVENT_NAME,
            FamilyDeliveryDiscoveryEvent {
                household_id: household_id.to_owned(),
                discovered_count: status.last_discovered_count,
                result: status.last_result,
                intake_result: status.last_intake_result,
                staged_count: status.last_staged_count,
            },
        );
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiscoveryFailure {
    Terminal(&'static str),
    Retryable(&'static str),
    Cancelled,
}

pub fn load_connection_context(
    state: &AppState,
    household_id: &str,
) -> Result<FamilyDeliveryConnectionContext, PersistenceError> {
    state.with_connection(|connection| {
        connection
            .query_row(
                "SELECT f.household_id,f.endpoint,f.remote_principal_id,
                        f.local_member_id,f.local_member_name,c.device_id,f.inbound_cursor
                 FROM family_delivery_connections f
                 JOIN local_sync_contexts c USING(household_id)
                 WHERE f.household_id=?1 AND f.state!='DISCONNECTED'",
                [household_id],
                |row| {
                    let cursor = row.get::<_, i64>(6)?;
                    Ok(FamilyDeliveryConnectionContext {
                        household_id: row.get(0)?,
                        endpoint: row.get(1)?,
                        remote_principal_id: row.get(2)?,
                        local_member_id: row.get(3)?,
                        local_member_name: row.get(4)?,
                        local_device_id: row.get(5)?,
                        inbound_cursor: cursor.max(0) as u64,
                    })
                },
            )
            .optional()?
            .ok_or(PersistenceError::Database(
                rusqlite::Error::QueryReturnedNoRows,
            ))
    })
}

pub fn credential_binding(
    context: &FamilyDeliveryConnectionContext,
) -> Result<FamilyDeliveryCredentialBinding, DiscoveryFailure> {
    FamilyDeliveryCredentialBinding::new(
        context.household_id.clone(),
        &context.endpoint,
        context.remote_principal_id.clone(),
    )
    .map_err(|_| DiscoveryFailure::Retryable("INVALID_CONNECTION"))
}

pub fn run_claimed_household(
    state: &AppState,
    credentials: &FamilyDeliveryCredentialStore,
    identity: &FamilyEnvelopeIdentityState,
    vault: &DocumentVault,
    household_id: &str,
    lease_token: &str,
) -> Result<u64, DiscoveryFailure> {
    run_claimed_household_guarded(
        state,
        credentials,
        identity,
        vault,
        household_id,
        lease_token,
        || false,
    )
}

fn run_claimed_household_guarded(
    state: &AppState,
    credentials: &FamilyDeliveryCredentialStore,
    identity: &FamilyEnvelopeIdentityState,
    vault: &DocumentVault,
    household_id: &str,
    lease_token: &str,
    cancelled: impl Fn() -> bool,
) -> Result<u64, DiscoveryFailure> {
    guard_claim(state, household_id, lease_token, &cancelled)?;
    let context = load_connection_context(state, household_id)
        .map_err(|_| DiscoveryFailure::Retryable("CONNECTION_UNAVAILABLE"))?;
    let binding = credential_binding(&context)?;
    let credential = credentials
        .read(&binding)
        .map_err(|_| DiscoveryFailure::Terminal("MISSING_CREDENTIAL"))?
        .ok_or(DiscoveryFailure::Terminal("MISSING_CREDENTIAL"))?;
    let client = FamilyDeliveryHttpClient::production(&context.endpoint, credential.bearer_token())
        .map_err(map_http_error)?;
    discover_and_intake_claimed_with_client(
        state,
        identity,
        vault,
        &context,
        &client,
        lease_token,
        &cancelled,
    )
}

fn discover_and_intake_claimed_with_client<T: FamilyDeliveryTransport>(
    state: &AppState,
    identity: &FamilyEnvelopeIdentityState,
    vault: &DocumentVault,
    context: &FamilyDeliveryConnectionContext,
    client: &FamilyDeliveryHttpClient<T>,
    lease_token: &str,
    cancelled: &impl Fn() -> bool,
) -> Result<u64, DiscoveryFailure> {
    let local_membership_id = validate_and_refresh_claimed_with_client(
        state,
        identity,
        context,
        client,
        lease_token,
        cancelled,
    )?;
    guard_claim(state, &context.household_id, lease_token, cancelled)?;
    let batch = client
        .list_publications(
            &context.household_id,
            context.inbound_cursor,
            &context.local_device_id,
        )
        .map_err(map_http_error)?;
    guard_claim(state, &context.household_id, lease_token, cancelled)?;
    let count =
        register_publication_metadata_claimed(state, &context.household_id, lease_token, batch)?;
    intake_one_claimed(
        state,
        identity,
        vault,
        context,
        client,
        lease_token,
        &local_membership_id,
        cancelled,
    )?;
    Ok(count)
}

// The explicit dependencies make the lease fence, identity, vault, transport,
// and cancellation boundary visible at every call site.
#[allow(clippy::too_many_arguments)]
fn intake_one_claimed<T: FamilyDeliveryTransport>(
    state: &AppState,
    identity: &FamilyEnvelopeIdentityState,
    vault: &DocumentVault,
    context: &FamilyDeliveryConnectionContext,
    client: &FamilyDeliveryHttpClient<T>,
    lease_token: &str,
    local_membership_id: &str,
    cancelled: &impl Fn() -> bool,
) -> Result<(), DiscoveryFailure> {
    guard_claim(state, &context.household_id, lease_token, cancelled)?;
    let candidate = state
        .with_connection(|connection| {
            if !family_delivery_schedule::intake_enabled(
                connection,
                &context.household_id,
                lease_token,
            )
            .map_err(|_| rusqlite::Error::InvalidQuery)?
            {
                return Ok(None);
            }
            if family_delivery_transport::has_active_review(connection, &context.household_id)
                .map_err(|_| rusqlite::Error::InvalidQuery)?
            {
                family_delivery_schedule::record_intake_result(
                    connection,
                    &context.household_id,
                    lease_token,
                    "REVIEW_PENDING",
                    0,
                    None,
                )
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
                return Ok(None);
            }
            let candidate = family_delivery_transport::oldest_encrypted_available(
                connection,
                &context.household_id,
            )
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
            if candidate.is_none() {
                family_delivery_schedule::record_intake_result(
                    connection,
                    &context.household_id,
                    lease_token,
                    "NO_AVAILABLE",
                    0,
                    None,
                )
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            }
            Ok(candidate)
        })
        .map_err(|_| DiscoveryFailure::Cancelled)?;
    let Some(metadata) = candidate else {
        return Ok(());
    };

    guard_claim(state, &context.household_id, lease_token, cancelled)?;
    let envelope = match client.download_publication(
        &context.household_id,
        &metadata.artifact_id,
        metadata.byte_size,
        &metadata.transport_sha256,
    ) {
        Ok(bytes) => bytes,
        Err(FamilyDeliveryHttpError::InvalidArtifact) => {
            return reject_claimed(
                state,
                &context.household_id,
                lease_token,
                &metadata.artifact_id,
                "REJECTED_INVALID",
                "INVALID_ARTIFACT",
            );
        }
        Err(error) => return Err(map_http_error(error)),
    };
    guard_claim(state, &context.household_id, lease_token, cancelled)?;
    let opened = match identity.open(crate::family_envelope_identity::OpenFamilyEnvelopeInput {
        expected_metadata: FamilyEnvelopeMetadata {
            household_id: context.household_id.clone(),
            publication_id: metadata.artifact_id.clone(),
            origin_installation_id: metadata.origin_device_id.clone(),
            artifact_schema: metadata.artifact_schema.clone(),
            inner_sha256: metadata.inner_sha256.clone(),
        },
        envelope_bytes: envelope,
        local_membership_id: local_membership_id.to_owned(),
    }) {
        Ok(opened) => opened,
        Err(crate::family_envelope_identity::FamilyEnvelopeIdentityError::AudienceDenied) => {
            return reject_claimed(
                state,
                &context.household_id,
                lease_token,
                &metadata.artifact_id,
                "AUDIENCE_DENIED",
                "RECIPIENT_DENIED",
            );
        }
        Err(_) => {
            return reject_claimed(
                state,
                &context.household_id,
                lease_token,
                &metadata.artifact_id,
                "REJECTED_INVALID",
                "INVALID_ENVELOPE",
            );
        }
    };
    guard_claim(state, &context.household_id, lease_token, cancelled)?;
    state
        .with_connection(|connection| {
            let transaction = connection.unchecked_transaction()?;
            family_delivery_schedule::assert_active_lease(
                &transaction,
                &context.household_id,
                lease_token,
            )
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
            let stage = family_delivery_transport::StageFamilyInboundInput {
                household_id: context.household_id.clone(),
                artifact_id: metadata.artifact_id.clone(),
                package_bytes: opened.artifact_bytes,
            };
            let intake = match family_delivery_transport::stage_inbound_with_vault(
                &transaction,
                vault,
                &stage,
            ) {
                Ok(_) => ("STAGED_FOR_REVIEW", 1, None),
                Err(family_delivery_transport::FamilyDeliveryError::ReviewPending) => {
                    ("REVIEW_PENDING", 0, None)
                }
                Err(family_delivery_transport::FamilyDeliveryError::AudienceDenied) => {
                    family_delivery_transport::reject_inbound(
                        &transaction,
                        &context.household_id,
                        &metadata.artifact_id,
                        "AUDIENCE_DENIED",
                    )
                    .map_err(|_| rusqlite::Error::InvalidQuery)?;
                    ("AUDIENCE_DENIED", 0, Some("AUDIENCE_DENIED"))
                }
                Err(_) => {
                    family_delivery_transport::reject_inbound(
                        &transaction,
                        &context.household_id,
                        &metadata.artifact_id,
                        "REJECTED_INVALID",
                    )
                    .map_err(|_| rusqlite::Error::InvalidQuery)?;
                    ("REJECTED_INVALID", 0, Some("INVALID_PACKAGE"))
                }
            };
            family_delivery_schedule::record_intake_result(
                &transaction,
                &context.household_id,
                lease_token,
                intake.0,
                intake.1,
                intake.2,
            )
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
            transaction.commit()?;
            Ok(())
        })
        .map_err(|_| DiscoveryFailure::Cancelled)
}

fn reject_claimed(
    state: &AppState,
    household_id: &str,
    lease_token: &str,
    artifact_id: &str,
    inbound_state: &str,
    error_code: &'static str,
) -> Result<(), DiscoveryFailure> {
    state
        .with_connection(|connection| {
            let transaction = connection.unchecked_transaction()?;
            family_delivery_schedule::assert_active_lease(&transaction, household_id, lease_token)
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            family_delivery_transport::reject_inbound(
                &transaction,
                household_id,
                artifact_id,
                inbound_state,
            )
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
            family_delivery_schedule::record_intake_result(
                &transaction,
                household_id,
                lease_token,
                inbound_state,
                0,
                Some(error_code),
            )
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
            transaction.commit()?;
            Ok(())
        })
        .map_err(|_| DiscoveryFailure::Cancelled)
}

fn guard_claim(
    state: &AppState,
    household_id: &str,
    lease_token: &str,
    cancelled: &impl Fn() -> bool,
) -> Result<(), DiscoveryFailure> {
    if cancelled() {
        return Err(DiscoveryFailure::Cancelled);
    }
    state
        .with_connection(|connection| {
            family_delivery_schedule::heartbeat_lease(connection, household_id, lease_token)
                .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| DiscoveryFailure::Cancelled)
}

#[cfg(test)]
pub fn discover_with_client<T: FamilyDeliveryTransport>(
    state: &AppState,
    identity: &FamilyEnvelopeIdentityState,
    context: &FamilyDeliveryConnectionContext,
    client: &FamilyDeliveryHttpClient<T>,
) -> Result<u64, DiscoveryFailure> {
    validate_and_refresh_with_client(state, identity, context, client)?;
    let batch = client
        .list_publications(
            &context.household_id,
            context.inbound_cursor,
            &context.local_device_id,
        )
        .map_err(map_http_error)?;
    register_publication_metadata(state, &context.household_id, batch)
}

fn validate_and_refresh_claimed_with_client<T: FamilyDeliveryTransport>(
    state: &AppState,
    identity: &FamilyEnvelopeIdentityState,
    context: &FamilyDeliveryConnectionContext,
    client: &FamilyDeliveryHttpClient<T>,
    lease_token: &str,
    cancelled: &impl Fn() -> bool,
) -> Result<String, DiscoveryFailure> {
    guard_claim(state, &context.household_id, lease_token, cancelled)?;
    let remote_identity = client.whoami().map_err(map_http_error)?;
    guard_claim(state, &context.household_id, lease_token, cancelled)?;
    if remote_identity.remote_principal_id != context.remote_principal_id {
        return Err(DiscoveryFailure::Terminal("AUTH_EXPIRED"));
    }
    let local_membership = remote_identity
        .memberships
        .iter()
        .find(|membership| {
            membership.household_id == context.household_id
                && membership.domain_member_id == context.local_member_id
        })
        .ok_or(DiscoveryFailure::Terminal("MEMBERSHIP_REVOKED"))?;

    let public_identity = identity.public_identity();
    guard_claim(state, &context.household_id, lease_token, cancelled)?;
    client
        .ensure_local_encryption_key(
            &context.household_id,
            &EncryptionPublicIdentity {
                key_id: public_identity.key_id,
                public_key: public_identity.public_key,
                generation: u64::from(public_identity.generation),
            },
        )
        .map_err(map_http_error)?;
    guard_claim(state, &context.household_id, lease_token, cancelled)?;
    let remote_members = client
        .household_members(&context.household_id)
        .map_err(map_http_error)?;
    guard_claim(state, &context.household_id, lease_token, cancelled)?;
    let memberships = build_memberships(state, context, &remote_members)?;
    if !memberships.iter().any(|membership| {
        membership.member_id == context.local_member_id
            && membership.state == "ACTIVE"
            && membership
                .remote_membership_ids
                .contains(&local_membership.membership_id)
    }) {
        return Err(DiscoveryFailure::Terminal("MEMBERSHIP_REVOKED"));
    }
    state
        .with_connection(|connection| {
            family_delivery_schedule::assert_active_lease(
                connection,
                &context.household_id,
                lease_token,
            )
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
            family_delivery_transport::register_remote_state(
                connection,
                &RegisterRemoteStateInput {
                    household_id: context.household_id.clone(),
                    remote_principal_id: context.remote_principal_id.clone(),
                    local_member_id: Some(context.local_member_id.clone()),
                    local_member_name: Some(context.local_member_name.clone()),
                    memberships,
                },
            )
            .map(|_| ())
            .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| DiscoveryFailure::Cancelled)?;
    Ok(local_membership.membership_id.clone())
}

/// Validates an explicit opt-in token and refreshes non-secret membership/key
/// metadata without listing or registering any inbound publication.
pub fn validate_and_refresh_with_client<T: FamilyDeliveryTransport>(
    state: &AppState,
    identity: &FamilyEnvelopeIdentityState,
    context: &FamilyDeliveryConnectionContext,
    client: &FamilyDeliveryHttpClient<T>,
) -> Result<(), DiscoveryFailure> {
    let remote_identity = client.whoami().map_err(map_http_error)?;
    if remote_identity.remote_principal_id != context.remote_principal_id {
        return Err(DiscoveryFailure::Terminal("AUTH_EXPIRED"));
    }
    let local_membership = remote_identity
        .memberships
        .iter()
        .find(|membership| {
            membership.household_id == context.household_id
                && membership.domain_member_id == context.local_member_id
        })
        .ok_or(DiscoveryFailure::Terminal("MEMBERSHIP_REVOKED"))?;

    let public_identity = identity.public_identity();
    client
        .ensure_local_encryption_key(
            &context.household_id,
            &EncryptionPublicIdentity {
                key_id: public_identity.key_id,
                public_key: public_identity.public_key,
                generation: u64::from(public_identity.generation),
            },
        )
        .map_err(map_http_error)?;
    let remote_members = client
        .household_members(&context.household_id)
        .map_err(map_http_error)?;
    let memberships = build_memberships(state, context, &remote_members)?;
    if !memberships.iter().any(|membership| {
        membership.member_id == context.local_member_id
            && membership.state == "ACTIVE"
            && membership
                .remote_membership_ids
                .contains(&local_membership.membership_id)
    }) {
        return Err(DiscoveryFailure::Terminal("MEMBERSHIP_REVOKED"));
    }
    state
        .with_connection(|connection| {
            family_delivery_transport::register_remote_state(
                connection,
                &RegisterRemoteStateInput {
                    household_id: context.household_id.clone(),
                    remote_principal_id: context.remote_principal_id.clone(),
                    local_member_id: Some(context.local_member_id.clone()),
                    local_member_name: Some(context.local_member_name.clone()),
                    memberships,
                },
            )
            .map(|_| ())
            .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| DiscoveryFailure::Retryable("LOCAL_STATE_CONFLICT"))?;

    Ok(())
}

fn build_memberships(
    state: &AppState,
    context: &FamilyDeliveryConnectionContext,
    remote: &[RemoteMembership],
) -> Result<Vec<FamilyMembershipDto>, DiscoveryFailure> {
    state
        .with_connection(|connection| {
            let mut current = BTreeMap::new();
            let mut statement = connection.prepare(
                "SELECT member_id,state,invite_id,invite_expires_at,last_delivery_at
                 FROM family_delivery_memberships WHERE household_id=?1",
            )?;
            for row in statement.query_map([&context.household_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            })? {
                let (id, state, invite, expiry, delivery) = row?;
                current.insert(id, (state, invite, expiry, delivery));
            }

            let mut local = connection.prepare(
                "SELECT id,display_name,status FROM household_members
                 WHERE household_id=?1 ORDER BY sort_order,id",
            )?;
            let rows = local
                .query_map([&context.household_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let memberships = rows
                .into_iter()
                .map(|(member_id, member_name, local_state)| {
                    let active_remote = remote
                        .iter()
                        .filter(|item| {
                            item.domain_member_id == member_id
                                && item.state
                                    == crate::family_delivery_http::MembershipState::Active
                        })
                        .map(|item| item.membership_id.clone())
                        .collect::<Vec<_>>();
                    let previous = current.get(&member_id);
                    let (state, invite_id, invite_expires_at) = if local_state == "ARCHIVED" {
                        ("ARCHIVED_BLOCKED".to_owned(), None, None)
                    } else if !active_remote.is_empty() {
                        ("ACTIVE".to_owned(), None, None)
                    } else if previous.is_some_and(|value| value.0 == "INVITED") {
                        (
                            "INVITED".to_owned(),
                            previous.and_then(|value| value.1.clone()),
                            previous.and_then(|value| value.2.clone()),
                        )
                    } else if remote.iter().any(|item| item.domain_member_id == member_id) {
                        ("REVOKED".to_owned(), None, None)
                    } else {
                        ("UNLINKED".to_owned(), None, None)
                    };
                    FamilyMembershipDto {
                        member_id: member_id.clone(),
                        member_name,
                        state,
                        device_count: active_remote.len() as u64,
                        remote_membership_ids: remote
                            .iter()
                            .filter(|item| item.domain_member_id == member_id)
                            .map(|item| item.membership_id.clone())
                            .collect(),
                        invite_id,
                        invite_expires_at,
                        last_delivery_at: previous.and_then(|value| value.3.clone()),
                    }
                })
                .collect();
            Ok(memberships)
        })
        .map_err(|_| DiscoveryFailure::Retryable("LOCAL_STATE_UNAVAILABLE"))
}

#[cfg(test)]
fn register_publication_metadata(
    state: &AppState,
    household_id: &str,
    batch: PublicationBatch,
) -> Result<u64, DiscoveryFailure> {
    let count = batch.publications.len() as u64;
    let artifacts = batch
        .publications
        .into_iter()
        .map(convert_publication)
        .collect();
    state
        .with_connection(|connection| {
            family_delivery_transport::register_inbound(
                connection,
                &RegisterFamilyInboundInput {
                    household_id: household_id.to_owned(),
                    artifacts,
                    next_cursor: batch.next_cursor,
                },
            )
            .map(|_| ())
            .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| DiscoveryFailure::Retryable("LOCAL_STATE_CONFLICT"))?;
    Ok(count)
}

fn register_publication_metadata_claimed(
    state: &AppState,
    household_id: &str,
    lease_token: &str,
    batch: PublicationBatch,
) -> Result<u64, DiscoveryFailure> {
    let count = batch.publications.len() as u64;
    let artifacts = batch
        .publications
        .into_iter()
        .map(convert_publication)
        .collect();
    state
        .with_connection(|connection| {
            family_delivery_schedule::assert_active_lease(connection, household_id, lease_token)
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            family_delivery_transport::register_inbound(
                connection,
                &RegisterFamilyInboundInput {
                    household_id: household_id.to_owned(),
                    artifacts,
                    next_cursor: batch.next_cursor,
                },
            )
            .map(|_| ())
            .map_err(|_| rusqlite::Error::InvalidQuery.into())
        })
        .map_err(|_| DiscoveryFailure::Cancelled)?;
    Ok(count)
}

fn convert_publication(publication: RemotePublication) -> RemoteFamilyArtifactInput {
    RemoteFamilyArtifactInput {
        sequence: publication.sequence,
        artifact_id: publication.publication_id,
        digest: publication.digest.clone(),
        created_at: publication.created_at,
        origin_device_id: publication.origin_device_id,
        sender_membership_id: publication.sender_membership_id,
        audience_visibility: match publication.audience.visibility {
            AudienceVisibility::Shared => "SHARED",
            AudienceVisibility::Personal => "PERSONAL",
        }
        .to_owned(),
        audience_member_id: publication.audience.member_id,
        byte_size: publication.byte_size,
        artifact_schema: match publication.artifact_schema {
            ArtifactSchema::FamilyAudiencePartitionV1 => "FAMILY_AUDIENCE_PARTITION_V1",
            ArtifactSchema::FamilyAudiencePartitionV2 => "FAMILY_AUDIENCE_PARTITION_V2",
            ArtifactSchema::FamilyAudiencePartitionV3 => "FAMILY_AUDIENCE_PARTITION_V3",
            ArtifactSchema::FamilyAudiencePartitionV4 => "FAMILY_AUDIENCE_PARTITION_V4",
        }
        .to_owned(),
        envelope_schema: publication.envelope_schema,
        transport_digest: publication
            .recipient_set_digest
            .as_ref()
            .map(|_| publication.digest),
        inner_digest: publication.inner_digest,
        recipient_set_digest: publication.recipient_set_digest,
    }
}

fn map_http_error(error: FamilyDeliveryHttpError) -> DiscoveryFailure {
    match error {
        FamilyDeliveryHttpError::Authentication => DiscoveryFailure::Terminal("AUTH_EXPIRED"),
        FamilyDeliveryHttpError::MembershipRevoked => {
            DiscoveryFailure::Terminal("MEMBERSHIP_REVOKED")
        }
        FamilyDeliveryHttpError::Network => DiscoveryFailure::Retryable("NETWORK_UNAVAILABLE"),
        FamilyDeliveryHttpError::InvalidResponse => DiscoveryFailure::Retryable("INVALID_RESPONSE"),
        FamilyDeliveryHttpError::InvalidArtifact => DiscoveryFailure::Retryable("INVALID_ARTIFACT"),
    }
}

fn set_connection_state_claimed(
    connection: &rusqlite::Connection,
    household_id: &str,
    lease_token: &str,
    state: &str,
) -> Result<(), rusqlite::Error> {
    let state = match state {
        "AUTH_EXPIRED" => "AUTH_EXPIRED",
        "MEMBERSHIP_REVOKED" => "MEMBERSHIP_REVOKED",
        "NETWORK_UNAVAILABLE" => "NETWORK_UNAVAILABLE",
        "MISSING_CREDENTIAL" => "AUTH_EXPIRED",
        _ => return Err(rusqlite::Error::InvalidQuery),
    };
    connection.execute(
        "UPDATE family_delivery_connections SET
             state=?1,last_checked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE household_id=?2 AND EXISTS(
             SELECT 1 FROM family_delivery_schedules
             WHERE household_id=?2 AND enabled=1 AND lease_token=?3
               AND lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        params![state, household_id, lease_token],
    )?;
    Ok(())
}

pub fn process_claimed_now(
    state: &AppState,
    credentials: &FamilyDeliveryCredentialStore,
    identity: &FamilyEnvelopeIdentityState,
    vault: &DocumentVault,
    household_id: &str,
    lease_token: &str,
) -> Result<family_delivery_schedule::FamilyDeliveryScheduleStatusDto, String> {
    let result = run_claimed_household(
        state,
        credentials,
        identity,
        vault,
        household_id,
        lease_token,
    );
    state
        .with_connection(|connection| finish_claimed(connection, household_id, lease_token, result))
        .map_err(|_| "Automatic family delivery check could not be completed".to_owned())
}

fn finish_claimed(
    connection: &rusqlite::Connection,
    household_id: &str,
    lease_token: &str,
    result: Result<u64, DiscoveryFailure>,
) -> Result<family_delivery_schedule::FamilyDeliveryScheduleStatusDto, PersistenceError> {
    let transaction = connection.unchecked_transaction()?;
    let status = match result {
        Ok(count) => {
            family_delivery_schedule::complete(&transaction, household_id, lease_token, count)
        }
        Err(DiscoveryFailure::Terminal(reason)) => {
            set_connection_state_claimed(&transaction, household_id, lease_token, reason)?;
            family_delivery_schedule::suspend_terminal_claimed(
                &transaction,
                household_id,
                lease_token,
                reason,
            )
        }
        Err(DiscoveryFailure::Retryable(code)) => {
            if code == "NETWORK_UNAVAILABLE" {
                set_connection_state_claimed(&transaction, household_id, lease_token, code)?;
            }
            family_delivery_schedule::fail_claimed_in_transaction(
                &transaction,
                household_id,
                lease_token,
                code,
            )
        }
        Err(DiscoveryFailure::Cancelled) => {
            family_delivery_schedule::release_claim(&transaction, household_id, lease_token)
        }
    }
    .map_err(|_| rusqlite::Error::InvalidQuery)?;
    transaction.commit()?;
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        family_delivery_http::{HttpRequest, HttpResponse, PublicationAudience, RemotePublication},
        read_model::{
            create_household, create_household_member, CreateHouseholdInput,
            CreateHouseholdMemberInput,
        },
        sync_foundation,
    };
    use std::{
        collections::VecDeque,
        sync::{Arc, Mutex},
    };

    #[derive(Debug)]
    struct FakeTransport {
        responses: Mutex<VecDeque<Result<HttpResponse, FamilyDeliveryHttpError>>>,
        requested_urls: Arc<Mutex<Vec<String>>>,
    }

    impl FakeTransport {
        fn new(responses: Vec<HttpResponse>, requested_urls: Arc<Mutex<Vec<String>>>) -> Self {
            Self {
                responses: Mutex::new(responses.into_iter().map(Ok).collect()),
                requested_urls,
            }
        }
    }

    impl FamilyDeliveryTransport for FakeTransport {
        fn execute(
            &self,
            request: HttpRequest<'_>,
        ) -> Result<HttpResponse, FamilyDeliveryHttpError> {
            assert_eq!(request.bearer_token, "test-token");
            self.requested_urls.lock().unwrap().push(request.url);
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .expect("unexpected relay request")
        }
    }

    fn response(value: serde_json::Value) -> HttpResponse {
        HttpResponse {
            status: 200,
            body: serde_json::to_vec(&value).unwrap(),
        }
    }

    fn remote_membership(
        membership_id: &str,
        principal_id: &str,
        member_id: &str,
        key: Option<&crate::family_envelope_identity::FamilyEnvelopePublicIdentityDto>,
    ) -> serde_json::Value {
        serde_json::json!({
            "membershipId": membership_id,
            "householdId": "family",
            "principalId": principal_id,
            "domainMemberId": member_id,
            "role": if member_id == "member-a" { "OWNER" } else { "MEMBER" },
            "state": "ACTIVE",
            "generation": 1,
            "encryptionKeyId": key.map(|value| value.key_id.clone()),
            "encryptionPublicKey": key.map(|value| value.public_key.clone()),
            "encryptionKeyGeneration": key.map_or(0, |value| value.generation),
            "encryptionKeyUpdatedAt": key.map(|_| "2026-07-14T01:00:00.000Z"),
            "joinedAt": "2026-07-14T00:00:00.000Z",
            "revokedAt": null
        })
    }

    fn setup_discovery_state() -> (AppState, FamilyEnvelopeIdentityState) {
        let state = AppState::in_memory(&[42; 32]).unwrap();
        state
            .with_connection(|connection| {
                create_household(
                    connection,
                    &CreateHouseholdInput {
                        id: "family".into(),
                        name: "Family".into(),
                    },
                )
                .unwrap();
                for (id, name) in [("member-a", "A"), ("member-b", "B")] {
                    create_household_member(
                        connection,
                        &CreateHouseholdMemberInput {
                            id: id.into(),
                            household_id: "family".into(),
                            display_name: name.into(),
                            relationship_label: None,
                        },
                    )
                    .unwrap();
                }
                let principal = sync_foundation::get_local_status(connection, "family")
                    .unwrap()
                    .principal
                    .id;
                sync_foundation::update_principal_member_binding(
                    connection,
                    &sync_foundation::UpdatePrincipalMemberBindingInput {
                        household_id: "family".into(),
                        principal_id: principal,
                        member_id: Some("member-a".into()),
                        mutation_id: "bind-local-member".into(),
                    },
                )
                .unwrap();
                family_delivery_transport::save_connection(
                    connection,
                    &family_delivery_transport::SaveFamilyConnectionInput {
                        household_id: "family".into(),
                        endpoint: "https://relay.example".into(),
                        remote_principal_id: "principal-a".into(),
                        local_member_id: Some("member-a".into()),
                        local_member_name: Some("A".into()),
                        memberships: vec![
                            FamilyMembershipDto {
                                member_id: "member-a".into(),
                                member_name: "A".into(),
                                state: "ACTIVE".into(),
                                remote_membership_ids: vec!["membership-1".into()],
                                invite_id: None,
                                invite_expires_at: None,
                                device_count: 1,
                                last_delivery_at: None,
                            },
                            FamilyMembershipDto {
                                member_id: "member-b".into(),
                                member_name: "B".into(),
                                state: "ACTIVE".into(),
                                remote_membership_ids: vec!["membership-2".into()],
                                invite_id: None,
                                invite_expires_at: None,
                                device_count: 1,
                                last_delivery_at: None,
                            },
                        ],
                    },
                )
                .unwrap();
                connection.execute(
                    "UPDATE family_delivery_connections SET state='NETWORK_UNAVAILABLE' WHERE household_id='family'",
                    [],
                )?;
                Ok(())
            })
            .unwrap();
        (
            state,
            FamilyEnvelopeIdentityState::from_private_key([7; 32]).unwrap(),
        )
    }

    fn database_boundary_counts(state: &AppState) -> Vec<i64> {
        state
            .with_connection(|connection| {
                [
                    "transactions",
                    "journal_entries",
                    "source_documents",
                    "import_runs",
                    "family_snapshot_sets",
                    "family_snapshot_records",
                ]
                .iter()
                .map(|table| {
                    connection.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                        row.get(0)
                    })
                })
                .collect::<Result<Vec<_>, _>>()
                .map_err(Into::into)
            })
            .unwrap()
    }

    fn client_for_page(
        identity: &FamilyEnvelopeIdentityState,
        publications: Vec<serde_json::Value>,
        next_cursor: u64,
    ) -> (
        FamilyDeliveryHttpClient<FakeTransport>,
        Arc<Mutex<Vec<String>>>,
    ) {
        let public_identity = identity.public_identity();
        let local = remote_membership(
            "membership-1",
            "principal-a",
            "member-a",
            Some(&public_identity),
        );
        let sender = remote_membership("membership-2", "principal-b", "member-b", None);
        let requested_urls = Arc::new(Mutex::new(Vec::new()));
        let client = FamilyDeliveryHttpClient::new(
            "https://relay.example",
            "test-token",
            FakeTransport::new(
                vec![
                    response(serde_json::json!({
                        "remotePrincipalId": "principal-a",
                        "memberships": [local.clone()]
                    })),
                    response(serde_json::json!({
                        "remotePrincipalId": "principal-a",
                        "memberships": [local.clone()]
                    })),
                    response(serde_json::json!({ "members": [local, sender] })),
                    response(serde_json::json!({
                        "publications": publications,
                        "nextCursor": next_cursor.to_string()
                    })),
                    response(serde_json::json!({
                        "publications": [],
                        "nextCursor": next_cursor.to_string()
                    })),
                ],
                Arc::clone(&requested_urls),
            ),
        )
        .unwrap();
        (client, requested_urls)
    }

    #[test]
    fn encrypted_publication_converts_to_available_metadata_without_payload() {
        let transport_digest = "a".repeat(64);
        let inner_digest = "b".repeat(64);
        let recipient_digest = "c".repeat(64);
        let converted = convert_publication(RemotePublication {
            sequence: 7,
            publication_id: "publication-7".to_owned(),
            digest: transport_digest.clone(),
            household_id: "household".to_owned(),
            origin_device_id: "remote-device".to_owned(),
            audience: PublicationAudience {
                visibility: AudienceVisibility::Personal,
                member_id: Some("member-local".to_owned()),
            },
            artifact_schema: ArtifactSchema::FamilyAudiencePartitionV3,
            envelope_schema: Some("FAMILY_ENCRYPTED_ENVELOPE_V1".to_owned()),
            recipient_set_digest: Some(recipient_digest.clone()),
            inner_digest: Some(inner_digest.clone()),
            sender_principal_id: "principal-remote".to_owned(),
            sender_membership_id: "membership-2".to_owned(),
            recipient_count: 1,
            byte_size: 512,
            created_at: "2026-07-14T00:00:00.000Z".to_owned(),
        });
        assert_eq!(converted.digest, transport_digest);
        assert_eq!(
            converted.transport_digest.as_deref(),
            Some(converted.digest.as_str())
        );
        assert_eq!(
            converted.inner_digest.as_deref(),
            Some(inner_digest.as_str())
        );
        assert_eq!(
            converted.recipient_set_digest.as_deref(),
            Some(recipient_digest.as_str())
        );
        assert_eq!(converted.audience_visibility, "PERSONAL");
        assert_eq!(
            converted.audience_member_id.as_deref(),
            Some("member-local")
        );
        assert_eq!(converted.artifact_schema, "FAMILY_AUDIENCE_PARTITION_V3");
    }

    #[test]
    fn intake_is_separate_opt_in_and_skips_legacy_plaintext_without_downloading() {
        let (state, identity) = setup_discovery_state();
        let context = load_connection_context(&state, "family").unwrap();
        state
            .with_connection(|connection| {
                family_delivery_transport::register_inbound(
                    connection,
                    &RegisterFamilyInboundInput {
                        household_id: "family".into(),
                        artifacts: vec![RemoteFamilyArtifactInput {
                            sequence: 1,
                            artifact_id: "legacy-plaintext".into(),
                            digest: "a".repeat(64),
                            created_at: "2026-07-14T00:00:00.000Z".into(),
                            origin_device_id: "remote-device".into(),
                            sender_membership_id: "membership-2".into(),
                            audience_visibility: "SHARED".into(),
                            audience_member_id: None,
                            byte_size: 10,
                            artifact_schema: "FAMILY_AUDIENCE_PARTITION_V3".into(),
                            envelope_schema: None,
                            transport_digest: None,
                            inner_digest: None,
                            recipient_set_digest: None,
                        }],
                        next_cursor: 1,
                    },
                )
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
                family_delivery_schedule::configure_with_intake(
                    connection, "family", true, 15, true,
                )
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
                Ok(())
            })
            .unwrap();
        let lease = state
            .with_connection(|connection| {
                family_delivery_schedule::claim_due(connection, "family")
                    .map_err(|_| rusqlite::Error::InvalidQuery.into())
            })
            .unwrap()
            .unwrap();
        let requested_urls = Arc::new(Mutex::new(Vec::new()));
        let client = FamilyDeliveryHttpClient::new(
            "https://relay.example",
            "test-token",
            FakeTransport::new(Vec::new(), Arc::clone(&requested_urls)),
        )
        .unwrap();
        let root = tempfile::tempdir().unwrap();
        let vault = DocumentVault::new(root.path(), &[13; 32]).unwrap();
        intake_one_claimed(
            &state,
            &identity,
            &vault,
            &context,
            &client,
            &lease.lease_token,
            "membership-1",
            &|| false,
        )
        .unwrap();
        assert!(requested_urls.lock().unwrap().is_empty());
        let status = state
            .with_connection(|connection| {
                family_delivery_schedule::status(connection, "family")
                    .map_err(|_| rusqlite::Error::InvalidQuery.into())
            })
            .unwrap();
        assert_eq!(status.last_intake_result, "NO_AVAILABLE");
    }

    #[test]
    fn http_failures_have_explicit_retry_or_terminal_policy() {
        assert_eq!(
            map_http_error(FamilyDeliveryHttpError::Authentication),
            DiscoveryFailure::Terminal("AUTH_EXPIRED")
        );
        assert_eq!(
            map_http_error(FamilyDeliveryHttpError::MembershipRevoked),
            DiscoveryFailure::Terminal("MEMBERSHIP_REVOKED")
        );
        assert_eq!(
            map_http_error(FamilyDeliveryHttpError::Network),
            DiscoveryFailure::Retryable("NETWORK_UNAVAILABLE")
        );
        assert_eq!(
            map_http_error(FamilyDeliveryHttpError::InvalidResponse),
            DiscoveryFailure::Retryable("INVALID_RESPONSE")
        );
    }

    #[test]
    fn cancellation_is_observed_before_the_next_relay_request() {
        let (state, identity) = setup_discovery_state();
        let context = load_connection_context(&state, "family").unwrap();
        let lease = state
            .with_connection(|connection| {
                family_delivery_schedule::configure(connection, "family", true, 15)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?;
                family_delivery_schedule::claim_due(connection, "family")
                    .map_err(|_| rusqlite::Error::InvalidQuery.into())
            })
            .unwrap()
            .unwrap();
        let (client, requested_urls) = client_for_page(&identity, Vec::new(), 0);
        assert_eq!(
            validate_and_refresh_claimed_with_client(
                &state,
                &identity,
                &context,
                &client,
                &lease.lease_token,
                &|| true,
            ),
            Err(DiscoveryFailure::Cancelled)
        );
        assert!(requested_urls.lock().unwrap().is_empty());
    }

    #[test]
    fn stale_generation_cannot_register_inbound_metadata() {
        let (state, _) = setup_discovery_state();
        let stale = state
            .with_connection(|connection| {
                family_delivery_schedule::configure(connection, "family", true, 15)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?;
                family_delivery_schedule::claim_due(connection, "family")
                    .map_err(|_| rusqlite::Error::InvalidQuery.into())
            })
            .unwrap()
            .unwrap();
        state
            .with_connection(|connection| {
                family_delivery_schedule::disable(connection, "family")
                    .map_err(|_| rusqlite::Error::InvalidQuery)?;
                family_delivery_schedule::configure(connection, "family", true, 15)
                    .map(|_| ())
                    .map_err(|_| rusqlite::Error::InvalidQuery.into())
            })
            .unwrap();
        let batch = PublicationBatch {
            publications: vec![RemotePublication {
                sequence: 1,
                publication_id: "stale-publication".into(),
                digest: "a".repeat(64),
                household_id: "family".into(),
                origin_device_id: "remote-device".into(),
                audience: PublicationAudience {
                    visibility: AudienceVisibility::Shared,
                    member_id: None,
                },
                artifact_schema: ArtifactSchema::FamilyAudiencePartitionV3,
                envelope_schema: Some("FAMILY_ENCRYPTED_ENVELOPE_V1".into()),
                recipient_set_digest: Some("b".repeat(64)),
                inner_digest: Some("c".repeat(64)),
                sender_principal_id: "principal-b".into(),
                sender_membership_id: "membership-b".into(),
                recipient_count: 1,
                byte_size: 10,
                created_at: "2026-07-14T00:00:00.000Z".into(),
            }],
            next_cursor: 1,
        };
        assert_eq!(
            register_publication_metadata_claimed(&state, "family", &stale.lease_token, batch,),
            Err(DiscoveryFailure::Cancelled)
        );
        state
            .with_connection(|connection| {
                let count: u64 = connection.query_row(
                    "SELECT count(*) FROM family_delivery_inbound
                     WHERE artifact_id='stale-publication'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(count, 0);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn full_poll_recovers_network_state_and_only_registers_idempotent_available_metadata() {
        let (state, identity) = setup_discovery_state();
        let context = load_connection_context(&state, "family").unwrap();
        let before = database_boundary_counts(&state);
        let publication = serde_json::json!({
            "sequence": 7,
            "publicationId": "publication-7",
            "digest": "a".repeat(64),
            "householdId": "family",
            "originDeviceId": "remote-device",
            "audience": { "visibility": "SHARED", "memberId": null },
            "artifactSchema": "FAMILY_AUDIENCE_PARTITION_V3",
            "envelopeSchema": "FAMILY_ENCRYPTED_ENVELOPE_V1",
            "recipientSetDigest": "b".repeat(64),
            "innerDigest": "c".repeat(64),
            "senderPrincipalId": "principal-b",
            "senderMembershipId": "membership-2",
            "recipientCount": 1,
            "byteSize": 512,
            "createdAt": "2026-07-14T02:00:00.000Z"
        });
        let (first, first_requested_urls) = client_for_page(&identity, vec![publication], 7);

        let first_result = discover_with_client(&state, &identity, &context, &first);
        assert_eq!(
            first_result,
            Ok(1),
            "relay requests: {:?}",
            first_requested_urls.lock().unwrap()
        );
        let first_requests = first_requested_urls.lock().unwrap();
        assert!(first_requests
            .iter()
            .any(|url| url.contains("after=0&excludeOriginDeviceId=")
                && url.ends_with(&context.local_device_id)));
        assert!(first_requests.last().unwrap().contains("after=7&"));
        drop(first_requests);

        state
            .with_connection(|connection| {
                let connection_state: String = connection.query_row(
                    "SELECT state FROM family_delivery_connections WHERE household_id='family'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(connection_state, "CONNECTED");
                let inbound: (i64, String, i64, i64, String, Option<String>) = connection.query_row(
                    "SELECT sequence,state,pending_package_bytes IS NULL,
                            staged_snapshot_set_id IS NULL,package_sha256,transport_sha256
                     FROM family_delivery_inbound WHERE artifact_id='publication-7'",
                    [],
                    |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?)),
                )?;
                assert_eq!(
                    inbound,
                    (
                        7,
                        "AVAILABLE".into(),
                        1,
                        1,
                        "c".repeat(64),
                        Some("a".repeat(64))
                    )
                );
                let cursor: i64 = connection.query_row(
                    "SELECT inbound_cursor FROM family_delivery_connections WHERE household_id='family'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(cursor, 7);
                Ok(())
            })
            .unwrap();
        assert_eq!(database_boundary_counts(&state), before);

        let refreshed = load_connection_context(&state, "family").unwrap();
        let (empty, empty_requested_urls) = client_for_page(&identity, Vec::new(), 7);
        assert_eq!(
            discover_with_client(&state, &identity, &refreshed, &empty),
            Ok(0)
        );
        assert!(empty_requested_urls
            .lock()
            .unwrap()
            .last()
            .unwrap()
            .contains("after=7&excludeOriginDeviceId="));
        state
            .with_connection(|connection| {
                let inbound_count: i64 = connection.query_row(
                    "SELECT count(*) FROM family_delivery_inbound",
                    [],
                    |row| row.get(0),
                )?;
                let state: String = connection.query_row(
                    "SELECT state FROM family_delivery_inbound WHERE artifact_id='publication-7'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(inbound_count, 1);
                assert_eq!(state, "AVAILABLE");
                Ok(())
            })
            .unwrap();
        assert_eq!(database_boundary_counts(&state), before);
    }
}
