# Import Parser Architecture Guide

A technical reference for `src/importParser.ts` — the engine that parses, organizes, and rewrites Rust `use` statements.

---

## Pipeline overview

The public entry point `organizeImportsInText` runs this entire pipeline. Individual stages are also exported for callers that need partial processing (e.g. the CLI uses `parseImports` + `buildOrganizedText` separately).

![Pipeline overview](assets/pipeline.svg)

---

## Core data structures

### `ImportStatement`

Everything the pipeline knows about a single logical import. One `use` statement in source may produce multiple `ImportStatement` objects when it contains nested braces.

```typescript
interface ImportStatement {
  originalText: string;               // raw source text, preserved for diagnostics
  module: string;                     // "std::collections"
  items: string[];                    // ["HashMap"] or ["Read", "Write"]
  aliases?: (string | undefined)[];   // parallel to items; undefined = no alias
  isGroup: boolean;                   // true when source used braces: use m::{A, B}
  isWildcard?: boolean;               // use m::*
  isPublic?: boolean;                 // pub use …
  cfgAttribute?: string;              // "#[cfg(test)]" — the line preceding this import
  startLine: number;                  // 0-based; includes the cfg line when present
  endLine: number;                    // 0-based; last line of the semicolon
}
```

**Why `isGroup` is kept after filtering:** when `removeUnusedImports` reduces `use std::path::{Path, PathBuf}` to just `Path`, the surviving import retains `isGroup: true`. This lets `formatImport` honour the `collapseSingleImports` option — the caller decides whether to emit `use std::path::Path` or `use std::path::{Path}`, not the filter.

**Why `aliases` is parallel, not a Map:** it lets `formatImport` iterate both slices together in one pass without a lookup, and it keeps serialization trivial.

### `OrganizedImports`

The output of `organizeImports`. Five buckets, always populated (may be empty arrays).

```typescript
interface OrganizedImports {
  stdImports: ImportStatement[];      // std::, core::, alloc::
  externalImports: ImportStatement[]; // third-party crates
  localImports: ImportStatement[];    // crate::, super::, self::
  cfgImports: ImportStatement[];      // any import with a #[cfg(...)] attribute
  pubUseImports: ImportStatement[];   // pub use re-exports (when not inline)
}
```

---

## Stage 1 — Parsing (`parseImports`)

### Parsing contract

`parseImports` reads from line 0 and **stops at the first non-import, non-blank, non-comment line**. This is intentional: `use` statements inside `fn`, `impl`, or `mod` bodies are valid Rust but are invisible to the organizer. Surfacing mid-file `pub use` statements is a separate concern handled by `findMidFilePubUse`.

### What the scanner handles

```
use std::collections::HashMap;              → simple
use std::path::{Path, PathBuf};             → grouped
use std::io::{Read as R, Write};            → grouped with per-item alias
use std::{io::{Read, Write}, fs::File};     → nested braces → expanded
use serde_json::Value as JsonValue;         → simple aliased
use std::prelude::*;                        → wildcard
pub use crate::models::User;               → re-export
#[cfg(test)]                               → cfg-gated (stored on the following import)
use crate::test_helpers::setup;
```

### Block comment and string tracking

Before scanning for identifiers, the parser masks content that could produce false matches:

| What gets masked | Why |
|---|---|
| `/* ... */` block comments | May contain `use`-shaped text |
| `// ...` line comments | Dead code; not a real usage |
| `"..."` string literals | `"Regex is great"` must not keep `regex::Regex` |
| `'...'` char literals | Edge case; masked for consistency |

### Nested brace expansion

`use std::{io::{Read, Write}, fs::File}` is expanded recursively into flat paths, then re-grouped by immediate module:

```
Input tree:   std::{io::{Read, Write}, fs::File}
Flat paths:   std::io::Read, std::io::Write, std::fs::File
Re-grouped:
  { module: "std::io",  items: ["Read", "Write"], isGroup: true }
  { module: "std::fs",  items: ["File"],           isGroup: true }
```

The re-grouping uses insertion-order to preserve the logical sequence. `isGroup` is always `true` for any import that came from braces, even when filtered to a single item.

