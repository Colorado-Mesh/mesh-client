//! Nomad Network file download helpers.

/// Basename for a Nomad `/file/...` request path (matches nomadnet Node.serve_file naming).
pub fn nomad_file_name_from_path(path: &str) -> String {
    path.strip_prefix("/file/")
        .unwrap_or(path)
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("downloaded_file")
        .to_string()
}

/// Prefer Resource metadata `{"name": <path bytes>}` when present (NomadNet
/// `serve_file` / `ReplyFile`), else fall back to the request path basename.
pub fn nomad_file_name_from_metadata_or_path(metadata: Option<&[u8]>, path: &str) -> String {
    if let Some(meta) = metadata {
        if let Some(name) = file_name_from_resource_metadata(meta) {
            return name;
        }
    }
    nomad_file_name_from_path(path)
}

fn file_name_from_resource_metadata(metadata: &[u8]) -> Option<String> {
    let value = rmpv::decode::read_value(&mut &metadata[..]).ok()?;
    let map = value.as_map()?;
    for (key, val) in map {
        if key.as_str() != Some("name") {
            continue;
        }
        let raw = match val {
            rmpv::Value::Binary(bin) => bin.as_slice(),
            rmpv::Value::String(s) => s.as_bytes(),
            _ => continue,
        };
        let name = String::from_utf8_lossy(raw);
        let base = name
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(name.as_ref())
            .trim();
        if !base.is_empty() {
            return Some(base.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{
        file_name_from_resource_metadata, nomad_file_name_from_metadata_or_path,
        nomad_file_name_from_path,
    };

    #[test]
    fn file_name_from_path_uses_basename() {
        assert_eq!(
            nomad_file_name_from_path("/file/docs/readme.txt"),
            "readme.txt"
        );
        assert_eq!(nomad_file_name_from_path("/file/image.png"), "image.png");
    }

    #[test]
    fn file_name_from_path_falls_back_when_empty() {
        assert_eq!(nomad_file_name_from_path("/file/"), "downloaded_file");
    }

    #[test]
    fn metadata_name_wins_over_path_basename() {
        let mut meta = Vec::new();
        rmpv::encode::write_value(
            &mut meta,
            &rmpv::Value::Map(vec![(
                rmpv::Value::String("name".into()),
                rmpv::Value::Binary(b"photos/pic.png".to_vec()),
            )]),
        )
        .unwrap();
        assert_eq!(
            file_name_from_resource_metadata(&meta).as_deref(),
            Some("pic.png")
        );
        assert_eq!(
            nomad_file_name_from_metadata_or_path(Some(&meta), "/file/other.bin"),
            "pic.png"
        );
        assert_eq!(
            nomad_file_name_from_metadata_or_path(None, "/file/other.bin"),
            "other.bin"
        );
    }
}
