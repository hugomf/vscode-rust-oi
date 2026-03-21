# Rust Import Organizer

A VS Code extension that automatically organizes Rust `use` statements — removing unused and duplicate imports, grouping by category, sorting alphabetically, and auto-importing missing symbols with disambiguation.

## Features

- **Unused import removal** — removes imports that are never referenced, with partial filtering for grouped imports (`use std::path::{Path, PathBuf}` becomes `use std::path::Path;` if only `Path` is used)
- **Duplicate removal** — silently drops identical import statements
- **Flexible grouping** — four modes to match any project style:
  - **Standard** (default) — three fixed sections: std / external / local, plus a fourth section for `#[cfg(...)]` conditional imports
  - **Custom** — define your own ordered groups by module prefix (e.g. put tokio and axum in their own groups)
  - **Preserve** — keep the blank-line groups you already have; only sort within each group
  - **Flat** — single block with no grouping
- **`pub use` placement** — choose whether re-exports are mixed in inline, promoted to the top, or collected at the bottom
- **Alphabetical sorting** — sorts imports by module path within each group
- **Auto-import with disambiguation** — detects unresolved symbols and adds missing imports via Rust Analyzer; shows a QuickPick when multiple candidates exist so you can choose the right one
- **Organize on save** — optionally runs automatically every time you save a `.rs` file
- **Cargo.toml awareness** — reads your `Cargo.toml` to correctly classify workspace members as local rather than external
- **Implicit trait detection** — keeps trait imports like `sqlx::Row` and `anyhow::Context` that are needed for method dispatch but never appear as bare identifiers
- **Comment preservation** — `// use ...` and `/* ... */` comment lines inside the import block are left exactly where they are; only real `use` statements are moved
- **Alias support** — correctly handles `use serde_json::Value as JsonValue;`
- **Wildcard support** — `use module::*` imports are always preserved
- **`pub use` support** — re-exports are parsed and formatted correctly
- **Nested brace expansion** — `use std::{io::{Read, Write}, fs::File}` is expanded and reorganized cleanly
- **Mid-file `pub use` detection** — warns when it finds re-export statements outside the import block that the organizer cannot safely touch

## Usage

### Commands

| Command | Description |
|---------|-------------|
| `Organize Rust Imports` | Sort, group, deduplicate, and remove unused imports |
| `Organize Rust Imports + Auto Import` | Same as above, plus auto-import any unresolved symbols first |

Run either command from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) or right-click inside any Rust file.

### Keyboard shortcut

| Platform | Shortcut |
|----------|----------|
| Windows / Linux | `Shift+Alt+O` |
| macOS | `Shift+Option+O` |

### Organize on save

Add to your `settings.json` to run automatically every time you save:

```json
{
  "rust-import-organizer.organizeOnSave": true
}
```

Or use VS Code's built-in Code Actions on save (works with `source.organizeImports`):

```json
{
  "[rust]": {
    "editor.codeActionsOnSave": {
      "source.organizeImports": "explicit"
    }
  }
}
```

### Auto-import disambiguation

When a symbol matches more than one crate, a QuickPick appears so you can pick the right one — the same UX as the Java extension. Symbols with exactly one match are applied automatically.

**Requires** the [Rust Analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer) extension.

## Example

### Before

```rust
use std::sync::Arc;
use crate::internal::module;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::path::{Path, PathBuf};
use crate::config::Settings;
use tokio::runtime::Runtime;
use anyhow::Result;
#[cfg(test)]
use crate::test_helpers::setup;
```

### After (default grouping)

The extension removes unused imports, groups, sorts, and preserves conditional imports last:

```rust
use std::collections::HashMap;
use std::fs::File;
use std::path::Path;

use anyhow::Result;
use tokio::runtime::Runtime;

use crate::config::Settings;

#[cfg(test)]
use crate::test_helpers::setup;
```

> `Arc`, `Serialize`, `Deserialize`, `PathBuf`, and `module` were removed as unused.
> `use std::path::{Path, PathBuf}` was narrowed to `use std::path::Path;`.
> The `#[cfg(test)]` import is kept unconditionally and placed last.

### After (custom group order)

With `"importOrder": ["std", "tokio", "axum", "*", "crate"]`:

```rust
use std::collections::HashMap;
use std::fs::File;

use tokio::runtime::Runtime;

use axum::Router;

use anyhow::Result;
use serde::Serialize;

use crate::config::Settings;
```

## Configuration

