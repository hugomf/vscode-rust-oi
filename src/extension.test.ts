// extension.test.ts
//
// Tests the full pipeline from the perspective of what extension.ts produces
// for each VS Code configuration setting combination. All tests go through
// organizeImportsInText / buildOrganizedText — the same functions that
// extension.ts calls — so this suite acts as an integration layer that would
// catch any regression introduced by wiring changes in extension.ts.

import {
  buildOrganizedText,
  organizeImportsInText,
  parseImports,
  removeDuplicateImports,
  removeUnusedImports,
} from './importParser';
import { parseCargoToml } from './cargoParser';

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────

const MIXED_SRC = `use std::collections::HashMap;
use serde::Serialize;
use crate::config::Settings;

fn main() {
    let _m: HashMap<String, i32> = HashMap::new();
    let _s: Serialize;
    let _c = Settings::new();
}`;

const BUG_SRC = `use chrono::{DateTime, Utc};
use serde_json::Value as JsonValue;

fn process(val: JsonValue) -> String {
    "ok".to_string()
}

fn main() {
    let v: JsonValue = serde_json::json!({"a": 1});
    let _ = process(v);
}`;

const FULL_SRC = `use std::sync::Arc;
use crate::internal::module;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use my_crate::utils::helper;
use std::fs::File;
use std::path::{Path, PathBuf};
use crate::config::Settings;
use tokio::runtime::Runtime;
use anyhow::Result;

fn main() {
    let _m: HashMap<String, i32> = HashMap::new();
    let _f = File::open("test.txt").unwrap();
    let _p = Path::new("test.txt");
    let _r: Result<()> = Ok(());
    let _s = Settings::new();
    let _t = Runtime::new().unwrap();
}`;

// ─────────────────────────────────────────────────────────────────────────────
// 1. groupImports setting
// ─────────────────────────────────────────────────────────────────────────────

