use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};
use thiserror::Error;
use wasmtime::{
    component::{Component, Linker},
    Config, Engine, Store, StoreLimits, StoreLimitsBuilder,
};

const PLUGIN_MEMORY_LIMIT: usize = 32 * 1024 * 1024;
const PLUGIN_FUEL: u64 = 10_000_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub kind: PluginKind,
    #[serde(default)]
    pub permissions: Vec<PluginPermission>,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publisher_key_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature_base64: Option<String>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PluginKind {
    Protocol,
    Auth,
    Importer,
    Transformer,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PluginPermission {
    Network,
    FilesystemRead,
    FilesystemWrite,
    SecretsRead,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub manifest: PluginManifest,
    pub enabled: bool,
    pub sha256: String,
    pub signature_verified: bool,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginState {
    enabled: bool,
    sha256: String,
}

#[derive(Debug, Error)]
pub enum PluginError {
    #[error("invalid plugin manifest: {0}")]
    Manifest(String),
    #[error("plugin permission `{0}` was not granted")]
    Permission(String),
    #[error("invalid WebAssembly Component: {0}")]
    Component(String),
    #[error("plugin `{0}` not found")]
    NotFound(String),
    #[error("plugin `{0}` is disabled")]
    Disabled(String),
    #[error("plugin execution failed: {0}")]
    Execution(String),
    #[error("plugin storage error: {0}")]
    Storage(String),
    #[error("plugin signature error: {0}")]
    Signature(String),
}

struct HostState {
    limits: StoreLimits,
}
pub struct PluginManager {
    root: PathBuf,
    engine: Engine,
    granted: HashSet<PluginPermission>,
    trusted_keys: HashMap<String, VerifyingKey>,
    allow_unsigned: bool,
}

impl PluginManager {
    pub fn new(
        root: impl Into<PathBuf>,
        granted: impl IntoIterator<Item = PluginPermission>,
    ) -> Result<Self, PluginError> {
        let mut config = Config::new();
        config.wasm_component_model(true).consume_fuel(true);
        let engine =
            Engine::new(&config).map_err(|error| PluginError::Component(error.to_string()))?;
        Ok(Self {
            root: root.into(),
            engine,
            granted: granted.into_iter().collect(),
            trusted_keys: HashMap::new(),
            allow_unsigned: true,
        })
    }
    pub fn new_with_trust(
        root: impl Into<PathBuf>,
        granted: impl IntoIterator<Item = PluginPermission>,
        trusted_keys: impl IntoIterator<Item = (String, [u8; 32])>,
        allow_unsigned: bool,
    ) -> Result<Self, PluginError> {
        let mut manager = Self::new(root, granted)?;
        manager.trusted_keys = trusted_keys
            .into_iter()
            .map(|(id, bytes)| {
                VerifyingKey::from_bytes(&bytes)
                    .map(|key| (id, key))
                    .map_err(|error| PluginError::Signature(error.to_string()))
            })
            .collect::<Result<HashMap<_, _>, _>>()?;
        manager.allow_unsigned = allow_unsigned;
        Ok(manager)
    }
    pub fn new_from_env(
        root: impl Into<PathBuf>,
        granted: impl IntoIterator<Item = PluginPermission>,
    ) -> Result<Self, PluginError> {
        let raw = std::env::var("APIVOY_PLUGIN_TRUSTED_KEYS").unwrap_or_else(|_| "{}".into());
        let encoded: HashMap<String, String> = serde_json::from_str(&raw).map_err(|error| {
            PluginError::Signature(format!(
                "APIVOY_PLUGIN_TRUSTED_KEYS must be a JSON object: {error}"
            ))
        })?;
        let keys = encoded
            .into_iter()
            .map(|(id, value)| {
                let bytes = BASE64.decode(value).map_err(|error| {
                    PluginError::Signature(format!("trusted key `{id}`: {error}"))
                })?;
                let bytes: [u8; 32] = bytes.try_into().map_err(|_| {
                    PluginError::Signature(format!("trusted key `{id}` must contain 32 bytes"))
                })?;
                Ok((id, bytes))
            })
            .collect::<Result<Vec<_>, PluginError>>()?;
        let allow_unsigned = std::env::var("APIVOY_ALLOW_UNSIGNED_PLUGINS")
            .is_ok_and(|value| value == "1" || value.eq_ignore_ascii_case("true"));
        Self::new_with_trust(root, granted, keys, allow_unsigned)
    }
    pub fn install(
        &self,
        manifest: PluginManifest,
        bytes: &[u8],
    ) -> Result<InstalledPlugin, PluginError> {
        validate_manifest(&manifest)?;
        for permission in &manifest.permissions {
            if !self.granted.contains(permission) {
                return Err(PluginError::Permission(format!("{permission:?}")));
            }
        }
        Component::from_binary(&self.engine, bytes)
            .map_err(|error| PluginError::Component(error.to_string()))?;
        let sha256 = format!("{:x}", Sha256::digest(bytes));
        let signature_verified = self.verify_signature(&manifest, bytes)?;
        let directory = self.root.join(&manifest.id);
        fs::create_dir_all(&directory).map_err(storage)?;
        fs::write(directory.join("plugin.wasm"), bytes).map_err(storage)?;
        fs::write(
            directory.join("manifest.json"),
            serde_json::to_vec_pretty(&manifest).map_err(storage)?,
        )
        .map_err(storage)?;
        let state = PluginState {
            enabled: true,
            sha256: sha256.clone(),
        };
        fs::write(
            directory.join("state.json"),
            serde_json::to_vec_pretty(&state).map_err(storage)?,
        )
        .map_err(storage)?;
        Ok(InstalledPlugin {
            manifest,
            enabled: true,
            sha256,
            signature_verified,
        })
    }
    pub fn list(&self) -> Result<Vec<InstalledPlugin>, PluginError> {
        if !self.root.exists() {
            return Ok(vec![]);
        }
        let mut plugins = Vec::new();
        for entry in fs::read_dir(&self.root).map_err(storage)? {
            let directory = entry.map_err(storage)?.path();
            if !directory.is_dir() {
                continue;
            }
            if let (Ok(manifest), Ok(state)) = (
                read_json::<PluginManifest>(&directory.join("manifest.json")),
                read_json::<PluginState>(&directory.join("state.json")),
            ) {
                let signature_verified = if manifest.signature_base64.is_some() {
                    self.verify_signature(
                        &manifest,
                        &fs::read(directory.join("plugin.wasm")).map_err(storage)?,
                    )?
                } else {
                    false
                };
                plugins.push(InstalledPlugin {
                    manifest,
                    enabled: state.enabled,
                    sha256: state.sha256,
                    signature_verified,
                });
            }
        }
        plugins.sort_by(|a, b| a.manifest.name.cmp(&b.manifest.name));
        Ok(plugins)
    }
    pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<(), PluginError> {
        let directory = self.plugin_directory(id)?;
        let mut state = read_json::<PluginState>(&directory.join("state.json"))?;
        state.enabled = enabled;
        fs::write(
            directory.join("state.json"),
            serde_json::to_vec_pretty(&state).map_err(storage)?,
        )
        .map_err(storage)
    }
    pub fn uninstall(&self, id: &str) -> Result<(), PluginError> {
        let directory = self.plugin_directory(id)?;
        fs::remove_dir_all(directory).map_err(storage)
    }
    pub fn transform(&self, id: &str, input: &str) -> Result<String, PluginError> {
        self.invoke_typed(id, PluginKind::Transformer, "transform", input)
    }
    pub fn execute_protocol(&self, id: &str, input: &str) -> Result<String, PluginError> {
        self.invoke_typed(id, PluginKind::Protocol, "execute", input)
    }
    pub fn apply_auth(&self, id: &str, input: &str) -> Result<String, PluginError> {
        self.invoke_typed(id, PluginKind::Auth, "apply-auth", input)
    }
    pub fn import(&self, id: &str, input: &str) -> Result<String, PluginError> {
        self.invoke_typed(id, PluginKind::Importer, "import", input)
    }
    pub fn invoke(&self, id: &str, input: &str) -> Result<String, PluginError> {
        let plugin = self
            .list()?
            .into_iter()
            .find(|plugin| plugin.manifest.id == id)
            .ok_or_else(|| PluginError::NotFound(id.into()))?;
        match plugin.manifest.kind {
            PluginKind::Transformer => self.transform(id, input),
            PluginKind::Protocol => self.execute_protocol(id, input),
            PluginKind::Auth => self.apply_auth(id, input),
            PluginKind::Importer => self.import(id, input),
        }
    }
    fn invoke_typed(
        &self,
        id: &str,
        expected_kind: PluginKind,
        export_name: &str,
        input: &str,
    ) -> Result<String, PluginError> {
        let plugin = self
            .list()?
            .into_iter()
            .find(|plugin| plugin.manifest.id == id)
            .ok_or_else(|| PluginError::NotFound(id.into()))?;
        if !plugin.enabled {
            return Err(PluginError::Disabled(id.into()));
        }
        if plugin.manifest.kind != expected_kind {
            return Err(PluginError::Manifest(format!(
                "plugin `{id}` is {:?}, expected {:?}",
                plugin.manifest.kind, expected_kind
            )));
        }
        let bytes = fs::read(self.root.join(id).join("plugin.wasm")).map_err(storage)?;
        let actual = format!("{:x}", Sha256::digest(&bytes));
        if actual != plugin.sha256 {
            return Err(PluginError::Component(
                "plugin checksum changed after installation".into(),
            ));
        }
        self.verify_signature(&plugin.manifest, &bytes)?;
        let component = Component::from_binary(&self.engine, &bytes)
            .map_err(|error| PluginError::Component(error.to_string()))?;
        let linker = Linker::<HostState>::new(&self.engine);
        let limits = StoreLimitsBuilder::new()
            .memory_size(PLUGIN_MEMORY_LIMIT)
            .instances(16)
            .tables(16)
            .build();
        let mut store = Store::new(&self.engine, HostState { limits });
        store.limiter(|state| &mut state.limits);
        store
            .set_fuel(PLUGIN_FUEL)
            .map_err(|error| PluginError::Execution(error.to_string()))?;
        let instance = linker
            .instantiate(&mut store, &component)
            .map_err(|error| PluginError::Execution(error.to_string()))?;
        let function = instance
            .get_typed_func::<(String,), (String,)>(&mut store, export_name)
            .map_err(|error| {
                PluginError::Execution(format!(
                    "missing export {export_name}(string) -> string: {error}"
                ))
            })?;
        let (output,) = function
            .call(&mut store, (input.to_owned(),))
            .map_err(|error| PluginError::Execution(error.to_string()))?;
        Ok(output)
    }
    fn plugin_directory(&self, id: &str) -> Result<PathBuf, PluginError> {
        validate_id(id)?;
        let path = self.root.join(id);
        if path.is_dir() {
            Ok(path)
        } else {
            Err(PluginError::NotFound(id.into()))
        }
    }
    fn verify_signature(
        &self,
        manifest: &PluginManifest,
        plugin_bytes: &[u8],
    ) -> Result<bool, PluginError> {
        match (&manifest.publisher_key_id, &manifest.signature_base64) {
            (None, None) if self.allow_unsigned => Ok(false),
            (None, None) => Err(PluginError::Signature(
                "unsigned plugins are disabled".into(),
            )),
            (Some(key_id), Some(encoded)) => {
                let key = self.trusted_keys.get(key_id).ok_or_else(|| {
                    PluginError::Signature(format!("publisher key `{key_id}` is not trusted"))
                })?;
                let signature_bytes = BASE64
                    .decode(encoded)
                    .map_err(|error| PluginError::Signature(error.to_string()))?;
                let signature = Signature::from_slice(&signature_bytes)
                    .map_err(|error| PluginError::Signature(error.to_string()))?;
                key.verify(
                    &plugin_signature_payload(manifest, plugin_bytes),
                    &signature,
                )
                .map_err(|error| PluginError::Signature(error.to_string()))?;
                Ok(true)
            }
            _ => Err(PluginError::Signature(
                "publisherKeyId and signatureBase64 must be supplied together".into(),
            )),
        }
    }
}

pub fn plugin_signature_payload(manifest: &PluginManifest, plugin_bytes: &[u8]) -> Vec<u8> {
    let metadata = serde_json::json!({ "id": manifest.id, "name": manifest.name, "version": manifest.version, "kind": manifest.kind, "permissions": manifest.permissions, "description": manifest.description, "publisherKeyId": manifest.publisher_key_id });
    let mut payload = b"ApiVoy Plugin Signature v1\0".to_vec();
    payload.extend_from_slice(&Sha256::digest(plugin_bytes));
    payload.extend_from_slice(
        &serde_json::to_vec(&metadata).expect("signature metadata is serializable"),
    );
    payload
}

fn validate_manifest(manifest: &PluginManifest) -> Result<(), PluginError> {
    validate_id(&manifest.id)?;
    if manifest.name.trim().is_empty() || manifest.version.trim().is_empty() {
        return Err(PluginError::Manifest(
            "name and version are required".into(),
        ));
    }
    Ok(())
}
fn validate_id(id: &str) -> Result<(), PluginError> {
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(PluginError::Manifest(
            "id must contain only ASCII letters, digits, '-' or '_'".into(),
        ));
    }
    Ok(())
}
fn storage(error: impl std::fmt::Display) -> PluginError {
    PluginError::Storage(error.to_string())
}
fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, PluginError> {
    serde_json::from_slice(&fs::read(path).map_err(storage)?).map_err(storage)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    fn manifest() -> PluginManifest {
        PluginManifest {
            id: "example-transform".into(),
            name: "Example".into(),
            version: "1.0.0".into(),
            kind: PluginKind::Transformer,
            permissions: vec![],
            description: String::new(),
            publisher_key_id: None,
            signature_base64: None,
        }
    }
    #[test]
    fn rejects_path_traversal_and_ungranted_permissions() {
        let directory = tempfile::tempdir().unwrap();
        let manager = PluginManager::new(directory.path(), []).unwrap();
        let mut bad = manifest();
        bad.id = "../escape".into();
        assert!(matches!(
            manager.install(bad, b"bad"),
            Err(PluginError::Manifest(_))
        ));
        let mut denied = manifest();
        denied.permissions = vec![PluginPermission::Network];
        assert!(matches!(
            manager.install(denied, b"bad"),
            Err(PluginError::Permission(_))
        ));
    }
    #[test]
    fn rejects_core_wasm_and_invalid_components() {
        let directory = tempfile::tempdir().unwrap();
        let manager = PluginManager::new(directory.path(), []).unwrap();
        let core_wasm = wat::parse_str("(module)").unwrap();
        assert!(matches!(
            manager.install(manifest(), &core_wasm),
            Err(PluginError::Component(_))
        ));
    }

    #[test]
    fn installs_lists_disables_and_detects_missing_export() {
        let directory = tempfile::tempdir().unwrap();
        let manager = PluginManager::new(directory.path(), []).unwrap();
        let component = wat::parse_str("(component)").unwrap();
        let installed = manager.install(manifest(), &component).unwrap();
        assert!(installed.enabled);
        assert_eq!(manager.list().unwrap().len(), 1);
        assert!(matches!(
            manager.transform("example-transform", "input"),
            Err(PluginError::Execution(_))
        ));
        assert!(matches!(
            manager.execute_protocol("example-transform", "input"),
            Err(PluginError::Manifest(_))
        ));
        assert!(matches!(
            manager.invoke("example-transform", "input"),
            Err(PluginError::Execution(_))
        ));
        manager.set_enabled("example-transform", false).unwrap();
        assert!(matches!(
            manager.transform("example-transform", "input"),
            Err(PluginError::Disabled(_))
        ));
        manager.uninstall("example-transform").unwrap();
        assert!(manager.list().unwrap().is_empty());
    }

    #[test]
    fn verifies_trusted_ed25519_signature_and_rejects_tampering() {
        let directory = tempfile::tempdir().unwrap();
        let signing = SigningKey::from_bytes(&[7u8; 32]);
        let manager = PluginManager::new_with_trust(
            directory.path(),
            [],
            [("official".into(), signing.verifying_key().to_bytes())],
            false,
        )
        .unwrap();
        let component = wat::parse_str("(component)").unwrap();
        let mut signed = manifest();
        signed.publisher_key_id = Some("official".into());
        signed.signature_base64 = Some(
            BASE64.encode(
                signing
                    .sign(&plugin_signature_payload(&signed, &component))
                    .to_bytes(),
            ),
        );
        let installed = manager.install(signed.clone(), &component).unwrap();
        assert!(installed.signature_verified);
        let mut tampered = signed;
        tampered.version = "2.0.0".into();
        assert!(matches!(
            manager.install(tampered, &component),
            Err(PluginError::Signature(_))
        ));
        assert!(matches!(
            manager.install(manifest(), &component),
            Err(PluginError::Signature(_))
        ));
    }
}
