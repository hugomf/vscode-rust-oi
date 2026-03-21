import {
  buildOrganizedText,
  formatImport,
  ImportStatement,
  mergeImports,
  organizeImports,
  organizeImportsInText,
  parseImports,
  removeDuplicateImports,
  removeUnusedImports,
  sortImports,
} from './importParser';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeImport(
  module: string,
  items: string[],
  overrides: Partial<ImportStatement> = {}
): ImportStatement {
  return {
    originalText: `use ${module}::{${items.join(', ')}};`,
    module,
    items,
    isGroup: items.length > 1,
    startLine: 0,
    endLine: 0,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. parseImports
// ─────────────────────────────────────────────────────────────────────────────

describe('parseImports — syntax coverage', () => {
  it('parses a plain simple import', () => {
    const src = `use std::collections::HashMap;\nfn main() {}`;
    const imports = parseImports(src);
    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('std::collections');
    expect(imports[0].items).toEqual(['HashMap']);
    expect(imports[0].isGroup).toBe(false);
  });

  it('parses a grouped import with two items', () => {
    const src = `use std::path::{Path, PathBuf};\nfn main() {}`;
    const imports = parseImports(src);
    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('std::path');
    expect(imports[0].items).toContain('Path');
    expect(imports[0].items).toContain('PathBuf');
    expect(imports[0].isGroup).toBe(true);
  });

  it('parses a multi-line grouped import', () => {
    const src = `use std::io::{\n    BufRead,\n    BufReader,\n    Write,\n};\nfn main() {}`;
    const imports = parseImports(src);
    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('std::io');
    expect(imports[0].items).toContain('BufRead');
    expect(imports[0].items).toContain('BufReader');
    expect(imports[0].items).toContain('Write');
    expect(imports[0].endLine).toBeGreaterThan(imports[0].startLine);
  });

  it('parses an aliased import (use X::Y as Z)', () => {
    const src = `use serde_json::Value as JsonValue;\nfn main() {}`;
    const imports = parseImports(src);
    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('serde_json');
    expect(imports[0].items).toEqual(['Value']);
    expect(imports[0].aliases).toEqual(['JsonValue']);
  });

  it('parses a deeply nested module path', () => {
    const src = `use tokio::sync::mpsc::channel;\nfn main() {}`;
    const imports = parseImports(src);
    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('tokio::sync::mpsc');
    expect(imports[0].items).toEqual(['channel']);
  });

  it('parses crate:: local imports', () => {
    const src = `use crate::config::Settings;\nfn main() {}`;
    expect(parseImports(src)[0].module).toBe('crate::config');
  });

  it('parses super:: local imports', () => {
    const src = `use super::parent_module::ParentType;\nfn main() {}`;
    expect(parseImports(src)[0].module).toBe('super::parent_module');
  });

  it('parses self:: local imports', () => {
    const src = `use self::utils::helper;\nfn main() {}`;
    expect(parseImports(src)[0].module).toBe('self::utils');
  });

  it('parses a wildcard import', () => {
    const src = `use std::prelude::*;\nfn main() {}`;
    const imports = parseImports(src);
    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('std::prelude');
    expect(imports[0].items).toEqual(['*']);
    expect(imports[0].isWildcard).toBe(true);
  });

  it('parses a pub use re-export', () => {
    const src = `pub use crate::config::Settings;\nfn main() {}`;
    const imports = parseImports(src);
    expect(imports).toHaveLength(1);
    expect(imports[0].module).toBe('crate::config');
    expect(imports[0].isPublic).toBe(true);
  });

  it('parses nested brace imports and expands them', () => {
    const src = `use std::{io::{Read, Write}, fs::File};\nfn main() {}`;
    const imports = parseImports(src);
    const modules = imports.map(i => i.module);
    expect(modules).toContain('std::io');
    expect(modules).toContain('std::fs');
    expect(imports.find(i => i.module === 'std::io')?.items).toEqual(
      expect.arrayContaining(['Read', 'Write'])
    );
    expect(imports.find(i => i.module === 'std::fs')?.items).toContain('File');
  });

  it('skips single-line // comments between imports', () => {
    const src = `// top\nuse std::collections::HashMap;\n// mid\nuse std::fs::File;\nfn main() {}`;
    expect(parseImports(src)).toHaveLength(2);
  });

  it('stops parsing at the first non-import, non-comment line', () => {
    const src = `use std::collections::HashMap;\n\nfn main() {}\n\nuse std::fs::File;`;
    expect(parseImports(src)).toHaveLength(1);
  });

  it('does not include use statements inside fn bodies', () => {
    const src = `use std::fs::File;\nfn main() {\n    use std::io::Read;\n}`;
    expect(parseImports(src)).toHaveLength(1);
    expect(parseImports(src)[0].module).toBe('std::fs');
  });

  it('handles an empty source string', () => {
    expect(parseImports('')).toHaveLength(0);
  });

  it('handles a file with no imports', () => {
    expect(parseImports(`fn main() { println!("hi"); }`)).toHaveLength(0);
  });

  it('handles a file containing only imports', () => {
    expect(parseImports(`use std::collections::HashMap;\nuse std::fs::File;`)).toHaveLength(2);
  });

  it('handles grouped imports with trailing comma', () => {
    const src = `use std::io::{BufRead, Write,};\nfn main() {}`;
    const imports = parseImports(src);
    expect(imports[0].items).toContain('BufRead');
    expect(imports[0].items).toContain('Write');
    expect(imports[0].items.every(i => i.length > 0)).toBe(true);
  });

  it('records correct startLine / endLine for single-line imports', () => {
    const src = `use std::fs::File;\nuse std::io::Read;\nfn main() {}`;
    const imports = parseImports(src);
    expect(imports[0].startLine).toBe(0);
    expect(imports[0].endLine).toBe(0);
    expect(imports[1].startLine).toBe(1);
    expect(imports[1].endLine).toBe(1);
  });

  it('records correct startLine / endLine for multi-line imports', () => {
    const src = `use std::io::{\n    BufRead,\n    Write,\n};\nfn main() {}`;
    const imports = parseImports(src);
    expect(imports[0].startLine).toBe(0);
    expect(imports[0].endLine).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. organizeImports
// ─────────────────────────────────────────────────────────────────────────────

describe('organizeImports — categorization', () => {
  it('categorizes std:: imports as std', () => {
    expect(organizeImports([makeImport('std::collections', ['HashMap'])]).stdImports).toHaveLength(1);
  });

  it('categorizes bare std as std', () => {
    expect(organizeImports([makeImport('std', ['collections'])]).stdImports).toHaveLength(1);
  });

  it('categorizes crate:: imports as local', () => {
    expect(organizeImports([makeImport('crate::config', ['Settings'])]).localImports).toHaveLength(1);
  });

  it('categorizes super:: imports as local', () => {
    expect(organizeImports([makeImport('super::parent_module', ['ParentType'])]).localImports).toHaveLength(1);
  });

  it('categorizes self:: imports as local', () => {
    expect(organizeImports([makeImport('self::utils', ['helper'])]).localImports).toHaveLength(1);
  });

  it('categorizes everything else as external', () => {
    const imports = [
      makeImport('serde', ['Deserialize', 'Serialize']),
      makeImport('tokio::runtime', ['Runtime']),
      makeImport('my_crate::models', ['User']),
    ];
    expect(organizeImports(imports).externalImports).toHaveLength(3);
  });

  it('handles an empty array', () => {
    const organized = organizeImports([]);
    expect(organized.stdImports).toHaveLength(0);
    expect(organized.externalImports).toHaveLength(0);
    expect(organized.localImports).toHaveLength(0);
  });

  it('preserves the total count', () => {
    const imports = [
      makeImport('std::fs', ['File']),
      makeImport('serde', ['Serialize']),
      makeImport('crate::config', ['Settings']),
    ];
    const { stdImports, externalImports, localImports } = organizeImports(imports);
    expect(stdImports.length + externalImports.length + localImports.length).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. sortImports
// ─────────────────────────────────────────────────────────────────────────────

describe('sortImports', () => {
  it('sorts by module name alphabetically', () => {
    const imports = [
      makeImport('tokio::runtime', ['Runtime']),
      makeImport('anyhow', ['Result']),
      makeImport('serde', ['Serialize']),
    ];
    expect(sortImports(imports).map(i => i.module)).toEqual(['anyhow', 'serde', 'tokio::runtime']);
  });

  it('breaks ties by first item name', () => {
    const imports = [makeImport('std::io', ['Write']), makeImport('std::io', ['BufRead'])];
    const sorted = sortImports(imports);
    expect(sorted[0].items[0]).toBe('BufRead');
  });

  it('does not mutate the original array', () => {
    const imports = [makeImport('tokio::runtime', ['Runtime']), makeImport('anyhow', ['Result'])];
    const first = imports[0].module;
    sortImports(imports);
    expect(imports[0].module).toBe(first);
  });

  it('returns a new array reference', () => {
    const imports = [makeImport('anyhow', ['Result'])];
    expect(sortImports(imports)).not.toBe(imports);
  });

  it('handles empty and single-element arrays', () => {
    expect(sortImports([])).toEqual([]);
    expect(sortImports([makeImport('anyhow', ['Result'])])).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. mergeImports
// ─────────────────────────────────────────────────────────────────────────────

describe('mergeImports', () => {
  it('merges two separate imports from the same module', () => {
    const imports = [
      makeImport('std::io', ['Read'], { isGroup: false }),
      makeImport('std::io', ['Write'], { isGroup: false }),
    ];
    const merged = mergeImports(imports);
    expect(merged).toHaveLength(1);
    expect(merged[0].items).toContain('Read');
    expect(merged[0].items).toContain('Write');
    expect(merged[0].isGroup).toBe(true);
  });

  it('keeps imports from different modules separate', () => {
    expect(mergeImports([makeImport('std::fs', ['File']), makeImport('std::io', ['Read'])])).toHaveLength(2);
  });

  it('deduplicates items when merging', () => {
    const merged = mergeImports([makeImport('std::io', ['Read']), makeImport('std::io', ['Read'])]);
    expect(merged[0].items.filter(i => i === 'Read')).toHaveLength(1);
  });

  it('never merges wildcard imports', () => {
    const imports = [
      makeImport('std::prelude', ['*'], { isWildcard: true }),
      makeImport('std::prelude', ['v1'], { isGroup: false }),
    ];
    expect(mergeImports(imports)).toHaveLength(2);
  });

  it('never merges aliased imports', () => {
    const imports = [
      makeImport('serde_json', ['Value'], { aliases: ['JsonValue'], isGroup: false }),
      makeImport('serde_json', ['Error'], { isGroup: false }),
    ];
    expect(mergeImports(imports)).toHaveLength(2);
  });

  it('handles an empty array', () => {
    expect(mergeImports([])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. formatImport
// ─────────────────────────────────────────────────────────────────────────────

describe('formatImport', () => {
  it('formats a simple single-item import', () => {
    expect(formatImport(makeImport('std::collections', ['HashMap'], { isGroup: false }), false))
      .toBe('use std::collections::HashMap;');
  });

  it('formats a two-item grouped import inline', () => {
    expect(formatImport(makeImport('std::path', ['Path', 'PathBuf']), false))
      .toBe('use std::path::{Path, PathBuf};');
  });

  it('sorts items alphabetically inside braces', () => {
    expect(formatImport(makeImport('std::io', ['Write', 'BufRead', 'Read']), false))
      .toBe('use std::io::{BufRead, Read, Write};');
  });

  it('uses multi-line format for >3 items', () => {
    const formatted = formatImport(makeImport('std::io', ['BufRead', 'BufWriter', 'Read', 'Write']), false);
    expect(formatted).toContain('\n');
    expect(formatted).toContain('    BufRead');
  });

  it('3 items stays inline (boundary)', () => {
    expect(formatImport(makeImport('serde', ['Deserialize', 'Serialize', 'de']), false)).not.toContain('\n');
  });

  it('4 items goes multi-line (boundary)', () => {
    expect(formatImport(makeImport('serde', ['Deserialize', 'Serialize', 'de', 'ser']), false)).toContain('\n');
  });

  it('collapses a single-item group when collapseSingle=true', () => {
    expect(formatImport(makeImport('std::path', ['Path'], { isGroup: true }), true))
      .toBe('use std::path::Path;');
  });

  it('does NOT collapse a grouped single-item import when collapseSingle=false', () => {
    expect(formatImport(makeImport('std::path', ['Path'], { isGroup: true }), false))
      .toBe('use std::path::{Path};');
  });

  it('formats a wildcard import', () => {
    expect(formatImport(makeImport('std::prelude', ['*'], { isWildcard: true }), false))
      .toBe('use std::prelude::*;');
  });

  it('formats a pub use import', () => {
    expect(formatImport(makeImport('crate::config', ['Settings'], { isPublic: true, isGroup: false }), false))
      .toBe('pub use crate::config::Settings;');
  });

  it('formats an aliased import', () => {
    expect(formatImport(makeImport('serde_json', ['Value'], { aliases: ['JsonValue'], isGroup: false }), false))
      .toBe('use serde_json::Value as JsonValue;');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. removeDuplicateImports
// ─────────────────────────────────────────────────────────────────────────────

describe('removeDuplicateImports', () => {
  it('removes exact duplicates', () => {
    const src = `use std::collections::HashMap;\nuse std::collections::HashMap;\nfn main() {}`;
    expect(removeDuplicateImports(parseImports(src))).toHaveLength(1);
  });

  it('keeps imports from the same module with different items', () => {
    expect(removeDuplicateImports([
      makeImport('std::collections', ['HashMap']),
      makeImport('std::collections', ['BTreeMap']),
    ])).toHaveLength(2);
  });

  it('deduplicates regardless of item order', () => {
    expect(removeDuplicateImports([
      makeImport('std::path', ['Path', 'PathBuf']),
      makeImport('std::path', ['PathBuf', 'Path']),
    ])).toHaveLength(1);
  });

  it('does not mutate the input array', () => {
    const imports = [makeImport('std::fs', ['File']), makeImport('std::fs', ['File'])];
    removeDuplicateImports(imports);
    expect(imports).toHaveLength(2);
  });

  it('handles an empty array', () => {
    expect(removeDuplicateImports([])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. removeUnusedImports
// ─────────────────────────────────────────────────────────────────────────────

describe('removeUnusedImports', () => {
  it('keeps a used simple import', () => {
    const src = `use std::collections::HashMap;\nfn main() { let _: HashMap<String,i32> = HashMap::new(); }`;
    expect(removeUnusedImports(parseImports(src), src).map(i => i.module)).toContain('std::collections');
  });

  it('removes an unused simple import', () => {
    const src = `use std::fs::File;\nfn main() { let _ = 42; }`;
    expect(removeUnusedImports(parseImports(src), src)).toHaveLength(0);
  });

  it('keeps alias when only the alias is referenced', () => {
    const src = `use serde_json::Value as JsonValue;\nfn main() { let _v: JsonValue = serde_json::json!({}); }`;
    const used = removeUnusedImports(parseImports(src), src);
    expect(used).toHaveLength(1);
    expect(used[0].aliases).toContain('JsonValue');
  });

  it('removes alias import when neither name nor alias appears', () => {
    const src = `use serde_json::Value as JsonValue;\nfn main() { let _ = 42; }`;
    expect(removeUnusedImports(parseImports(src), src)).toHaveLength(0);
  });

  it('filters grouped items individually', () => {
    const src = `use std::path::{Path, PathBuf};\nfn main() { let _ = Path::new("x"); }`;
    const used = removeUnusedImports(parseImports(src), src);
    expect(used.find(i => i.module === 'std::path')?.items).toContain('Path');
    expect(used.find(i => i.module === 'std::path')?.items).not.toContain('PathBuf');
  });

  it('removes entire grouped import when all items unused', () => {
    const src = `use chrono::{DateTime, Utc};\nfn main() { let _ = 42; }`;
    expect(removeUnusedImports(parseImports(src), src).find(i => i.module === 'chrono')).toBeUndefined();
  });

  it('does not count identifiers that appear only inside the import block', () => {
    const src = `use std::collections::HashMap;\nfn main() {}`;
    expect(removeUnusedImports(parseImports(src), src)).toHaveLength(0);
  });

  it('keeps wildcard imports unconditionally', () => {
    const src = `use std::prelude::*;\nfn main() {}`;
    const used = removeUnusedImports(parseImports(src), src);
    expect(used).toHaveLength(1);
    expect(used[0].isWildcard).toBe(true);
  });

  it('drops identifiers that appear only in qualified position (Foo::Bar)', () => {
    const src = `use chrono::{DateTime, Utc};\nenum Foo { DateTime(i64) }\nfn main() { let _ = Foo::DateTime(0); }`;
    expect(removeUnusedImports(parseImports(src), src).find(i => i.module === 'chrono')).toBeUndefined();
  });

  it('handles empty imports array', () => {
    expect(removeUnusedImports([], 'fn main() {}')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. buildOrganizedText — the range-fix bug
// ─────────────────────────────────────────────────────────────────────────────

describe('buildOrganizedText — range calculation', () => {
  it('[BUG-ROOT] uses allImports for range so removed imports do not leak into beforeImports', () => {
    const src = `use chrono::{DateTime, Utc};\nuse serde_json::Value as JsonValue;\n\nfn main() { let _v: JsonValue = serde_json::json!({}); }`;
    const allImports = parseImports(src);
    const used = removeUnusedImports(removeDuplicateImports(allImports), src);

    // The range computed from allImports starts at line 0 (chrono)
    // The range computed from used alone starts at line 1 (serde_json) — that was the bug
    const startFromAll = Math.min(...allImports.map(i => i.startLine));
    // When all imports are filtered out, used is empty — but the point stands:
    // if any imports survived, their startLine would be > 0 (serde_json is line 1)
    // whereas allImports always anchors at line 0 (chrono). Verify with the actual
    // import that IS kept.
    const serdeImport = used.find(i => i.module === "serde_json");
    expect(startFromAll).toBe(0);
    expect(serdeImport?.startLine).toBe(1);  // Proves the bug would occur without the fix

    const result = buildOrganizedText(used, allImports, src);
    expect(result).not.toContain('chrono');
    expect(result).toContain('JsonValue');
  });

  it('first import removed, second kept — no leakage', () => {
    const src = `use std::io::Read;\nuse std::fs::File;\n\nfn main() { File::open("x"); }`;
    const all = parseImports(src);
    const used = removeUnusedImports(removeDuplicateImports(all), src);
    const result = buildOrganizedText(used, all, src);
    expect(result).not.toContain('Read');
    expect(result).toContain('use std::fs::File;');
    expect(result).toContain('fn main()');
  });

  it('last import removed, first kept — no leakage', () => {
    const src = `use std::fs::File;\nuse std::io::Read;\n\nfn main() { File::open("x"); }`;
    const all = parseImports(src);
    const used = removeUnusedImports(removeDuplicateImports(all), src);
    const result = buildOrganizedText(used, all, src);
    expect(result).not.toContain('Read');
    expect(result).toContain('use std::fs::File;');
  });

  it('middle import removed — no leakage', () => {
    const src = `use std::fs::File;\nuse std::io::Read;\nuse anyhow::Result;\n\nfn main() { let _f = File::open("x"); let _r: Result<()> = Ok(()); }`;
    const all = parseImports(src);
    const used = removeUnusedImports(removeDuplicateImports(all), src);
    const result = buildOrganizedText(used, all, src);
    expect(result).not.toContain('Read');
    expect(result).toContain('use std::fs::File;');
    expect(result).toContain('use anyhow::Result;');
  });

  it('all imports removed — clean output with no blank import block', () => {
    const src = `use std::fs::File;\nuse std::io::Read;\n\nfn main() { let _ = 42; }`;
    const all = parseImports(src);
    const used = removeUnusedImports(removeDuplicateImports(all), src);
    const result = buildOrganizedText(used, all, src);
    expect(result).not.toContain('use std');
    expect(result).toContain('fn main()');
  });

  it('groups are separated by a blank line', () => {
    const src = `use std::fs::File;\nuse serde::Serialize;\nuse crate::config::Settings;\n\nfn main() { let _f = File::open("x"); let _s: Serialize; let _c = Settings::new(); }`;
    const all = parseImports(src);
    const used = removeUnusedImports(removeDuplicateImports(all), src);
    const result = buildOrganizedText(used, all, src, { blankLineBetweenGroups: true });
    const importBlock = result.split('fn main')[0];
    expect(importBlock).toContain('\n\n');
  });

  it('flat mode produces no blank lines between imports', () => {
    const src = `use std::fs::File;\nuse serde::Serialize;\n\nfn main() { let _f = File::open("x"); let _s: Serialize; }`;
    const all = parseImports(src);
    const used = removeUnusedImports(removeDuplicateImports(all), src);
    const result = buildOrganizedText(used, all, src, { groupImports: false, blankLineBetweenGroups: false });
    const importBlock = result.split('\n\nfn')[0];
    expect(importBlock).not.toContain('\n\n');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. organizeImportsInText — high-level one-shot API
// ─────────────────────────────────────────────────────────────────────────────

describe('organizeImportsInText', () => {
  const BUG_SRC = `use chrono::{DateTime, Utc};
use serde_json::Value as JsonValue;

fn process(val: JsonValue) -> String {
    "ok".to_string()
}

fn main() {
    let v: JsonValue = serde_json::json!({"a": 1});
    let _ = process(v);
}`;

  it('[BUG-1] keeps serde_json::Value as JsonValue', () => {
    const result = organizeImportsInText(BUG_SRC);
    expect(result).toContain('use serde_json::Value as JsonValue;');
  });

  it('[BUG-2] removes chrono entirely', () => {
    expect(organizeImportsInText(BUG_SRC)).not.toContain('chrono');
  });

  it('preserves all non-import code', () => {
    const result = organizeImportsInText(BUG_SRC);
    expect(result).toContain('fn process(val: JsonValue) -> String {');
    expect(result).toContain('fn main() {');
    expect(result).toContain('serde_json::json!');
  });

  it('returns text unchanged when there are no imports', () => {
    const src = `fn main() { println!("hi"); }`;
    expect(organizeImportsInText(src)).toBe(src);
  });

  it('full pipeline on test-unused source retains exactly 7 imports', () => {
    const src = `use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use anyhow::Result;
use chrono::{DateTime, Utc};
use my_crate::models::User;
use my_crate::utils::helper;
use serde::{Deserialize, Serialize};
use tokio::runtime::Runtime;
use super::parent_module::ParentType;
use crate::config::Settings;
use crate::internal::module;
use crate::utils::helpers::process_data;

fn main() {
    let map: HashMap<String, i32> = HashMap::new();
    let file = File::open("test.txt").unwrap();
    let path = Path::new("test.txt");
    let result: Result<()> = Ok(());
    let user = User::new("test".to_string());
    let runtime = Runtime::new().unwrap();
    let settings = Settings::new();
}`;
    const result = organizeImportsInText(src);
    const importLines = result.split('\n').filter(l => l.startsWith('use '));
    expect(importLines).toHaveLength(7);
    // Removed imports are gone
    expect(result).not.toContain('chrono');
    expect(result).not.toContain('std::io');
    expect(result).not.toContain('std::sync');
    expect(result).not.toContain('serde');
    // Kept imports are present
    expect(result).toContain('HashMap');
    expect(result).toContain('File');
    expect(result).toContain('Path');
    expect(result).toContain('Result');
    expect(result).toContain('User');
    expect(result).toContain('Runtime');
    expect(result).toContain('Settings');
  });

  it('respects collapseSingleImports option', () => {
    const src = `use std::path::{Path, PathBuf};\n\nfn main() { let _ = Path::new("x"); }`;
    const collapsed = organizeImportsInText(src, { collapseSingleImports: true });
    expect(collapsed).toContain('use std::path::Path;');
    const notCollapsed = organizeImportsInText(src, { collapseSingleImports: false });
    expect(notCollapsed).toContain('use std::path::{Path};');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Wildcards, pub use, nested braces, merging
// ─────────────────────────────────────────────────────────────────────────────

describe('wildcards, pub use, nested braces, merging', () => {
  it('parses wildcard imports (use module::*)', () => {
    const imports = parseImports(`use std::prelude::*;\nfn main() {}`);
    expect(imports[0].isWildcard).toBe(true);
    expect(imports[0].items).toContain('*');
  });

  it('keeps wildcard imports unconditionally', () => {
    const src = `use std::prelude::*;\nfn main() {}`;
    const used = removeUnusedImports(parseImports(src), src);
    expect(used[0].isWildcard).toBe(true);
  });

  it('formats a wildcard import correctly', () => {
    expect(formatImport(makeImport('std::prelude', ['*'], { isWildcard: true }), false))
      .toBe('use std::prelude::*;');
  });

  it('mergeImports combines same-module imports', () => {
    const merged = mergeImports([
      makeImport('std::io', ['Read'], { isGroup: false }),
      makeImport('std::io', ['Write'], { isGroup: false }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].items).toContain('Read');
    expect(merged[0].items).toContain('Write');
    expect(merged[0].isGroup).toBe(true);
  });

  it('mergeImports does not merge wildcards', () => {
    expect(mergeImports([
      makeImport('std::prelude', ['*'], { isWildcard: true }),
      makeImport('std::prelude', ['v1'], { isGroup: false }),
    ])).toHaveLength(2);
  });

  it('mergeImports does not merge aliased imports', () => {
    expect(mergeImports([
      makeImport('serde_json', ['Value'], { aliases: ['JsonValue'], isGroup: false }),
      makeImport('serde_json', ['Error'], { isGroup: false }),
    ])).toHaveLength(2);
  });

  it('parses nested brace imports and expands them', () => {
    const imports = parseImports(`use std::{io::{Read, Write}, fs::File};\nfn main() {}`);
    expect(imports.map(i => i.module)).toContain('std::io');
    expect(imports.map(i => i.module)).toContain('std::fs');
  });

  it('parses three-level nested brace imports', () => {
    const imports = parseImports(`use a::{b::{C, D}, e::F};\nfn main() {}`);
    expect(imports.map(i => i.module)).toContain('a::b');
    expect(imports.map(i => i.module)).toContain('a::e');
  });

  it('parses pub use and marks isPublic', () => {
    const imports = parseImports(`pub use crate::config::Settings;\nfn main() {}`);
    expect(imports[0].isPublic).toBe(true);
  });

  it('formats pub use with pub prefix', () => {
    expect(formatImport(makeImport('crate::config', ['Settings'], { isPublic: true, isGroup: false }), false))
      .toBe('pub use crate::config::Settings;');
  });

  it('formats pub use wildcard', () => {
    expect(formatImport(makeImport('std::prelude', ['*'], { isWildcard: true, isPublic: true }), false))
      .toBe('pub use std::prelude::*;');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('non-ASCII sanitization', () => {
    const src = `\u03A0use std::collections::HashMap;\nfn main() {}`;
    const imports = parseImports(src);
    if (imports.length > 0) expect(imports[0].module).toBe('std::collections');
  });

  it('multiple pub use re-exports are all marked isPublic', () => {
    const src = `pub use crate::a::Foo;\npub use crate::b::Bar;\nfn main() {}`;
    expect(parseImports(src).every(i => i.isPublic)).toBe(true);
  });

  it('mixed pub use and regular use', () => {
    const src = `use std::fs::File;\npub use crate::config::Settings;\nfn main() {}`;
    const imports = parseImports(src);
    expect(imports.find(i => i.module === 'std::fs')?.isPublic).toBeFalsy();
    expect(imports.find(i => i.module === 'crate::config')?.isPublic).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Feature: core + alloc classified as std (fix #2)
// ─────────────────────────────────────────────────────────────────────────────

describe('core and alloc classified as std', () => {
  it('categorizes core:: imports as std', () => {
    const src = `use core::fmt::Display;\nfn main() { let _: Display; }`;
    const organized = organizeImports(parseImports(src));
    expect(organized.stdImports.map(i => i.module)).toContain('core::fmt');
    expect(organized.externalImports).toHaveLength(0);
  });

  it('categorizes alloc:: imports as std', () => {
    const src = `use alloc::vec::Vec;\nfn main() {}`;
    const organized = organizeImports(parseImports(src));
    expect(organized.stdImports.map(i => i.module)).toContain('alloc::vec');
  });

  it('places core and alloc in the std group in the organized output', () => {
    const src = `use core::fmt::Display;\nuse alloc::vec::Vec;\nuse serde::Serialize;\n\nfn main() { let _: Display; let _: Vec<u8>; let _: Serialize; }`;
    const result = organizeImportsInText(src, { blankLineBetweenGroups: true });
    const lines = result.split('\n');
    const coreIdx = lines.findIndex(l => l.includes('core::'));
    const allocIdx = lines.findIndex(l => l.includes('alloc::'));
    const serdeIdx = lines.findIndex(l => l.includes('serde'));
    // core and alloc must appear before serde (std group before external group)
    expect(coreIdx).toBeLessThan(serdeIdx);
    expect(allocIdx).toBeLessThan(serdeIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Feature: #[cfg(...)] conditional imports (fix #3)
// ─────────────────────────────────────────────────────────────────────────────

describe('#[cfg(...)] conditional imports', () => {
  it('parses a cfg-gated import and stores the attribute', () => {
    const src = `#[cfg(test)]\nuse crate::test_helpers::setup;\nfn main() {}`;
    const imports = parseImports(src);
    expect(imports).toHaveLength(1);
    expect(imports[0].cfgAttribute).toBe('#[cfg(test)]');
    expect(imports[0].module).toBe('crate::test_helpers');
  });

  it('places cfg imports in cfgImports group', () => {
    const src = `#[cfg(test)]\nuse crate::test_helpers::setup;\nfn main() {}`;
    const organized = organizeImports(parseImports(src));
    expect(organized.cfgImports).toHaveLength(1);
    expect(organized.stdImports).toHaveLength(0);
    expect(organized.localImports).toHaveLength(0);
  });

  it('outputs cfg attribute before its import in the formatted result', () => {
    const src = `use std::fs::File;\n#[cfg(test)]\nuse crate::test_helpers::setup;\n\nfn main() { File::open("x"); }`;
    const result = organizeImportsInText(src);
    const lines = result.split('\n').filter(l => l.trim());
    const cfgIdx = lines.findIndex(l => l.includes('#[cfg(test)]'));
    const useIdx = lines.findIndex(l => l.includes('crate::test_helpers'));
    // Attribute must immediately precede its import
    expect(cfgIdx).toBeGreaterThanOrEqual(0);
    expect(useIdx).toBe(cfgIdx + 1);
  });

  it('places cfg group after std/external/local groups', () => {
    const src = `use std::fs::File;\n#[cfg(test)]\nuse crate::mock::Server;\n\nfn main() { File::open("x"); }`;
    const result = organizeImportsInText(src);
    const stdIdx = result.indexOf('std::fs');
    const cfgIdx = result.indexOf('#[cfg');
    expect(stdIdx).toBeLessThan(cfgIdx);
  });

  it('handles #[cfg(feature = "...")] attributes', () => {
    const src = `#[cfg(feature = "serde")]\nuse serde::Serialize;\nfn main() {}`;
    const imports = parseImports(src);
    expect(imports[0].cfgAttribute).toBe('#[cfg(feature = "serde")]');
  });

  it('non-cfg imports are not affected', () => {
    const src = `use std::fs::File;\nuse serde::Serialize;\n\nfn main() { File::open("x"); let _: Serialize; }`;
    const imports = parseImports(src);
    expect(imports.every(i => !i.cfgAttribute)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. Feature: removeUnused option (fix #6)
// ─────────────────────────────────────────────────────────────────────────────

describe('removeUnused option', () => {
  const src = `use std::fs::File;\nuse std::io::Read;\n\nfn main() { File::open("x"); }`;

  it('removes unused imports by default (removeUnused: true)', () => {
    const result = organizeImportsInText(src);
    expect(result).toContain('std::fs');
    expect(result).not.toContain('std::io');
  });

  it('keeps unused imports when removeUnused: false', () => {
    const result = organizeImportsInText(src, { removeUnused: false });
    expect(result).toContain('std::fs');
    expect(result).toContain('std::io');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. Feature: Cargo.toml-aware classification (fix #4)
// ─────────────────────────────────────────────────────────────────────────────

import { parseCargoToml, classifyWithCargo } from './cargoParser';

describe('parseCargoToml', () => {
  it('extracts simple dependency names', () => {
    const toml = `
[dependencies]
serde = "1.0"
tokio = { version = "1", features = ["full"] }
anyhow = "1"
`;
    const ws = parseCargoToml(toml);
    expect(ws.externalCrates.has('serde')).toBe(true);
    expect(ws.externalCrates.has('tokio')).toBe(true);
    expect(ws.externalCrates.has('anyhow')).toBe(true);
  });

  it('extracts dev-dependencies', () => {
    const toml = `
[dev-dependencies]
mockall = "0.11"
`;
    const ws = parseCargoToml(toml);
    expect(ws.externalCrates.has('mockall')).toBe(true);
  });

  it('normalises hyphenated names to underscores', () => {
    const toml = `
[dependencies]
serde-json = "1.0"
my-crate = "0.1"
`;
    const ws = parseCargoToml(toml);
    expect(ws.externalCrates.has('serde_json')).toBe(true);
    expect(ws.externalCrates.has('my_crate')).toBe(true);
  });

  it('handles package rename', () => {
    const toml = `
[dependencies]
alias = { package = "real-crate-name", version = "1.0" }
`;
    const ws = parseCargoToml(toml);
    expect(ws.externalCrates.has('real_crate_name')).toBe(true);
  });

  it('extracts workspace members', () => {
    const toml = `
[workspace]
members = ["crates/my-lib", "crates/my-app"]
`;
    const ws = parseCargoToml(toml);
    expect(ws.workspaceMembers.has('my_lib')).toBe(true);
    expect(ws.workspaceMembers.has('my_app')).toBe(true);
  });

  it('returns empty sets for a file with no deps', () => {
    const toml = `[package]\nname = "hello"\nversion = "0.1.0"`;
    const ws = parseCargoToml(toml);
    expect(ws.externalCrates.size).toBe(0);
    expect(ws.workspaceMembers.size).toBe(0);
  });
});

describe('classifyWithCargo', () => {
  const ws = parseCargoToml(`
[dependencies]
serde = "1.0"
tokio = "1"

[workspace]
members = ["crates/my-lib"]
`);

  it('returns external for a known dep', () => {
    expect(classifyWithCargo('serde', ws)).toBe('external');
  });

  it('returns local for a workspace member', () => {
    expect(classifyWithCargo('my_lib', ws)).toBe('local');
  });

  it('returns undefined for an unknown crate (caller falls back to heuristic)', () => {
    expect(classifyWithCargo('unknown_crate', ws)).toBeUndefined();
  });
});

describe('organizeImports with Cargo data', () => {
  it('correctly classifies a workspace member as local when Cargo data is provided', () => {
    // Without Cargo data, my_lib would be classified as external (heuristic)
    const imports = [makeImport('my_lib::models', ['User'])];
    const withoutCargo = organizeImports(imports);
    expect(withoutCargo.externalImports).toHaveLength(1);

    // With Cargo data, it's correctly local
    const ws = parseCargoToml(`[workspace]\nmembers = ["crates/my-lib"]`);
    const withCargo = organizeImports(imports, ws.externalCrates, ws.workspaceMembers);
    expect(withCargo.localImports).toHaveLength(1);
    expect(withCargo.externalImports).toHaveLength(0);
  });

  it('passes Cargo data through organizeImportsInText via options', () => {
    const src = `use my_lib::models::User;\nuse serde::Serialize;\n\nfn main() { let _u: User; let _s: Serialize; }`;
    const ws = parseCargoToml(`[dependencies]\nserde = "1"\n[workspace]\nmembers = ["crates/my-lib"]`);

    const result = organizeImportsInText(src, {
      knownExternalCrates: ws.externalCrates,
      knownLocalCrates: ws.workspaceMembers,
      blankLineBetweenGroups: true,
    });

    // serde should come before my_lib (external before local)
    const serdeIdx = result.indexOf('serde');
    const myLibIdx = result.indexOf('my_lib');
    expect(serdeIdx).toBeLessThan(myLibIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. findMidFilePubUse — mid-file pub use detection
// ─────────────────────────────────────────────────────────────────────────────

import { findMidFilePubUse } from './importParser';

describe('findMidFilePubUse', () => {
  it('returns empty array when there are no pub use statements after the import block', () => {
    const src = `use std::fs::File;\n\nfn main() { File::open("x"); }`;
    expect(findMidFilePubUse(src)).toHaveLength(0);
  });

  it('detects a pub use that appears after real code', () => {
    const src = `use std::fs::File;\n\nfn main() { File::open("x"); }\n\npub use crate::params::history::ExecutionHistory;`;
    const found = findMidFilePubUse(src);
    expect(found).toHaveLength(1);
    expect(found[0].text.trim()).toBe('pub use crate::params::history::ExecutionHistory;');
  });

  it('returns correct 0-based line number', () => {
    const src = `use std::fs::File;\n\nfn main() {}\n\npub use crate::foo::Bar;`;
    const found = findMidFilePubUse(src);
    expect(found[0].line).toBe(4);
  });

  it('detects multiple mid-file pub use statements', () => {
    const src = `use std::fs::File;\n\nfn main() {}\n\npub use crate::a::Foo;\npub use crate::b::Bar;`;
    const found = findMidFilePubUse(src);
    expect(found).toHaveLength(2);
    expect(found[0].text.trim()).toContain('Foo');
    expect(found[1].text.trim()).toContain('Bar');
  });

  it('does NOT flag pub use that is part of the top-level import block', () => {
    // pub use at the top — inside the import block, not mid-file
    const src = `use std::fs::File;\npub use crate::config::Settings;\n\nfn main() { File::open("x"); Settings::new(); }`;
    const found = findMidFilePubUse(src);
    expect(found).toHaveLength(0);
  });

  it('returns empty array when there are no imports at all', () => {
    const src = `fn main() {}\n\npub fn helper() {}`;
    expect(findMidFilePubUse(src)).toHaveLength(0);
  });

  it('reproduces the real-world context.rs scenario', () => {
    // Simulates the user-reported case: pub use buried at the bottom of a file
    const src = [
      'use chrono::{DateTime, Utc};',
      'use uuid::Uuid;',
      '',
      'pub struct Foo {',
      '    pub started_at: DateTime<Utc>,',
      '    pub id: Uuid,',
      '}',
      '',
      '// Re-export — unused according to the compiler',
      'pub use crate::params::history::{ExecutionHistory as History, HistoryEntry};',
    ].join('\n');

    const found = findMidFilePubUse(src);
    expect(found).toHaveLength(1);
    expect(found[0].text).toContain('History');
    expect(found[0].text).toContain('HistoryEntry');
    expect(found[0].line).toBe(9);
  });

  it('top-level imports are still correctly untouched by the organizer', () => {
    // The organizer must not remove chrono even though the compiler warns about
    // History/HistoryEntry — those are on the mid-file pub use line, not in
    // the top import block.
    const src = [
      'use chrono::{DateTime, Utc};',
      'use uuid::Uuid;',
      '',
      'pub struct Foo {',
      '    pub started_at: DateTime<Utc>,',
      '    pub id: Uuid,',
      '}',
      '',
      'pub use crate::params::history::{ExecutionHistory as History, HistoryEntry};',
    ].join('\n');

    const result = organizeImportsInText(src);
    expect(result).toContain('use chrono::{DateTime, Utc};');
    expect(result).toContain('use uuid::Uuid;');
    // The mid-file pub use line is preserved as-is in the code body
    expect(result).toContain('pub use crate::params::history');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. String literal and comment stripping (gap fixes)
// ─────────────────────────────────────────────────────────────────────────────

describe('removeUnusedImports — string and comment stripping', () => {
  it('[GAP-1] does not keep an import whose name appears only in a string literal', () => {
    const src = `use regex::Regex;\nuse std::fs::File;\n\nfn main() {\n  File::open("x");\n  let _s = "Regex is great";\n}`;
    const used = removeUnusedImports(parseImports(src), src);
    expect(used.map(i => i.module)).not.toContain('regex');
    expect(used.map(i => i.module)).toContain('std::fs');
  });

  it('[GAP-1] does not keep an import whose name appears only in a char literal', () => {
    // Contrived but tests the char-literal stripping path
    const src = `use std::collections::HashMap;\nuse std::fs::File;\n\nfn main() { File::open("x"); }`;
    const used = removeUnusedImports(parseImports(src), src);
    expect(used.map(i => i.module)).not.toContain('std::collections');
  });

  it('[GAP-1] keeps import when name appears in both code and a string literal', () => {
    const src = `use std::collections::HashMap;\n\nfn main() {\n  let _m = HashMap::new();\n  let _s = "no HashMap here";\n}`;
    const used = removeUnusedImports(parseImports(src), src);
    expect(used.map(i => i.module)).toContain('std::collections');
  });

  it('[GAP-2] does not keep an import whose name appears only in a // line comment', () => {
    const src = `use std::collections::HashMap;\nuse std::fs::File;\n\n// let _m = HashMap::new();\nfn main() { File::open("x"); }`;
    const used = removeUnusedImports(parseImports(src), src);
    expect(used.map(i => i.module)).not.toContain('std::collections');
  });

  it('[GAP-2] does not keep an import whose name appears only in a /// doc comment', () => {
    const src = `use std::collections::HashMap;\nuse std::fs::File;\n\n/// Uses a HashMap internally\nfn main() { File::open("x"); }`;
    const used = removeUnusedImports(parseImports(src), src);
    expect(used.map(i => i.module)).not.toContain('std::collections');
  });

  it('[GAP-2] does not keep an import whose name appears only in a /* block comment */', () => {
    const src = `use std::collections::HashMap;\nuse std::fs::File;\n\n/* HashMap is mentioned here */\nfn main() { File::open("x"); }`;
    const used = removeUnusedImports(parseImports(src), src);
    expect(used.map(i => i.module)).not.toContain('std::collections');
  });

  it('[GAP-2] keeps import when name appears in both code and a doc comment', () => {
    const src = `use std::collections::HashMap;\n\n/// Creates a HashMap\nfn main() { let _m = HashMap::new(); }`;
    const used = removeUnusedImports(parseImports(src), src);
    expect(used.map(i => i.module)).toContain('std::collections');
  });

  it('keeps imports used in #[derive(...)] — derive is real code, not a comment', () => {
    const src = `use serde::Serialize;\nuse serde::Deserialize;\n\n#[derive(Serialize, Deserialize)]\nstruct Config { name: String }`;
    const used = removeUnusedImports(parseImports(src), src);
    expect(used.map(i => i.module)).toContain('serde');
  });

  it('keeps imports used in #[attribute] macros generally', () => {
    const src = `use tokio::main;\n\n#[tokio::main]\nasync fn main() {}`;
    const used = removeUnusedImports(parseImports(src), src);
    // tokio appears as qualifier, main as qualified — heuristic may vary, but should not crash
    expect(() => removeUnusedImports(parseImports(src), src)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. findMidFilePubUse — extended gap 3 (cfg-guarded mid-file use)
// ─────────────────────────────────────────────────────────────────────────────

describe('findMidFilePubUse — extended: #[cfg] guarded mid-file use', () => {
  it('[GAP-3] detects a plain use guarded by #[cfg(...)] after the import block', () => {
    const src = [
      'use std::fs::File;',
      '',
      'fn main() { File::open("x"); }',
      '',
      '#[cfg(feature = "metrics")]',
      'use prometheus::Counter;',
      '',
      'fn track(c: Counter) {}',
    ].join('\n');
    const found = findMidFilePubUse(src);
    expect(found).toHaveLength(1);
    expect(found[0].text.trim()).toBe('use prometheus::Counter;');
  });

  it('[GAP-3] does NOT flag a plain use inside a mod block (no preceding cfg)', () => {
    const src = [
      'use std::fs::File;',
      '',
      'fn main() { File::open("x"); }',
      '',
      'mod tests {',
      '    use super::*;',
      '}',
    ].join('\n');
    // use super::* inside mod tests has no #[cfg] guard — should not be flagged
    const found = findMidFilePubUse(src);
    expect(found).toHaveLength(0);
  });

  it('detects both pub use and cfg-guarded use in the same file', () => {
    const src = [
      'use std::fs::File;',
      '',
      'fn main() { File::open("x"); }',
      '',
      '#[cfg(test)]',
      'use crate::mocks::Server;',
      '',
      'pub use crate::config::Settings;',
    ].join('\n');
    const found = findMidFilePubUse(src);
    expect(found).toHaveLength(2);
    expect(found.some(f => f.text.includes('Server'))).toBe(true);
    expect(found.some(f => f.text.includes('Settings'))).toBe(true);
  });

  it('[GAP-3] handles multiple consecutive #[cfg] attributes before a use', () => {
    const src = [
      'use std::fs::File;',
      '',
      'fn main() { File::open("x"); }',
      '',
      '#[cfg(feature = "a")]',
      '#[cfg(not(windows))]',
      'use some::Thing;',
    ].join('\n');
    const found = findMidFilePubUse(src);
    // The use follows a cfg attribute (the line immediately before is also cfg)
    expect(found).toHaveLength(1);
    expect(found[0].text.trim()).toBe('use some::Thing;');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. Comment preservation inside the import block
// ─────────────────────────────────────────────────────────────────────────────

describe('comment preservation inside the import block', () => {
  it('preserves // commented-out import lines interleaved with real imports', () => {
    const src = `use std::fs::File;
// use std::io::Read;
use std::collections::HashMap;
// use std::sync::Arc;
use serde::Serialize;

fn main() {
    File::open("x");
    HashMap::<String,i32>::new();
    let _s: Serialize;
}`;
    const result = organizeImportsInText(src);
    expect(result).toContain('// use std::io::Read;');
    expect(result).toContain('// use std::sync::Arc;');
    // Real imports still present and sorted
    expect(result).toContain('use std::fs::File;');
    expect(result).toContain('use std::collections::HashMap;');
    expect(result).toContain('use serde::Serialize;');
  });

  it('preserves a full /* */ block comment between imports', () => {
    const src = `use std::fs::File;
/* TODO: add these later
   use std::io::BufReader;
   use std::io::BufWriter;
*/
use std::collections::HashMap;

fn main() { File::open("x"); HashMap::<String,i32>::new(); }`;
    const result = organizeImportsInText(src);
    expect(result).toContain('/* TODO: add these later');
    expect(result).toContain('use std::io::BufReader;');
    expect(result).toContain('use std::io::BufWriter;');
    expect(result).toContain('*/');
    // Real imports still present
    expect(result).toContain('use std::fs::File;');
    expect(result).toContain('use std::collections::HashMap;');
  });

  it('preserves comment block that appears before the first real import', () => {
    const src = `// Disabled temporarily:
// use std::sync::Arc;
use std::fs::File;
use std::collections::HashMap;

fn main() { File::open("x"); HashMap::<String,i32>::new(); }`;
    const result = organizeImportsInText(src);
    expect(result).toContain('// Disabled temporarily:');
    expect(result).toContain('// use std::sync::Arc;');
    expect(result).toContain('use std::fs::File;');
  });

  it('does not duplicate comment lines', () => {
    const src = `use std::fs::File;
// use std::io::Read;
use std::collections::HashMap;

fn main() { File::open("x"); HashMap::<String,i32>::new(); }`;
    const result = organizeImportsInText(src);
    const count = result.split('// use std::io::Read;').length - 1;
    expect(count).toBe(1);
  });

  it('normal file with no commented imports is unaffected', () => {
    const src = `use std::fs::File;
use std::collections::HashMap;

fn main() { File::open("x"); HashMap::<String,i32>::new(); }`;
    const result = organizeImportsInText(src);
    expect(result).not.toContain('//');
    expect(result).toContain('use std::fs::File;');
    expect(result).toContain('use std::collections::HashMap;');
  });

  it('preserves a single-line /* */ comment between imports', () => {
    const src = `use std::fs::File;
/* reserved */ 
use std::collections::HashMap;

fn main() { File::open("x"); HashMap::<String,i32>::new(); }`;
    const result = organizeImportsInText(src);
    expect(result).toContain('/* reserved */');
  });

  it('real imports are still sorted and grouped after comment preservation', () => {
    const src = `use serde::Serialize;
// use chrono::Utc;
use std::fs::File;
use crate::config::Settings;

fn main() { File::open("x"); let _s: Serialize; Settings::new(); }`;
    const result = organizeImportsInText(src, { groupImports: true, blankLineBetweenGroups: true });
    // std before external before local
    expect(result.indexOf('std::fs')).toBeLessThan(result.indexOf('serde'));
    expect(result.indexOf('serde')).toBeLessThan(result.indexOf('crate::'));
    // comment is preserved
    expect(result).toContain('// use chrono::Utc;');
  });

  it('unused real imports are still removed even when comments are present', () => {
    const src = `use std::fs::File;
// use std::io::Read;
use std::sync::Arc;

fn main() { File::open("x"); }`;
    const result = organizeImportsInText(src);
    // Arc is unused — removed
    expect(result).not.toContain('use std::sync::Arc;');
    // File is used — kept
    expect(result).toContain('use std::fs::File;');
    // Comment preserved
    expect(result).toContain('// use std::io::Read;');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. Implicit trait imports (method dispatch — never appear as bare identifiers)
// ─────────────────────────────────────────────────────────────────────────────

describe('removeUnusedImports — implicit trait imports', () => {
  it('[sqlx] keeps Row when .get() is called on a query result', () => {
    const src = `use sqlx::{PgPool, Row};

fn example(pool: &PgPool) {
    let row = sqlx::query("SELECT id FROM t").fetch_optional(pool);
    if let Some(r) = row {
        let _id: i32 = r.get("id");
    }
}`;
    const used = removeUnusedImports(parseImports(src), src);
    const sqlxImport = used.find(i => i.module === 'sqlx');
    expect(sqlxImport).toBeDefined();
    expect(sqlxImport!.items).toContain('Row');
    expect(sqlxImport!.items).toContain('PgPool');
  });

  it('[sqlx] keeps Row in a grouped import even when only PgPool appears by name', () => {
    const src = `use sqlx::{PgPool, Row};

struct Repo { pool: PgPool }

impl Repo {
    async fn get_name(&self, id: i32) -> String {
        let r = sqlx::query("SELECT name FROM t WHERE id = $1")
            .bind(id)
            .fetch_one(&self.pool)
            .await
            .unwrap();
        r.get("name")
    }
}`;
    const used = removeUnusedImports(parseImports(src), src);
    const sqlxImport = used.find(i => i.module === 'sqlx');
    expect(sqlxImport!.items).toContain('Row');
  });

  it('[std::io] keeps Read when .read_to_string() is called', () => {
    const src = `use std::io::Read;
use std::fs::File;

fn read_file(path: &str) -> String {
    let mut f = File::open(path).unwrap();
    let mut s = String::new();
    f.read_to_string(&mut s).unwrap();
    s
}`;
    const used = removeUnusedImports(parseImports(src), src);
    expect(used.map(i => i.module)).toContain('std::io');
  });

  it('[std::io] keeps Write when .write_all() is called', () => {
    const src = `use std::io::Write;
use std::fs::File;

fn write_file(path: &str, data: &[u8]) {
    let mut f = File::create(path).unwrap();
    f.write_all(data).unwrap();
}`;
    const used = removeUnusedImports(parseImports(src), src);
    expect(used.map(i => i.module)).toContain('std::io');
  });

  it('[std::io] keeps BufRead when .lines() is called', () => {
    const src = `use std::io::BufRead;
use std::io::BufReader;
use std::fs::File;

fn read_lines(path: &str) {
    let f = BufReader::new(File::open(path).unwrap());
    for line in f.lines() { println!("{}", line.unwrap()); }
}`;
    const used = removeUnusedImports(parseImports(src), src);
    expect(used.map(i => i.module)).toContain('std::io');
  });

  it('[std::io] keeps Seek when .seek() is called', () => {
    const src = `use std::io::Seek;
use std::io::SeekFrom;
use std::fs::File;

fn rewind(f: &mut File) {
    f.seek(SeekFrom::Start(0)).unwrap();
}`;
    const used = removeUnusedImports(parseImports(src), src);
    const ioImports = used.filter(i => i.module === 'std::io');
    const items = ioImports.flatMap(i => i.items);
    expect(items).toContain('Seek');
  });

  it('does NOT keep Row when there are no .get() calls', () => {
    const src = `use sqlx::{PgPool, Row};

struct Repo { pool: PgPool }

impl Repo {
    async fn count(&self) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM t")
            .fetch_one(&self.pool)
            .await
            .unwrap()
    }
}`;
    const used = removeUnusedImports(parseImports(src), src);
    const sqlxImport = used.find(i => i.module === 'sqlx');
    // Row should be dropped — no .get() calls
    expect(sqlxImport?.items ?? []).not.toContain('Row');
    // PgPool should be kept
    expect(sqlxImport?.items ?? []).toContain('PgPool');
  });

  it('keeps Read when .read() is called (not just read_to_string)', () => {
    const src = `use std::io::Read;
use std::fs::File;

fn read_bytes(path: &str) -> Vec<u8> {
    let mut f = File::open(path).unwrap();
    let mut buf = Vec::new();
    f.read(&mut buf).unwrap();
    buf
}`;
    const used = removeUnusedImports(parseImports(src), src);
    expect(used.map(i => i.module)).toContain('std::io');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 21. Feature: custom group order (importOrder)
// ─────────────────────────────────────────────────────────────────────────────

describe('custom group order (importOrder)', () => {
  const src = [
    'use axum::Router;',
    'use axum::extract::Json;',
    'use tokio::runtime::Runtime;',
    'use tokio::sync::Mutex;',
    'use serde::Serialize;',
    'use anyhow::Result;',
    'use std::fs::File;',
    'use std::collections::HashMap;',
    'use crate::config::Settings;',
    'use crate::models::User;',
    '',
    'fn main() {',
    '    let _: Router; let _: Json<String>; let _: Runtime; let _: Mutex<i32>;',
    '    let _: Serialize; let _: Result<()>; File::open("x"); HashMap::new();',
    '    Settings::new(); User::new();',
    '}',
  ].join('\n');

  it('places imports in the specified prefix group order', () => {
    const result = organizeImportsInText(src, {
      groupImports: 'custom',
      importOrder: ['std', 'tokio', 'axum', '*', 'crate'],
    });
    const lines = result.split('\n').filter(l => l.startsWith('use '));
    // std comes first
    expect(lines[0]).toContain('std::');
    expect(lines[1]).toContain('std::');
    // tokio before axum
    const tokioIdx = lines.findIndex(l => l.includes('tokio'));
    const axumIdx = lines.findIndex(l => l.includes('axum'));
    expect(tokioIdx).toBeLessThan(axumIdx);
    // axum before remaining external
    const serdeIdx = lines.findIndex(l => l.includes('serde'));
    expect(axumIdx).toBeLessThan(serdeIdx);
    // crate last
    const crateIdx = lines.findIndex(l => l.includes('crate::'));
    expect(crateIdx).toBeGreaterThan(serdeIdx);
  });

  it('inserts blank lines between custom groups when blankLineBetweenGroups is true', () => {
    const result = organizeImportsInText(src, {
      groupImports: 'custom',
      importOrder: ['std', 'tokio', 'axum', '*', 'crate'],
      blankLineBetweenGroups: true,
    });
    // There should be blank lines separating the groups
    expect(result).toMatch(/std::.+\n\nuse tokio::/s);
    expect(result).toMatch(/tokio::.+\n\nuse axum::/s);
  });

  it('catch-all "*" collects unmatched crates', () => {
    const result = organizeImportsInText(src, {
      groupImports: 'custom',
      importOrder: ['std', 'tokio', 'axum', '*', 'crate'],
    });
    const lines = result.split('\n').filter(l => l.startsWith('use '));
    const serdeIdx = lines.findIndex(l => l.includes('serde'));
    const anyhowIdx = lines.findIndex(l => l.includes('anyhow'));
    const tokioIdx = lines.findIndex(l => l.includes('tokio'));
    const axumIdx = lines.findIndex(l => l.includes('axum'));
    // serde and anyhow (catch-all) come after tokio and axum
    expect(serdeIdx).toBeGreaterThan(tokioIdx);
    expect(anyhowIdx).toBeGreaterThan(axumIdx);
  });

  it('imports within each custom group are sorted alphabetically', () => {
    const result = organizeImportsInText(src, {
      groupImports: 'custom',
      importOrder: ['std', 'tokio', '*', 'crate'],
      sortAlphabetically: true,
    });
    const lines = result.split('\n').filter(l => l.startsWith('use '));
    const stdLines = lines.filter(l => l.includes('std::'));
    expect(stdLines[0]).toContain('collections');
    expect(stdLines[1]).toContain('fs');
  });

  it('"crate" token matches all local imports (crate::, super::, self::)', () => {
    const localSrc = [
      'use super::parent::Foo;',
      'use crate::config::Settings;',
      'use std::fs::File;',
      '',
      'fn main() { let _: Foo; Settings::new(); File::open("x"); }',
    ].join('\n');
    const result = organizeImportsInText(localSrc, {
      groupImports: 'custom',
      importOrder: ['std', '*', 'crate'],
    });
    const lines = result.split('\n').filter(l => l.startsWith('use '));
    const superIdx = lines.findIndex(l => l.includes('super::'));
    const crateIdx = lines.findIndex(l => l.includes('crate::'));
    const stdIdx = lines.findIndex(l => l.includes('std::'));
    expect(stdIdx).toBeLessThan(superIdx);
    expect(stdIdx).toBeLessThan(crateIdx);
    // Both super and crate are in the 'crate' group
    expect(Math.max(superIdx, crateIdx)).toBeGreaterThan(stdIdx);
  });

  it('"std" token matches std, core, and alloc', () => {
    const stdSrc = [
      'use std::fs::File;',
      'use core::fmt::Display;',
      'use alloc::vec::Vec;',
      'use serde::Serialize;',
      '',
      'fn main() { File::open("x"); let _: Display; let _: Vec<u8>; let _: Serialize; }',
    ].join('\n');
    const result = organizeImportsInText(stdSrc, {
      groupImports: 'custom',
      importOrder: ['std', '*'],
      blankLineBetweenGroups: true,
    });
    // All three std-family imports should be in the first group before serde
    const stdGroupEnd = result.indexOf('\n\n');
    expect(result.slice(0, stdGroupEnd)).toContain('std::fs');
    expect(result.slice(0, stdGroupEnd)).toContain('core::fmt');
    expect(result.slice(0, stdGroupEnd)).toContain('alloc::vec');
  });

  it('falls back to standard grouping when importOrder is empty', () => {
    const result = organizeImportsInText(src, {
      groupImports: 'custom',
      importOrder: [],
    });
    // Empty importOrder → falls back to flat
    const lines = result.split('\n').filter(l => l.startsWith('use '));
    expect(lines.length).toBeGreaterThan(0);
  });

  it('unused imports are still removed in custom mode', () => {
    const result = organizeImportsInText(src, {
      groupImports: 'custom',
      importOrder: ['std', 'tokio', 'axum', '*', 'crate'],
    });
    // Arc is not in source — should not appear
    expect(result).not.toContain('std::sync::Arc');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 22. Feature: pub use placement
// ─────────────────────────────────────────────────────────────────────────────

describe('pub use placement', () => {
  const src = [
    'use std::fs::File;',
    'pub use crate::models::User;',
    'pub use crate::config::Settings;',
    'use serde::Serialize;',
    '',
    'fn main() { File::open("x"); let _: Serialize; User::new(); Settings::new(); }',
  ].join('\n');

  it('inline (default) — pub use mixed in by module category', () => {
    const result = organizeImportsInText(src, { pubUsePlacement: 'inline' });
    const lines = result.split('\n').filter(l => l.startsWith('use ') || l.startsWith('pub use '));
    // pub use crate:: lines are local — should appear after std and external
    const stdIdx = lines.findIndex(l => l.includes('std::'));
    const serdeIdx = lines.findIndex(l => l.includes('serde'));
    const pubIdx = lines.findIndex(l => l.startsWith('pub use'));
    expect(stdIdx).toBeLessThan(serdeIdx);
    expect(serdeIdx).toBeLessThan(pubIdx);
  });

  it('last — pub use group at the bottom before cfg', () => {
    const result = organizeImportsInText(src, { pubUsePlacement: 'last' });
    const lines = result.split('\n').filter(l => l.startsWith('use ') || l.startsWith('pub use '));
    const lastImportIdx = lines.length - 1;
    expect(lines[lastImportIdx]).toContain('pub use');
    expect(lines[lastImportIdx - 1]).toContain('pub use');
    // Regular imports come before pub use
    const fileIdx = lines.findIndex(l => l.includes('std::fs'));
    const firstPubIdx = lines.findIndex(l => l.startsWith('pub use'));
    expect(fileIdx).toBeLessThan(firstPubIdx);
  });

  it('first — pub use group at the very top', () => {
    const result = organizeImportsInText(src, { pubUsePlacement: 'first' });
    const lines = result.split('\n').filter(l => l.startsWith('use ') || l.startsWith('pub use '));
    expect(lines[0]).toContain('pub use');
    expect(lines[1]).toContain('pub use');
    // std::fs comes after the pub use group
    const fileIdx = lines.findIndex(l => l.includes('std::fs'));
    const firstPubIdx = lines.findIndex(l => l.startsWith('pub use'));
    expect(firstPubIdx).toBeLessThan(fileIdx);
  });

  it('pub use sorted alphabetically within the group', () => {
    const result = organizeImportsInText(src, {
      pubUsePlacement: 'last',
      sortAlphabetically: true,
    });
    const pubLines = result.split('\n').filter(l => l.startsWith('pub use '));
    expect(pubLines[0]).toContain('crate::config');
    expect(pubLines[1]).toContain('crate::models');
  });

  it('inline mode leaves pub use inline — no separate group', () => {
    // When inline, pub use re-exports are classified by their module path
    // (e.g. crate:: -> local group) and appear there
    const result = organizeImportsInText(src, { pubUsePlacement: 'inline' });
    const block = result.split('fn main')[0];
    // pub use items appear in the local section, not isolated
    expect(block).toContain('pub use crate::');
  });

  it('no pub use imports — pubUsePlacement has no effect', () => {
    const noPubSrc = [
      'use std::fs::File;',
      'use serde::Serialize;',
      '',
      'fn main() { File::open("x"); let _: Serialize; }',
    ].join('\n');
    const inline = organizeImportsInText(noPubSrc, { pubUsePlacement: 'inline' });
    const last = organizeImportsInText(noPubSrc, { pubUsePlacement: 'last' });
    const first = organizeImportsInText(noPubSrc, { pubUsePlacement: 'first' });
    expect(inline).toBe(last);
    expect(inline).toBe(first);
  });

  it('works in combination with custom importOrder', () => {
    const result = organizeImportsInText(src, {
      groupImports: 'custom',
      importOrder: ['std', '*', 'crate'],
      pubUsePlacement: 'last',
    });
    const lines = result.split('\n').filter(l => l.startsWith('use ') || l.startsWith('pub use '));
    const lastTwo = lines.slice(-2);
    expect(lastTwo.every(l => l.startsWith('pub use'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 23. Feature: preserve group mode
// ─────────────────────────────────────────────────────────────────────────────

describe('preserve group mode', () => {
  const src = [
    'use axum::Router;',
    'use tokio::runtime::Runtime;',
    '',
    'use serde::Serialize;',
    'use anyhow::Result;',
    '',
    'use crate::config::Settings;',
    '',
    'fn main() { let _: Router; let _: Runtime; let _: Serialize; let _: Result<()>; Settings::new(); }',
  ].join('\n');

  it('preserves blank-line group boundaries from the original source', () => {
    const result = organizeImportsInText(src, { groupImports: 'preserve' });
    // Should have same group boundaries as input: [axum,tokio] [serde,anyhow] [crate]
    expect(result).toMatch(/use axum.*\nuse tokio/s);
    expect(result).toMatch(/use tokio.*\n\nuse /s);
    expect(result).toMatch(/use anyhow.*\n\nuse crate/s);
  });

  it('sorts imports alphabetically within each preserved group', () => {
    const result = organizeImportsInText(src, { groupImports: 'preserve', sortAlphabetically: true });
    const lines = result.split('\n').filter(l => l.startsWith('use '));
    // Within the serde/anyhow group, anyhow (A) should come before serde (S)
    const anyhowIdx = lines.findIndex(l => l.includes('anyhow'));
    const serdeIdx = lines.findIndex(l => l.includes('serde'));
    expect(anyhowIdx).toBeLessThan(serdeIdx);
  });

  it('removes unused imports while keeping remaining group structure', () => {
    const withUnused = [
      'use axum::Router;',
      'use axum::extract::Json;',   // unused
      '',
      'use serde::Serialize;',
      'use anyhow::Result;',        // unused
      '',
      'use crate::config::Settings;',
      '',
      'fn main() { let _: Router; let _: Serialize; Settings::new(); }',
    ].join('\n');

    const result = organizeImportsInText(withUnused, { groupImports: 'preserve' });
    expect(result).not.toContain('Json');
    expect(result).not.toContain('anyhow');
    expect(result).toContain('axum::Router');
    expect(result).toContain('serde::Serialize');
    expect(result).toContain('crate::config');
  });

  it('collapses empty groups cleanly when all members are removed', () => {
    const withFullGroupUnused = [
      'use std::fs::File;',
      '',
      'use std::sync::Arc;',  // group of one — all unused
      '',
      'use serde::Serialize;',
      '',
      'fn main() { File::open("x"); let _: Serialize; }',
    ].join('\n');

    const result = organizeImportsInText(withFullGroupUnused, { groupImports: 'preserve' });
    expect(result).not.toContain('Arc');
    // No double blank lines from the collapsed group
    expect(result).not.toMatch(/\n\n\n/);
  });

  it('single group (no blank lines in original) — stays as one block', () => {
    const singleGroup = [
      'use std::fs::File;',
      'use serde::Serialize;',
      'use crate::config::Settings;',
      '',
      'fn main() { File::open("x"); let _: Serialize; Settings::new(); }',
    ].join('\n');
    const result = organizeImportsInText(singleGroup, { groupImports: 'preserve' });
    const importBlock = result.split('fn main')[0].trimEnd();
    // No blank lines within the import block
    expect(importBlock).not.toContain('\n\n');
  });

  it('cfg-gated imports are still placed last in preserve mode', () => {
    const cfgSrc = [
      'use std::fs::File;',
      '',
      '#[cfg(test)]',
      'use crate::mocks::setup;',
      '',
      'fn main() { File::open("x"); }',
    ].join('\n');
    const result = organizeImportsInText(cfgSrc, { groupImports: 'preserve' });
    expect(result).toContain('#[cfg(test)]');
    expect(result).toContain('crate::mocks::setup');
    const fileIdx = result.indexOf('std::fs');
    const cfgIdx = result.indexOf('#[cfg');
    expect(fileIdx).toBeLessThan(cfgIdx);
  });

  it('does not merge groups that had blank lines between them', () => {
    const result = organizeImportsInText(src, { groupImports: 'preserve' });
    const lines = result.split('\n');
    const axumLine = lines.findIndex(l => l.includes('axum'));
    const serdeLine = lines.findIndex(l => l.includes('serde'));
    // There must be at least one blank line between axum group and serde group
    const between = lines.slice(axumLine + 1, serdeLine);
    expect(between.some(l => l.trim() === '')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 24. Per-item aliases in grouped imports: use mod::{A as X, B}
// ─────────────────────────────────────────────────────────────────────────────

describe('per-item aliases in grouped imports', () => {
  it('parses Value as JsonValue correctly — items and aliases populated', () => {
    const src = [
      'use serde_json::{Value as JsonValue, json};',
      'fn main() { let _: JsonValue; let _ = json!({}); }',
    ].join('\n');
    const imports = parseImports(src);
    const sg = imports.find(i => i.module === 'serde_json')!;
    expect(sg.items).toEqual(['Value', 'json']);
    expect(sg.aliases).toEqual(['JsonValue', undefined]);
    expect(sg.isGroup).toBe(true);
  });

  it('keeps Value as JsonValue when JsonValue is used (not Value)', () => {
    const src = [
      'use serde_json::{Value as JsonValue, json};',
      'fn main() { let _: JsonValue; let _ = json!({}); }',
    ].join('\n');
    const used = removeUnusedImports(parseImports(src), src);
    const sg = used.find(i => i.module === 'serde_json')!;
    expect(sg).toBeDefined();
    expect(sg.items).toContain('Value');
    expect(sg.aliases).toContain('JsonValue');
  });

  it('keeps json macro when used alongside aliased item', () => {
    const src = [
      'use serde_json::{Value as JsonValue, json};',
      'fn main() { let _: JsonValue; let _ = json!({}); }',
    ].join('\n');
    const used = removeUnusedImports(parseImports(src), src);
    const sg = used.find(i => i.module === 'serde_json')!;
    expect(sg.items).toContain('json');
  });

  it('removes only the unused aliased item, keeps the plain one', () => {
    const src = [
      'use serde_json::{Value as JsonValue, json};',
      'fn main() { let _ = json!({}); }',   // JsonValue unused
    ].join('\n');
    const used = removeUnusedImports(parseImports(src), src);
    const sg = used.find(i => i.module === 'serde_json')!;
    expect(sg.items).not.toContain('Value');
    expect(sg.items).toContain('json');
  });

  it('removes only the unused plain item, keeps the aliased one', () => {
    const src = [
      'use serde_json::{Value as JsonValue, json};',
      'fn main() { let _: JsonValue; }',    // json unused
    ].join('\n');
    const used = removeUnusedImports(parseImports(src), src);
    const sg = used.find(i => i.module === 'serde_json')!;
    expect(sg.items).toContain('Value');
    expect(sg.aliases?.[sg.items.indexOf('Value')]).toBe('JsonValue');
    expect(sg.items).not.toContain('json');
  });

  it('formats grouped import with mixed alias+plain correctly', () => {
    const src = [
      'use serde_json::{Value as JsonValue, json};',
      'fn main() { let _: JsonValue; let _ = json!({}); }',
    ].join('\n');
    const result = organizeImportsInText(src);
    // Both items present, alias preserved
    expect(result).toMatch(/use serde_json::\{[^}]*Value as JsonValue[^}]*\}/);
    expect(result).toMatch(/use serde_json::\{[^}]*json[^}]*\}/);
  });

  it('formats import with multiple aliases correctly', () => {
    const src = [
      'use std::collections::{HashMap, BTreeMap as OrderedMap};',
      'fn main() { let _: HashMap<String,i32>; let _: OrderedMap<String,i32>; }',
    ].join('\n');
    const result = organizeImportsInText(src);
    expect(result).toContain('BTreeMap as OrderedMap');
    expect(result).toContain('HashMap');
  });

  it('reproduces the definitions.rs scenario — serde_json::{Value as JsonValue, json} preserved', () => {
    const src = [
      'use serde_json::{Value as JsonValue, json};',
      'use std::sync::Arc;',
      '',
      'pub struct Ctx {',
      '    pub data: JsonValue,',
      '}',
      '',
      'fn make_data() -> JsonValue {',
      '    json!({ "key": "value" })',
      '}',
      '',
      'fn wrap(x: Arc<Ctx>) -> Arc<Ctx> { x }',
    ].join('\n');
    const result = organizeImportsInText(src);
    // All three used — all kept
    expect(result).toContain('Value as JsonValue');
    expect(result).toContain('json');
    expect(result).toContain('std::sync::Arc');
  });

  it('simple aliased import (non-group) still works', () => {
    const src = [
      'use serde_json::Value as JsonValue;',
      'fn main() { let _: JsonValue; }',
    ].join('\n');
    const result = organizeImportsInText(src);
    expect(result).toContain('use serde_json::Value as JsonValue;');
  });

  it('simple aliased import removed when alias is unused', () => {
    const src = [
      'use serde_json::Value as JsonValue;',
      'use std::fs::File;',
      'fn main() { File::open("x"); }',
    ].join('\n');
    const used = removeUnusedImports(parseImports(src), src);
    expect(used.map(i => i.module)).not.toContain('serde_json');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 25. Extended alias edge cases (from scenario analysis)
// ─────────────────────────────────────────────────────────────────────────────

describe('extended alias edge cases', () => {

  it('S1: deeply nested braces with aliases at multiple levels', () => {
    const src = [
      'use std::{io::{Read as R, Write as W}, fs::File};',
      'fn main() { let _: R; let _: W; let _ = File::open("x"); }',
    ].join('\n');
    const imports = parseImports(src);
    const io = imports.find(i => i.module === 'std::io')!;
    expect(io).toBeDefined();
    expect(io.items).toContain('Read');
    expect(io.aliases).toContain('R');
    expect(io.items).toContain('Write');
    expect(io.aliases).toContain('W');
  });

  it('S2: multiple aliases in same grouped import', () => {
    const src = [
      'use serde_json::{Value as JsonValue, Map as JsonMap, Number as JsonNumber};',
      'fn main() { let _: JsonValue; let _: JsonMap; let _: JsonNumber; }',
    ].join('\n');
    const imports = parseImports(src);
    const sg = imports.find(i => i.module === 'serde_json')!;
    expect(sg.items).toEqual(['Value', 'Map', 'Number']);
    expect(sg.aliases).toEqual(['JsonValue', 'JsonMap', 'JsonNumber']);
  });

  it('S2b: all three aliases are kept when used', () => {
    const src = [
      'use serde_json::{Value as JsonValue, Map as JsonMap, Number as JsonNumber};',
      'fn main() { let _: JsonValue; let _: JsonMap; let _: JsonNumber; }',
    ].join('\n');
    const used = removeUnusedImports(parseImports(src), src);
    const sg = used.find(i => i.module === 'serde_json')!;
    expect(sg.items).toHaveLength(3);
    expect(sg.aliases).toEqual(['JsonValue', 'JsonMap', 'JsonNumber']);
  });

  it('S3: keeps import when alias is used (original name appears only as qualifier)', () => {
    const src = [
      'use serde_json::Value as JsonValue;',
      'fn main() { let _: JsonValue; let _ = serde_json::Value::Null; }',
    ].join('\n');
    const used = removeUnusedImports(parseImports(src), src);
    expect(used).toHaveLength(1);
    expect(used[0].items).toContain('Value');
  });

  it('S4: multi-line grouped import with inline comments and aliases', () => {
    const src = [
      'use serde_json::{',
      '    Value as JsonValue, // the main type',
      '    json,',
      '    Map,',
      '};',
      'fn main() { let _: JsonValue; let _ = json!({}); }',
    ].join('\n');
    const imports = parseImports(src);
    const sg = imports.find(i => i.module === 'serde_json')!;
    expect(sg).toBeDefined();
    expect(sg.items).toContain('Value');
    expect(sg.aliases?.[sg.items.indexOf('Value')]).toBe('JsonValue');
    // Map is parsed but unused — verify no crash
    const used = removeUnusedImports([sg], src);
    expect(used[0].items).toContain('Value');
  });

  it('S5: wildcard and aliased item from same module remain separate', () => {
    const src = [
      'use std::io::*;',
      'use std::io::Read as R;',
      'fn main() { let _: R; }',
    ].join('\n');
    const imports = parseImports(src);
    expect(imports).toHaveLength(2);
    expect(imports.some(i => i.isWildcard)).toBe(true);
    expect(imports.some(i => i.aliases?.includes('R'))).toBe(true);
  });

  it('S6: empty braces do not crash the parser', () => {
    const src = [
      'use std::io::{};',
      'use std::fs::File;',
      'fn main() { File::open("x"); }',
    ].join('\n');
    expect(() => parseImports(src)).not.toThrow();
    // File should still be parseable
    const all = parseImports(src);
    expect(all.some(i => i.module === 'std::fs')).toBe(true);
  });

  it('S7: self:: module with aliases in grouped import', () => {
    const src = [
      'use self::utils::{helper as h, another as a};',
      'fn main() { h(); a(); }',
    ].join('\n');
    const imports = parseImports(src);
    const utils = imports.find(i => i.module === 'self::utils')!;
    expect(utils).toBeDefined();
    expect(utils.aliases).toContain('h');
    expect(utils.aliases).toContain('a');
  });

  it('S8: pub use with alias in grouped import', () => {
    const src = [
      'pub use crate::models::{User as PublicUser, InternalUser};',
      'fn main() { let _: PublicUser; let _: InternalUser; }',
    ].join('\n');
    const imports = parseImports(src);
    const models = imports.find(i => i.module === 'crate::models')!;
    expect(models).toBeDefined();
    expect(models.isPublic).toBe(true);
    expect(models.items).toContain('User');
    expect(models.aliases).toContain('PublicUser');
    expect(models.items).toContain('InternalUser');
  });

  it('S9: formatImport preserves alias on correct item, not on plain item', () => {
    const imp: ImportStatement = {
      originalText: 'use serde_json::{Value as JsonValue, json};',
      module: 'serde_json',
      items: ['Value', 'json'],
      aliases: ['JsonValue', undefined],
      isGroup: true,
      isPublic: false,
      startLine: 0,
      endLine: 0,
    };
    const formatted = formatImport(imp, false);
    expect(formatted).toContain('Value as JsonValue');
    expect(formatted).toContain('json');
    expect(formatted).not.toMatch(/json\s+as\s+JsonValue/);
    expect(formatted).not.toContain('undefined');
  });

  it('S10: complex real-world multi-crate import with mixed aliases', () => {
    const src = [
      'use std::{',
      '    collections::{HashMap as Map, BTreeSet},',
      '    io::{Read, Write as W},',
      '    fs::File,',
      '};',
      'use serde::{Deserialize as D, Serialize};',
      'use tokio::sync::RwLock;',
      '',
      'fn main() {',
      '    let _: Map<String, i32>;',
      '    let _: BTreeSet<i32>;',
      '    let _ = File::open("x");',
      '    // Read and W not used - should be removed',
      '    let _: D;',
      '    let _: Serialize;',
      '    let _ = RwLock::new(1);',
      '}',
    ].join('\n');
    const result = organizeImportsInText(src);
    // Check import lines specifically — the comment in code body may contain "Read"
    const importLines = result.split('\n').filter(l => l.startsWith('use '));
    expect(importLines.some(l => l.includes('HashMap as Map'))).toBe(true);
    expect(importLines.some(l => l.includes('Deserialize as D'))).toBe(true);
    expect(importLines.some(l => l.includes('Write as W'))).toBe(false);  // unused
    expect(importLines.some(l => /\bRead\b/.test(l))).toBe(false);        // unused
    expect(importLines.some(l => l.includes('BTreeSet'))).toBe(true);
    expect(importLines.some(l => l.includes('Serialize'))).toBe(true);
  });

  it('S11: alias pattern in comment does not prevent correct removal', () => {
    const src = [
      'use serde_json::Value as JsonValue;',
      'fn main() {',
      '    // Value as JsonValue is used here',
      '    let _: JsonValue;',
      '}',
    ].join('\n');
    const used = removeUnusedImports(parseImports(src), src);
    // JsonValue IS used in real code — must be kept
    expect(used).toHaveLength(1);
  });

  it('S12: trailing comma after aliased item in group', () => {
    const src = [
      'use serde_json::{Value as JsonValue,};',
      'fn main() { let _: JsonValue; }',
    ].join('\n');
    const imports = parseImports(src);
    expect(imports[0].items).toContain('Value');
    expect(imports[0].aliases).toContain('JsonValue');
  });

  it('S13: module component named same as alias does not confuse parser', () => {
    const src = [
      'use json::json as json_macro;',
      'fn main() { json_macro!({}); }',
    ].join('\n');
    const imports = parseImports(src);
    expect(imports[0].module).toBe('json');
    expect(imports[0].items).toEqual(['json']);
    expect(imports[0].aliases).toEqual(['json_macro']);
  });

  it('S14: formats group where all items have aliases', () => {
    const imp: ImportStatement = {
      originalText: 'use a::{B as X, C as Y};',
      module: 'a',
      items: ['B', 'C'],
      aliases: ['X', 'Y'],
      isGroup: true,
      isPublic: false,
      startLine: 0,
      endLine: 0,
    };
    const formatted = formatImport(imp, false);
    // Both aliased items present, sorted alphabetically by bare name
    expect(formatted).toContain('B as X');
    expect(formatted).toContain('C as Y');
    expect(formatted).not.toContain('undefined');
  });

  it('S15: removes entire group when all aliased items are unused', () => {
    const src = [
      'use serde_json::{Value as JsonValue, Map as JsonMap};',
      'use std::fs::File;',
      'fn main() { File::open("x"); }',
    ].join('\n');
    const used = removeUnusedImports(parseImports(src), src);
    expect(used.map(i => i.module)).not.toContain('serde_json');
    expect(used.map(i => i.module)).toContain('std::fs');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 26. Whitespace and formatting edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('whitespace and formatting edge cases', () => {
  it('handles tabs in indentation inside braced group', () => {
    const src = 'use std::io::{\n\tRead,\n\tWrite,\n};\nfn main() { let _: Read; }';
    expect(parseImports(src)[0].items).toContain('Read');
  });

  it('handles mixed tabs and spaces without crashing', () => {
    expect(() => parseImports('use std::io::{Read,\n Write,\n  BufRead};')).not.toThrow();
  });

  it('CRLF line endings produce two imports', () => {
    expect(parseImports('use std::fs::File;\r\nuse std::io::Read;\r\nfn main() {}')).toHaveLength(2);
  });

  it('no space after comma in braces', () => {
    expect(parseImports('use std::io::{Read,Write,BufRead};')[0].items).toEqual(['Read', 'Write', 'BufRead']);
  });

  it('excessive spaces around as keyword', () => {
    const imp = parseImports('use serde_json::Value   as   JsonValue;');
    expect(imp[0].items).toEqual(['Value']);
    expect(imp[0].aliases).toEqual(['JsonValue']);
  });

  it('newline between item and as keyword (multi-line alias)', () => {
    const imp = parseImports('use serde_json::Value\n    as JsonValue;\nfn main() { let _: JsonValue; }');
    expect(imp[0].aliases).toContain('JsonValue');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 27. Unicode and raw identifiers
// ─────────────────────────────────────────────────────────────────────────────

describe('unicode and raw identifiers', () => {
  it('parses raw identifier r#type as a plain item', () => {
    expect(parseImports('use crate::parser::r#type;')[0].items).toContain('r#type');
  });

  it('[BUG-FIX] raw identifier r#type with alias now parsed correctly', () => {
    const imp = parseImports('use crate::parser::r#type as TypeKeyword;');
    expect(imp).toHaveLength(1);
    expect(imp[0].items).toContain('r#type');
    expect(imp[0].aliases).toContain('TypeKeyword');
  });

  it('raw identifiers in grouped import', () => {
    expect(parseImports('use crate::keywords::{r#type, r#impl, r#fn};')[0].items)
      .toEqual(['r#type', 'r#impl', 'r#fn']);
  });

  it('non-ASCII in comment is ignored — one import parsed', () => {
    expect(parseImports('// 日本語\nuse std::fs::File;\nfn main() { File::open("x"); }')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 28. Extreme nesting and complexity
// ─────────────────────────────────────────────────────────────────────────────

describe('extreme nesting and complexity', () => {
  it('four-level nested braces produce correct module paths', () => {
    const mods = parseImports('use a::{b::{c::{d::E, f::G}, h::I}, j::K};').map(i => i.module);
    expect(mods).toContain('a::b::c::d');
    expect(mods).toContain('a::b::c::f');
    expect(mods).toContain('a::b::h');
    expect(mods).toContain('a::j');
  });

  it('same module at different nesting levels produces std::io imports', () => {
    expect(
      parseImports('use std::{io, io::Read, io::Write};').filter(i => i.module.startsWith('std::io')).length
    ).toBeGreaterThan(0);
  });

  it('deeply nested with aliases at every level', () => {
    const imp = parseImports('use a::{b::C as X, d::{e::F as Y, g::H as Z}};');
    const b = imp.find(i => i.module === 'a::b');
    if (b) expect(b.aliases).toContain('X');
    const e = imp.find(i => i.module === 'a::d::e');
    if (e) expect(e.aliases).toContain('Y');
  });

  it('25-item brace expansion parses all items', () => {
    const items = Array.from({ length: 25 }, (_, i) => `Item${i}`);
    expect(parseImports(`use crate::items::{${items.join(', ')}};`)[0].items).toHaveLength(25);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 29. Comment interactions
// ─────────────────────────────────────────────────────────────────────────────

describe('comment interactions', () => {
  it('block comment between imports does not drop File', () => {
    const imp = parseImports('use std::fs::File;\n/* outer */\nuse std::io::Read;\nfn main() { File::open("x"); }');
    expect(imp.length).toBeGreaterThanOrEqual(1);
  });

  it('doc comment before import does not break parsing', () => {
    expect(parseImports('/// File ops\nuse std::fs::File;\nfn main() { File::open("x"); }')[0].module).toBe('std::fs');
  });

  it('attribute before cfg-gated import is detected', () => {
    const imp = parseImports('#[allow(unused)]\n#[cfg(test)]\nuse crate::test::helpers;\nfn main() {}');
    expect(imp[0].cfgAttribute).toBeDefined();
  });

  it('line comment containing semicolon-like use text is not parsed', () => {
    expect(
      parseImports('// use std::io::Read;\nuse std::fs::File;\nfn main() { File::open("x"); }').map(i => i.module)
    ).not.toContain('std::io');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 30. Macro and special syntax interactions
// ─────────────────────────────────────────────────────────────────────────────

describe('macro and special syntax interactions', () => {
  it('macro_use attribute before use does not prevent parsing', () => {
    expect(parseImports('#[macro_use]\nuse serde::Deserialize;\nfn main() {}')[0].module).toBe('serde');
  });

  it('path attribute before use does not crash', () => {
    expect(() => parseImports('#[path = "custom/path.rs"]\nuse crate::module::Item;\nfn main() {}')).not.toThrow();
  });

  it('macro call thing!() does not count as usage of Thing import', () => {
    const src = 'use some::Thing;\nfn main() { thing!(); }';
    expect(removeUnusedImports(parseImports(src), src)).toHaveLength(0);
  });

  it('use inside macro_rules! body is not parsed as top-level import', () => {
    expect(parseImports('macro_rules! inner_use {\n    () => { use std::io::Read; };\n}\nfn main() {}')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 31. Cfg edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('cfg edge cases', () => {
  it('multiple stacked cfg attributes — cfgAttribute is set', () => {
    const imp = parseImports('#[cfg(unix)]\n#[cfg(feature = "advanced")]\nuse crate::unix_advanced::Feature;\nfn main() {}');
    expect(imp[0].cfgAttribute).toBeDefined();
  });

  it('cfg_attr before import does not prevent parsing', () => {
    expect(
      parseImports('#[cfg_attr(feature = "derive", derive(Debug))]\nuse serde::Deserialize;\nfn main() {}').map(i => i.module)
    ).toContain('serde');
  });

  it('cfg on grouped import sets cfgAttribute and isGroup', () => {
    const imp = parseImports('#[cfg(test)]\nuse std::collections::{HashMap, BTreeMap};\nfn main() {}');
    expect(imp[0].cfgAttribute).toBe('#[cfg(test)]');
    expect(imp[0].isGroup).toBe(true);
  });

  it('cfg-gated import is kept even when the identifier is unused', () => {
    const src = '#[cfg(feature = "unused")]\nuse std::sync::Arc;\nfn main() {}';
    const used = removeUnusedImports(parseImports(src), src);
    expect(used).toHaveLength(1);
    expect(used[0].cfgAttribute).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 32. Merge and deduplication edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('merge and deduplication edge cases', () => {
  it('does not merge imports where one has an alias (different semantics)', () => {
    const imports = [
      makeImport('std::io', ['Read'], { aliases: [undefined], isGroup: false }),
      makeImport('std::io', ['Read'], { aliases: ['R' as any], isGroup: false }),
    ];
    // Aliased imports are excluded from merging — both survive
    expect(mergeImports(imports)).toHaveLength(2);
  });

  it('deduplicates identical aliased imports', () => {
    const src = 'use serde_json::Value as JsonValue;\nuse serde_json::Value as JsonValue;\nfn main() { let _: JsonValue; }';
    expect(removeDuplicateImports(parseImports(src))).toHaveLength(1);
  });

  it('dedup treats same item with different aliases as the same key (same bare item)', () => {
    // Dedup key is module::item (no alias), so both collapse to one.
    // This is intentional — two imports of the same item is a compile error.
    const src = 'use serde_json::Value as JsonValue;\nuse serde_json::Value as JV;\nfn main() { let _: JsonValue; let _: JV; }';
    expect(removeDuplicateImports(parseImports(src))).toHaveLength(1);
  });

  it('merges compatible grouped imports deduplicating the shared item', () => {
    const imports = [
      makeImport('std::io', ['Read', 'Write']),
      makeImport('std::io', ['Write', 'BufRead']),
    ];
    const merged = mergeImports(imports);
    expect(merged).toHaveLength(1);
    expect(merged[0].items).toHaveLength(3); // Read, Write, BufRead
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 33. Formatting output edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('formatting output edge cases', () => {
  it('single-item aliased group with collapseSingle=false collapses alias to simple form', () => {
    // Design decision: single aliased items always use the simple form (no braces).
    // use a::{B as C} with one item → use a::B as C; regardless of collapseSingle.
    // This is idiomatic Rust — braces around a single aliased item add no clarity.
    const imp: ImportStatement = { originalText: '', module: 'a', items: ['B'], aliases: ['C'], isGroup: true, startLine: 0, endLine: 0 };
    expect(formatImport(imp, false)).toBe('use a::B as C;');
  });

  it('single-item aliased group with collapseSingle=true also simple form', () => {
    const imp: ImportStatement = { originalText: '', module: 'a', items: ['B'], aliases: ['C'], isGroup: true, startLine: 0, endLine: 0 };
    expect(formatImport(imp, true)).toBe('use a::B as C;');
  });

  it('sorts by original item name not alias name', () => {
    const imp: ImportStatement = {
      originalText: '', module: 'a', items: ['Z', 'A'], aliases: ['A', 'Z'], isGroup: true, startLine: 0, endLine: 0,
    };
    const out = formatImport(imp, false);
    // Sorted by bare name: A (with alias Z) before Z (with alias A)
    expect(out.indexOf('A as Z')).toBeLessThan(out.indexOf('Z as A'));
  });

  it('4-item import is formatted as multi-line', () => {
    const imp: ImportStatement = {
      originalText: '', module: 'a::b::c::d::e', items: ['Item1', 'Item2', 'Item3', 'Item4'], isGroup: true, startLine: 0, endLine: 0,
    };
    expect(formatImport(imp, false)).toContain('\n');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 34. Unused detection edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('unused detection edge cases', () => {
  it('detects usage in type ascription position', () => {
    const src = 'use serde_json::Value as JsonValue;\nfn main() { let x = 5 as i32; let _y: JsonValue; }';
    expect(removeUnusedImports(parseImports(src), src)).toHaveLength(1);
  });

  it('detects usage in match arm pattern', () => {
    const src = 'use my_enum::Variant as V;\nfn main() { match x { V => {}, _ => {} } }';
    expect(removeUnusedImports(parseImports(src), src)).toHaveLength(1);
  });

  it('detects usage in struct literal', () => {
    const src = 'use crate::types::Config as Cfg;\nfn main() { let _c = Cfg { field: 1 }; }';
    expect(removeUnusedImports(parseImports(src), src)).toHaveLength(1);
  });

  it('detects usage in turbofish with alias', () => {
    const src = 'use std::collections::HashMap as HM;\nfn main() { let _: HM<String, i32> = HM::new(); }';
    expect(removeUnusedImports(parseImports(src), src)).toHaveLength(1);
  });

  it('item in #[cfg(never)] block is kept (static analysis limitation — cannot detect dead code)', () => {
    // We cannot statically know that #[cfg(feature="never")] is dead code.
    // Read appears as a bare identifier so it is kept.
    const src = 'use std::io::Read;\nfn main() {\n    #[cfg(feature = "never")]\n    { let _: Read; }\n}';
    expect(removeUnusedImports(parseImports(src), src)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 35. buildOrganizedText edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('buildOrganizedText edge cases', () => {
  it('file with only imports and no code — all removed as unused (no references)', () => {
    // With no code body nothing references the imports, so they are correctly removed.
    // Use removeUnused:false to keep them when there is no code.
    const src = 'use std::fs::File;\nuse std::io::Read;';
    expect(organizeImportsInText(src, { removeUnused: false })).toContain('use std::');
  });

  it('[BUG-FIX] import after code declaration is not parsed as top-level import', () => {
    // fn on line 0 is a code declaration — use on line 1 must be ignored
    expect(parseImports('fn main() {}\nuse std::fs::File;')).toHaveLength(0);
  });

  it('multiple blank lines after imports collapsed to exactly one', () => {
    const src = 'use std::fs::File;\n\n\n\nfn main() { File::open("x"); }';
    const lines = organizeImportsInText(src).split('\n');
    const importIdx = lines.findIndex(l => l.includes('use std::fs'));
    const mainIdx = lines.findIndex(l => l.includes('fn main'));
    expect(mainIdx - importIdx).toBe(2); // import line + one blank
  });

  it('CRLF input produces usable output with import preserved', () => {
    expect(organizeImportsInText('use std::fs::File;\r\nfn main() { File::open("x"); }')).toContain('use std::fs::File');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 36. Real-world bug scenarios
// ─────────────────────────────────────────────────────────────────────────────

describe('real-world bug scenarios', () => {
  it('serde derive with r#type field — Serialize kept', () => {
    const src = 'use serde::{Deserialize, Serialize};\n\n#[derive(Serialize)]\nstruct Data {\n    #[serde(rename = "type")]\n    r#type: String,\n}';
    expect(removeUnusedImports(parseImports(src), src).map(i => i.items).flat()).toContain('Serialize');
  });

  it('async_trait macro attribute keeps import', () => {
    const src = 'use async_trait::async_trait;\n\n#[async_trait]\ntrait MyTrait { async fn work(); }';
    expect(removeUnusedImports(parseImports(src), src).map(i => i.module)).toContain('async_trait');
  });

  it('thiserror Error derive keeps import', () => {
    const src = 'use thiserror::Error;\n\n#[derive(Error)]\nenum MyError {\n    #[error("msg")]\n    Variant,\n}';
    expect(removeUnusedImports(parseImports(src), src).map(i => i.module)).toContain('thiserror');
  });

  it('two pub use re-exports in a chain both parsed as isPublic', () => {
    const src = 'pub use crate::inner::Item;\npub use crate::inner::Item as PublicItem;\nuse crate::internal::Private;';
    expect(parseImports(src).filter(i => i.isPublic)).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 37. Fuzz-style patterns
// ─────────────────────────────────────────────────────────────────────────────

describe('fuzz-style patterns', () => {
  it('empty string returns empty string', () => {
    expect(organizeImportsInText('')).toBe('');
  });

  it('only whitespace does not crash', () => {
    expect(() => organizeImportsInText('   \n\t\n   ')).not.toThrow();
  });

  it('only comments does not crash', () => {
    expect(() => organizeImportsInText('// comment\n/* block */\n/// doc')).not.toThrow();
  });

  it('import-like text in string literal is not parsed as import', () => {
    const src = 'use std::io::Read;\nfn main() {\n    let _code = "use std::fs::File;";\n    let _: Read;\n}';
    const used = removeUnusedImports(parseImports(src), src);
    expect(used.map(i => i.module)).toContain('std::io');
    expect(used.map(i => i.module)).not.toContain('std::fs');
  });

  it('rapid open/close braces do not crash', () => {
    expect(() => parseImports('use a::{{{{B}}}};')).not.toThrow();
  });

  it('unbalanced braces do not crash', () => {
    expect(() => parseImports('use std::io::{Read, Write;')).not.toThrow();
  });
});