//! Shared request-body field length checks for HTTP API handlers.

/// Destination / identity hash fields never need more than 64 hex chars
/// (32-byte hash as hex); keep a little headroom for prefixed paste.
pub const MAX_DEST_HASH_CHARS: usize = 64;

/// Reject when `value` exceeds `max` Unicode scalar values.
pub fn reject_oversize(label: &str, value: &str, max: usize) -> Option<String> {
    if value.chars().count() > max {
        Some(format!(
            "{label} exceeds maximum length of {max} characters"
        ))
    } else {
        None
    }
}

/// Reject when the list is too long, or any entry exceeds `max_item_chars`.
pub fn reject_oversize_list(
    label: &str,
    values: &[String],
    max_entries: usize,
    max_item_chars: usize,
) -> Option<String> {
    if values.len() > max_entries {
        return Some(format!("{label} exceeds maximum of {max_entries} entries"));
    }
    values
        .iter()
        .find_map(|v| reject_oversize(label, v, max_item_chars))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reject_oversize_accepts_exact_limit() {
        let s = "a".repeat(64);
        assert!(reject_oversize("destination_hash", &s, 64).is_none());
    }

    #[test]
    fn reject_oversize_rejects_over_limit() {
        let s = "a".repeat(65);
        let err = reject_oversize("destination_hash", &s, 64).expect("err");
        assert!(err.contains("destination_hash"));
        assert!(err.contains("64"));
    }

    #[test]
    fn reject_oversize_list_caps_entries_and_items() {
        let many: Vec<String> = (0..3).map(|i| format!("h{i}")).collect();
        assert!(reject_oversize_list("allowed", &many, 2, 64).is_some());
        let long = vec!["a".repeat(65)];
        assert!(reject_oversize_list("allowed", &long, 256, 64).is_some());
        let ok = vec!["ab".repeat(16)];
        assert!(reject_oversize_list("allowed", &ok, 256, 64).is_none());
    }
}
