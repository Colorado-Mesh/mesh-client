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

#[cfg(test)]
mod tests {
    use super::nomad_file_name_from_path;

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
}
