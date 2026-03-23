//! Connector routes:
//!
//!   GET       /api/connectors
//!   POST      /api/connectors/register  (idempotent — see RegistrationOutcome)
//!   POST      /api/connectors/test
//!   GET       /api/connectors/types
//!   GET       /api/connectors/types/{connector_type}/schema
//!   DELETE    /api/connectors/{connector_id}
//!
//! ## Idempotency contract
//!
//! `POST /api/connectors/register` is safe to call multiple times with the
//! same payload.  The response always includes an `outcome` field:
//!
//! | outcome     | HTTP | Meaning                                         |
//! |-------------|------|-------------------------------------------------|
//! | `created`   | 201  | First time we saw this name — record inserted.  |
//! | `updated`   | 200  | Name existed, config changed — record updated.  |
//! | `no_change` | 200  | Name existed, payload identical — no DB write.  |
//!
//! If the caller tries to change the immutable `type` field the endpoint
//! returns `422 IMMUTABLE_FIELD` instead of silently overwriting.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json as ResponseJson, Response},
    Json,
};
use std::sync::Arc;
use uuid::Uuid;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::AppState;
use flowforge_runtime::types::{
    ApiError, ApiErrorCode,
    ConfigFieldSchema, ConfigOptionSchema,
    ConnectorConfigSchemaResponse, ConnectorKind,
    ConnectorTypeResponse, ConnectorTypesResponse,
    ConnectorsListResponse, CreateConnectorRequest,
    RegisteredConnectorResponse, RegistrationOutcome, RegistrationResponse,
    SavedConnectorResponse, TestConnectorRequest, TestConnectorResponse,
    redact_config,
};


// ── Handlers ──────────────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/api/connectors",
    tag = "Connectors",
    responses((status = 200, body = ConnectorsListResponse))
)]
pub async fn list_saved_connectors(
    State(state): State<Arc<AppState>>,
) -> Result<ResponseJson<ConnectorsListResponse>, ApiError> {
    let connectors = state.connectors.list().await
        .map_err(ApiError::db)?;

    let connectors = connectors.into_iter().map(|c| SavedConnectorResponse {
        id:             c.id.to_string(),
        name:           c.name,
        connector_type: c.connector_type,
        config:         redact_config(c.config),
        created_at:     c.created_at.to_rfc3339(),
    }).collect();

    Ok(Json(ConnectorsListResponse { connectors }))
}

/// Register (idempotent upsert) a connector.
///
/// Returns **201 Created** when the connector is new, **200 OK** when it
/// already existed (updated or unchanged).  The `outcome` field in the body
/// tells you exactly which case occurred.
#[utoipa::path(
    post,
    path = "/api/connectors/register",
    tag = "Connectors",
    responses(
        (status = 201, body = inline(RegistrationResponse<RegisteredConnectorResponse>),
         description = "Connector created for the first time"),
        (status = 200, body = inline(RegistrationResponse<RegisteredConnectorResponse>),
         description = "Connector already existed — updated or unchanged"),
        (status = 422, body = ApiError,
         description = "Attempted to change the immutable `type` field"),
    )
)]
pub async fn register_connector(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateConnectorRequest>,
) -> Result<Response, ApiError> {
    let input = flowforge_db::repo::connectors::CreateConnectorInput {
        name:           req.name,
        connector_type: req.connector_type,
        config:         req.config,
    };

    let reg = state.connectors.register(input).await?;

    let resource = RegisteredConnectorResponse {
        id:             reg.connector.id.to_string(),
        name:           reg.connector.name,
        connector_type: reg.connector.connector_type,
        config:         redact_config(reg.connector.config),
        created_at:     reg.connector.created_at.to_rfc3339(),
        updated_at:     reg.connector.updated_at.to_rfc3339(),
    };

    let status = match reg.outcome {
        RegistrationOutcome::Created => StatusCode::CREATED,
        RegistrationOutcome::Updated | RegistrationOutcome::NoChange => StatusCode::OK,
    };

    let body = RegistrationResponse { outcome: reg.outcome, resource };
    Ok((status, ResponseJson(body)).into_response())
}

