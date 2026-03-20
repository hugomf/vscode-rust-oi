# Rust Import Organizer

A VS Code extension that automatically organizes Rust `use` statements — removing unused and duplicate imports, grouping by category, sorting alphabetically, and auto-importing missing symbols with disambiguation.

## Features

- **Unused import removal** — removes imports that are never referenced, with partial filtering for grouped imports (`use std::path::{Path, PathBuf}` becomes `use std::path::Path;` if only `Path` is used)
- **Duplicate removal** — silently drops identical import statements
- **Smart grouping** — organizes imports into four sections, separated by blank lines:
  1. Standard library (`std::*`, `core::*`, `alloc::*`)
  2. External crates (third-party dependencies)
  3. Local imports (`crate::*`, `super::*`, `self::*`)
  4. Conditional imports (`#[cfg(...)] use ...`) — always placed last
- **Alphabetical sorting** — sorts imports by module path within each group
- **Auto-import with disambiguation** — detects unresolved symbols and adds missing imports via Rust Analyzer; shows a QuickPick when multiple candidates exist so you can choose the right one
- **Organize on save** — optionally runs automatically every time you save a `.rs` file
- **Cargo.toml awareness** — reads your `Cargo.toml` to correctly classify workspace members as local rather than external
- **Alias support** — correctly handles `use serde_json::Value as JsonValue;`
- **Wildcard support** — `use module::*` imports are always preserved
- **`pub use` support** — re-exports are parsed and formatted correctly
- **Nested brace expansion** — `use std::{io::{Read, Write}, fs::File}` is expanded and reorganized cleanly
- **Configurable** — every behaviour can be toggled through VS Code settings

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

### After

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

## Configuration

```json
{
  "rust-import-organizer.groupImports": true,
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
| `groupImports` | boolean | `true` | Split imports into std / external / local / cfg sections |
| `sortAlphabetically` | boolean | `true` | Sort by module path within each group |
| `blankLineBetweenGroups` | boolean | `true` | Insert a blank line between each group |
| `collapseSingleImports` | boolean | `false` | Collapse a grouped import filtered to one item (`use std::path::{Path}` → `use std::path::Path;`) |
| `removeUnused` | boolean | `true` | Remove unused imports. Set to `false` to only sort and group |
| `enableAutoImport` | boolean | `true` | Auto-import unresolved symbols when running *Organize + Auto Import* |
| `organizeOnSave` | boolean | `false` | Automatically organize imports on save |

## Features in detail

### Unused import removal

The extension analyses all identifiers referenced after the import block and removes any `use` statement whose imported name never appears. For grouped imports it filters item by item — only unused items are dropped, the rest are kept.

**Alias-aware:** `use serde_json::Value as JsonValue;` is kept as long as `JsonValue` appears in the code, even if `Value` itself does not.

**Qualified-context aware:** an identifier that appears only in a qualified position like `Foo::Bar` is treated as an enum variant or associated item — not as a use of the imported name. This prevents false positives:

```rust
use chrono::{DateTime, Utc};   // removed — neither is used directly
enum Event { DateTime(i64) }   // this is a variant definition, not chrono::DateTime
```

**cfg-gated imports are always kept.** Their usage cannot be determined statically because they are conditionally compiled.

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

### Import merging

Separate imports from the same module are merged into a single grouped import:

```rust
// Before
use std::io::Read;
use std::io::Write;

// After
use std::io::{Read, Write};
```

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
npm run compile   # one-off compile
npm run watch     # watch mode during development
```

### Test

```bash
npm test
```

The test suite has 181 tests across three files:

| File | What it covers |
|------|---------------|
| `importParser.test.ts` | Parsing, categorization, sorting, merging, formatting, unused removal, cfg imports, Cargo classification |
| `extension.test.ts` | All configuration settings, organize-on-save pipeline, range-fix regression, bug regressions |
| `autoImport.test.ts` | Diagnostic scanning, candidate fetching, single-match auto-apply, multi-match disambiguation, mixed scenarios |

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
| `organizeImports(imports, externalCrates?, localCrates?)` | Splits into std / external / local / cfg buckets |
| `sortImports(imports)` | Sorts by module path |
| `formatImport(imp, collapseSingle)` | Formats a single import statement as a string |
| `categorizeImport(module, externalCrates?, localCrates?)` | Returns `'std'`, `'external'`, or `'local'` |

## License

MIT

## Contributing

Pull requests are welcome. Please open an issue first to discuss significant changes.

## Issues

Report bugs or request features on the [GitHub Issues page](https://github.com/hugomf/vscode-rust-oi/issues).