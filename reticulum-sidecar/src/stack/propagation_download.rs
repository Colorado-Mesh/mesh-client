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

use lxmf_core::admission::SuppressionReason;
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
    decode_downloaded_propagated_blob_checked(identity, blob).ok()
}

/// Transient id of a client-download blob (`dest_hash || encrypted_data`): the SHA-256 over the
/// unstamped ciphertext, matching `PropagationEnvelope::transient_id()` on the sender.
pub(crate) fn propagation_transient_id(blob: &[u8]) -> [u8; 32] {
    rns_crypto::sha::full_hash(blob)
}

/// Like [`decode_downloaded_propagated_blob`] but reports why decoding failed so the caller can
/// resolve the download admission token with an accurate [`SuppressionReason`].
pub(crate) fn decode_downloaded_propagated_blob_checked(
    identity: &Identity,
    blob: &[u8],
) -> Result<LxMessage, SuppressionReason> {
    if blob.len() <= DESTINATION_LENGTH {
        return Err(SuppressionReason::Malformed);
    }
    let (dest_hash, ciphertext) = blob.split_at(DESTINATION_LENGTH);
    let plaintext = identity
        .decrypt(ciphertext, None, false)
        .map_err(|_| SuppressionReason::DecryptionFailed)?;

    let mut unpack_data = Vec::with_capacity(DESTINATION_LENGTH + plaintext.len());
    unpack_data.extend_from_slice(dest_hash);
    unpack_data.extend_from_slice(&plaintext);

    let mut msg = LxMessage::unpack(&unpack_data).map_err(|_| SuppressionReason::Malformed)?;
    msg.incoming = true;
    msg.method = DeliveryMethod::Propagated;
    Ok(msg)
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
    use lxmf_core::propagation_send::PropagationEnvelope;
    use rns_identity::destination::Destination;

    let dest_hash =
        Destination::hash_from_name_and_identity("lxmf.delivery", Some(&recipient.hash));
    let src_hash = Destination::hash_from_name_and_identity("lxmf.delivery", Some(&sender.hash));
    let (msg, _) = super::lxmf_compose::sign_finalize(
        super::lxmf_compose::new_draft(
            dest_hash,
            src_hash,
            "",
            content,
            DeliveryMethod::Propagated,
        )
        .expect("draft"),
        &sender.get_signing_key().expect("sender signing key"),
    )
    .expect("sign");
    // The envelope's ciphertext is exactly the inner lxmf_data entry
    // (dest || encrypted_data) that a client download yields.
    let remote = Identity::from_public_key(&recipient.get_public_key()).expect("remote identity");
    let envelope = PropagationEnvelope::new(msg, [0u8; 32], 0, |plaintext| {
        remote
            .encrypt(plaintext, None)
            .map_err(|e| lxmf_core::message::MessageError::PackFailed(e.to_string()))
    })
    .expect("propagation envelope");
    envelope.ciphertext().to_vec()
}

/// Hosting policy with a zero PN stamp floor so tests can mint genuine stamps instantly.
#[cfg(test)]
pub(crate) fn zero_cost_policy() -> super::pn_hosting_policy::PnHostingPolicy {
    super::pn_hosting_policy::PnHostingPolicy {
        propagation_stamp_cost: 0,
        propagation_stamp_flex: 0,
        ..Default::default()
    }
}

/// PN stamp value actually measured for `stamp` over `lxmf_data`'s transient id. LXMF 1.4 relay
/// ingress requires the claimed value to equal this measurement (no caller-asserted values).
#[cfg(test)]
pub(crate) fn measured_pn_stamp_value(lxmf_data: &[u8], stamp: &[u8; 32]) -> u8 {
    use lxmf_core::constants::STAMP_WORKBLOCK_EXPAND_ROUNDS_PN;
    let tid = propagation_transient_id(lxmf_data);
    let workblock = lxmf_core::stamper::stamp_workblock(&tid, STAMP_WORKBLOCK_EXPAND_ROUNDS_PN);
    u8::try_from(lxmf_core::stamper::stamp_value(&workblock, stamp)).unwrap_or(u8::MAX)
}

/// Admit `lxmf_data` + `stamp` into `node` using the measured stamp value.
#[cfg(test)]
pub(crate) fn accept_stamped_for_test(
    node: &mut lxmf_core::propagation_node::PropagationNode,
    lxmf_data: &[u8],
    stamp: &[u8; 32],
) -> bool {
    node.accept_stamped_propagated_blob(lxmf_data, stamp, measured_pn_stamp_value(lxmf_data, stamp))
}

/// Deposit a client-download blob into `node`, generating a genuine stamp at the node's floor.
#[cfg(test)]
pub(crate) fn deposit_client_blob_for_test(
    node: &mut lxmf_core::propagation_node::PropagationNode,
    blob: &[u8],
) -> bool {
    use lxmf_core::constants::STAMP_WORKBLOCK_EXPAND_ROUNDS_PN;
    let tid = propagation_transient_id(blob);
    let (stamp, _) = lxmf_core::stamper::generate_stamp(
        &tid,
        node.min_stamp_cost(),
        STAMP_WORKBLOCK_EXPAND_ROUNDS_PN,
    )
    .expect("test stamp");
    accept_stamped_for_test(node, blob, &stamp)
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
        assert_eq!(decoded.content_text(), "hello via PN");
        assert!(decoded.incoming);
        assert_eq!(decoded.method, DeliveryMethod::Propagated);
        assert_eq!(propagation_transient_id(&blob).len(), 32);
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
