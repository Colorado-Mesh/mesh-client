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
    /// No external selection — managed `storage/nomadnetwork`.
    Managed,
}

#[derive(Debug, Clone)]
pub struct ResolvedNomadContentRoots {
    pub layout: NomadContentLayout,
    /// Absolute path the user chose (None for managed).
    pub content_source: Option<PathBuf>,
    pub pages_dir: PathBuf,
    pub files_dir: PathBuf,
    /// Display path for status (`content_root`) — pages parent or managed base.
    pub content_root: PathBuf,
}

/// Error codes returned to the API / UI (stable snake_case).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContentSourceError {
    NotFound,
    NotDirectory,
    Unreadable,
    InvalidLayout,
}

impl ContentSourceError {
    pub fn as_str(&self) -> &'static str {
        match self {
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

/// Resolve pages/files directories from an optional external selection.
///
/// When `external` is `None`, use managed storage under `managed_base`
/// (`…/nomadnetwork` → pages + files).
///
/// For external site roots without an existing `files/` directory, files stay
/// under the managed base so we do not create `files/` inside the user's repo.
pub fn resolve_content_roots(
    managed_base: &Path,
    external: Option<&Path>,
) -> Result<ResolvedNomadContentRoots, ContentSourceError> {
    let managed_pages = managed_base.join("pages");
    let managed_files = managed_base.join("files");

    let Some(selected) = external else {
        return Ok(ResolvedNomadContentRoots {
            layout: NomadContentLayout::Managed,
            content_source: None,
            pages_dir: managed_pages,
            files_dir: managed_files,
            content_root: managed_base.to_path_buf(),
        });
    };

    let canonical = fs::canonicalize(selected).map_err(|e| {
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
            let site_files = canonical.join("files");
            let files_dir = if site_files.exists() {
                reject_symlink(&site_files)?;
                if site_files.is_dir() {
                    ensure_contained(&canonical, &site_files)?
                } else {
                    managed_files
                }
            } else {
                managed_files
            };
            Ok(ResolvedNomadContentRoots {
                layout,
                content_source: Some(canonical.clone()),
                pages_dir,
                files_dir,
                content_root: canonical,
            })
        }
        NomadContentLayout::PagesDir => Ok(ResolvedNomadContentRoots {
            layout,
            content_source: Some(canonical.clone()),
            pages_dir: canonical.clone(),
            files_dir: managed_files,
            content_root: canonical
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| canonical.clone()),
        }),
        NomadContentLayout::Managed => unreachable!("detect_layout never returns Managed"),
    }
}

/// Layout label for status JSON.
pub fn layout_label(layout: NomadContentLayout) -> &'static str {
    match layout {
        NomadContentLayout::SiteRoot => "site_root",
        NomadContentLayout::PagesDir => "pages_dir",
        NomadContentLayout::Managed => "managed",
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
    fn managed_when_no_external() {
        let dir = test_root("managed");
        let managed = dir.join("nomadnetwork");
        let resolved = resolve_content_roots(&managed, None).unwrap();
        assert_eq!(resolved.layout, NomadContentLayout::Managed);
        assert!(resolved.content_source.is_none());
        assert_eq!(resolved.pages_dir, managed.join("pages"));
        assert_eq!(resolved.files_dir, managed.join("files"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn site_root_with_pages_uses_managed_files_when_absent() {
        let dir = test_root("site");
        let site = dir.join("nomad-page");
        fs::create_dir_all(site.join("pages")).unwrap();
        fs::write(site.join("pages/index.mu"), b"> hi").unwrap();
        let managed = dir.join("nomadnetwork");
        let resolved = resolve_content_roots(&managed, Some(&site)).unwrap();
        assert_eq!(resolved.layout, NomadContentLayout::SiteRoot);
        assert_eq!(
            resolved.pages_dir,
            fs::canonicalize(site.join("pages")).unwrap()
        );
        assert_eq!(resolved.files_dir, managed.join("files"));
        assert!(!site.join("files").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn site_root_uses_existing_files_dir() {
        let dir = test_root("site_files");
        let site = dir.join("site");
        fs::create_dir_all(site.join("pages")).unwrap();
        fs::create_dir_all(site.join("files")).unwrap();
        let managed = dir.join("nomadnetwork");
        let resolved = resolve_content_roots(&managed, Some(&site)).unwrap();
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
        let managed = dir.join("nomadnetwork");
        let resolved = resolve_content_roots(&managed, Some(&pages)).unwrap();
        assert_eq!(resolved.layout, NomadContentLayout::PagesDir);
        assert_eq!(resolved.pages_dir, fs::canonicalize(&pages).unwrap());
        assert_eq!(resolved.files_dir, managed.join("files"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn pages_dir_via_mu_files_without_pages_name() {
        let dir = test_root("mu");
        let custom = dir.join("my-mu");
        fs::create_dir_all(&custom).unwrap();
        fs::write(custom.join("about.mu"), b"> a").unwrap();
        let managed = dir.join("nomadnetwork");
        let resolved = resolve_content_roots(&managed, Some(&custom)).unwrap();
        assert_eq!(resolved.layout, NomadContentLayout::PagesDir);
        assert_eq!(resolved.pages_dir, fs::canonicalize(&custom).unwrap());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_dir_rejected() {
        let dir = test_root("empty");
        let empty = dir.join("empty");
        fs::create_dir_all(&empty).unwrap();
        let managed = dir.join("nomadnetwork");
        let err = resolve_content_roots(&managed, Some(&empty)).unwrap_err();
        assert_eq!(err, ContentSourceError::InvalidLayout);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_path_rejected() {
        let dir = test_root("missing");
        let managed = dir.join("nomadnetwork");
        let missing = dir.join("nope");
        let err = resolve_content_roots(&managed, Some(&missing)).unwrap_err();
        assert_eq!(err, ContentSourceError::NotFound);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn not_directory_rejected() {
        let dir = test_root("file");
        let file = dir.join("not-a-dir");
        fs::write(&file, b"x").unwrap();
        let managed = dir.join("nomadnetwork");
        let err = resolve_content_roots(&managed, Some(&file)).unwrap_err();
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
            let managed = dir.join("nomadnetwork");
            let err = resolve_content_roots(&managed, Some(&site)).unwrap_err();
            assert_eq!(err, ContentSourceError::InvalidLayout);
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn layout_label_covers_all_variants() {
        assert_eq!(layout_label(NomadContentLayout::SiteRoot), "site_root");
        assert_eq!(layout_label(NomadContentLayout::PagesDir), "pages_dir");
        assert_eq!(layout_label(NomadContentLayout::Managed), "managed");
    }
}
