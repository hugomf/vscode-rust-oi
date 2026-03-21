# Change Log

All notable changes to the "rust-import-organizer" extension are documented in this file.

## [0.2.7] - 2026-03-21

### Added

**Documentation overhaul**
- New comprehensive documentation in `docs/` folder:
  - `DEVELOPMENT.md` — setup guide, architecture overview, and development workflow
  - `IMPORT_PARSER.md` — detailed explanation of the import parsing algorithm
  - `QUICKSTART.md` — getting started guide for new users
- Added SVG diagrams for visual documentation (pipeline, filter decision tree, slot replacement)

**Test infrastructure**
- New `rust-test/` Rust project for integration testing the extension
- New fixture test system with comprehensive test cases (`fixtures/input/`, `fixtures/expected/`)
- New test fixtures covering: simple imports, comprehensive scenarios, unused imports, and alias bugs
- Added `validate.sh` script for running validation tests

**CLI tool**
- New `src/cli.ts` — command-line interface for running import organization outside VS Code
- New `src/fixture.test.ts` — test runner for fixture-based validation

**GitHub Actions CI**
- New `.github/workflows/ci.yml` — automated CI pipeline for the extension

**Release tooling**
- New `scripts/release.js` — automation script for releasing new versions
- New `scripts/integration-test.sh` — integration test runner

### Changed
- Updated README.md with improved documentation and usage examples
- Updated package.json with new scripts and metadata
- Updated import parser (`src/importParser.ts`) with improved parsing logic
- Updated import parser tests (`src/importParser.test.ts`) with comprehensive coverage

---


## [0.2.6] - 2026-03-21

### Added

**Custom group order (`importOrder`)**
- New setting `importOrder` — an ordered array of module prefixes that defines fully custom import groups. Only active when `groupImports` is `"custom"`.
- Three special tokens:
  - `"std"` — matches the entire standard library family (`std::`, `core::`, `alloc::`)
  - `"crate"` — matches all local imports (`crate::`, `super::`, `self::`)
  - `"*"` — catch-all for everything not matched by a named prefix
- Specific prefixes always beat `*` (two-pass matching), so `["std", "tokio", "*", "crate"]` correctly places `crate::` imports last even though `*` appears before `crate` in the array.
- Example for an Axum/Tokio web service:
  ```json
  {
    "rust-import-organizer.groupImports": "custom",
    "rust-import-organizer.importOrder": ["std", "tokio", "axum", "tower", "*", "crate"]
  }
  ```

**Preserve group mode**
- New value `"preserve"` for `groupImports` — respects the blank-line group boundaries already in your file and only sorts alphabetically within each group. No blank lines are added or removed.
- Ideal for teams that have an established import order and only want alphabetical sorting within their existing groups.

**`pub use` placement control (`pubUsePlacement`)**
- New setting `pubUsePlacement` with three options:
  - `"inline"` (default) — re-exports are classified by module path and placed inline with regular imports
  - `"last"` — all `pub use` statements are collected into a dedicated group at the bottom, just above any `#[cfg(...)]` imports
  - `"first"` — the `pub use` group appears at the very top, before std imports
- Works in all grouping modes including `"custom"`.

**`groupImports` extended to accept string values**
- The setting now accepts `true`, `false`, `"preserve"`, or `"custom"` (previously only boolean). VS Code settings UI shows a dropdown with descriptions for each option.

**Fixture test improvements**
- Fixed failing fixture tests by updating expected output files to match current import organization behavior
- Added comprehensive test coverage for import organization scenarios including aliases, nested imports, unused import detection, and various edge cases
- All 399 tests now pass with 1 skipped test for fixtures with section headers

### New settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `importOrder` | `string[]` | `[]` | Ordered prefix list for custom grouping. Only used when `groupImports` is `"custom"` |
| `pubUsePlacement` | `"inline"` \| `"first"` \| `"last"` | `"inline"` | Where `pub use` re-exports are placed |

---

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

**Implicit trait method awareness**
- The extension now correctly keeps trait imports that are needed for method dispatch but never appear as bare identifiers in code:
  - `sqlx::Row` — kept when `.get("field")` is called on a query result
  - `sqlx::Executor` — kept when `.execute()` / `fetch_one` / `fetch_all` / `fetch_optional` are called
  - `std::io::Read` — kept when `.read()` / `read_to_string` / `read_to_end` are called
  - `std::io::Write` — kept when `.write()` / `write_all` / `flush()` are called
  - `std::io::BufRead` — kept when `.lines()` / `read_line` are called
  - `std::io::Seek` — kept when `.seek()` is called
  - `anyhow::Context` — kept when `.context()` / `.with_context()` are called

**Comment preservation**
- `//` line comments and `/* */` block comments that sit inside the import block are now left exactly in place — only real `use` statements are moved or removed
- Previously, comments interleaved with imports were silently deleted when the import block was rewritten

**String and comment stripping in unused-import analysis**
- Identifier names that appear only inside string literals (`"HashMap is great"`) or doc comments (`/// Uses a HashMap`) no longer cause false keeps
- The identifier scan now strips string literals, char literals, `//` comments, and `/* */` block comments before checking for usage

### Fixed

- **Inline `//` comments after `use` lines no longer break parsing** — `use std::fs::File; // comment` was previously causing the parser to consume the entire function body into the import statement
- **`r#` raw identifier prefixes in module paths** — `use crate::r#type::Foo` was silently dropped; now parsed correctly
- **`use` inside `/* */` block comments no longer parsed as real imports** — the parser now tracks block comment state and skips all lines until `*/`
- **Removed imports leaking into file header** — when the first import in a file was removed (e.g. `chrono` before `serde_json`), the removed line was incorrectly included in `beforeImports` verbatim; fixed by using the full `allImports` list for range calculation
- **`collapseSingleImports: false` was ignored for groups filtered to one item** — `use std::path::{Path, PathBuf}` filtered to `{Path}` now correctly keeps braces when the option is `false`
- **`isGroup` incorrectly reset after filtering** — a group filtered to one item was marked `isGroup: false`, losing the information needed for `collapseSingleImports`
- **`use` inside `impl` / `fn` / `mod` bodies no longer parsed** — the parser correctly stops at the first non-import line
- **`sqlx::Row` false removal** — `Row` is needed for `.get("field")` method calls but never appears as a bare identifier; now detected via call pattern analysis
- **`anyhow::Context` false removal** — same implicit trait pattern; now detected via `.context(` and `.with_context(` call patterns
- **Identifiers in string literals causing false keeps** — `"Regex is great"` no longer keeps `use regex::Regex`
- **Identifiers in `//` and `///` comments causing false keeps** — `/// Uses a HashMap` no longer keeps `use std::collections::HashMap`

### New settings in this release

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