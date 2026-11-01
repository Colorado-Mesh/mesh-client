//! Outbound native LXMF media fields (`FIELD_FILE_ATTACHMENTS`, `FIELD_IMAGE`).
//!
//! Wire shapes match Ratspeak / rsLXMF (see `rsLXMF-file-attachments-list.patch`):
//!
//! | Field | Wire | Typed setter |
//! | --- | --- | --- |
//! | `FIELD_FILE_ATTACHMENTS` (0x05) | `[[name, bytes], …]` | `set_file_attachments_field` |
//! | `FIELD_IMAGE` (0x06) | `[format, bytes]` | `set_image_field` |
//!
//! This is **not** rncp (Remote tab file transfer over a Link); attachments here ride
//! inside the signed LXMF message so they are covered by the message hash and respect
//! the lxmf-core 256 KiB per-field unpack limit and default PN deposit limits.

use base64::Engine as _;

use super::types::{LxmfFileAttachmentRequest, LxmfImageRequest, LxmfSendRequest};

/// Max files per outbound message (Sideband / NomadNet send a handful at most).
pub const MAX_LXMF_FILE_ATTACHMENT_COUNT: usize = 4;
/// Combined raw bytes of all files — one `FIELD_FILE_ATTACHMENTS` value must stay under
/// lxmf-core's 256 KiB per-field cap once msgpack framing + names are added.
pub const MAX_LXMF_FILE_ATTACHMENTS_TOTAL_BYTES: usize = 240 * 1024;
/// Raw image bytes for `FIELD_IMAGE` (same per-field cap headroom as files / voice memos).
pub const MAX_LXMF_IMAGE_FIELD_BYTES: usize = 240 * 1024;
/// Display/wire file-name cap (chars, after sanitisation).
pub const MAX_ATTACHMENT_FILE_NAME_CHARS: usize = 96;

/// Native media prepared for signing (before `msg.sign`).
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct OutboundMedia {
    pub audio: Option<Vec<u8>>,
    /// `(format, bytes)` — `format` is a lower-case extension (`png`, `jpeg`, `webp`, `gif`).
    pub image: Option<(String, Vec<u8>)>,
    pub files: Vec<(String, Vec<u8>)>,
}

impl OutboundMedia {
    #[must_use]
    pub fn has_files_or_image(&self) -> bool {
        self.image.is_some() || !self.files.is_empty()
    }
}

/// Neutralise a peer- or user-supplied attachment name for wire, chat markers
/// (`[file:name:mime]`) and on-disk cache names.
///
/// Strips directory components, control / bidi-override characters and the chat-marker
/// delimiters (`[` `]` `:`), drops leading dots, avoids Windows device names, and caps length
/// while keeping a short extension.
#[must_use]
pub fn sanitize_attachment_file_name(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or(raw).trim();
    let mut cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_control()
                || matches!(
                    c,
                    '[' | ']'
                        | ':'
                        | '<'
                        | '>'
                        | '"'
                        | '|'
                        | '?'
                        | '*'
                        | '\u{200e}'
                        | '\u{200f}'
                        | '\u{202a}'..='\u{202e}'
                        | '\u{2066}'..='\u{2069}'
                )
            {
                '_'
            } else {
                c
            }
        })
        .collect();
    cleaned = cleaned
        .trim()
        .trim_start_matches('.')
        .trim_end_matches(['.', ' '])
        .to_string();
    if cleaned.is_empty() {
        return "attachment".into();
    }
    let stem_upper = cleaned.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(
        stem_upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    );
    if reserved {
        cleaned.insert(0, '_');
    }
    if cleaned.chars().count() > MAX_ATTACHMENT_FILE_NAME_CHARS {
        let ext = cleaned
            .rfind('.')
            .map(|i| cleaned[i..].to_string())
            .filter(|e| e.chars().count() <= 12)
            .unwrap_or_default();
        let keep = MAX_ATTACHMENT_FILE_NAME_CHARS.saturating_sub(ext.chars().count());
        let stem: String = cleaned.chars().take(keep).collect();
        cleaned = format!("{stem}{ext}");
    }
    cleaned
}

