//! Stable Nomad page/file link error codes for the Electron proxy / UI.

/// Map a `LinkClient` / path discovery failure into a stable short code when
/// recognized; otherwise return the original error string.
pub fn map_nomad_link_error(err: &str) -> String {
    let lower = err.to_ascii_lowercase();
    if lower.contains("missing_identity_hash") {
        return "missing_identity_hash".into();
    }
    if lower.contains("path lookup")
        || lower.contains("path/announce")
        || lower.contains("pubkey recall")
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
    err.to_string()
}

#[cfg(test)]
mod tests {
    use super::map_nomad_link_error;

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
    }

    #[test]
    fn passes_through_unknown() {
        assert_eq!(
            map_nomad_link_error("encryption failure on link: x"),
            "encryption failure on link: x"
        );
    }
}
