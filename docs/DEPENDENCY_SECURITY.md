# Rust dependency security exceptions

`cargo audit` is configured to fail on every vulnerability and informational
warning unless the advisory ID is explicitly listed in `.cargo/audit.toml`.
The exceptions below were last reviewed on 2026-08-12.

## Current exceptions

| Advisory group | Dependency path | Assessment | Removal trigger |
| --- | --- | --- | --- |
| `RUSTSEC-2024-0411` through `RUSTSEC-2024-0420` (GTK3 bindings) | `apivoy-desktop -> Tauri/Wry -> gtk-rs 0.18` | Linux-only, unmaintained upstream bindings required by the current Tauri WebKit backend. | Remove when Tauri/Wry ships a maintained Linux GTK backend and ApiVoy upgrades to it. |
| `RUSTSEC-2024-0370` (`proc-macro-error`) | `gtk3-macros` / `glib-macros` | Build-time macro dependency in the same GTK3 chain. | Remove with the GTK3 exception group or when gtk-rs replaces the macro dependency. |
| `RUSTSEC-2025-0075`, `RUSTSEC-2025-0080`, `RUSTSEC-2025-0081`, `RUSTSEC-2025-0098`, `RUSTSEC-2025-0100` (UNIC 0.9) | `apivoy-desktop -> tauri-utils -> urlpattern 0.3.0 -> UNIC` | Unmaintained transitive parser dependencies; no direct ApiVoy dependency. | Remove when `tauri-utils` or `urlpattern` migrates away from UNIC 0.9. |
| `RUSTSEC-2024-0429` (`glib`) | `apivoy-desktop -> Tauri/Wry -> glib 0.18` | The advisory affects `VariantStrIter`; neither ApiVoy nor the resolved Tauri/Wry sources reference that API. | Remove on a Tauri GTK stack upgrade or if the affected API becomes reachable. |

These are dependency-maintenance exceptions, not blanket category ignores. New
RustSec entries still fail CI. Review the list whenever Tauri, Wry, `tauri-utils`,
or `urlpattern` changes, and at least once per release cycle.