#[utoipa::path(
    post,
    path = "/api/connectors/test",
    tag = "Connectors",
    responses((status = 200, body = TestConnectorResponse))
)]
pub async fn test_connector(
    State(state): State<Arc<AppState>>,
    Json(req): Json<TestConnectorRequest>,
) -> ResponseJson<TestConnectorResponse> {
    let start = std::time::Instant::now();
    let result: Result<String, String> = match state.registry.get(&req.connector_type) {
        None => Err(format!("Unknown connector type: {}", req.connector_type)),
        Some(reg) => {
            if reg.supports_source() {
                match reg.make_source(req.config.clone()) {
                    Ok(source) => source.open().await
                        .map(|_| format!("{} connection successful", req.connector_type))
                        .map_err(|e| format!("Connection failed: {}", e)),
                    Err(e) => Err(format!("Invalid config: {}", e)),
                }
            } else {
                match reg.make_sink(req.config.clone()) {
                    Ok(sink) => sink.open(None).await
                        .map(|_| format!("{} connection successful", req.connector_type))
                        .map_err(|e| format!("Connection failed: {}", e)),
                    Err(e) => Err(format!("Invalid config: {}", e)),
                }
            }
        }
    };
    let ms = start.elapsed().as_millis() as u64;
    match result {
        Ok(m)  => Json(TestConnectorResponse { success: true,  message: m, latency_ms: Some(ms) }),
        Err(m) => Json(TestConnectorResponse { success: false, message: m, latency_ms: Some(ms) }),
    }
}

#[utoipa::path(
    get,
    path = "/api/connectors/types",
    tag = "Connectors",
    responses((status = 200, body = ConnectorTypesResponse))
)]
pub async fn list_connector_types(
    State(state): State<Arc<AppState>>,
) -> ResponseJson<ConnectorTypesResponse> {
    let types = state.registry
        .all()
        .iter()
        .map(|(name, reg)| ConnectorTypeResponse {
            id:              name.clone(),
            name:            reg.meta.name.to_string(),
            description:     reg.meta.description.to_string(),
            category:        format!("{:?}", reg.category).to_lowercase(),
            kind:            ConnectorKind::BuiltIn,
            supports_source: reg.supports_source(),
            supports_sink:   reg.supports_sink(),
        })
        .collect();

    Json(ConnectorTypesResponse { types })
}

#[utoipa::path(
    get,
    path = "/api/connectors/types/{connector_type}/schema",
    tag = "Connectors",
    responses((status = 200, body = ConnectorConfigSchemaResponse))
)]
pub async fn get_connector_schema(
    State(state): State<Arc<AppState>>,
    Path(connector_type): Path<String>,
) -> ResponseJson<ConnectorConfigSchemaResponse> {
    let fields = state.registry
        .get_schema(&connector_type)
        .unwrap_or_default()
        .fields
        .into_iter()
        .map(|f| ConfigFieldSchema {
            name:          f.name,
            label:         f.label,
            field_type:    format!("{:?}", f.field_type).to_lowercase(),
            description:   f.description,
            required:      f.required,
            default_value: f.default_value,
            options:       f.options.map(|opts| {
                opts.into_iter()
                    .map(|o| ConfigOptionSchema { value: o.value, label: o.label })
                    .collect()
            }),
        })
        .collect();

    Json(ConnectorConfigSchemaResponse { fields })
}

#[utoipa::path(
    delete,
    path = "/api/connectors/{connector_id}",
    tag = "Connectors",
    params(("connector_id" = String, Path)),
    responses(
        (status = 204, description = "Deleted"),
        (status = 404, body = ApiError, description = "Not found"),
        (status = 400, body = ApiError, description = "Invalid ID format"),
    )
)]
pub async fn delete_connector(
    State(state): State<Arc<AppState>>,
    Path(connector_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let id = connector_id.parse::<Uuid>()
        .map_err(|e| ApiError::invalid_id(format!("Invalid connector ID '{}': {}", connector_id, e)))?;

    let deleted = state.connectors.delete(id).await
        .map_err(ApiError::db)?;

    if deleted {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::not_found(format!("Connector '{}' not found", connector_id)))
    }
}

// ── Router ────────────────────────────────────────────────────────────────────

pub fn router() -> OpenApiRouter<Arc<AppState>> {
    OpenApiRouter::new()
        .routes(routes!(list_saved_connectors))
        .routes(routes!(register_connector))
        .routes(routes!(test_connector))
        .routes(routes!(list_connector_types))
        .routes(routes!(get_connector_schema))
        .routes(routes!(delete_connector))
}
