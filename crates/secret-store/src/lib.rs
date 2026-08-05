//! Secret store facade.
//!
//! Phase 0 keeps an in-memory stub. Production will use OS Keychain/Keyring
//! and never persist plaintext in SQLite or project files.

use std::collections::HashMap;
use std::sync::RwLock;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum SecretError {
    #[error("secret `{0}` not found")]
    NotFound(String),
    #[error("secret store lock poisoned")]
    LockPoisoned,
}

#[derive(Debug, Default)]
pub struct SecretStore {
    // Temporary in-memory map for scaffolding only.
    values: RwLock<HashMap<String, String>>,
}

impl SecretStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn put_ref(&self, name: impl Into<String>, value: impl Into<String>) -> Result<(), SecretError> {
        let mut guard = self.values.write().map_err(|_| SecretError::LockPoisoned)?;
        guard.insert(name.into(), value.into());
        Ok(())
    }

    pub fn resolve(&self, name: &str) -> Result<String, SecretError> {
        let guard = self.values.read().map_err(|_| SecretError::LockPoisoned)?;
        guard
            .get(name)
            .cloned()
            .ok_or_else(|| SecretError::NotFound(name.to_string()))
    }

    /// Returns only whether a secret exists; never exposes the value to UI layers.
    pub fn exists(&self, name: &str) -> Result<bool, SecretError> {
        let guard = self.values.read().map_err(|_| SecretError::LockPoisoned)?;
        Ok(guard.contains_key(name))
    }
}
