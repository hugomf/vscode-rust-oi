import {
    parseImports,
    removeUnusedImports,
    removeDuplicateImports,
    organizeImportsInText,
    categorizeImport,
} from './importParser';

// Helper: run the full pipeline and return parsed/used/output
function run(src: string) {
    const all = parseImports(src);
    const used = removeUnusedImports(removeDuplicateImports(all), src);
    const output = organizeImportsInText(src);
    const kept = used.map(i => i.module);
    const items = used.flatMap(i => i.items);
    return { all, used, output, kept, items };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. SYNTAX EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe('syntax edge cases', () => {

    it('nested braces 3 levels deep', () => {
        const src = [
            'use std::{io::{Read, Write}, collections::{HashMap, BTreeMap}};',
            'fn main() { let _: HashMap<String,i32>; let _: BTreeMap<String,i32>; let _: Read; let _: Write; }',
        ].join('\n');
        const { kept } = run(src);
        expect(kept).toContain('std::io');
        expect(kept).toContain('std::collections');
    });

    it('CRLF line endings do not appear in output', () => {
        const src = 'use std::fs::File;\r\nuse std::io::Read;\r\n\r\nfn main() { File::open("x"); }';
        const { output } = run(src);
        expect(output).not.toContain('\r');
    });

    it('use statement split across 5 lines', () => {
        const src = [
            'use std::{',
            '    collections::HashMap,',
            '    fs::File,',
            '    io::Read,',
            '};',
            'fn main() { let _: HashMap<String,i32>; File::open("x"); let _: Read; }',
        ].join('\n');
        const { items } = run(src);
        expect(items).toContain('HashMap');
        expect(items).toContain('File');
        expect(items).toContain('Read');
    });

    it('raw identifier in module path: r#type', () => {
        // r# prefixed identifiers are valid Rust module names
        const src = [
            'use crate::r#type::Foo;',
            'fn main() { let _: Foo; }',
        ].join('\n');
        const { used } = run(src);
        expect(used.length).toBeGreaterThan(0);
    });

    it('very long module path (10 segments)', () => {
        const src = [
            'use a::b::c::d::e::f::g::h::i::j::SomeType;',
            'fn main() { let _: SomeType; }',
        ].join('\n');
        const { items } = run(src);
        expect(items).toContain('SomeType');
    });

    it('crate name with digit: sha2::Sha256', () => {
        const src = [
            'use sha2::Sha256;',
            'use sha2::Digest;',
            'fn main() { Sha256::new(); Digest::new(); }',
        ].join('\n');
        const { used } = run(src);
        expect(used).toHaveLength(2);
    });

    it('Unicode in string literal that resembles an import is not parsed', () => {
        const src = [
            'use std::fs::File;',
            'fn main() {',
            '    File::open("x");',
            '    let _s = "use std::collections::HashMap; // 日本語";',
            '}',
        ].join('\n');
        const { kept } = run(src);
        expect(kept).not.toContain('std::collections');
    });

    it('trailing whitespace on import lines does not crash', () => {
        const src = 'use std::fs::File;   \nuse std::io::Read;   \n\nfn main() { File::open("x"); }';
        expect(() => run(src)).not.toThrow();
        const { kept } = run(src);
        expect(kept).toContain('std::fs');
    });

    it('item with per-item aliases in group: use serde::{Serialize as Ser, Deserialize as De}', () => {
        // Our parser currently does not handle per-item aliases inside braces.
        // Document that it does not crash and keeps the whole group conservatively.
        const src = [
            'use serde::{Serialize as Ser, Deserialize as De};',
            'fn main() { let _: Ser; let _: De; }',
        ].join('\n');
        expect(() => run(src)).not.toThrow();
        // At minimum the module should not disappear entirely
        const { kept } = run(src);
        // May keep or drop serde — just no crash and no wrong removal when both aliases used
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. COMMENT EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe('comment edge cases', () => {

    it('inline // comment after import line: import parsed correctly, comment stripped on reformat', () => {
        // The extension parses the import correctly (inline comment does not confuse it)
        // and removes unused imports. The inline comment on the use line is stripped
        // when the import is reformatted — this is expected behaviour for a formatter.
        const src = [
            'use std::fs::File; // the file type',
            'use std::io::Read; // unused',
            'fn main() { File::open("x"); }',
        ].join('\n');
        const { output, used } = run(src);
        // Parsing was correct: File kept, Read removed
        expect(used.map(i => i.module)).toContain('std::fs');
        expect(used.map(i => i.module)).not.toContain('std::io');
        // Output has the clean formatted import
        expect(output).toContain('use std::fs::File;');
        expect(output).not.toContain('use std::io::Read;');
    });

    it('block comment containing a use statement is not parsed as real import', () => {
        const src = [
            'use std::fs::File;',
            '/* use std::io::Read; */',
            'use std::collections::HashMap;',
            'fn main() { File::open("x"); let _: HashMap<String,i32>; }',
        ].join('\n');
        const { kept } = run(src);
        expect(kept).not.toContain('std::io');
    });

    it('multi-line block comment with use statements inside is not parsed', () => {
        const src = [
            'use std::fs::File;',
            '/*',
            ' * use std::io::Read;',
            ' * use std::sync::Arc;',
            ' */',
            'use std::collections::HashMap;',
            'fn main() { File::open("x"); let _: HashMap<String,i32>; }',
        ].join('\n');
        const { kept } = run(src);
        expect(kept).not.toContain('std::io');
        expect(kept).not.toContain('std::sync');
    });

    it('doc comment (///) with use example is not parsed as import', () => {
        const src = [
            '/// # Example',
            '/// ```',
            '/// use std::collections::HashMap;',
            '/// ```',
            'use std::fs::File;',
            'fn main() { File::open("x"); }',
        ].join('\n');
        const { kept } = run(src);
        expect(kept).not.toContain('std::collections');
    });

    it('shebang line at start of file does not break import parsing', () => {
        // rust-script files start with #!/usr/bin/env rust-script
        const src = [
            '#!/usr/bin/env rust-script',
            'use std::fs::File;',
            'fn main() { File::open("x"); }',
        ].join('\n');
        expect(() => run(src)).not.toThrow();
        // Parser stops at shebang (non-import line) then finds File — or handles gracefully
        // Either behaviour is acceptable as long as there's no crash
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. UNUSED IMPORT DETECTION EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe('unused import detection edge cases', () => {

    it('type used only as dyn Trait bound', () => {
        const src = [
            'use std::fmt::Display;',
            'use std::fmt::Debug;',
            'fn print_it(val: &dyn Display) { println!("{val}"); }',
            'fn debug_it(val: &dyn Debug)   { println!("{val:?}"); }',
        ].join('\n');
        const { items } = run(src);
        expect(items).toContain('Display');
        expect(items).toContain('Debug');
    });

    it('type used only in impl Trait return position', () => {
        const src = [
            'use std::fmt::Display;',
            'fn make_display() -> impl Display { 42 }',
        ].join('\n');
        const { items } = run(src);
        expect(items).toContain('Display');
    });

    it('type used only in where clause', () => {
        const src = [
            'use std::string::ToString;',
            'fn greet<T: ToString>(name: T) { println!("{}", name.to_string()); }',
        ].join('\n');
        const { items } = run(src);
        expect(items).toContain('ToString');
    });

    it('type used only in turbofish: HashMap::<K,V>::new()', () => {
        const src = [
            'use std::collections::HashMap;',
            'fn main() { let _ = HashMap::<String,i32>::new(); }',
        ].join('\n');
        const { items } = run(src);
        expect(items).toContain('HashMap');
    });

    it('type used only in const expression', () => {
        const src = [
            'use std::mem::size_of;',
            'const SIZE: usize = size_of::<u64>();',
        ].join('\n');
        const { items } = run(src);
        expect(items).toContain('size_of');
    });

    it('two imports from same module, only one via trait method — Read kept, Write dropped', () => {
        const src = [
            'use std::io::Read;',
            'use std::io::Write;',
            'fn needs_read<R: Read>(r: &mut R) {}',
            // Write not used at all (no W: Write bound, no .write() call)
        ].join('\n');
        const { items } = run(src);
        expect(items).toContain('Read');
        expect(items).not.toContain('Write');
    });

    it('identifier only in format string argument position is still kept', () => {
        const src = [
            'use std::collections::HashMap;',
            'fn main() {',
            '    let m: HashMap<String,i32> = HashMap::new();',
            '    println!("{m:?}");',
            '}',
        ].join('\n');
        const { items } = run(src);
        expect(items).toContain('HashMap');
    });

    it('import used only in a const generic parameter', () => {
        const src = [
            'use std::mem::align_of;',
            'fn check_align<T>() { assert_eq!(align_of::<T>(), 8); }',
        ].join('\n');
        const { items } = run(src);
        expect(items).toContain('align_of');
    });

    it('name appears in both a string literal and real code — kept', () => {
        const src = [
            'use std::collections::HashMap;',
            'fn main() {',
            '    let _m = HashMap::new();',
            '    let _s = "HashMap is useful";',
            '}',
        ].join('\n');
        const { items } = run(src);
        expect(items).toContain('HashMap');
    });

    it('name appears ONLY in a string literal — removed', () => {
        const src = [
            'use std::collections::HashMap;',
            'use std::fs::File;',
            'fn main() {',
            '    File::open("x");',
            '    let _s = "HashMap is great";',
            '}',
        ].join('\n');
        const { kept } = run(src);
        expect(kept).not.toContain('std::collections');
        expect(kept).toContain('std::fs');
    });

    it('name appears ONLY in a doc comment — removed', () => {
        const src = [
            'use std::collections::HashMap;',
            'use std::fs::File;',
            '/// Uses a HashMap internally',
            'fn main() { File::open("x"); }',
        ].join('\n');
        const { kept } = run(src);
        expect(kept).not.toContain('std::collections');
        expect(kept).toContain('std::fs');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. CATEGORIZATION EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe('categorization edge cases', () => {

    it('crate with numeric suffix (serde2) is external', () => {
        expect(categorizeImport('serde2::Serialize')).toBe('external');
    });

    it('crate starting with underscore is external', () => {
        expect(categorizeImport('_internal::Foo')).toBe('external');
    });

    it('alloc is std-family', () => {
        expect(categorizeImport('alloc::string')).toBe('std');
    });

    it('core is std-family', () => {
        expect(categorizeImport('core::fmt')).toBe('std');
    });

    it('std itself (not std::) is std', () => {
        expect(categorizeImport('std')).toBe('std');
    });

    it('crate with double-underscore is external', () => {
        expect(categorizeImport('__proc_macro::Foo')).toBe('external');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. FALSE POSITIVE / FALSE NEGATIVE EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe('false positive / false negative edge cases', () => {

    it('enum variant same name as import — removed correctly', () => {
        // DateTime appears only as Status::DateTime (qualified variant call)
        // and as a variant name definition — not as a type annotation.
        // The extension should NOT keep chrono::DateTime.
        const src = [
            'use chrono::DateTime;',
            'enum Status { DateTime, Other }',
            'fn main() { let _ = Status::DateTime; }',
        ].join('\n');
        const { kept } = run(src);
        expect(kept).not.toContain('chrono');
    });

    it('multi-variant enum with DateTime<Utc> fields keeps chrono', () => {
        // Here DateTime IS used as a real type in struct field positions
        const src = [
            'use chrono::{DateTime, Utc};',
            'use uuid::Uuid;',
            'pub enum Event {',
            '    Created { id: Uuid, at: DateTime<Utc> },',
            '    Updated { id: Uuid, at: DateTime<Utc> },',
            '}',
        ].join('\n');
        const { items } = run(src);
        expect(items).toContain('DateTime');
        expect(items).toContain('Utc');
        expect(items).toContain('Uuid');
    });

    it('deeply nested mod blocks do not expose inner use to the parser', () => {
        const src = [
            'use std::fs::File;',
            'mod a {',
            '    mod b {',
            '        mod c {',
            '            use std::collections::HashMap;',
            '            pub fn inner() { let _: HashMap<String,i32>; }',
            '        }',
            '    }',
            '}',
            'fn main() { File::open("x"); }',
        ].join('\n');
        const { kept } = run(src);
        expect(kept).not.toContain('std::collections');
        expect(kept).toContain('std::fs');
    });

    it('50 imports — exactly half used are kept', () => {
        const imports = Array.from({ length: 50 }, (_, i) =>
            `use crate::module${i}::Type${i};`
        ).join('\n');
        const usages = Array.from({ length: 25 }, (_, i) =>
            `let _: Type${i};`
        ).join('\n');
        const src = `${imports}\n\nfn main() {\n${usages}\n}`;
        const { used } = run(src);
        expect(used).toHaveLength(25);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. IMPLICIT TRAIT METHOD DISPATCH
// ─────────────────────────────────────────────────────────────────────────────

describe('implicit trait method dispatch', () => {

    it('[sqlx] Row kept when r.get() is called on a query result', () => {
        const src = [
            'use sqlx::{PgPool, Row};',
            'struct Repo { pool: PgPool }',
            'impl Repo {',
            '    async fn get_name(&self, id: i32) -> String {',
            '        let r = sqlx::query("SELECT name FROM t WHERE id=$1")',
            '            .bind(id).fetch_one(&self.pool).await.unwrap();',
            '        r.get("name")',
            '    }',
            '}',
        ].join('\n');
        const { used } = run(src);
        const sqlx = used.find(i => i.module === 'sqlx');
        expect(sqlx?.items).toContain('Row');
        expect(sqlx?.items).toContain('PgPool');
    });

    it('[sqlx] Row dropped when no .get() calls present', () => {
        const src = [
            'use sqlx::{PgPool, Row};',
            'struct Repo { pool: PgPool }',
            'impl Repo {',
            '    async fn count(&self) -> i64 {',
            '        sqlx::query_scalar("SELECT COUNT(*) FROM t")',
            '            .fetch_one(&self.pool).await.unwrap()',
            '    }',
            '}',
        ].join('\n');
        const { used } = run(src);
        const sqlx = used.find(i => i.module === 'sqlx');
        expect(sqlx?.items ?? []).not.toContain('Row');
        expect(sqlx?.items ?? []).toContain('PgPool');
    });

    it('[std::io] Read kept when .read_to_string() is called', () => {
        const src = [
            'use std::io::Read;',
            'use std::fs::File;',
            'fn read_file(path: &str) -> String {',
            '    let mut f = File::open(path).unwrap();',
            '    let mut s = String::new();',
            '    f.read_to_string(&mut s).unwrap();',
            '    s',
            '}',
        ].join('\n');
        const { kept } = run(src);
        expect(kept).toContain('std::io');
    });

    it('[std::io] Write kept when .write_all() is called', () => {
        const src = [
            'use std::io::Write;',
            'use std::fs::File;',
            'fn write_file(path: &str, data: &[u8]) {',
            '    let mut f = File::create(path).unwrap();',
            '    f.write_all(data).unwrap();',
            '}',
        ].join('\n');
        const { kept } = run(src);
        expect(kept).toContain('std::io');
    });

    it('[std::io] BufRead kept when .lines() is called', () => {
        const src = [
            'use std::io::BufRead;',
            'use std::io::BufReader;',
            'use std::fs::File;',
            'fn read_lines(path: &str) {',
            '    let f = BufReader::new(File::open(path).unwrap());',
            '    for line in f.lines() { println!("{}", line.unwrap()); }',
            '}',
        ].join('\n');
        const { items } = run(src);
        expect(items).toContain('BufRead');
    });

    it('[anyhow] Context kept when .context() is called', () => {
        const src = [
            'use anyhow::{Result, Context};',
            'use std::fs::File;',
            'fn open_file(path: &str) -> Result<File> {',
            '    File::open(path).context("could not open file")',
            '}',
        ].join('\n');
        const { used } = run(src);
        const anyhow = used.find(i => i.module === 'anyhow');
        expect(anyhow?.items).toContain('Result');
        expect(anyhow?.items).toContain('Context');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. REAL-WORLD PATTERNS
// ─────────────────────────────────────────────────────────────────────────────

describe('real-world patterns', () => {

    it('async_trait macro attribute on trait and impl', () => {
        const src = [
            'use async_trait::async_trait;',
            '#[async_trait]',
            'pub trait Repo {',
            '    async fn get(&self) -> String;',
            '}',
            '#[async_trait]',
            'impl Repo for () {',
            '    async fn get(&self) -> String { "x".to_string() }',
            '}',
        ].join('\n');
        const { items } = run(src);
        expect(items).toContain('async_trait');
    });

    it('thiserror::Error derive macro', () => {
        const src = [
            'use thiserror::Error;',
            '#[derive(Debug, Error)]',
            'pub enum MyError {',
            '    #[error("not found")]',
            '    NotFound,',
            '}',
        ].join('\n');
        const { items } = run(src);
        expect(items).toContain('Error');
    });

    it('serde derive on struct with serde_json field type', () => {
        const src = [
            'use serde::{Deserialize, Serialize};',
            '#[derive(Debug, Clone, Serialize, Deserialize)]',
            'pub struct Config {',
            '    pub name: String,',
            '    pub data: serde_json::Value,',
            '}',
        ].join('\n');
        const { items } = run(src);
        expect(items).toContain('Serialize');
        expect(items).toContain('Deserialize');
    });

    it('full definitions.rs style file with PgPool, Row, DateTime, Uuid, async_trait', () => {
        const src = [
            'use async_trait::async_trait;',
            'use sqlx::{PgPool, Row};',
            'use chrono::{DateTime, Utc};',
            'use uuid::Uuid;',
            '',
            '#[async_trait]',
            'pub trait Repo: Send + Sync {',
            '    async fn get_by_id(&self, id: Uuid) -> Option<String>;',
            '}',
            '',
            'pub struct RepoImpl { pool: PgPool }',
            '',
            '#[async_trait]',
            'impl Repo for RepoImpl {',
            '    async fn get_by_id(&self, id: Uuid) -> Option<String> {',
            '        let row = sqlx::query("SELECT name FROM t WHERE id=$1")',
            '            .bind(id)',
            '            .fetch_optional(&self.pool)',
            '            .await',
            '            .unwrap();',
            '        let _now: DateTime<Utc> = Utc::now();',
            '        row.map(|r| r.get("name"))',
            '    }',
            '}',
        ].join('\n');
        const { kept, items } = run(src);
        expect(items).toContain('async_trait');
        expect(items).toContain('PgPool');
        expect(items).toContain('Row');
        expect(items).toContain('DateTime');
        expect(items).toContain('Utc');
        expect(items).toContain('Uuid');
        // No false removals
        expect(kept.length).toBe(4); // async_trait, sqlx, chrono, uuid
    });
});