```json
{
  "rust-import-organizer.groupImports": true,
  "rust-import-organizer.importOrder": [],
  "rust-import-organizer.pubUsePlacement": "inline",
  "rust-import-organizer.sortAlphabetically": true,
  "rust-import-organizer.blankLineBetweenGroups": true,
  "rust-import-organizer.collapseSingleImports": false,
  "rust-import-organizer.removeUnused": true,
  "rust-import-organizer.enableAutoImport": true,
  "rust-import-organizer.organizeOnSave": false
}
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `groupImports` | `true` \| `false` \| `"preserve"` \| `"custom"` | `true` | Controls how imports are grouped (see below) |
| `importOrder` | `string[]` | `[]` | Ordered prefix list for custom grouping. Only used when `groupImports` is `"custom"` |
| `pubUsePlacement` | `"inline"` \| `"first"` \| `"last"` | `"inline"` | Where `pub use` re-exports are placed |
| `sortAlphabetically` | boolean | `true` | Sort by module path within each group |
| `blankLineBetweenGroups` | boolean | `true` | Insert a blank line between each group |
| `collapseSingleImports` | boolean | `false` | Collapse a grouped import filtered to one item (`use std::path::{Path}` → `use std::path::Path;`) |
| `removeUnused` | boolean | `true` | Remove unused imports. Set to `false` to only sort and group |
| `enableAutoImport` | boolean | `true` | Auto-import unresolved symbols when running *Organize + Auto Import* |
| `organizeOnSave` | boolean | `false` | Automatically organize imports on save |

## Features in detail

### Grouping modes

**`groupImports: true`** (default) — three fixed groups in order: standard library first, external crates second, local imports third. A fourth group at the end holds any `#[cfg(...)]` conditional imports. Empty groups produce no blank lines.

**`groupImports: false`** — all imports in one flat sorted block with no group separators.

**`groupImports: "preserve"`** — the organizer detects the blank-line boundaries that already exist between your imports and treats each blank-separated block as a group. It only sorts alphabetically within each group; it never adds or removes blank lines. This is ideal for teams that already have an agreed import order and just want alphabetical sorting within their existing groups.

```rust
// Before (preserve mode)             // After (preserve mode)
use axum::Router;                     use axum::Router;
use tokio::runtime::Runtime;          use tokio::runtime::Runtime;
                              →
use serde::Serialize;                 use anyhow::Result;
use anyhow::Result;                   use serde::Serialize;
```

**`groupImports: "custom"`** — define your own groups using `importOrder`. Each entry is a module prefix; the first match wins. Three special tokens are available:

- `"std"` — matches the entire standard library family (`std::`, `core::`, `alloc::`)
- `"crate"` — matches all local imports (`crate::`, `super::`, `self::`)
- `"*"` — catch-all for anything not matched by a named prefix

Example for an Axum/Tokio web service:

```json
{
  "rust-import-organizer.groupImports": "custom",
  "rust-import-organizer.importOrder": ["std", "tokio", "axum", "tower", "*", "crate"]
}
```

This produces five groups: std, then tokio, then axum, then tower, then all other external crates, then local. Specific prefixes always beat `*`, so `crate::` imports correctly land in the `"crate"` group even if `"*"` appears earlier in the list.

### `pub use` placement

`pub use` re-exports can be awkward to place — they are neither purely internal nor purely external. Three options:

- **`"inline"`** (default) — re-exports are classified by their module path and placed in the corresponding group alongside regular imports.
- **`"last"`** — all `pub use` statements are collected into a dedicated group at the bottom of the import block, just above any `#[cfg(...)]` imports. Common in library crates that re-export their public API.
- **`"first"`** — the `pub use` group appears at the very top, before std imports.

### Unused import removal

The extension analyses all identifiers referenced after the import block and removes any `use` statement whose imported name never appears. For grouped imports it filters item by item — only unused items are dropped, the rest are kept.

**Alias-aware:** `use serde_json::Value as JsonValue;` is kept as long as `JsonValue` appears in the code, even if `Value` itself does not.

**Qualified-context aware:** an identifier that appears only in a qualified position like `Foo::Bar` is treated as an enum variant or associated item — not as a use of the imported name. This prevents false positives:

```rust
use chrono::{DateTime, Utc};   // removed — neither is used directly
enum Event { DateTime(i64) }   // this is a variant definition, not chrono::DateTime
```

**cfg-gated imports are always kept.** Their usage cannot be determined statically because they are conditionally compiled.

**Implicit trait method awareness:** some traits must be in scope for method calls to work even though the trait name never appears explicitly in code. The extension detects characteristic call patterns and keeps the corresponding imports:

| Pattern in code | Import kept |
|-----------------|------------|
| `.get("field")` on a query result | `sqlx::Row` |
| `.execute(…)` / `fetch_one` / `fetch_all` | `sqlx::Executor` |
| `.read(…)` / `read_to_string` / `read_to_end` | `std::io::Read` |
| `.write(…)` / `write_all` / `flush()` | `std::io::Write` |
| `.lines()` / `read_line` | `std::io::BufRead` |
| `.seek(…)` | `std::io::Seek` |
| `.context(…)` / `.with_context(…)` | `anyhow::Context` |

**String literals and comments are ignored** during identifier scanning — `"HashMap is useful"` or `/// Uses a HashMap` will not prevent `std::collections::HashMap` from being removed if `HashMap` is not used in real code.

