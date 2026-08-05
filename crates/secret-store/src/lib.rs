//! Secret store facade with OS Keychain backend and memory fallback.
//!
//! Project files / SQLite store only `secret_ref` names. Plaintext never lands
//! in the local DB. A small redaction helper masks known secret values in logs.

use std::collections::HashMap;
use std::sync::RwLock;

use keyring::Entry;
use thiserror::Error;
use tracing::warn;

const SERVICE: &str = "apivoy.secrets";

#[derive(Debug, Error)]
pub enum SecretError {
    #[error("secret `{0}` not found")]
    NotFound(String),
    #[error("secret store lock poisoned")]
    LockPoisoned,
    #[error("keychain: {0}")]
    Keychain(String),
}

/// Where secrets are persisted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretBackendKind {
    /// Process-local map (tests / CI / keychain unavailable).
    Memory,
    /// OS credential store via `keyring`.
    Keychain,
}

pub struct SecretStore {
    kind: SecretBackendKind,
    /// Always kept as a write-through cache for redaction + offline reads.
    cache: RwLock<HashMap<String, String>>,
}

impl Default for SecretStore {
    fn default() -> Self {
        Self::with_keychain()
    }
}

impl SecretStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Prefer OS keychain; fall back to memory if unavailable.
    pub fn with_keychain() -> Self {
        // Probe keyring with a throwaway lookup; some CI images lack a session bus.
        match Entry::new(SERVICE, "__apivoy_probe__") {
            Ok(entry) => match entry.get_password() {
                Ok(_) | Err(keyring::Error::NoEntry) => Self {
                    kind: SecretBackendKind::Keychain,
                    cache: RwLock::new(HashMap::new()),
                },
                Err(err) => {
                    warn!(error = %err, "keychain unavailable; using in-memory secret store");
                    Self::memory()
                }
            },
            Err(err) => {
                warn!(error = %err, "keychain init failed; using in-memory secret store");
                Self::memory()
            }
        }
    }

    pub fn memory() -> Self {
        Self {
            kind: SecretBackendKind::Memory,
            cache: RwLock::new(HashMap::new()),
        }
    }

    pub fn backend_kind(&self) -> SecretBackendKind {
        self.kind
    }

    pub fn put_ref(&self, name: impl Into<String>, value: impl Into<String>) -> Result<(), SecretError> {
        let name = name.into();
        let value = value.into();
        if self.kind == SecretBackendKind::Keychain {
            let entry = Entry::new(SERVICE, &name).map_err(|e| SecretError::Keychain(e.to_string()))?;
            entry
                .set_password(&value)
                .map_err(|e| SecretError::Keychain(e.to_string()))?;
        }
        let mut guard = self.cache.write().map_err(|_| SecretError::LockPoisoned)?;
        guard.insert(name, value);
        Ok(())
    }

    pub fn resolve(&self, name: &str) -> Result<String, SecretError> {
        {
            let guard = self.cache.read().map_err(|_| SecretError::LockPoisoned)?;
            if let Some(v) = guard.get(name) {
                return Ok(v.clone());
            }
        }
        if self.kind == SecretBackendKind::Keychain {
            let entry = Entry::new(SERVICE, name).map_err(|e| SecretError::Keychain(e.to_string()))?;
            match entry.get_password() {
                Ok(value) => {
                    let mut guard = self.cache.write().map_err(|_| SecretError::LockPoisoned)?;
                    guard.insert(name.to_string(), value.clone());
                    return Ok(value);
                }
                Err(keyring::Error::NoEntry) => {}
                Err(err) => return Err(SecretError::Keychain(err.to_string())),
            }
        }
        Err(SecretError::NotFound(name.to_string()))
    }

    pub fn delete(&self, name: &str) -> Result<(), SecretError> {
        if self.kind == SecretBackendKind::Keychain {
            let entry = Entry::new(SERVICE, name).map_err(|e| SecretError::Keychain(e.to_string()))?;
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(err) => return Err(SecretError::Keychain(err.to_string())),
            }
        }
        let mut guard = self.cache.write().map_err(|_| SecretError::LockPoisoned)?;
        guard.remove(name);
        Ok(())
    }

    /// Returns only whether a secret exists; never exposes the value to UI layers.
    pub fn exists(&self, name: &str) -> Result<bool, SecretError> {
        match self.resolve(name) {
            Ok(_) => Ok(true),
            Err(SecretError::NotFound(_)) => Ok(false),
            Err(err) => Err(err),
        }
    }

    /// Mask known secret values in free-form text (logs / export preview).
    pub fn redact(&self, text: &str) -> Result<String, SecretError> {
        let guard = self.cache.read().map_err(|_| SecretError::LockPoisoned)?;
        let mut out = text.to_string();
        for value in guard.values() {
            if value.len() >= 4 {
                out = out.replace(value, "***");
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_roundtrip_and_redact() {
        let store = SecretStore::memory();
        store.put_ref("token", "super-secret-value").unwrap();
        assert_eq!(store.resolve("token").unwrap(), "super-secret-value");
        assert!(store.exists("token").unwrap());
        let redacted = store.redact("Bearer super-secret-value").unwrap();
        assert_eq!(redacted, "Bearer ***");
    }
}
