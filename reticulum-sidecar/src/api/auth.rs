use std::sync::Arc;

use axum::Json;
use axum::extract::{Request, State};
use axum::http::{StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use subtle::ConstantTimeEq;

const AUTH_TOKEN_BYTES: usize = 32;
const BEARER_PREFIX: &[u8] = b"Bearer ";

#[derive(Clone)]
pub(crate) struct ApiAuth {
    token: Arc<[u8]>,
}

impl ApiAuth {
    pub(crate) fn try_new(token: String) -> Result<Self, String> {
        let decoded = URL_SAFE_NO_PAD
            .decode(token.as_bytes())
            .map_err(|_| "sidecar authentication token is not valid base64url".to_string())?;
        if decoded.len() != AUTH_TOKEN_BYTES {
            return Err(format!(
                "sidecar authentication token must contain {AUTH_TOKEN_BYTES} random bytes"
            ));
        }
        Ok(Self {
            token: Arc::from(token.into_bytes()),
        })
    }

    fn authorizes(&self, request: &Request) -> bool {
        let mut values = request.headers().get_all(header::AUTHORIZATION).iter();
        let Some(value) = values.next() else {
            return false;
        };
        if values.next().is_some() {
            return false;
        }
        let bytes = value.as_bytes();
        let Some(candidate) = bytes.strip_prefix(BEARER_PREFIX) else {
            return false;
        };
        candidate.len() == self.token.len() && bool::from(candidate.ct_eq(self.token.as_ref()))
    }
}

pub(crate) async fn require_bearer_auth(
    State(auth): State<ApiAuth>,
    request: Request,
    next: Next,
) -> Response {
    if !auth.authorizes(&request) {
        return (
            StatusCode::UNAUTHORIZED,
            [(header::WWW_AUTHENTICATE, "Bearer")],
            Json(serde_json::json!({ "ok": false, "error": "unauthorized" })),
        )
            .into_response();
    }
    next.run(request).await
}

#[cfg(test)]
mod tests {
    use axum::Router;
    use axum::body::Body;
    use axum::http::Request;
    use axum::middleware;
    use axum::routing::get;
    use tower::ServiceExt;

    use super::*;

    const TEST_TOKEN: &str = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY";

    fn protected_router() -> Router {
        let auth = ApiAuth::try_new(TEST_TOKEN.to_string()).expect("valid test token");
        Router::new()
            .route("/api/v1/status", get(|| async { "ok" }))
            .route("/ws", get(|| async { "upgrade" }))
            .layer(middleware::from_fn_with_state(auth, require_bearer_auth))
    }

    #[tokio::test]
    async fn rejects_missing_and_wrong_credentials_on_http_and_websocket_paths() {
        for path in ["/api/v1/status", "/ws"] {
            let missing = protected_router()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);

            let wrong = protected_router()
                .oneshot(
                    Request::builder()
                        .uri(path)
                        .header(header::AUTHORIZATION, "Bearer wrong")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(wrong.status(), StatusCode::UNAUTHORIZED);
        }

        let query_token = protected_router()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/v1/status?access_token={TEST_TOKEN}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(query_token.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn accepts_exact_bearer_token() {
        let response = protected_router()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/status")
                    .header(header::AUTHORIZATION, format!("Bearer {TEST_TOKEN}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[test]
    fn requires_exactly_32_random_bytes() {
        assert!(ApiAuth::try_new(TEST_TOKEN.to_string()).is_ok());
        assert!(ApiAuth::try_new("c2hvcnQ".to_string()).is_err());
        assert!(ApiAuth::try_new("not base64url!".to_string()).is_err());
    }
}
