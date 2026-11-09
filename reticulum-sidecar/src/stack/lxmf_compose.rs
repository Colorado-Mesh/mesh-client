//! LXMF 1.4 compose helpers: immutable `LxMessage` is produced only by
//! `LxMessageDraft` → `sign` → `finalize`. Mutable fields are set on the draft
//! before signing so they are covered by the message hash.

use lxmf_core::constants::DeliveryMethod;
use lxmf_core::message::{FieldValueRef, LxMessage, LxMessageDraft};
use rns_crypto::ed25519::Ed25519PrivateKey;
use std::collections::BTreeMap;

/// Start a draft (title/content/method set; fields added by caller before [`sign_finalize`]).
pub(super) fn new_draft(
    dest: [u8; 16],
    source: [u8; 16],
    title: &str,
    content: &str,
    method: DeliveryMethod,
) -> Result<LxMessageDraft, String> {
    LxMessageDraft::new(dest, source, title, content, method)
        .map_err(|e| format!("lxmf draft: {e:?}"))
}

/// Sign a draft and finalize it without a recipient stamp (the router stamps on send when needed).
/// Returns the immutable message and its lowercase hex message id.
pub(super) fn sign_finalize(
    draft: LxMessageDraft,
    signing_key: &Ed25519PrivateKey,
) -> Result<(LxMessage, String), String> {
    let signed = draft
        .sign(signing_key)
        .map_err(|e| format!("lxmf sign: {e:?}"))?;
    let message = signed
        .finalize(None)
        .map_err(|e| format!("lxmf finalize: {e:?}"))?;
    let hash_hex = hex::encode(message.message_id());
    Ok((message, hash_hex))
}

/// Raw payload bytes of an LXMF field: the binary payload for binary values, otherwise the exact
/// encoded MessagePack value. Mirrors the pre-1.4 `get_field` byte view that decoders expect.
pub(super) fn field_payload_bytes(value: FieldValueRef<'_>) -> &[u8] {
    value.as_binary().unwrap_or_else(|| value.encoded())
}

/// Raw payload bytes for `id` on `msg` (see [`field_payload_bytes`]).
pub(super) fn message_field_bytes(msg: &LxMessage, id: u8) -> Option<&[u8]> {
    msg.get_field(id).map(field_payload_bytes)
}

/// Standard (`0..=255`) fields as `id -> payload bytes` (see [`field_payload_bytes`]).
/// Custom/negative field ids are skipped.
pub(super) fn standard_fields_map(msg: &LxMessage) -> BTreeMap<u8, Vec<u8>> {
    msg.fields()
        .iter()
        .filter_map(|(id, value)| Some((id.as_standard()?, field_payload_bytes(value).to_vec())))
        .collect()
}

#[cfg(test)]
pub(super) mod test_support {
    use super::*;

    /// Start a draft for tests (panics on error).
    pub(crate) fn draft(
        dest: [u8; 16],
        source: [u8; 16],
        title: &str,
        content: &str,
        method: DeliveryMethod,
    ) -> LxMessageDraft {
        new_draft(dest, source, title, content, method).expect("draft")
    }

    /// Sign `draft` with `key` and finalize without a recipient stamp (panics on error).
    pub(crate) fn finalize(draft: LxMessageDraft, key: &Ed25519PrivateKey) -> LxMessage {
        sign_finalize(draft, key).expect("sign").0
    }

    /// [`finalize`] with a fixed deterministic test key.
    pub(crate) fn finalize_default(draft: LxMessageDraft) -> LxMessage {
        finalize(draft, &Ed25519PrivateKey::from_bytes(&[7u8; 32]))
    }

    /// Fixed timestamp used by [`fixed_message`] so messages with equal content share an id.
    pub(crate) const FIXED_TEST_TIMESTAMP: f64 = 1_700_000_000.0;

    /// Deterministic finalized message (fixed source/title/timestamp/key): equal `dest` +
    /// `content` always yield the same message id regardless of `method`, since 1.4 ids derive
    /// from signed bytes and can no longer be assigned.
    pub(crate) fn fixed_message(
        dest: [u8; 16],
        content: &str,
        method: DeliveryMethod,
    ) -> LxMessage {
        let mut d = draft(dest, [1u8; 16], "", content, method);
        d.set_timestamp(FIXED_TEST_TIMESTAMP).expect("timestamp");
        finalize_default(d)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lxmf_core::constants::FIELD_REPLY_TO;

    #[test]
    fn sign_finalize_produces_stable_message_id_and_fields() {
        let mut draft =
            new_draft([1; 16], [2; 16], "", "hi", DeliveryMethod::Direct).expect("draft");
        draft
            .set_field(FIELD_REPLY_TO, vec![9u8; 32])
            .expect("field");
        let (msg, hash_hex) =
            sign_finalize(draft, &Ed25519PrivateKey::from_bytes(&[5u8; 32])).expect("sign");
        assert_eq!(hash_hex, hex::encode(msg.message_id()));
        assert_eq!(msg.content_text(), "hi");
        assert_eq!(
            message_field_bytes(&msg, FIELD_REPLY_TO),
            Some(&[9u8; 32][..])
        );
    }
}