**Comment preservation:** comments that sit inside the import block — both `//` line comments and `/* */` block comments — are left exactly where they are. Only real `use` statements are moved:

```rust
use std::fs::File;
// use std::io::Read;   ← left in place, never touched
use std::collections::HashMap;
```

### Standard library family

`std`, `core`, and `alloc` are all treated as the standard library. `core` is the dependency-free subset of `std`; `alloc` adds heap allocation. Both are shipped with every Rust toolchain and belong in the std group alongside `std::` imports.

### Conditional imports (`#[cfg(...)]`)

Imports preceded by a `#[cfg(...)]` attribute are placed in a dedicated fourth group at the end of the import block, each with its attribute on the preceding line:

```rust
// regular imports (std / external / local) ...

#[cfg(test)]
use crate::test_helpers::setup;

#[cfg(feature = "serde")]
use serde::Serialize;
```

### Cargo.toml awareness

The extension reads your workspace `Cargo.toml` to build an accurate list of external dependencies and workspace members. This ensures workspace members are correctly classified as local imports rather than external crates, even when they do not use a `crate::` prefix.

### Nested brace expansion

```rust
use std::{io::{Read, Write}, fs::File};
```

is expanded into separate logical imports before processing:

```rust
use std::fs::File;
use std::io::{Read, Write};
```

### Mid-file `pub use` detection

If a `pub use` or `#[cfg]-guarded use` statement appears after the main import block (e.g. a re-export accidentally placed at the bottom of a file), the extension cannot remove it automatically — it may be inside a `mod` block or otherwise intentional. Instead it shows a warning notification with the line number so you can review it manually.

## Development

### Prerequisites

- Node.js v16 or higher
- npm

### Setup

```bash
git clone https://github.com/hugomf/vscode-rust-oi.git
cd vscode-rust-oi
npm install
```

### Build

```bash
npm run compile
```

### Test

```bash
npm test
```

The test suite has 330 tests across six files:

| File | Tests | What it covers |
|------|-------|---------------|
| `importParser.test.ts` | ~169 | Parsing, categorization, sorting, merging, formatting, unused removal, cfg imports, Cargo classification, comment preservation, custom groups, pub use placement, preserve mode |
| `extension.test.ts` | ~55 | All configuration settings, organize-on-save pipeline, range-fix regression, bug regressions |
| `autoImport.test.ts` | 22 | Diagnostic scanning, candidate fetching, single-match auto-apply, multi-match disambiguation |
| `cargoParser.test.ts` | 30 | Cargo.toml parsing, workspace member extraction, dep normalisation, `classifyWithCargo` |
| `cargoWorkspace.test.ts` | 10 | VS Code filesystem adapter, Cargo.toml discovery |
| `stress_test.test.ts` | 45 | Edge cases: raw identifiers, nested braces, CRLF, shebang, 50-import files, real-world patterns |

### Running locally

1. Open the project in VS Code
2. Press `F5` to launch an Extension Development Host window
3. Open any `.rs` file and run **Organize Rust Imports** from the Command Palette or right-click menu

## Architecture

```
extension.ts         VS Code adapter — commands, keybindings, Code Actions, on-save hook
autoImport.ts        Rust Analyzer integration — diagnostic scanning, candidate fetching, QuickPick
importParser.ts      All parsing and transformation logic — no VS Code dependency, fully testable
cargoParser.ts       Cargo.toml parser — pure TypeScript, no VS Code dependency
cargoWorkspace.ts    VS Code adapter for cargoParser — reads Cargo.toml via the filesystem API
```

### `importParser.ts` public API

| Export | Purpose |
|--------|---------|
| `organizeImportsInText(text, options)` | Main entry point — runs the full pipeline and returns the transformed source |
| `buildOrganizedText(used, all, text, options)` | Rebuilds source text using `all` for range calculation |
| `parseImports(text)` | Parses all `use` statements from a Rust source string |
| `removeUnusedImports(imports, text)` | Filters to only imports referenced in the code |
| `removeDuplicateImports(imports)` | Removes exact duplicates |
| `mergeImports(imports)` | Combines separate same-module imports into a single grouped import |
| `organizeImports(imports, externalCrates?, localCrates?, pubUsePlacement?)` | Splits into std / external / local / pubUse / cfg buckets |
| `sortImports(imports)` | Sorts by module path |
| `formatImport(imp, collapseSingle)` | Formats a single import statement as a string |
| `categorizeImport(module, externalCrates?, localCrates?)` | Returns `'std'`, `'external'`, or `'local'` |
| `findMidFilePubUse(text)` | Finds `pub use` statements outside the top-level import block |

## License

MIT

## Contributing

Pull requests are welcome. Please open an issue first to discuss significant changes.

## Issues

Report bugs or request features on the [GitHub Issues page](https://github.com/hugomf/vscode-rust-oi/issues).