use axum::Json;

pub async fn list_interfaces() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "interfaces": [] }))
}
