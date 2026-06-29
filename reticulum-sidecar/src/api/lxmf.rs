use axum::Json;

pub async fn lxmf_send() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": false, "error": "not_implemented" }))
}

pub async fn list_contacts() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "contacts": [] }))
}
