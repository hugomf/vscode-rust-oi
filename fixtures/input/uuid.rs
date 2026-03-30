//! Audit API handlers
//!
//! This module provides API endpoints for querying audit events.

use std::sync::Arc;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use wf_core::{AuditEvent, AuditAction};
use wf_db::repo::AuditRepository;

/// Query parameters for audit listing
#[derive(Debug, Deserialize)]
pub struct AuditQuery {
    #[serde(default)]
    pub actor: Option<String>,
    #[serde(default)]
    pub from_date: Option<String>,
    #[serde(default)]
    pub to_date: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub offset: Option<usize>,
}

/// Audit event response
#[derive(Debug, Serialize)]
pub struct AuditEventResponse {
    pub id: Uuid,
    pub instance_id: String,
    pub tenant_id: String,
    pub actor: String,
    pub action: String,
    pub node_id: Option<String>,
    pub previous_node: Option<String>,
    pub new_node: Option<String>,
    pub payload: Option<serde_json::Value>,
    pub timestamp: String,
}

impl From<AuditEvent> for AuditEventResponse {
    fn from(event: AuditEvent) -> Self {
        Self {
            id: event.id,
            instance_id: event.instance_id.0.to_string(),
            tenant_id: event.tenant_id.0.clone(),
            actor: event.actor.0.clone(),
            action: format!("{:?}", event.action),
            node_id: event.node_id,
            previous_node: event.previous_node,
            new_node: event.new_node,
            payload: event.payload,
            timestamp: event.timestamp.to_rfc3339(),
        }
    }
}

/// Convert database AuditEvent to core AuditEvent
fn db_to_core(db_event: wf_db::repo::AuditEvent) -> AuditEvent {
    let action = match db_event.action.as_str() {
        "case_created" => AuditAction::CaseCreated,
        "case_status_changed" => AuditAction::CaseStatusChanged,
        "activity_started" => AuditAction::ActivityStarted,
        "activity_completed" => AuditAction::ActivityCompleted,
        "activity_failed" => AuditAction::ActivityFailed,
        "worklist_item_created" => AuditAction::WorklistItemCreated,
        "worklist_item_claimed" => AuditAction::WorklistItemClaimed,
        "worklist_item_completed" => AuditAction::WorklistItemCompleted,
        "worklist_item_reassigned" => AuditAction::WorklistItemReassigned,
        "transition_fired" => AuditAction::TransitionFired,
        "saga_step_recorded" => AuditAction::SagaStepRecorded,
        "saga_compensated" => AuditAction::SagaCompensated,
        "sla_breached" => AuditAction::SlaBreached,
        "escalation_triggered" => AuditAction::EscalationTriggered,
        _ => AuditAction::Custom {
            action: db_event.action.clone(),
        },
    };

    AuditEvent {
        id: db_event.id,
        instance_id: wf_core::CaseId(db_event.instance_id),
        tenant_id: wf_core::TenantId(db_event.tenant_id.to_string()),
        actor: wf_core::UserId(db_event.actor.to_string()),
        action,
        node_id: db_event.node_id,
        previous_node: db_event.previous_node,
        new_node: db_event.new_node,
        payload: db_event.payload,
        timestamp: db_event.timestamp,
    }
}

/// Convert core AuditEvent to database AuditEvent
fn core_to_db(core_event: AuditEvent) -> wf_db::repo::AuditEvent {
    let action_str = match &core_event.action {
        AuditAction::CaseCreated => "case_created",
        AuditAction::CaseStatusChanged => "case_status_changed",
        AuditAction::ActivityStarted => "activity_started",
        AuditAction::ActivityCompleted => "activity_completed",
        AuditAction::ActivityFailed => "activity_failed",
        AuditAction::WorklistItemCreated => "worklist_item_created",
        AuditAction::WorklistItemClaimed => "worklist_item_claimed",
        AuditAction::WorklistItemCompleted => "worklist_item_completed",
        AuditAction::WorklistItemReassigned => "worklist_item_reassigned",
        AuditAction::TransitionFired => "transition_fired",
        AuditAction::SagaStepRecorded => "saga_step_recorded",
        AuditAction::SagaCompensated => "saga_compensated",
        AuditAction::SlaBreached => "sla_breached",
        AuditAction::EscalationTriggered => "escalation_triggered",
        AuditAction::Custom { action } => action.as_str(),
    };

    wf_db::repo::AuditEvent {
        id: core_event.id,
        instance_id: core_event.instance_id.0,
        tenant_id: Uuid::parse_str(&core_event.tenant_id.0)
            .unwrap_or_else(|_| Uuid::new_v4()),
        actor: Uuid::parse_str(&core_event.actor.0)
            .unwrap_or_else(|_| Uuid::new_v4()),
        action: action_str.to_string(),
        node_id: core_event.node_id,
        previous_node: core_event.previous_node,
        new_node: core_event.new_node,
        payload: core_event.payload,
        timestamp: core_event.timestamp,
    }
}

