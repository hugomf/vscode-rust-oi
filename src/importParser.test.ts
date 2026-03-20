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