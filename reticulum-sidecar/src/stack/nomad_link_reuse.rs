//! Nomad Link reuse: keep one initiator session per remote node.
//!
//! `LinkClient::query` opens a Link, serves one request, then closes. Zeva-style
//! pages pay a full TCP handshake (and can drop the cached path) for every
//! `/media` image. Reuse the same dest's session across page + queued images.

/// True when the cached initiator dest matches the next Nomad query dest.
pub fn nomad_link_cache_should_reuse(cached_dest: &[u8; 16], dest: &[u8; 16]) -> bool {
    cached_dest == dest
}

#[cfg(test)]
mod tests {
    use super::nomad_link_cache_should_reuse;

    #[test]
    fn reuses_only_the_same_nomad_dest() {
        let dest_a = [0x78; 16];
        let dest_b = [0x32; 16];
        assert!(nomad_link_cache_should_reuse(&dest_a, &dest_a));
        assert!(!nomad_link_cache_should_reuse(&dest_a, &dest_b));
    }
}