/// Paginated audit events response
#[derive(Debug, Serialize)]
pub struct AuditListResponse {
    pub items: Vec<AuditEventResponse>,
    pub total: usize,
    pub limit: usize,
    pub offset: usize,
}

/// Audit API router
pub fn router(state: Arc<AppState>) -> axum::Router {
    axum::Router::new()
        .route("/audit", axum::routing::get(list_audit_events))
        .route("/audit/:instance_id", axum::routing::get(get_instance_audit))
        .with_state(state)
}

/// List audit events
///
/// GET /api/audit
pub async fn list_audit_events(
    State(state): State<Arc<AppState>>,
    Query(query): Query<AuditQuery>,
) -> impl IntoResponse {
    let audit_repo = state.audit.clone();

    // Build audit filter
    let from_time = query.from_date.and_then(|s| s.parse::<chrono::DateTime<chrono::Utc>>().ok());
    let to_time = query.to_date.and_then(|s| s.parse::<chrono::DateTime<chrono::Utc>>().ok());

    let filter = wf_db::repo::AuditFilter {
        tenant_id: None,
        instance_id: None,
        action: None,
        actor: None,
        node_id: None,
        from_time,
        to_time,
        limit: Some(query.limit.unwrap_or(50).min(100) as i64),
        offset: Some(query.offset.unwrap_or(0) as i64),
    };

    // Get audit events
    let events = match audit_repo.get_events(&filter).await {
        Ok(events) => events,
        Err(e) => {
            eprintln!("Error listing audit events: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "Failed to retrieve audit events",
                    "message": e.to_string()
                })),
            )
            .into_response();
        }
    };

    // Convert to core events and build response
    let core_events: Vec<AuditEvent> = events.into_iter().map(db_to_core).collect();
    let items: Vec<AuditEventResponse> = core_events.into_iter().map(Into::into).collect();
    let total = items.len();

    let response = AuditListResponse {
        items,
        total,
        limit: total,
        offset: query.offset.unwrap_or(0),
    };

    Json(response).into_response()
}

/// Get audit events for a specific instance
///
/// GET /api/audit/:instance_id
pub async fn get_instance_audit(
    State(state): State<Arc<AppState>>,
    Path(instance_id): Path<String>,
) -> impl IntoResponse {
    let audit_repo = state.audit.clone();

    // Parse instance_id as UUID
    let instance_uuid = match Uuid::parse_str(&instance_id) {
        Ok(uuid) => uuid,
        Err(e) => {
            eprintln!("Error parsing instance ID: {}", e);
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": "Invalid instance ID",
                    "message": e.to_string()
                })),
            )
            .into_response();
        }
    };

    // Get audit events for instance
    let db_events = match audit_repo.get_by_instance(instance_uuid, Uuid::new_v4()).await {
        Ok(events) => events,
        Err(e) => {
            eprintln!("Error getting instance audit events: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "Failed to retrieve audit events",
                    "message": e.to_string()
                })),
            )
            .into_response();
        }
    };

    // Convert to core events and build response
    let core_events: Vec<AuditEvent> = db_events.into_iter().map(db_to_core).collect();
    let items: Vec<AuditEventResponse> = core_events.into_iter().map(Into::into).collect();

    Json(items).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn test_audit_event_response_serialization() {
        let case_id = Uuid::new_v4();
        let tenant_id = Uuid::new_v4().to_string();
        let user_id = Uuid::new_v4().to_string();
        
        let event = AuditEvent::new(
            wf_core::CaseId(case_id),
            wf_core::TenantId(tenant_id),
            wf_core::UserId(user_id),
            AuditAction::CaseCreated,
            None,
            None,
            None,
            Some(serde_json::json!({"name": "Test Flow"}).into()),
        );

        let response = AuditEventResponse::from(event);
        assert_eq!(response.instance_id, case_id.to_string());
        assert_eq!(response.action, "CaseCreated");
    }
}
