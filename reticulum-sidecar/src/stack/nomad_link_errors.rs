//! Stable Nomad page/file link error codes for the Electron proxy / UI.

/// Structured `LinkSessionError` class — inspect variants before Display.
///
/// `ProofInvalid` / `HandshakeFailed` payloads must not be string-scanned
/// (`destination identity`, `public key unavailable` are path-timeout phrases).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NomadLinkSessionKind {
    PathTimeout,
    LinkTimeout,
    ResponseTimeout,
    PublicKeyUnavailable,
    ProofInvalid,
    HandshakeFailed,
    TransportUnavailable,
    ResponseTooLarge,
    /// Pre-LinkSession / raw Display strings (LinkClient leftovers).
    Legacy,
}

/// Classify a `LinkSessionError::Timeout` label (`what`) without scanning
/// proof/handshake payload text.
pub fn nomad_link_session_kind_from_timeout_what(what: &str) -> NomadLinkSessionKind {
    let lower = what.to_ascii_lowercase();
    if lower.contains("path") || lower.contains("announce") || lower.contains("identity") {
        NomadLinkSessionKind::PathTimeout
    } else if lower.contains("response") || lower.contains("overall") {
        NomadLinkSessionKind::ResponseTimeout
    } else {
        NomadLinkSessionKind::LinkTimeout
    }
}

/// Map a structured session kind. `legacy_display` is used only for [`NomadLinkSessionKind::Legacy`].
pub fn map_nomad_link_session_kind(kind: NomadLinkSessionKind, legacy_display: &str) -> String {
    match kind {
        NomadLinkSessionKind::PathTimeout | NomadLinkSessionKind::PublicKeyUnavailable => {
            "path_timeout".into()
        }
        NomadLinkSessionKind::LinkTimeout
        | NomadLinkSessionKind::ProofInvalid
        | NomadLinkSessionKind::HandshakeFailed => "link_timeout".into(),
        NomadLinkSessionKind::ResponseTimeout => "response_timeout".into(),
        NomadLinkSessionKind::TransportUnavailable => "transport_unavailable".into(),
        NomadLinkSessionKind::ResponseTooLarge => "response_too_large".into(),
        NomadLinkSessionKind::Legacy => map_nomad_link_error(legacy_display),
    }
}

/// Map a `LinkClient` / path discovery failure into a stable short code when
/// recognized; otherwise return the original error string.
///
/// String matching is the **legacy** path only. Structured `LinkSessionError`
/// variants must go through [`map_nomad_link_session_kind`].
pub fn map_nomad_link_error(err: &str) -> String {
    let lower = err.to_ascii_lowercase();
    if lower.contains("missing_identity_hash") {
        return "missing_identity_hash".into();
    }
    if lower.contains("path lookup")
        || lower.contains("path/announce")
        || lower.contains("pubkey recall")
        || lower.contains("destination identity")
        || lower.contains("public key unavailable")
        || lower.contains("did not include a public key")
    {
        return "path_timeout".into();
    }
    if lower.contains("could not discover remote identity") || lower.contains("pubkeynotdiscovered")
    {
        return "pubkey_not_found".into();
    }
    if lower.contains("link proof") || lower.contains("link establishment") {
        return "link_timeout".into();
    }
    if lower.contains("timed out waiting for response")
        || lower.contains("waiting for response")
        || lower.contains("timed out waiting for overall")
    {
        return "response_timeout".into();
    }
    if lower.contains("transport channel closed") || lower.contains("transportunavailable") {
        return "transport_unavailable".into();
    }
    if lower.contains("response_too_large") || lower.contains("too large") {
        return "response_too_large".into();
    }
    if lower.contains("nomad_busy") {
        return "nomad_busy".into();
    }
    if lower.contains("session task is no longer running") || lower.contains("sessionclosed") {
        return "link_timeout".into();
    }
    err.to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        NomadLinkSessionKind, map_nomad_link_error, map_nomad_link_session_kind,
        nomad_link_session_kind_from_timeout_what,
    };

    #[test]
    fn maps_path_and_link_timeouts() {
        assert_eq!(
            map_nomad_link_error("timed out waiting for path lookup"),
            "path_timeout"
        );
        assert_eq!(
            map_nomad_link_error("timed out waiting for path/announce discovery"),
            "path_timeout"
        );
        assert_eq!(
            map_nomad_link_error("timed out waiting for link proof"),
            "link_timeout"
        );
        assert_eq!(
            map_nomad_link_error("timed out waiting for response"),
            "response_timeout"
        );
        assert_eq!(
            map_nomad_link_error("could not discover remote identity public key for destination"),
            "pubkey_not_found"
        );
        assert_eq!(
            map_nomad_link_error("timed out waiting for destination identity"),
            "path_timeout"
        );
        assert_eq!(
            map_nomad_link_error("Link session task is no longer running"),
            "link_timeout"
        );
    }

    #[test]
    fn passes_through_unknown() {
        assert_eq!(
            map_nomad_link_error("encryption failure on link: x"),
            "encryption failure on link: x"
        );
    }

    #[test]
    fn proof_invalid_payload_with_destination_identity_is_not_path_timeout() {
        assert_eq!(
            map_nomad_link_session_kind(
                NomadLinkSessionKind::ProofInvalid,
                "destination identity missing on proof"
            ),
            "link_timeout"
        );
        assert_eq!(
            map_nomad_link_error("timed out waiting for destination identity"),
            "path_timeout"
        );
    }

    #[test]
    fn handshake_failed_payload_with_public_key_unavailable_is_not_path_timeout() {
        assert_eq!(
            map_nomad_link_session_kind(
                NomadLinkSessionKind::HandshakeFailed,
                "public key unavailable during handshake"
            ),
            "link_timeout"
        );
        assert_eq!(
            map_nomad_link_session_kind(NomadLinkSessionKind::PublicKeyUnavailable, ""),
            "path_timeout"
        );
    }

    #[test]
    fn timeout_what_classifies_path_vs_response() {
        assert_eq!(
            nomad_link_session_kind_from_timeout_what("destination identity"),
            NomadLinkSessionKind::PathTimeout
        );
        assert_eq!(
            nomad_link_session_kind_from_timeout_what("overall query"),
            NomadLinkSessionKind::ResponseTimeout
        );
        assert_eq!(
            map_nomad_link_session_kind(
                NomadLinkSessionKind::Legacy,
                "timed out waiting for destination identity"
            ),
            "path_timeout"
        );
    }
}
