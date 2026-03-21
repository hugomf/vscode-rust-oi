# Change Log

All notable changes to the "rust-import-organizer" extension are documented in this file.

## [0.2.0] - 2026-03-20

### Added

**Auto-import with disambiguation**
- New command: `Organize Rust Imports + Auto Import` — detects unresolved symbols via Rust Analyzer and adds missing imports automatically
- When a symbol matches multiple crates, a QuickPick dropdown lets you choose the right one (same UX as the Java extension)
- Symbols with exactly one candidate are applied without prompting

**Organize on save**
- New setting `organizeOnSave` — runs the organizer automatically on every `.rs` file save
- Also integrates with VS Code's `source.organizeImports` Code Action, enabling:
  ```json
  { "[rust]": { "editor.codeActionsOnSave": { "source.organizeImports": "explicit" } } }
  ```

**Right-click context menu**
- Both commands now appear in the editor context menu under the modification group

**Conditional import group (`#[cfg(...)]`)**
- Imports preceded by a `#[cfg(...)]` attribute are placed in a dedicated fourth group at the end of the import block, with the attribute preserved on the line above each import
- cfg-gated imports are never removed by unused-import analysis (their usage cannot be determined statically)

**Standard library family expanded**
- `core::*` and `alloc::*` are now correctly classified as standard library, not external crates

**Cargo.toml-aware classification**
- The extension reads the workspace `Cargo.toml` to accurately classify workspace member crates as local imports rather than external
- Supports `[dependencies]`, `[dev-dependencies]`, `[build-dependencies]`, and `[workspace.members]`
- Hyphenated crate names are normalised to underscores for matching

**Unused import removal toggle**
- New setting `removeUnused` — set to `false` to only sort and group without removing anything

**Auto-import toggle**
- New setting `enableAutoImport` — disable auto-import while keeping organize-on-save

**Mid-file `pub use` detection**
- After organizing, the extension warns when it finds `pub use` or `#[cfg]-guarded use` statements that appear after the top-level import block — these are invisible to the organizer and may be unintentional re-exports

### Fixed

- **Inline `//` comments after `use` lines no longer break parsing** — `use std::fs::File; // comment` was previously causing the parser to consume the entire function body into the import statement
- **`r#` raw identifier prefixes in module paths** — `use crate::r#type::Foo` was silently dropped; now parsed correctly
- **`sqlx::Row` false removal** — `Row` is needed for `.get("field")` method calls but never appears as a bare identifier; now detected via `.get(` call pattern
- **`anyhow::Context` false removal** — same implicit trait pattern; now detected via `.context(` and `.with_context(` call patterns
- **Removed imports leaking into file header** — when the first import in a file was removed (e.g. `chrono` before `serde_json`), the removed line was incorrectly included in `beforeImports` verbatim; fixed by using the full `allImports` list for range calculation
- **Comments inside the import block preserved** — `// use std::io::Read;` and `/* ... */` block comments between real imports were previously deleted when the import block was replaced; now copied verbatim to their original positions
- **`use` inside `/* */` block comments no longer parsed as real imports** — the parser now tracks block comment state and skips all lines until `*/`
- **Identifiers in string literals causing false keeps** — `"Regex is great"` no longer keeps `use regex::Regex`
- **Identifiers in `//` and `///` comments causing false keeps** — `/// Uses a HashMap` no longer keeps `use std::collections::HashMap`
- **`collapseSingleImports: false` was ignored for groups filtered to one item** — `use std::path::{Path, PathBuf}` filtered to `{Path}` now correctly keeps braces when the option is `false`
- **`isGroup` incorrectly reset after filtering** — a group filtered to one item was marked `isGroup: false`, losing the information needed for `collapseSingleImports`
- **`use` inside `impl` / `fn` / `mod` bodies no longer parsed** — the parser correctly stops at the first non-import line

### New settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `removeUnused` | boolean | `true` | Remove unused imports. Set to `false` to only sort and group |
| `enableAutoImport` | boolean | `true` | Auto-import unresolved symbols via Rust Analyzer |
| `organizeOnSave` | boolean | `false` | Automatically organize imports on save |

---

## [0.1.0] - 2026-03-19

### Added
- Initial release
- Automatic import organization for Rust files
- Smart grouping into three categories: standard library (`std::*`), external crates, and local imports (`crate::*`, `super::*`, `self::*`)
- Alphabetical sorting within each group
- Duplicate import removal
- Multi-line import support
- Configurable settings: `groupImports`, `sortAlphabetically`, `blankLineBetweenGroups`, `collapseSingleImports`
- Keyboard shortcut: `Shift+Alt+O` / `Shift+Option+O`
- Command palette: `Organize Rust Imports`