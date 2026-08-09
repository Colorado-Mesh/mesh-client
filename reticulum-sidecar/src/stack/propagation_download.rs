//! Client-side propagation-node retrieval (`/get` pull) decode helpers.
//!
//! The user-facing **Sync** flow downloads store-and-forward mail addressed to
//! our own `lxmf.delivery` identity from a propagation node via
//! [`lxmf_core::propagation_client::PropagationClient`] (`/get` list → get →
//! purge, Python `LXMRouter.request_messages_from_propagation_node` parity).
//!
//! A downloaded entry (client-download form, propagation stamp already stripped
//! by the serving node) is `dest_hash(16) || encrypted_data`, where
//! `encrypted_data` is the RNS-encrypted `src_hash(16) || signature(64) ||
//! msgpack_payload`. We decrypt with the local identity, reassemble the wire
//! message, and hand the resulting [`LxMessage`] to the router delivery
//! callback exactly like a Direct/opportunistic inbound message.

use lxmf_core::constants::{DESTINATION_LENGTH, DeliveryMethod};
use lxmf_core::message::LxMessage;
use rns_identity::identity::Identity;

/// Outcome of one [`PropagationBridge::poll_client_download`] tick.
///
/// [`PropagationBridge::poll_client_download`]: super::propagation_bridge::PropagationBridge::poll_client_download
#[derive(Debug)]
pub(crate) enum ClientDownloadPoll {
    /// No download is active (never started, or already consumed).
    Idle,
    /// Download in progress (link/list/get/purge not yet terminal).
    InProgress,
    /// Download reached a terminal Complete. `messages` are decoded and ready
    /// for the delivery callback; `listed` / `downloaded` are audit counts.
    Complete {
        messages: Vec<LxMessage>,
        listed: usize,
        downloaded: usize,
    },
    /// Download failed (link close, timeout, or malformed response).
    Failed,
}

/// Decode one client-downloaded propagation entry into an inbound [`LxMessage`].
///
/// `blob` is `dest_hash(16) || encrypted_data` (the serving node strips the
/// trailing propagation stamp for client downloads). Returns `None` when the
/// blob is too short, decryption fails (not addressed to us / wrong ratchet),
/// or the decrypted bytes are not a valid LXMF message.
pub(crate) fn decode_downloaded_propagated_blob(
    identity: &Identity,
    blob: &[u8],
) -> Option<LxMessage> {
    if blob.len() <= DESTINATION_LENGTH {
        return None;
    }
    let (dest_hash, ciphertext) = blob.split_at(DESTINATION_LENGTH);
    let plaintext = identity.decrypt(ciphertext, None, false).ok()?;

    let mut unpack_data = Vec::with_capacity(DESTINATION_LENGTH + plaintext.len());
    unpack_data.extend_from_slice(dest_hash);
    unpack_data.extend_from_slice(&plaintext);

    let mut msg = LxMessage::unpack(&unpack_data).ok()?;
    msg.incoming = true;
    msg.method = DeliveryMethod::Propagated;
    // Python computes the transient id over the (unstamped) lxmf_data; mirror it
    // so retrieve telemetry correlates with the sender's deposit transient id.
    msg.transient_id = Some(LxMessage::compute_propagation_transient_id(blob));
    Some(msg)
}

/// Pack a propagated message for `recipient` in the client-download form the
/// serving node returns (`dest_hash || encrypted_data`, no stamp). Shared by the
/// download unit tests and the propagation-bridge local-prop loopback test.
#[cfg(test)]
pub(crate) fn build_client_download_blob(
    sender: &Identity,
    recipient: &Identity,
    content: &str,
) -> Vec<u8> {
    use rns_identity::destination::Destination;

    let dest_hash =
        Destination::hash_from_name_and_identity("lxmf.delivery", Some(&recipient.hash));
    let src_hash = Destination::hash_from_name_and_identity("lxmf.delivery", Some(&sender.hash));
    let mut msg = LxMessage::new(dest_hash, src_hash, "", content, DeliveryMethod::Propagated);
    msg.sign(&sender.get_signing_key().expect("sender signing key"))
        .expect("sign");
    // pack_propagated_encrypted returns the msgpack propagation wrapper; we only
    // need the inner lxmf_data entry (dest || encrypted_data) that a client
    // download yields, so extract it to mirror the wire form.
    let (wrapper, _tid) = {
        let recipient_pub = recipient.get_public_key();
        let remote = Identity::from_public_key(&recipient_pub).expect("remote identity");
        msg.pack_propagated_encrypted(|plaintext| {
            remote
                .encrypt(plaintext, None)
                .map_err(|e| lxmf_core::message::MessageError::PackFailed(e.to_string()))
        })
        .expect("pack propagated encrypted")
    };
    let (_ts, entries) = LxMessage::unpack_propagation_wrapper(&wrapper).expect("unpack wrapper");
    entries.into_iter().next().expect("one entry")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_downloaded_blob_addressed_to_us() {
        let sender = Identity::new();
        let recipient = Identity::new();
        let blob = build_client_download_blob(&sender, &recipient, "hello via PN");

        let decoded = decode_downloaded_propagated_blob(&recipient, &blob)
            .expect("recipient can decode its own mail");
        assert_eq!(decoded.content, "hello via PN");
        assert!(decoded.incoming);
        assert_eq!(decoded.method, DeliveryMethod::Propagated);
        assert!(decoded.transient_id.is_some());
    }

    #[test]
    fn rejects_blob_not_addressed_to_us() {
        let sender = Identity::new();
        let recipient = Identity::new();
        let stranger = Identity::new();
        let blob = build_client_download_blob(&sender, &recipient, "not for you");

        assert!(
            decode_downloaded_propagated_blob(&stranger, &blob).is_none(),
            "a foreign identity must not decode mail addressed to the recipient"
        );
    }

    #[test]
    fn rejects_too_short_blob() {
        let identity = Identity::new();
        assert!(decode_downloaded_propagated_blob(&identity, &[0u8; 8]).is_none());
        assert!(decode_downloaded_propagated_blob(&identity, &[0u8; DESTINATION_LENGTH]).is_none());
    }
}
