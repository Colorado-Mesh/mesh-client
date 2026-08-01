//! Path medium preference (global) and per-destination medium pins.

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::Deserialize;

use crate::stack::{PathMediumPreferenceSetting, PathMediumSetting, StackHandle};

type ApiResult = Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)>;

fn bad_request(error: &str) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({ "ok": false, "error": error })),
    )
}

#[derive(Debug, Deserialize)]
pub struct PathMediumPreferenceBody {
    pub preference: String,
}

pub async fn get_path_medium_preference(
    State(stack): State<Arc<StackHandle>>,
) -> Json<serde_json::Value> {
    let preference = stack.path_medium_preference().await;
    Json(serde_json::json!({
        "ok": true,
        "preference": preference.as_str(),
        "pins": stack.peer_medium_pins_json().await,
    }))
}

pub async fn put_path_medium_preference(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<PathMediumPreferenceBody>,
) -> ApiResult {
    let Some(preference) = PathMediumPreferenceSetting::from_wire(&body.preference) else {
        return Err(bad_request("invalid_path_medium_preference"));
    };
    match stack.set_path_medium_preference(preference).await {
        Ok(()) => Ok(Json(
            serde_json::json!({ "ok": true, "preference": preference.as_str() }),
        )),
        Err(e) => Ok(Json(serde_json::json!({ "ok": false, "error": e }))),
    }
}

pub async fn get_peer_paths(
    State(stack): State<Arc<StackHandle>>,
    Path(hash): Path<String>,
) -> ApiResult {
    match stack.peer_path_slots(&hash).await {
        Ok(res) => Ok(Json(res)),
        Err(e) if is_hash_error(&e) => Err(bad_request(&e)),
        Err(e) => Ok(Json(serde_json::json!({ "ok": false, "error": e }))),
    }
}

/// `{ "pin": "rf" | "network" | null }`. The raw body keeps `pin: null` (clear)
/// distinguishable from an absent key, which `Option<T>` would collapse.
pub async fn put_peer_medium_pin(
    State(stack): State<Arc<StackHandle>>,
    Path(hash): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> ApiResult {
    let pin = match parse_pin(body.get("pin")) {
        Ok(pin) => pin,
        Err(e) => return Err(bad_request(e)),
    };
    match stack.set_peer_medium_pin(&hash, pin).await {
        Ok(destination_hash) => Ok(Json(serde_json::json!({
            "ok": true,
            "destination_hash": destination_hash,
            "pin": pin.map(PathMediumSetting::as_str),
        }))),
        Err(e) if is_hash_error(&e) => Err(bad_request(&e)),
        Err(e) => Ok(Json(serde_json::json!({ "ok": false, "error": e }))),
    }
}

/// `null` clears the pin; a string must be a known medium token.
fn parse_pin(raw: Option<&serde_json::Value>) -> Result<Option<PathMediumSetting>, &'static str> {
    match raw {
        None => Err("pin_required"),
        Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(s)) => PathMediumSetting::from_wire(s)
            .map(Some)
            .ok_or("invalid_pin"),
        Some(_) => Err("invalid_pin"),
    }
}

/// Hash rejections are client errors (400); everything else is a stack failure.
fn is_hash_error(error: &str) -> bool {
    error.contains("32 hex characters")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_pin_accepts_tokens_and_null() {
        assert_eq!(
            parse_pin(Some(&serde_json::json!("rf"))),
            Ok(Some(PathMediumSetting::Rf))
        );
        assert_eq!(
            parse_pin(Some(&serde_json::json!("NETWORK"))),
            Ok(Some(PathMediumSetting::Network))
        );
        assert_eq!(parse_pin(Some(&serde_json::Value::Null)), Ok(None));
    }

    #[test]
    fn parse_pin_rejects_missing_and_unknown() {
        assert_eq!(parse_pin(None), Err("pin_required"));
        assert_eq!(
            parse_pin(Some(&serde_json::json!("lowest"))),
            Err("invalid_pin")
        );
        assert_eq!(parse_pin(Some(&serde_json::json!(3))), Err("invalid_pin"));
    }

    #[test]
    fn hash_errors_map_to_bad_request() {
        assert!(is_hash_error("destination_hash must be 32 hex characters"));
        assert!(!is_hash_error("path_slots_query_failed"));
    }

    #[test]
    fn preference_body_parses_known_tokens() {
        let body: PathMediumPreferenceBody =
            serde_json::from_str("{\"preference\":\" Rf \"}").expect("parse");
        assert_eq!(
            PathMediumPreferenceSetting::from_wire(&body.preference),
            Some(PathMediumPreferenceSetting::Rf)
        );
        let body: PathMediumPreferenceBody =
            serde_json::from_str("{\"preference\":\"satellite\"}").expect("parse");
        assert!(PathMediumPreferenceSetting::from_wire(&body.preference).is_none());
    }

    #[test]
    fn pin_body_distinguishes_absent_from_null() {
        let absent: serde_json::Value = serde_json::from_str("{}").expect("parse");
        assert_eq!(parse_pin(absent.get("pin")), Err("pin_required"));
        let explicit_null: serde_json::Value =
            serde_json::from_str("{\"pin\":null}").expect("parse");
        assert_eq!(parse_pin(explicit_null.get("pin")), Ok(None));
        let pinned: serde_json::Value =
            serde_json::from_str("{\"pin\":\"network\"}").expect("parse");
        assert_eq!(
            parse_pin(pinned.get("pin")),
            Ok(Some(PathMediumSetting::Network))
        );
    }
}
