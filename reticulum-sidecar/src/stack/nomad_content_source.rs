//! Resolve a user-selected Nomad content folder into pages/files roots.

use std::fs;
use std::path::{Path, PathBuf};

/// How a selected path maps onto Nomad content roots.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NomadContentLayout {
    /// Selected path contains a `pages/` subdirectory (site root).
    SiteRoot,
    /// Selected path is itself the pages directory.
    PagesDir,
}

#[derive(Debug, Clone)]
pub struct ResolvedNomadContentRoots {
    pub layout: NomadContentLayout,
    /// Absolute path the user chose.
    pub content_source: PathBuf,
    pub pages_dir: PathBuf,
    pub files_dir: PathBuf,
    /// Display path for status (`content_root`) — site root or pages parent.
    pub content_root: PathBuf,
}

/// Error codes returned to the API / UI (stable snake_case).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContentSourceError {
    Required,
    NotFound,
    NotDirectory,
    Unreadable,
    InvalidLayout,
}

impl ContentSourceError {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Required => "content_source_required",
            Self::NotFound => "content_source_unavailable",
            Self::NotDirectory => "content_source_not_directory",
            Self::Unreadable => "content_source_unreadable",
            Self::InvalidLayout => "invalid_content_source",
        }
    }
}

impl std::fmt::Display for ContentSourceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

fn dir_has_mu_files(dir: &Path) -> bool {
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file()
            && path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("mu"))
        {
            return true;
        }
    }
    false
}

fn is_pages_named(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.eq_ignore_ascii_case("pages"))
}

/// Reject symlink entries that would escape the selected root when followed.
fn reject_symlink(path: &Path) -> Result<(), ContentSourceError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => Err(ContentSourceError::InvalidLayout),
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(ContentSourceError::Unreadable),
    }
}

/// Ensure `child` resolves under `root` (both should already be canonical when possible).
fn ensure_contained(root: &Path, child: &Path) -> Result<PathBuf, ContentSourceError> {
    reject_symlink(child)?;
    let child_canon = fs::canonicalize(child).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            ContentSourceError::NotFound
        } else {
            ContentSourceError::Unreadable
        }
    })?;
    if !child_canon.starts_with(root) {
        return Err(ContentSourceError::InvalidLayout);
    }
    Ok(child_canon)
}

/// Sibling `files/` under `content_root`. Missing dirs are returned as the expected
/// path (not created here). Existing non-directory or symlink entries are rejected.
fn resolve_files_dir(content_root: &Path) -> Result<PathBuf, ContentSourceError> {
    let site_files = content_root.join("files");
    if !site_files.exists() {
        return Ok(site_files);
    }
    reject_symlink(&site_files)?;
    if !site_files.is_dir() {
        return Err(ContentSourceError::InvalidLayout);
    }
    ensure_contained(content_root, &site_files)
}

/// Auto-detect whether `selected` is a site root (`pages/` child) or a pages directory.
pub fn detect_layout(selected: &Path) -> Result<NomadContentLayout, ContentSourceError> {
    if !selected.exists() {
        return Err(ContentSourceError::NotFound);
    }
    if !selected.is_dir() {
        return Err(ContentSourceError::NotDirectory);
    }
    // Probe readability.
    if fs::read_dir(selected).is_err() {
        return Err(ContentSourceError::Unreadable);
    }

    let pages_child = selected.join("pages");
    if pages_child.exists() {
        // Symlink `pages/` can escape the selected root on init writes.
        reject_symlink(&pages_child)?;
        if pages_child.is_dir() {
            if fs::read_dir(&pages_child).is_err() {
                return Err(ContentSourceError::Unreadable);
            }
            return Ok(NomadContentLayout::SiteRoot);
        }
    }

    if is_pages_named(selected) || dir_has_mu_files(selected) {
        return Ok(NomadContentLayout::PagesDir);
    }

    Err(ContentSourceError::InvalidLayout)
}

/// Resolve pages/files directories from a required external selection.
///
/// When sibling `files/` is missing, `files_dir` is still the expected path under
/// the watched tree (not created here). Opening a content store may create it.
pub fn resolve_content_roots(
    external: &Path,
) -> Result<ResolvedNomadContentRoots, ContentSourceError> {
    if external.as_os_str().is_empty() {
        return Err(ContentSourceError::Required);
    }

    let canonical = fs::canonicalize(external).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            ContentSourceError::NotFound
        } else {
            ContentSourceError::Unreadable
        }
    })?;

    let layout = detect_layout(&canonical)?;
    match layout {
        NomadContentLayout::SiteRoot => {
            let pages_dir = ensure_contained(&canonical, &canonical.join("pages"))?;
            let files_dir = resolve_files_dir(&canonical)?;
            Ok(ResolvedNomadContentRoots {
                layout,
                content_source: canonical.clone(),
                pages_dir,
                files_dir,
                content_root: canonical,
            })
        }
        NomadContentLayout::PagesDir => {
            let content_root = canonical
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| canonical.clone());
            let files_dir = resolve_files_dir(&content_root)?;
            Ok(ResolvedNomadContentRoots {
                layout,
                content_source: canonical.clone(),
                pages_dir: canonical,
                files_dir,
                content_root,
            })
        }
    }
}