---

## Stage 2 — Deduplication (`removeDuplicateImports`)

Duplicate detection key: `module::item₁,item₂,...` with items sorted. This means `use std::path::{Path, PathBuf}` and `use std::path::{PathBuf, Path}` collapse to one, regardless of order in source.

Aliased imports deduplicate on the bare item name, not the alias. Two imports of `Value as JsonValue` and `Value as JV` from the same module collapse — both would be a compile error anyway.

---

## Stage 3 — Unused import removal (`removeUnusedImports`)

### Analysis strategy

Identifiers are collected only from the code **after** the import block. The analysis runs in four passes:

**Pass 1 — bare identifiers.** Scan the masked source (comments and literals removed) for every `\b[a-zA-Z_][a-zA-Z0-9_]*\b`. This is the primary "is it used?" signal.

**Pass 2 — qualified-only identifiers.** Find identifiers that appear *exclusively* in a `Something::Identifier` position. These are usually enum variants or associated items, not the imported type itself.

```rust
// DateTime is qualified-only here — enum variant, not chrono::DateTime
enum Event { DateTime(i64) }
fn main() { let _ = Foo::DateTime(0); }
```

An import is removed if its items appear only in qualified position and never bare.

**Pass 3 — declaration bodies stripped.** Enum and struct definition bodies are blanked before the qualified-only scan, so a variant named `DateTime` inside an enum body doesn't count as a "bare use" of the name.

**Pass 4 — implicit trait patterns.** Some traits must be in scope for method dispatch to work even though the trait name never appears literally in the code:

| Method pattern in code | Trait kept |
|---|---|
| `.get(...)` | `sqlx::Row` |
| `.execute(...)` / `fetch_one` / `fetch_all` | `sqlx::Executor` |
| `.context(...)` / `.with_context(...)` | `anyhow::Context` |
| `.read(...)` / `read_to_string` / `read_to_end` | `std::io::Read` |
| `.write(...)` / `write_all` / `flush(...)` | `std::io::Write` |
| `.lines(...)` / `read_line` | `std::io::BufRead` |
| `.seek(...)` | `std::io::Seek` |

**Always kept regardless of usage:** wildcards (`use m::*`) and cfg-gated imports. Their actual use cannot be determined by static analysis of a single file.

### Filter decision tree

For each `ImportStatement` after the four analysis passes:

```
isWildcard?     → keep unconditionally
cfgAttribute?   → keep unconditionally
isGroup?        → filter items individually using passes 1-4; drop if all items removed
has alias?      → check alias name AND original name; keep if either appears
otherwise       → check item name against passes 1-4
```

![Filter decision tree](assets/filter-decision-tree.svg)

---

## Stage 4 — Organization (`organizeImports`)

### Categorization

```typescript
categorizeImport(module, cargoExternalCrates?, cargoLocalCrates?)
  → 'std' | 'external' | 'local'
```

Priority order (first match wins):

1. `std`, `core`, `alloc` roots → **std**
2. `crate`, `super`, `self` roots → **local**
3. Found in `cargoLocalCrates` (workspace members) → **local**
4. Found in `cargoExternalCrates` (Cargo.toml deps) → **external**
5. Fallback heuristic → **external**

Without Cargo.toml data, workspace-local crates are misclassified as external. Pass `knownLocalCrates` from `parseCargoToml` to fix this.

### Grouping modes

| Mode | Behaviour |
|---|---|
| `true` (default) | Three fixed groups: std → external → local, cfg always last |
| `false` | Single flat block, sorted alphabetically |
| `"preserve"` | Respects blank-line boundaries from original source; sorts within groups |
| `"custom"` | `importOrder` array defines group sequence; `"*"` is the catch-all |

**Custom group matching** uses a two-pass strategy: specific prefix matches first, then the catch-all `"*"`. This ensures `["std", "tokio", "*", "crate"]` puts `crate::` imports in the `"crate"` slot even though `"*"` appears earlier in the array.