describe('setting: groupImports', () => {
  it('groups imports into std / external / local sections by default', () => {
    const result = organizeImportsInText(MIXED_SRC);
    const lines = result.split('\n').filter(l => l.startsWith('use '));
    expect(lines[0]).toContain('std::');
    expect(lines[1]).toContain('serde');
    expect(lines[2]).toContain('crate::');
  });

  it('groupImports:true inserts blank lines between non-empty groups', () => {
    const result = organizeImportsInText(MIXED_SRC, { groupImports: true, blankLineBetweenGroups: true });
    const importBlock = result.split('fn main')[0].trimEnd();
    expect(importBlock.match(/\n\n/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('groupImports:false produces a single flat block', () => {
    const result = organizeImportsInText(MIXED_SRC, { groupImports: false, blankLineBetweenGroups: false });
    const importBlock = result.split('\n\nfn')[0];
    expect(importBlock).not.toContain('\n\n');
    // All three imports must still be present
    expect(result).toContain('std::collections');
    expect(result).toContain('serde');
    expect(result).toContain('crate::config');
  });

  it('empty groups produce no extra blank lines', () => {
    const src = `use std::collections::HashMap;\nuse std::fs::File;\n\nfn main() { HashMap::<String,i32>::new(); File::open("x"); }`;
    const result = organizeImportsInText(src, { groupImports: true, blankLineBetweenGroups: true });
    const importBlock = result.split('\n\nfn')[0];
    expect(importBlock).not.toMatch(/\n\n\n/);
  });

  it('std group appears before external, external before local', () => {
    const result = organizeImportsInText(MIXED_SRC, { groupImports: true, blankLineBetweenGroups: true });
    const block = result.split('fn main')[0];
    expect(block.indexOf('std::')).toBeLessThan(block.indexOf('serde'));
    expect(block.indexOf('serde')).toBeLessThan(block.indexOf('crate::'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. sortAlphabetically setting
// ─────────────────────────────────────────────────────────────────────────────

describe('setting: sortAlphabetically', () => {
  const UNSORTED_SRC = `use tokio::runtime::Runtime;
use anyhow::Result;
use std::fs::File;
use std::collections::HashMap;

fn main() {
    let _h = HashMap::new();
    let _f = File::open("x");
    let _r: Result<()> = Ok(());
    let _t = Runtime::new();
}`;

  it('sortAlphabetically:true sorts within each group', () => {
    const result = organizeImportsInText(UNSORTED_SRC, { sortAlphabetically: true, groupImports: false });
    const lines = result.split('\n').filter(l => l.startsWith('use '));
    expect(lines[0]).toContain('anyhow');
    expect(lines[1]).toContain('std::collections');
    expect(lines[2]).toContain('std::fs');
    expect(lines[3]).toContain('tokio');
  });

  it('sortAlphabetically:false preserves original order', () => {
    const result = organizeImportsInText(UNSORTED_SRC, { sortAlphabetically: false, groupImports: false });
    const lines = result.split('\n').filter(l => l.startsWith('use '));
    expect(lines[0]).toContain('tokio');
    expect(lines[1]).toContain('anyhow');
  });

  it('sorted output satisfies alphabetical ordering for every consecutive pair', () => {
    const result = organizeImportsInText(FULL_SRC, { sortAlphabetically: true, groupImports: false });
    const lines = result.split('\n').filter(l => l.startsWith('use '));
    for (let i = 0; i < lines.length - 1; i++) {
      expect(lines[i].localeCompare(lines[i + 1])).toBeLessThanOrEqual(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. blankLineBetweenGroups setting
// ─────────────────────────────────────────────────────────────────────────────

describe('setting: blankLineBetweenGroups', () => {
  it('blankLineBetweenGroups:true adds a blank line between each group', () => {
    const result = organizeImportsInText(MIXED_SRC, { groupImports: true, blankLineBetweenGroups: true });
    const importBlock = result.split('fn main')[0].trimEnd();
    expect(importBlock.match(/\n\n/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('blankLineBetweenGroups:false keeps groups together', () => {
    const result = organizeImportsInText(MIXED_SRC, { groupImports: true, blankLineBetweenGroups: false });
    const importBlock = result.split('\n\nfn')[0];
    expect(importBlock).not.toContain('\n\n');
  });

  it('has no effect when groupImports:false', () => {
    const withBlanks = organizeImportsInText(MIXED_SRC, { groupImports: false, blankLineBetweenGroups: true });
    const withoutBlanks = organizeImportsInText(MIXED_SRC, { groupImports: false, blankLineBetweenGroups: false });
    const blockWith = withBlanks.split('\n\nfn')[0];
    const blockWithout = withoutBlanks.split('\n\nfn')[0];
    expect(blockWith).not.toContain('\n\n');
    expect(blockWithout).not.toContain('\n\n');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. collapseSingleImports setting
// ─────────────────────────────────────────────────────────────────────────────

describe('setting: collapseSingleImports', () => {
  it('collapseSingleImports:true collapses a group filtered to one item', () => {
    const src = `use std::path::{Path, PathBuf};\n\nfn main() { let _ = Path::new("x"); }`;
    const result = organizeImportsInText(src, { collapseSingleImports: true });
    expect(result).toContain('use std::path::Path;');
    const importLine = result.split('\n').find(l => l.startsWith('use '));
    expect(importLine).not.toContain('{');
  });

  it('collapseSingleImports:false keeps braces on a single-item group', () => {
    const src = `use std::path::{Path, PathBuf};\n\nfn main() { let _ = Path::new("x"); }`;
    expect(organizeImportsInText(src, { collapseSingleImports: false })).toContain('use std::path::{Path};');
  });

  it('naturally simple imports are always collapsed regardless of the option', () => {
    const src = `use std::fs::File;\n\nfn main() { File::open("x"); }`;
    expect(organizeImportsInText(src, { collapseSingleImports: false })).toContain('use std::fs::File;');
    expect(organizeImportsInText(src, { collapseSingleImports: true })).toContain('use std::fs::File;');
  });

  it('multi-item groups are never collapsed', () => {
    const src = `use std::path::{Path, PathBuf};\n\nfn main() { let _ = Path::new("x"); let _ = PathBuf::new(); }`;
    const result = organizeImportsInText(src, { collapseSingleImports: true });
    expect(result).toContain('{');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. removeUnused setting
// ─────────────────────────────────────────────────────────────────────────────

describe('setting: removeUnused', () => {
  it('removeUnused:true (default) removes unused imports', () => {
    const src = `use std::fs::File;\nuse std::io::Read;\n\nfn main() { File::open("x"); }`;
    const result = organizeImportsInText(src);
    expect(result).toContain('std::fs');
    expect(result).not.toContain('std::io');
  });

  it('removeUnused:false keeps all imports even if unused', () => {
    const src = `use std::fs::File;\nuse std::io::Read;\n\nfn main() { File::open("x"); }`;
    const result = organizeImportsInText(src, { removeUnused: false });
    expect(result).toContain('std::fs');
    expect(result).toContain('std::io');
  });

  it('removeUnused:false still deduplicates', () => {
    const src = `use std::fs::File;\nuse std::fs::File;\n\nfn main() {}`;
    const result = organizeImportsInText(src, { removeUnused: false });
    const importLines = result.split('\n').filter(l => l.startsWith('use '));
    expect(importLines).toHaveLength(1);
  });

  it('removeUnused:false still sorts and groups', () => {
    const src = `use crate::config::Settings;\nuse std::fs::File;\nuse serde::Serialize;\n\nfn main() {}`;
    const result = organizeImportsInText(src, { removeUnused: false, groupImports: true, blankLineBetweenGroups: true });
    const block = result.split('fn main')[0];
    expect(block.indexOf('std::')).toBeLessThan(block.indexOf('serde'));
    expect(block.indexOf('serde')).toBeLessThan(block.indexOf('crate::'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. core + alloc treated as std
// ─────────────────────────────────────────────────────────────────────────────

describe('setting: core and alloc treated as std', () => {
  it('core:: imports appear in the std group', () => {
    const src = `use core::fmt::Display;\nuse serde::Serialize;\n\nfn main() { let _: Display; let _: Serialize; }`;
    const result = organizeImportsInText(src, { groupImports: true, blankLineBetweenGroups: true });
    expect(result.indexOf('core::')).toBeLessThan(result.indexOf('serde'));
  });

  it('alloc:: imports appear in the std group', () => {
    const src = `use alloc::string::String;\nuse serde::Serialize;\n\nfn main() { let _: String; let _: Serialize; }`;
    const result = organizeImportsInText(src, { groupImports: true, blankLineBetweenGroups: true });
    expect(result.indexOf('alloc::')).toBeLessThan(result.indexOf('serde'));
  });

  it('std, core and alloc all land in the same group with no blank line between them', () => {
    const src = `use std::fs::File;\nuse core::fmt::Display;\nuse alloc::vec::Vec;\nuse serde::Serialize;\n\nfn main() { File::open("x"); let _: Display; let _: Vec<u8>; let _: Serialize; }`;
    const result = organizeImportsInText(src, { groupImports: true, blankLineBetweenGroups: true });
    // Exactly one blank line between std-family block and external block
    const lines = result.split('\n');
    let lastStdIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('std::') || lines[i].includes('core::') || lines[i].includes('alloc::')) {
        lastStdIdx = i;
      }
    }
    const firstExtIdx = lines.findIndex((l: string) => l.includes('serde'));
    // There should be exactly one blank line between the two blocks
    expect(lines[lastStdIdx + 1]).toBe('');
    expect(lines[firstExtIdx - 1]).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. #[cfg(...)] conditional imports
// ─────────────────────────────────────────────────────────────────────────────

describe('setting: cfg conditional imports', () => {
  it('cfg-gated imports are never removed (always kept)', () => {
    // setup is not used in main() — but it should be kept because it is cfg-gated
    const src = `use std::fs::File;\n#[cfg(test)]\nuse crate::mocks::setup;\n\nfn main() { File::open("x"); }`;
    const result = organizeImportsInText(src);
    expect(result).toContain('#[cfg(test)]');
    expect(result).toContain('crate::mocks::setup');
  });

  it('cfg group is placed after std / external / local groups', () => {
    const src = `use std::fs::File;\nuse serde::Serialize;\n#[cfg(test)]\nuse crate::mocks::setup;\n\nfn main() { File::open("x"); let _: Serialize; }`;
    const result = organizeImportsInText(src);
    const stdIdx = result.indexOf('std::fs');
    const serdeIdx = result.indexOf('serde');
    const cfgIdx = result.indexOf('#[cfg');
    expect(stdIdx).toBeLessThan(cfgIdx);
    expect(serdeIdx).toBeLessThan(cfgIdx);
  });

  it('cfg attribute is printed on the line immediately before its import', () => {
    const src = `use std::fs::File;\n#[cfg(test)]\nuse crate::mocks::setup;\n\nfn main() { File::open("x"); }`;
    const result = organizeImportsInText(src);
    const lines = result.split('\n').filter(l => l.trim());
    const cfgIdx = lines.findIndex(l => l.includes('#[cfg(test)]'));
    const useIdx = lines.findIndex(l => l.includes('crate::mocks::setup'));
    expect(cfgIdx).toBeGreaterThanOrEqual(0);
    expect(useIdx).toBe(cfgIdx + 1);
  });

  it('handles #[cfg(feature = "...")] attributes', () => {
    const src = `#[cfg(feature = "serde")]\nuse serde::Serialize;\nfn main() {}`;
    const result = organizeImportsInText(src);
    expect(result).toContain('#[cfg(feature = "serde")]');
    expect(result).toContain('serde::Serialize');
  });

  it('multiple cfg imports are all kept and emitted with their attributes', () => {
    const src = `use std::fs::File;\n#[cfg(test)]\nuse crate::mocks::setup;\n#[cfg(feature = "logging")]\nuse tracing::info;\n\nfn main() { File::open("x"); }`;
    const result = organizeImportsInText(src);
    expect(result).toContain('#[cfg(test)]');
    expect(result).toContain('#[cfg(feature = "logging")]');
    expect(result).toContain('crate::mocks::setup');
    expect(result).toContain('tracing::info');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Cargo.toml-aware classification
// ─────────────────────────────────────────────────────────────────────────────

describe('setting: Cargo.toml-aware classification', () => {
  it('workspace member is classified as local when knownLocalCrates is provided', () => {
    const src = `use my_lib::models::User;\nuse serde::Serialize;\n\nfn main() { let _u: User; let _s: Serialize; }`;
    const ws = parseCargoToml(`[dependencies]\nserde = "1"\n[workspace]\nmembers = ["crates/my-lib"]`);

    const result = organizeImportsInText(src, {
      knownExternalCrates: ws.externalCrates,
      knownLocalCrates: ws.workspaceMembers,
      groupImports: true,
      blankLineBetweenGroups: true,
    });

    // serde (external) comes before my_lib (local)
    expect(result.indexOf('serde')).toBeLessThan(result.indexOf('my_lib'));
  });

  it('unknown crate falls back to external heuristic without Cargo data', () => {
    const src = `use unknown_crate::Foo;\n\nfn main() { let _: Foo; }`;
    const result = organizeImportsInText(src);
    // Should appear in output (classified as external by heuristic)
    expect(result).toContain('unknown_crate');
  });

  it('hyphenated dep names are normalised to underscores', () => {
    const ws = parseCargoToml(`[dependencies]\nmy-dep = "1.0"`);
    expect(ws.externalCrates.has('my_dep')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. buildOrganizedText — range-fix regression
// ─────────────────────────────────────────────────────────────────────────────

describe('buildOrganizedText — range-fix regression', () => {
  it('[BUG-ROOT] removed imports do not leak into beforeImports', () => {
    const allImports = parseImports(BUG_SRC);
    const used = removeUnusedImports(removeDuplicateImports(allImports), BUG_SRC);

    // chrono is on line 0; if we used `used` for the range, importStartLine=1
    // and line 0 (chrono) would end up in beforeImports verbatim
    expect(allImports[0].module).toBe('chrono');
    expect(used.find(i => i.module === 'serde_json')?.startLine).toBe(1);

    const result = buildOrganizedText(used, allImports, BUG_SRC);
    expect(result).not.toContain('chrono');
    expect(result).toContain('use serde_json::Value as JsonValue;');
  });

  it('first import removed, second kept — no leakage', () => {
    const src = `use std::io::Read;\nuse std::fs::File;\n\nfn main() { File::open("x"); }`;
    const all = parseImports(src);
    const used = removeUnusedImports(removeDuplicateImports(all), src);
    const out = buildOrganizedText(used, all, src);
    expect(out).not.toContain('Read');
    expect(out).toContain('use std::fs::File;');
    expect(out).toContain('fn main()');
  });

  it('last import removed, first kept', () => {
    const src = `use std::fs::File;\nuse std::io::Read;\n\nfn main() { File::open("x"); }`;
    const all = parseImports(src);
    const used = removeUnusedImports(removeDuplicateImports(all), src);
    expect(buildOrganizedText(used, all, src)).not.toContain('Read');
  });

  it('middle import removed', () => {
    const src = `use std::fs::File;\nuse std::io::Read;\nuse anyhow::Result;\n\nfn main() { let _f = File::open("x"); let _r: Result<()> = Ok(()); }`;
    const all = parseImports(src);
    const used = removeUnusedImports(removeDuplicateImports(all), src);
    const out = buildOrganizedText(used, all, src);
    expect(out).not.toContain('Read');
    expect(out).toContain('use std::fs::File;');
    expect(out).toContain('use anyhow::Result;');
  });

  it('all imports removed — block deleted, code preserved', () => {
    const src = `use std::fs::File;\nuse std::io::Read;\n\nfn main() { let _ = 42; }`;
    const all = parseImports(src);
    const used = removeUnusedImports(removeDuplicateImports(all), src);
    const out = buildOrganizedText(used, all, src);
    expect(out).not.toContain('use std');
    expect(out).toContain('fn main()');
  });

  it('returns original text unchanged when there are no imports', () => {
    const src = `fn main() { println!("hi"); }`;
    expect(organizeImportsInText(src)).toBe(src);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Text preservation
// ─────────────────────────────────────────────────────────────────────────────

describe('text preservation', () => {
  it('preserves code before the import block', () => {
    const src = `// top comment\nuse std::fs::File;\n\nfn main() { File::open("x"); }`;
    const out = organizeImportsInText(src);
    expect(out).toContain('// top comment');
    expect(out).toContain('use std::fs::File;');
  });

  it('preserves code after the import block', () => {
    const src = `use std::fs::File;\n\nfn main() { File::open("x"); }\n\npub struct Foo;`;
    const out = organizeImportsInText(src);
    expect(out).toContain('fn main()');
    expect(out).toContain('pub struct Foo;');
  });

  it('imports start at the top when there is no preceding code', () => {
    const src = `use std::collections::HashMap;\n\nfn main() { HashMap::<String,i32>::new(); }`;
    expect(organizeImportsInText(src).startsWith('use std::collections::HashMap;')).toBe(true);
  });

  it('exactly one blank line separates the import block from the code', () => {
    const src = `use std::fs::File;\n\n\n\nfn main() { File::open("x"); }`;
    const result = organizeImportsInText(src);
    // Should not have more than one blank line between imports and fn main
    expect(result).not.toMatch(/use .+;\n\n\n/);
    expect(result).toContain('fn main()');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Bug regressions
// ─────────────────────────────────────────────────────────────────────────────

describe('bug regressions', () => {
  it('[BUG-1] keeps serde_json::Value as JsonValue when alias is used', () => {
    expect(organizeImportsInText(BUG_SRC)).toContain('use serde_json::Value as JsonValue;');
  });

  it('[BUG-2] removes chrono entirely when neither DateTime nor Utc is used', () => {
    expect(organizeImportsInText(BUG_SRC)).not.toContain('chrono');
  });

  it('[BUG-2] does not produce a partial chrono import (old bug: kept DateTime)', () => {
    const result = organizeImportsInText(BUG_SRC);
    expect(result).not.toContain('DateTime');
    expect(result).not.toContain('chrono');
  });

  it('non-import code is fully preserved after pipeline', () => {
    const result = organizeImportsInText(BUG_SRC);
    expect(result).toContain('fn process(val: JsonValue) -> String {');
    expect(result).toContain('fn main() {');
    expect(result).toContain('serde_json::json!');
  });

  it('full test-unused.rs scenario produces exactly 6 import lines', () => {
    const result = organizeImportsInText(FULL_SRC);
    const importLines = result.split('\n').filter(l => l.startsWith('use '));
    expect(importLines).toHaveLength(6);
    expect(result).not.toContain('Arc');
    expect(result).not.toContain('Serialize');
    expect(result).not.toContain('helper');
    expect(result).not.toContain('PathBuf');
    expect(result).not.toContain('module');
  });
});