/// Layout label for status JSON.
pub fn layout_label(layout: NomadContentLayout) -> &'static str {
    match layout {
        NomadContentLayout::SiteRoot => "site_root",
        NomadContentLayout::PagesDir => "pages_dir",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn test_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("mesh_nomad_src_{label}_{}", Uuid::new_v4()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn empty_path_required() {
        let err = resolve_content_roots(Path::new("")).unwrap_err();
        assert_eq!(err, ContentSourceError::Required);
        assert_eq!(err.as_str(), "content_source_required");
    }

    #[test]
    fn site_root_with_pages_uses_sibling_files_path_when_absent() {
        let dir = test_root("site");
        let site = dir.join("nomad-page");
        fs::create_dir_all(site.join("pages")).unwrap();
        fs::write(site.join("pages/index.mu"), b"> hi").unwrap();
        let resolved = resolve_content_roots(&site).unwrap();
        assert_eq!(resolved.layout, NomadContentLayout::SiteRoot);
        assert_eq!(
            resolved.pages_dir,
            fs::canonicalize(site.join("pages")).unwrap()
        );
        assert_eq!(resolved.files_dir, resolved.content_root.join("files"));
        assert!(!resolved.files_dir.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn site_root_uses_existing_files_dir() {
        let dir = test_root("site_files");
        let site = dir.join("site");
        fs::create_dir_all(site.join("pages")).unwrap();
        fs::create_dir_all(site.join("files")).unwrap();
        let resolved = resolve_content_roots(&site).unwrap();
        assert_eq!(
            resolved.files_dir,
            fs::canonicalize(site.join("files")).unwrap()
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn pages_dir_selection() {
        let dir = test_root("pages");
        let pages = dir.join("pages");
        fs::create_dir_all(&pages).unwrap();
        fs::write(pages.join("index.mu"), b"> hi").unwrap();
        let resolved = resolve_content_roots(&pages).unwrap();
        assert_eq!(resolved.layout, NomadContentLayout::PagesDir);
        assert_eq!(resolved.pages_dir, fs::canonicalize(&pages).unwrap());
        assert_eq!(resolved.files_dir, resolved.content_root.join("files"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn pages_dir_via_mu_files_without_pages_name() {
        let dir = test_root("mu");
        let custom = dir.join("my-mu");
        fs::create_dir_all(&custom).unwrap();
        fs::write(custom.join("about.mu"), b"> a").unwrap();
        let resolved = resolve_content_roots(&custom).unwrap();
        assert_eq!(resolved.layout, NomadContentLayout::PagesDir);
        assert_eq!(resolved.pages_dir, fs::canonicalize(&custom).unwrap());
        assert_eq!(resolved.files_dir, resolved.content_root.join("files"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_dir_rejected() {
        let dir = test_root("empty");
        let empty = dir.join("empty");
        fs::create_dir_all(&empty).unwrap();
        let err = resolve_content_roots(&empty).unwrap_err();
        assert_eq!(err, ContentSourceError::InvalidLayout);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_path_rejected() {
        let dir = test_root("missing");
        let missing = dir.join("nope");
        let err = resolve_content_roots(&missing).unwrap_err();
        assert_eq!(err, ContentSourceError::NotFound);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn not_directory_rejected() {
        let dir = test_root("file");
        let file = dir.join("not-a-dir");
        fs::write(&file, b"x").unwrap();
        let err = resolve_content_roots(&file).unwrap_err();
        assert_eq!(err, ContentSourceError::NotDirectory);
        assert_eq!(err.as_str(), "content_source_not_directory");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn pages_symlink_rejected() {
        let dir = test_root("symlink_pages");
        let site = dir.join("site");
        let outside = dir.join("outside");
        fs::create_dir_all(&site).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("index.mu"), b"> leak").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, site.join("pages")).unwrap();
            let err = resolve_content_roots(&site).unwrap_err();
            assert_eq!(err, ContentSourceError::InvalidLayout);
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn layout_label_covers_all_variants() {
        assert_eq!(layout_label(NomadContentLayout::SiteRoot), "site_root");
        assert_eq!(layout_label(NomadContentLayout::PagesDir), "pages_dir");
    }
}
