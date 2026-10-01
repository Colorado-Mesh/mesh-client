//! Read and edit a hosted page's `{page}.allowed` companion (NomadNet ACL).
//!
//! rsNomad's content API refuses every `.allowed` path so allowlists are never
//! listed or served. The page path is therefore validated with rsNomad's own
//! resolver (traversal, symlinks, hidden names) and the companion is resolved
//! beside it; callers never pass the `.allowed` path itself.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use nomad_core::{NomadError, resolve_under_root};

/// Allowlists hold one 32-hex hash per line; 64 KiB is far beyond any real list.
pub const PAGE_ACL_MAX_BYTES: usize = 64 * 1024;

const ACL_SUFFIX: &str = ".allowed";

fn path_error(op: &str, rel: &str, err: &NomadError) -> String {
    let code = match err {
        NomadError::NotFound(_) => "page_not_found",
        NomadError::PathTraversal | NomadError::InvalidPath(_) => "invalid_page_path",
        NomadError::TooLarge { .. } => "page_too_large",
        NomadError::Io(_) => "page_io_error",
        NomadError::Message(_) | NomadError::TransportClosed => "page_write_failed",
    };
    tracing::warn!("[nomad-serving] {op} page acl {rel} failed ({code}): {err}");
    code.to_string()
}

fn io_error(op: &str, rel: &str, err: &std::io::Error) -> String {
    tracing::warn!("[nomad-serving] {op} page acl {rel} failed (page_io_error): {err}");
    "page_io_error".to_string()
}

/// Resolve `{page}.allowed` for an existing hosted page.
fn acl_path(pages_dir: &Path, page_rel: &str, op: &str) -> Result<PathBuf, String> {
    let page = resolve_under_root(pages_dir, page_rel).map_err(|e| path_error(op, page_rel, &e))?;
    match fs::symlink_metadata(&page) {
        Ok(meta) if meta.is_file() => {}
        Ok(_) => return Err("invalid_page_path".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err("page_not_found".into());
        }
        Err(e) => return Err(io_error(op, page_rel, &e)),
    }
    let mut name = page
        .file_name()
        .ok_or_else(|| "invalid_page_path".to_string())?
        .to_os_string();
    name.push(ACL_SUFFIX);
    let acl = page.with_file_name(name);
    match fs::symlink_metadata(&acl) {
        Ok(meta) if !meta.is_file() => Err("invalid_page_path".into()),
        Ok(_) => Ok(acl),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(acl),
        Err(e) => Err(io_error(op, page_rel, &e)),
    }
}

/// `Ok(None)` when the page has no allowlist (anyone may fetch it).
pub fn read_page_acl(pages_dir: &Path, page_rel: &str) -> Result<Option<String>, String> {
    let acl = acl_path(pages_dir, page_rel, "read")?;
    let meta = match fs::metadata(&acl) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(io_error("read", page_rel, &e)),
    };
    if meta.len() > PAGE_ACL_MAX_BYTES as u64 {
        return Err("page_too_large".into());
    }
    let bytes = fs::read(&acl).map_err(|e| io_error("read", page_rel, &e))?;
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| "page_not_utf8".to_string())
}

pub fn write_page_acl(pages_dir: &Path, page_rel: &str, content: &str) -> Result<(), String> {
    if content.len() > PAGE_ACL_MAX_BYTES {
        return Err("page_too_large".into());
    }
    let acl = acl_path(pages_dir, page_rel, "write")?;
    let parent = acl
        .parent()
        .ok_or_else(|| "invalid_page_path".to_string())?;
    let mut tmp =
        tempfile::NamedTempFile::new_in(parent).map_err(|e| io_error("write", page_rel, &e))?;
    tmp.write_all(content.as_bytes())
        .and_then(|()| tmp.flush())
        .map_err(|e| io_error("write", page_rel, &e))?;
    tmp.persist(&acl)
        .map_err(|e| io_error("write", page_rel, &e.error))?;
    Ok(())
}

/// Removing a missing allowlist is a no-op so the page ends up public either way.
pub fn delete_page_acl(pages_dir: &Path, page_rel: &str) -> Result<(), String> {
    let acl = acl_path(pages_dir, page_rel, "delete")?;
    match fs::remove_file(&acl) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(io_error("delete", page_rel, &e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pages_with_index() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("index.mu"), b">Hello").expect("page");
        dir
    }

    #[test]
    fn missing_allowlist_reads_as_none() {
        let dir = pages_with_index();
        assert_eq!(read_page_acl(dir.path(), "index.mu"), Ok(None));
    }

    #[test]
    fn write_read_delete_round_trip() {
        let dir = pages_with_index();
        let body = "# friends\n0123456789abcdef0123456789abcdef\n";
        write_page_acl(dir.path(), "index.mu", body).expect("write");
        assert_eq!(
            fs::read_to_string(dir.path().join("index.mu.allowed")).expect("file"),
            body
        );
        assert_eq!(
            read_page_acl(dir.path(), "index.mu"),
            Ok(Some(body.to_string()))
        );
        delete_page_acl(dir.path(), "index.mu").expect("delete");
        assert!(!dir.path().join("index.mu.allowed").exists());
        delete_page_acl(dir.path(), "index.mu").expect("delete is idempotent");
    }

    #[test]
    fn nested_pages_get_a_sibling_allowlist() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::create_dir_all(dir.path().join("members")).expect("dir");
        fs::write(dir.path().join("members/board.mu"), b">Board").expect("page");
        write_page_acl(dir.path(), "members/board.mu", "abc\n").expect("write");
        assert!(dir.path().join("members/board.mu.allowed").is_file());
    }

    #[test]
    fn rejects_allowlist_and_traversal_paths() {
        let dir = pages_with_index();
        assert_eq!(
            write_page_acl(dir.path(), "index.mu.allowed", "x"),
            Err("invalid_page_path".into())
        );
        assert_eq!(
            read_page_acl(dir.path(), "../index.mu"),
            Err("invalid_page_path".into())
        );
        assert_eq!(
            delete_page_acl(dir.path(), ".hidden.mu"),
            Err("invalid_page_path".into())
        );
    }

    #[test]
    fn requires_an_existing_page() {
        let dir = pages_with_index();
        assert_eq!(
            write_page_acl(dir.path(), "missing.mu", "x"),
            Err("page_not_found".into())
        );
        assert!(!dir.path().join("missing.mu.allowed").exists());
    }

    #[test]
    fn rejects_oversized_allowlists() {
        let dir = pages_with_index();
        let big = "a".repeat(PAGE_ACL_MAX_BYTES + 1);
        assert_eq!(
            write_page_acl(dir.path(), "index.mu", &big),
            Err("page_too_large".into())
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_allowlist() {
        let dir = pages_with_index();
        let outside = tempfile::tempdir().expect("outside");
        let target = outside.path().join("elsewhere");
        fs::write(&target, b"x").expect("target");
        std::os::unix::fs::symlink(&target, dir.path().join("index.mu.allowed")).expect("link");
        assert_eq!(
            write_page_acl(dir.path(), "index.mu", "y"),
            Err("invalid_page_path".into())
        );
        assert_eq!(fs::read_to_string(&target).expect("target"), "x");
    }
}
