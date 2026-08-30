//! Shared Reticulum interface-type catalog.
//!
//! Loaded from `src/shared/reticulumInterfaceCatalog.json`, the same file the
//! renderer imports, so the sidecar and UI cannot drift on supported types,
//! config type names, default modes, or flow-control policy.

use std::collections::HashMap;
use std::sync::LazyLock;

use serde::Deserialize;

const CATALOG_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../src/shared/reticulumInterfaceCatalog.json"
));

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogField {
    pub key: String,
    pub kind: String,
    /// `InterfaceRow` field this maps to. `None` round-trips via `extra_config`.
    #[serde(default)]
    pub bind: Option<String>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub min: Option<i64>,
    #[serde(default)]
    pub max: Option<i64>,
    #[serde(default)]
    pub max_length: Option<usize>,
    #[serde(default)]
    pub options: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub config_type: String,
    #[serde(default)]
    pub default_mode: Option<String>,
    pub classify: String,
    pub uses_serial_port: bool,
    pub supports_flow_control: bool,
    #[serde(default)]
    pub default_flow_control: Option<bool>,
    #[serde(default)]
    pub fields: Vec<CatalogField>,
}

#[derive(Deserialize)]
struct CatalogFile {
    types: HashMap<String, CatalogEntry>,
}

pub struct InterfaceCatalog {
    /// Keys are leaked so lookups can return `&'static str` like the previous consts did.
    by_ui_type: HashMap<&'static str, CatalogEntry>,
    config_types: Vec<&'static str>,
    /// Production code only ever looks types up by name; this ordered list exists
    /// so invariant tests can sweep every entry.
    #[allow(dead_code)]
    ui_types: Vec<&'static str>,
}

impl InterfaceCatalog {
    fn load() -> Self {
        let file: CatalogFile = serde_json::from_str(CATALOG_JSON)
            .expect("reticulumInterfaceCatalog.json is malformed");

        let by_ui_type: HashMap<&'static str, CatalogEntry> = file
            .types
            .into_iter()
            .map(|(k, v)| (&*Box::leak(k.into_boxed_str()), v))
            .collect();

        let mut ui_types: Vec<&'static str> = by_ui_type.keys().copied().collect();
        ui_types.sort_unstable();

        let mut config_types: Vec<&'static str> = by_ui_type
            .values()
            .map(|e| &*Box::leak(e.config_type.clone().into_boxed_str()))
            .collect();
        config_types.sort_unstable();

        Self {
            by_ui_type,
            config_types,
            ui_types,
        }
    }

    pub fn get(&self, ui_type: &str) -> Option<&CatalogEntry> {
        self.by_ui_type.get(ui_type)
    }

    /// RNS config `type =` values mesh-client will parse out of a config file.
    pub fn supported_config_types(&self) -> &[&'static str] {
        &self.config_types
    }

    /// Every UI type key, sorted. Test-only sweep helper — see the field comment.
    #[allow(dead_code)]
    pub fn ui_types(&self) -> &[&'static str] {
        &self.ui_types
    }

    /// `type =` value → UI type key.
    pub fn ui_type_for_config_type(&self, config_type: &str) -> Option<&'static str> {
        self.by_ui_type
            .iter()
            .find(|(_, entry)| entry.config_type == config_type)
            .map(|(ui, _)| *ui)
    }

    /// UI type key → `type =` value.
    pub fn config_type_for_ui_type(&self, ui_type: &str) -> Option<&'static str> {
        let entry = self.by_ui_type.get(ui_type)?;
        self.config_types
            .iter()
            .copied()
            .find(|t| *t == entry.config_type)
    }
}

pub static INTERFACE_CATALOG: LazyLock<InterfaceCatalog> = LazyLock::new(InterfaceCatalog::load);

#[cfg(test)]
mod tests {
    use super::*;

    /// Every `configType` must be a name the upstream factory `synthesize_interface`
    /// accepts, otherwise the interface silently never comes up. `BlePeerInterface`
    /// is the documented exception: mesh-client spawns it from `live.rs`.
    const UPSTREAM_FACTORY_TYPES: &[&str] = &[
        "TCPClientInterface",
        "TCPServerInterface",
        "UDPInterface",
        "SerialInterface",
        "KISSInterface",
        "AutoInterface",
        "RNodeInterface",
        "LocalInterface",
        "I2PInterface",
        "PipeInterface",
        "RNodeMultiInterface",
        "AX25KISSInterface",
        "BackboneInterface",
    ];

    const MESH_CLIENT_SPAWNED_TYPES: &[&str] = &["BlePeerInterface"];

    #[test]
    fn every_config_type_is_constructible() {
        for ui in INTERFACE_CATALOG.ui_types() {
            let entry = INTERFACE_CATALOG.get(ui).expect("entry");
            let known = UPSTREAM_FACTORY_TYPES.contains(&entry.config_type.as_str())
                || MESH_CLIENT_SPAWNED_TYPES.contains(&entry.config_type.as_str());
            assert!(
                known,
                "{ui} has configType {} which no factory arm accepts",
                entry.config_type
            );
        }
    }

    #[test]
    fn config_types_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for ui in INTERFACE_CATALOG.ui_types() {
            let entry = INTERFACE_CATALOG.get(ui).expect("entry");
            assert!(
                seen.insert(entry.config_type.clone()),
                "duplicate configType {}",
                entry.config_type
            );
        }
    }

    #[test]
    fn round_trips_ui_and_config_type_names() {
        for ui in INTERFACE_CATALOG.ui_types() {
            let config_type = INTERFACE_CATALOG
                .config_type_for_ui_type(ui)
                .expect("config type");
            assert_eq!(
                INTERFACE_CATALOG.ui_type_for_config_type(config_type),
                Some(*ui)
            );
        }
    }

    #[test]
    fn flow_control_default_requires_support() {
        for ui in INTERFACE_CATALOG.ui_types() {
            let entry = INTERFACE_CATALOG.get(ui).expect("entry");
            if entry.default_flow_control.is_some() {
                assert!(
                    entry.supports_flow_control,
                    "{ui} sets defaultFlowControl without supportsFlowControl"
                );
            }
        }
    }

    #[test]
    fn bound_fields_use_known_row_bindings() {
        for ui in INTERFACE_CATALOG.ui_types() {
            let entry = INTERFACE_CATALOG.get(ui).expect("entry");
            for field in &entry.fields {
                if let Some(bind) = &field.bind {
                    assert!(
                        matches!(
                            bind.as_str(),
                            "serial_port" | "port" | "host" | "callsign" | "flow_control"
                        ),
                        "{ui}.{} binds unknown row field {bind}",
                        field.key
                    );
                }
            }
        }
    }

    #[test]
    fn preserves_legacy_supported_types() {
        for legacy in [
            "AutoInterface",
            "TCPClientInterface",
            "RNodeInterface",
            "UDPInterface",
            "KISSInterface",
            "PipeInterface",
            "I2PInterface",
            "RNodeMultiInterface",
            "BlePeerInterface",
        ] {
            assert!(
                INTERFACE_CATALOG.supported_config_types().contains(&legacy),
                "{legacy} dropped from catalog"
            );
        }
    }
}