**pub use placement** (`'inline' | 'first' | 'last'`) controls where re-exports land relative to the other groups. When `'inline'`, they are categorized normally by module path. When `'first'` or `'last'`, they are extracted into `pubUseImports` and emitted as a dedicated block.

---

## Stage 5 — Text reconstruction (`buildOrganizedText`)

### Why slot-based replacement?

The naive approach — replace every line between `importStartLine` and `importEndLine` — would silently destroy interleaved comments, section headers, and developer-placed blank lines. The organizer instead:

1. Identifies the exact set of line numbers belonging to real `use` statements (`importLineSet`).
2. Identifies blank lines that already exist between those statements (these become "blank slots" that absorb group separators).
3. Merges both sets into `allSlots`, sorted by line number.
4. Distributes `organizedLines` across `allSlots` in order.
5. Rebuilds the file line-by-line: slot lines get replaced, all other lines are copied verbatim.

**Consequence:** a commented-out import like `// use std::io::Read;` between two real imports is never touched. It occupies a line that is not in `importLineSet`, so it passes through unchanged.

![Slot-based replacement](assets/slot-replacement.svg)

### Overflow handling

If the organized output produces more lines than there are slots (e.g. a group separator blank line where none existed before), the extra lines are flushed immediately after the last slot. A final collapse pass then reduces any run of more than one consecutive blank line within and immediately after the import block.

### Idempotency

Running the organizer twice on the same file produces the same output. The blank lines that were inserted as group separators on the first pass become "blank slots" on the second pass and are reused — no extra blank lines accumulate.

---

## `formatImport` — output rules

| Case | Output |
|---|---|
| Wildcard | `use m::*;` |
| Simple aliased | `use m::Item as Alias;` (never braces around a single aliased item) |
| 1 item, `isGroup: false` | `use m::Item;` |
| 1 item, `isGroup: true`, `collapseSingle: false` | `use m::{Item};` |
| 1 item, `isGroup: true`, `collapseSingle: true` | `use m::Item;` |
| 2–3 items | `use m::{A, B, C};` (sorted by bare name) |
| 4+ items | multi-line with 4-space indent and trailing comma |

Items with aliases are sorted by their **bare name**, not the alias. `Value as JsonValue` sorts under `V`, not `J`.

---

## `findMidFilePubUse` — diagnostics

Finds `pub use` and `#[cfg]-guarded use` statements that appear **after** the top-level import block. These are invisible to `parseImports` and cannot be automatically reorganized — they may be inside `mod` or `impl` blocks, or conditionally compiled.

The function flags:
- Any `pub use` after the import block (likely an unintentional re-export or a missed placement)
- Any plain `use` immediately preceded by a `#[cfg(...)]` attribute mid-file (an import the organizer cannot see)

It does **not** flag plain `use` inside `mod` or `impl` blocks without a preceding `#[cfg]` — those are intentional scoped imports.

---

## Cargo.toml integration

`parseCargoToml` (in `cargoParser.ts`) extracts two sets:

- `externalCrates` — all `[dependencies]` and `[dev-dependencies]` names, hyphen-normalized to underscores, with `package = "..."` renames resolved.
- `workspaceMembers` — `[workspace] members` paths with the directory component stripped and hyphen-normalized.

Pass both to `organizeImportsInText` via `knownExternalCrates` and `knownLocalCrates`. Without them, workspace-local crates (e.g. `my_lib::models`) are treated as external crates by the heuristic fallback.

---

## Known limitations

**No cross-file analysis.** Whether a type is actually used is determined by scanning the current file only. An import that is re-exported and consumed elsewhere will appear unused locally.

**Wildcard imports are always kept.** `use m::*` brings an unknown set of names into scope. Removing it safely would require knowing what names it provides, which requires either an index or a compiler.

**Mid-file imports are not reorganized.** `use` statements inside `fn`, `mod`, or `impl` bodies are below the parse horizon. `findMidFilePubUse` surfaces them for human review.

**Implicit trait list is manually maintained.** The method-dispatch patterns in `removeUnusedImports` cover common crates (sqlx, anyhow, std::io) but are not exhaustive. Traits not in the list whose names never appear as bare identifiers will be incorrectly removed.