/// Normalise an image `format` token to a supported lower-case extension.
fn normalize_image_format(raw: &str) -> Option<&'static str> {
    match raw
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Some("png"),
        "jpg" | "jpeg" => Some("jpeg"),
        "webp" => Some("webp"),
        "gif" => Some("gif"),
        _ => None,
    }
}

/// Magic-byte check so a mislabeled payload is not stamped as `FIELD_IMAGE`.
fn image_magic_matches(format: &str, bytes: &[u8]) -> bool {
    match format {
        "png" => bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]),
        "jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "webp" => bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        _ => false,
    }
}

fn decode_b64(data: &str, what: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("{what}_base64_decode: {e}"))
}

/// Validate and decode `attachments` / `image` from an LXMF send request.
///
/// Error codes are stable snake_case prefixes (`attachment_count_exceeded`,
/// `attachment_too_large`, `attachment_empty`, `image_too_large`, `image_format_unsupported`,
/// `image_magic_mismatch`, …) mapped by the renderer to i18n copy.
pub fn decode_outbound_attachments(req: &LxmfSendRequest) -> Result<OutboundMedia, String> {
    decode_outbound_attachment_parts(&req.attachments, req.image.as_ref())
}

pub fn decode_outbound_attachment_parts(
    attachments: &[LxmfFileAttachmentRequest],
    image: Option<&LxmfImageRequest>,
) -> Result<OutboundMedia, String> {
    let mut media = OutboundMedia::default();

    if attachments.len() > MAX_LXMF_FILE_ATTACHMENT_COUNT {
        return Err(format!(
            "attachment_count_exceeded: {} > {}",
            attachments.len(),
            MAX_LXMF_FILE_ATTACHMENT_COUNT
        ));
    }
    let mut total = 0usize;
    for att in attachments {
        // Cheap upper bound before decoding: base64 inflates by 4/3.
        if att.data_base64.len() > (MAX_LXMF_FILE_ATTACHMENTS_TOTAL_BYTES / 3 + 1) * 4 + 8 {
            return Err(format!(
                "attachment_too_large: encoded {} chars",
                att.data_base64.len()
            ));
        }
        let bytes = decode_b64(&att.data_base64, "attachment")?;
        if bytes.is_empty() {
            return Err("attachment_empty".into());
        }
        total = total.saturating_add(bytes.len());
        if total > MAX_LXMF_FILE_ATTACHMENTS_TOTAL_BYTES {
            return Err(format!(
                "attachment_too_large: {total} > {MAX_LXMF_FILE_ATTACHMENTS_TOTAL_BYTES}"
            ));
        }
        media
            .files
            .push((sanitize_attachment_file_name(&att.file_name), bytes));
    }

    if let Some(img) = image {
        let format = normalize_image_format(&img.format)
            .ok_or_else(|| format!("image_format_unsupported: {}", img.format.trim()))?;
        if img.data_base64.len() > (MAX_LXMF_IMAGE_FIELD_BYTES / 3 + 1) * 4 + 8 {
            return Err(format!(
                "image_too_large: encoded {} chars",
                img.data_base64.len()
            ));
        }
        let bytes = decode_b64(&img.data_base64, "image")?;
        if bytes.is_empty() {
            return Err("attachment_empty".into());
        }
        if bytes.len() > MAX_LXMF_IMAGE_FIELD_BYTES {
            return Err(format!(
                "image_too_large: {} > {MAX_LXMF_IMAGE_FIELD_BYTES}",
                bytes.len()
            ));
        }
        if !image_magic_matches(format, &bytes) {
            return Err(format!("image_magic_mismatch: {format}"));
        }
        media.image = Some((format.to_string(), bytes));
    }

    Ok(media)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str, bytes: &[u8]) -> LxmfFileAttachmentRequest {
        LxmfFileAttachmentRequest {
            file_name: name.into(),
            data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        }
    }

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];

    #[test]
    fn sanitize_strips_paths_markers_and_bidi() {
        assert_eq!(sanitize_attachment_file_name("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_attachment_file_name("C:\\evil\\a.exe"), "a.exe");
        assert_eq!(sanitize_attachment_file_name("a:b]c[d.txt"), "a_b_c_d.txt");
        assert_eq!(
            sanitize_attachment_file_name("inv\u{202e}gpj.exe"),
            "inv_gpj.exe"
        );
        assert_eq!(sanitize_attachment_file_name("  ...hidden "), "hidden");
        assert_eq!(sanitize_attachment_file_name("   "), "attachment");
        assert_eq!(sanitize_attachment_file_name("nul.txt"), "_nul.txt");
        assert_eq!(sanitize_attachment_file_name("COM1"), "_COM1");
    }

    #[test]
    fn sanitize_caps_length_and_keeps_extension() {
        let long = format!("{}.pdf", "a".repeat(300));
        let out = sanitize_attachment_file_name(&long);
        assert_eq!(out.chars().count(), MAX_ATTACHMENT_FILE_NAME_CHARS);
        assert!(out.ends_with(".pdf"));
    }

    #[test]
    fn decode_accepts_files_and_sanitizes_names() {
        let media = decode_outbound_attachment_parts(
            &[file("dir/a.txt", b"one"), file("b.bin", b"two")],
            None,
        )
        .expect("ok");
        assert_eq!(media.files.len(), 2);
        assert_eq!(media.files[0].0, "a.txt");
        assert_eq!(media.files[1].1, b"two");
        assert!(media.image.is_none());
    }

    #[test]
    fn decode_rejects_too_many_files() {
        let files: Vec<_> = (0..=MAX_LXMF_FILE_ATTACHMENT_COUNT)
            .map(|i| file(&format!("f{i}.txt"), b"x"))
            .collect();
        let err = decode_outbound_attachment_parts(&files, None).expect_err("count");
        assert!(err.starts_with("attachment_count_exceeded"), "{err}");
    }

    #[test]
    fn decode_rejects_oversize_total_and_empty() {
        let half = vec![7u8; MAX_LXMF_FILE_ATTACHMENTS_TOTAL_BYTES / 2 + 1];
        let err = decode_outbound_attachment_parts(&[file("a", &half), file("b", &half)], None)
            .expect_err("total");
        assert!(err.starts_with("attachment_too_large"), "{err}");
        let err = decode_outbound_attachment_parts(&[file("a", b"")], None).expect_err("empty");
        assert_eq!(err, "attachment_empty");
        let err = decode_outbound_attachment_parts(
            &[LxmfFileAttachmentRequest {
                file_name: "a".into(),
                data_base64: "!!!not-base64".into(),
            }],
            None,
        )
        .expect_err("b64");
        assert!(err.starts_with("attachment_base64_decode"), "{err}");
    }

    #[test]
    fn decode_image_checks_format_magic_and_size() {
        let ok = decode_outbound_attachment_parts(
            &[],
            Some(&LxmfImageRequest {
                format: ".PNG".into(),
                data_base64: base64::engine::general_purpose::STANDARD.encode(PNG),
            }),
        )
        .expect("png");
        assert_eq!(ok.image.as_ref().map(|i| i.0.as_str()), Some("png"));

        let err = decode_outbound_attachment_parts(
            &[],
            Some(&LxmfImageRequest {
                format: "jpeg".into(),
                data_base64: base64::engine::general_purpose::STANDARD.encode(PNG),
            }),
        )
        .expect_err("mismatch");
        assert!(err.starts_with("image_magic_mismatch"), "{err}");

        let err = decode_outbound_attachment_parts(
            &[],
            Some(&LxmfImageRequest {
                format: "svg".into(),
                data_base64: "AAAA".into(),
            }),
        )
        .expect_err("fmt");
        assert!(err.starts_with("image_format_unsupported"), "{err}");

        let mut big = PNG.to_vec();
        big.resize(MAX_LXMF_IMAGE_FIELD_BYTES + 1, 0);
        let err = decode_outbound_attachment_parts(
            &[],
            Some(&LxmfImageRequest {
                format: "png".into(),
                data_base64: base64::engine::general_purpose::STANDARD.encode(&big),
            }),
        )
        .expect_err("big");
        assert!(err.starts_with("image_too_large"), "{err}");
    }
}
