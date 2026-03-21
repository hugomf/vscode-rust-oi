// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ImportStatement {
  /** The raw text of the import as it appeared in the source */
  originalText: string;
  /** The module path, e.g. "std::collections" */
  module: string;
  /** Items imported from the module, e.g. ["HashMap"] or ["Read", "Write"] */
  items: string[];
  /**
   * For `use X::Y as Z`, aliases[i] is the alias for items[i].
   * undefined when no alias exists for that position.
   */
  aliases?: (string | undefined)[];
  /** True when the original source used braces: `use m::{A, B}` */
  isGroup: boolean;
  /** True when the import is a wildcard: `use m::*` */
  isWildcard?: boolean;
  /** True when the import is a re-export: `pub use …` */
  isPublic?: boolean;
  /**
   * The raw cfg attribute that precedes this import, if any.
   * e.g. `#[cfg(test)]` or `#[cfg(feature = "serde")]`
   */
  cfgAttribute?: string;
  startLine: number;
  endLine: number;
}

export interface OrganizedImports {
  stdImports: ImportStatement[];
  externalImports: ImportStatement[];
  localImports: ImportStatement[];
  /** Imports preceded by a #[cfg(...)] attribute — always placed last */
  cfgImports: ImportStatement[];
  /** pub use re-exports, when pubUsePlacement != "inline" */
  pubUseImports: ImportStatement[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Strip non-ASCII characters that editors can accidentally insert */
function sanitize(line: string): string {
  return line.replace(/[^\x00-\x7F]/g, '');
}

/**
 * Collect a complete `use` statement that may span multiple lines.
 * Returns the full text and the index of the closing `;` line.
 */
function collectStatement(
  lines: string[],
  startIndex: number
): { fullText: string; endIndex: number } {
  let fullText = '';
  let endIndex = startIndex;

  for (let i = startIndex; i < lines.length; i++) {
    const sanitized = sanitize(lines[i]);
    // Strip trailing inline // comment before adding to fullText and before
    // the semicolon check so that "use std::fs::File; // comment" is parsed
    // correctly as a single-line import statement.
    const withoutInlineComment = sanitized.replace(/\s*\/\/.*$/, '');
    fullText += (i === startIndex ? '' : '\n') + withoutInlineComment;

    if (withoutInlineComment.trimEnd().endsWith(';')) {
      endIndex = i;
      break;
    }

    if (i === lines.length - 1) {
      endIndex = i;
    }
  }

  return { fullText, endIndex };
}

// ─────────────────────────────────────────────────────────────────────────────
// Nested-brace expansion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively expand a Rust use-tree string into a list of flat import paths.
 *
 * Examples:
 *   "std::{io::{Read, Write}, fs::File}"
 *     → ["std::io::Read", "std::io::Write", "std::fs::File"]
 *
 *   "std::collections::HashMap"
 *     → ["std::collections::HashMap"]
 *
 *   "std::prelude::*"
 *     → ["std::prelude::*"]
 */
function expandUsePaths(prefix: string, tree: string): string[] {
  tree = tree.trim();

  if (!tree.startsWith('{')) {
    // Leaf: simple path or wildcard
    const full = prefix ? `${prefix}::${tree}` : tree;
    return [full];
  }

  // Strip the outer braces and split on top-level commas
  const inner = tree.slice(1, tree.lastIndexOf('}')).trim();
  const parts = splitTopLevel(inner);
  const results: string[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Does this part contain a sub-tree?
    const braceIdx = trimmed.indexOf('{');
    if (braceIdx !== -1) {
      // e.g. "io::{Read, Write}"
      const subPrefix = trimmed.slice(0, braceIdx).replace(/::$/, '');
      const subTree = trimmed.slice(braceIdx);
      const combined = prefix ? `${prefix}::${subPrefix}` : subPrefix;
      results.push(...expandUsePaths(combined, subTree));
    } else {
      // Plain item or wildcard
      const full = prefix ? `${prefix}::${trimmed}` : trimmed;
      results.push(full);
    }
  }

  return results;
}

/**
 * Split a string on top-level commas (ignoring commas inside nested braces).
 */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const ch of s) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;

    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) parts.push(current);
  return parts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing a single `use` statement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse one `use` statement (possibly `pub use`) starting at `startIndex`.
 *
 * Returns an array of ImportStatements (one statement can expand into multiple
 * when it uses nested braces) and the next line index to continue from.
 */
function parseUseStatement(
  lines: string[],
  startIndex: number
): { statements: ImportStatement[]; nextLine: number } | null {
  const { fullText, endIndex } = collectStatement(lines, startIndex);
  const trimmed = fullText.trim();

  // Detect pub use
  const isPublic = /^pub\s+use\s+/.test(trimmed);
  // Normalise to plain `use …`
  const normalized = isPublic ? trimmed.replace(/^pub\s+/, '') : trimmed;

  // Must start with `use `
  if (!normalized.startsWith('use ')) return null;

  // Strip leading `use ` and trailing `;`
  const body = normalized.slice(4).replace(/\s*;$/, '').trim();

  // ── Wildcard: use module::* ──────────────────────────────────────────────
  const wildcardMatch = body.match(/^([\w:]+(?:::[\w:]+)*)::(\*)$/);
  if (wildcardMatch) {
    return {
      statements: [
        {
          originalText: fullText,
          module: wildcardMatch[1],
          items: ['*'],
          isGroup: false,
          isWildcard: true,
          isPublic,
          startLine: startIndex,
          endLine: endIndex,
        },
      ],
      nextLine: endIndex + 1,
    };
  }

  // ── Simple aliased: use module::Item as Alias ────────────────────────────
  const aliasMatch = body.match(
    /^([\w]+(?:::[\w]+)*)\s+as\s+(\w+)$/
  );
  if (aliasMatch) {
    const fullPath = aliasMatch[1];
    const alias = aliasMatch[2];
    const parts = fullPath.split('::');
    return {
      statements: [
        {
          originalText: fullText,
          module: parts.slice(0, -1).join('::') || parts[0],
          items: [parts[parts.length - 1]],
          aliases: [alias],
          isGroup: false,
          isPublic,
          startLine: startIndex,
          endLine: endIndex,
        },
      ],
      nextLine: endIndex + 1,
    };
  }

  // ── Nested or flat braces: use prefix::{…} or use prefix::simple ─────────
  // Check for braces anywhere in the body
  const braceIdx = body.indexOf('{');

  if (braceIdx !== -1) {
    // Has braces — expand the full use-tree
    const prefixPart = body.slice(0, braceIdx).replace(/::$/, '');
    const treePart = body.slice(braceIdx);
    const expanded = expandUsePaths(prefixPart, treePart);

    // Group them back into logical ImportStatements.
    // Items from the same immediate module become one grouped ImportStatement.
    // Items from different sub-paths become separate ImportStatements.
    const byModule = new Map<string, string[]>();
    const order: string[] = [];

    for (const path of expanded) {
      const parts = path.split('::');
      const item = parts[parts.length - 1];
      const mod = parts.slice(0, -1).join('::');

      if (!byModule.has(mod)) {
        byModule.set(mod, []);
        order.push(mod);
      }
      byModule.get(mod)!.push(item);
    }

    const statements: ImportStatement[] = order.map(mod => {
      const items = byModule.get(mod)!;
      return {
        originalText: fullText,
        module: mod,
        items,
        isGroup: items.length > 1,
        isPublic,
        startLine: startIndex,
        endLine: endIndex,
      };
    });

    return { statements, nextLine: endIndex + 1 };
  }

  // ── Simple: use module::item ──────────────────────────────────────────────
  const simpleMatch = body.match(/^((?:r#)?[\w]+(?:::(?:r#)?[\w]+)*)$/);
  if (simpleMatch) {
    const parts = simpleMatch[1].split('::');
    return {
      statements: [
        {
          originalText: fullText,
          module: parts.slice(0, -1).join('::') || parts[0],
          items: [parts[parts.length - 1]],
          isGroup: false,
          isPublic,
          startLine: startIndex,
          endLine: endIndex,
        },
      ],
      nextLine: endIndex + 1,
    };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API: parseImports
// ─────────────────────────────────────────────────────────────────────────────

export function parseImports(text: string): ImportStatement[] {
  const lines = text.split('\n');
  const imports: ImportStatement[] = [];
  let i = 0;
  let inBlockComment = false;

  while (i < lines.length) {
    const line = sanitize(lines[i]).trim();

    // Track block comment state so we never parse `use` inside /* ... */
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      i++;
      continue;
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true;  // multi-line block comment
      i++;
      continue;
    }

    // Skip blank lines and line comments
    if (
      line === '' ||
      line.startsWith('//')
    ) {
      i++;
      continue;
    }

    // Detect #[cfg(...)] attribute on its own line before a use statement
    if (line.startsWith('#[cfg(') || line.startsWith('#[cfg (')) {
      const cfgAttr = line;
      // Peek ahead for the use statement that this cfg guards
      let j = i + 1;
      while (j < lines.length && sanitize(lines[j]).trim() === '') j++;
      const nextLine = sanitize(lines[j] ?? '').trim();
      if (nextLine.startsWith('use ') || nextLine.startsWith('pub use ')) {
        const result = parseUseStatement(lines, j);
        if (result) {
          result.statements.forEach(s => {
            s.cfgAttribute = cfgAttr;
            s.startLine = i;   // include the attribute line in the range
          });
          imports.push(...result.statements);
          i = result.nextLine;
          continue;
        }
      }
      // cfg without a following use — stop parsing imports
      if (imports.length > 0) break;
      i++;
      continue;
    }

    // Match `use` or `pub use`
    if (line.startsWith('use ') || line.startsWith('pub use ')) {
      const result = parseUseStatement(lines, i);
      if (result) {
        imports.push(...result.statements);
        i = result.nextLine;
        continue;
      }
    }

    // Stop at the first non-import, non-comment, non-blank line to avoid
    // picking up `use` statements inside fn / mod bodies.
    if (imports.length > 0) {
      break;
    }

    i++;
  }

  return imports;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API: categorizeImport
// ─────────────────────────────────────────────────────────────────────────────

export function categorizeImport(
  module: string,
  cargoExternalCrates?: Set<string>,
  cargoLocalCrates?: Set<string>
): 'std' | 'external' | 'local' {
  // std, core and alloc are all part of the Rust standard library family.
  // core is the dependency-free subset; alloc adds heap allocation. Both are
  // shipped with every Rust toolchain and should appear in the std group.
  const STD_ROOTS = new Set(['std', 'core', 'alloc']);
  const root = module.split('::')[0].replace(/-/g, '_');

  if (STD_ROOTS.has(root)) return 'std';

  // Explicit local prefixes always win
  if (
    root === 'crate' ||
    root === 'super' ||
    root === 'self'
  ) {
    return 'local';
  }

  // Cargo.toml-aware classification (more accurate than heuristics)
  if (cargoLocalCrates?.has(root)) return 'local';
  if (cargoExternalCrates?.has(root)) return 'external';

  // Heuristic fallback: anything with a multi-segment path that doesn't start
  // with a local keyword is treated as external.
  return 'external';
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API: organizeImports
// ─────────────────────────────────────────────────────────────────────────────

export function organizeImports(
  imports: ImportStatement[],
  knownExternalCrates?: Set<string>,
  knownLocalCrates?: Set<string>,
  pubUsePlacement: 'inline' | 'first' | 'last' = 'inline'
): OrganizedImports {
  const organized: OrganizedImports = {
    stdImports: [],
    externalImports: [],
    localImports: [],
    cfgImports: [],
    pubUseImports: [],
  };

  for (const imp of imports) {
    // cfg-gated imports always go into the dedicated group regardless of origin
    if (imp.cfgAttribute) {
      organized.cfgImports.push(imp);
      continue;
    }

    // pub use re-exports are routed to their own group when placement != inline
    if (imp.isPublic && pubUsePlacement !== 'inline') {
      organized.pubUseImports.push(imp);
      continue;
    }

    switch (categorizeImport(imp.module, knownExternalCrates, knownLocalCrates)) {
      case 'std':
        organized.stdImports.push(imp);
        break;
      case 'external':
        organized.externalImports.push(imp);
        break;
      case 'local':
        organized.localImports.push(imp);
        break;
    }
  }

  return organized;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API: sortImports
// ─────────────────────────────────────────────────────────────────────────────

export function sortImports(imports: ImportStatement[]): ImportStatement[] {
  return [...imports].sort((a, b) => {
    const moduleCompare = a.module.localeCompare(b.module);
    if (moduleCompare !== 0) return moduleCompare;
    // Tie-break by first item name
    return (a.items[0] ?? '').localeCompare(b.items[0] ?? '');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API: mergeImports
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge separate imports from the same module into single grouped imports.
 *
 * Example:
 *   use std::io::Read;
 *   use std::io::Write;
 * becomes:
 *   use std::io::{Read, Write}   (isGroup: true)
 *
 * Wildcards and aliased imports are never merged.
 */
export function mergeImports(imports: ImportStatement[]): ImportStatement[] {
  const byModule = new Map<string, ImportStatement[]>();
  const order: string[] = [];

  for (const imp of imports) {
    // Never merge wildcards or aliased imports
    if (imp.isWildcard || (imp.aliases && imp.aliases.some(Boolean))) {
      const sentinel = `__noMerge__${imp.startLine}`;
      byModule.set(sentinel, [imp]);
      order.push(sentinel);
      continue;
    }

    if (!byModule.has(imp.module)) {
      byModule.set(imp.module, []);
      order.push(imp.module);
    }
    byModule.get(imp.module)!.push(imp);
  }

  return order.map(key => {
    const group = byModule.get(key)!;
    if (group.length === 1) return group[0];

    // Merge: combine all items, deduplicate, preserve first occurrence metadata
    const allItems = [...new Set(group.flatMap(i => i.items))];
    const first = group[0];
    return {
      originalText: group.map(i => i.originalText).join('\n'),
      module: first.module,
      items: allItems,
      isGroup: true,
      isPublic: first.isPublic,
      startLine: first.startLine,
      endLine: group[group.length - 1].endLine,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API: formatImport
// ─────────────────────────────────────────────────────────────────────────────

export function formatImport(imp: ImportStatement, collapseSingle: boolean): string {
  const pub = imp.isPublic ? 'pub ' : '';

  // Wildcard
  if (imp.isWildcard) {
    return `${pub}use ${imp.module}::*;`;
  }

  // Aliased simple import
  if (imp.aliases && imp.aliases.some(Boolean)) {
    const item = imp.items[0];
    const alias = imp.aliases[0];
    return alias
      ? `${pub}use ${imp.module}::${item} as ${alias};`
      : `${pub}use ${imp.module}::${item};`;
  }

  // Single item — collapse when requested (or always when there's only one item)
  if (imp.items.length === 1 && (collapseSingle || !imp.isGroup)) {
    return `${pub}use ${imp.module}::${imp.items[0]};`;
  }

  // Multiple items
  const sortedItems = [...imp.items].sort();

  if (sortedItems.length <= 3) {
    return `${pub}use ${imp.module}::{${sortedItems.join(', ')}};`;
  }

  const itemsFormatted = sortedItems.map(item => `    ${item}`).join(',\n');
  return `${pub}use ${imp.module}::{\n${itemsFormatted},\n};`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API: removeDuplicateImports
// ─────────────────────────────────────────────────────────────────────────────

export function removeDuplicateImports(imports: ImportStatement[]): ImportStatement[] {
  const seen = new Set<string>();
  const unique: ImportStatement[] = [];

  for (const imp of imports) {
    const key = `${imp.module}::${[...imp.items].sort().join(',')}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(imp);
    }
  }

  return unique;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API: removeUnusedImports
// ─────────────────────────────────────────────────────────────────────────────

export function removeUnusedImports(
  imports: ImportStatement[],
  text: string
): ImportStatement[] {
  if (imports.length === 0) return [];

  // ── 1. Extract the code section AFTER the import block ───────────────────
  const lines = text.split('\n');
  const importEndLine = Math.max(...imports.map(imp => imp.endLine));
  const codeAfterImports = lines.slice(importEndLine + 1).join('\n');

  // ── 2. Collect every bare identifier that appears in the code ─────────────
  //
  // Pre-process: strip content that contains identifier-shaped text but is NOT
  // actually a use of an imported name:
  //
  //   • String literals  — "Regex is great" contains "Regex" but that is not
  //                         a use of the regex::Regex import.
  //   • Doc comments     — /// Uses a HashMap is documentation, not code.
  //   • Line comments    — // let x = HashMap::new() is dead code.
  //   • Block comments   — /* ... */ may contain any identifier text.
  //
  // We blank out these regions before scanning so false-keep bugs are avoided.
  // We do this ONLY for the identifier scan — the qualified-context scan still
  // uses codeAfterImports so that real qualified usages like Utc::now() are
  // still detected correctly.
  const codeForIdScan = codeAfterImports
    // Block comments: /* ... */ (non-greedy, dotAll)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    // Line comments (including doc comments /// and //)
    .replace(/\/\/[^\n]*/g, ' ')
    // Double-quoted string literals (handles \" escapes)
    .replace(/"(?:[^"\\]|\\.)*"/g, '" "')
    // Single-quoted char literals: 'a', '\n', '\u{1F600}'
    .replace(/'(?:[^'\\]|\\.)*'/g, "' '");

  const usedIdentifiers = new Set<string>();
  const identifierRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
  let match: RegExpExecArray | null;

  while ((match = identifierRegex.exec(codeForIdScan)) !== null) {
    usedIdentifiers.add(match[1]);
  }

  // ── 3. Collect identifiers that appear ONLY as `Something::Identifier` ────
  //      If an identifier appears exclusively in a qualified position (right
  //      side of `::`) it is very likely an enum variant or associated item
  //      from a *different* type, not the imported name itself.
  //
  //      We also strip enum/struct variant *definition* lines before scanning
  //      for bare usages, because writing `DateTime(i64)` inside an enum body
  //      is a *declaration*, not a use of the imported chrono::DateTime type.
  const qualifiedOnlyIdentifiers = new Set<string>();

  // Remove enum and struct body declarations so variant names don't count as
  // "bare usages" of an imported identifier.
  //   enum Foo { DateTime(i64), Other }
  //   struct Bar { field: i32 }
  // We blank out the content inside the outermost braces of enum/struct blocks.
  const codeWithoutDeclBodies = codeAfterImports.replace(
    /\b(?:enum|struct)\s+\w+[^{]*\{[^}]*\}/gs,
    match => match.replace(/\{[^}]*\}/, '{}')
  );

  // Find every `Word::Identifier` occurrence
  const qualifiedRegex = /\b[A-Za-z_][A-Za-z0-9_]*::([A-Za-z_][A-Za-z0-9_]*)\b/g;
  const qualifiedAppearances = new Set<string>();

  while ((match = qualifiedRegex.exec(codeAfterImports)) !== null) {
    qualifiedAppearances.add(match[1]);
  }

  // An identifier is "qualified-only" when every occurrence of it in the
  // declaration-stripped code is in a `Foo::Ident` position — never bare.
  for (const ident of qualifiedAppearances) {
    const bareRegex = new RegExp(
      `(?<!::|\\.)\\b${escapeRegex(ident)}\\b(?!\\s*::)`,
      'g'
    );
    if (!bareRegex.test(codeWithoutDeclBodies)) {
      qualifiedOnlyIdentifiers.add(ident);
    }
  }

  // ── 4. Build set of trait names that are implicitly used via method dispatch.
  //
  // Some traits must be in scope for method calls to work (e.g. sqlx::Row for
  // r.get(), std::io::Read for f.read()) even though the trait name itself
  // never appears as a bare identifier in the code. We detect their usage by
  // looking for characteristic method call patterns rather than identifier names.
  const implicitlyUsedTraits = new Set<string>();

  // sqlx::Row — needed when .get("field") is called on a query result row
  if (/\.get\s*\(/.test(codeAfterImports)) {
    implicitlyUsedTraits.add('Row');
  }
  // sqlx::Executor — needed when .execute() / .fetch_one() etc are called directly on a pool/conn
  if (/\.execute\s*\(|fetch_one|fetch_all|fetch_optional/.test(codeAfterImports)) {
    implicitlyUsedTraits.add('Executor');
  }
  // anyhow::Context — needed when .context() / .with_context() are called
  if (/\.context\s*\(|\.with_context\s*\(/.test(codeAfterImports)) {
    implicitlyUsedTraits.add('Context');
  }
  // std::io::Read — needed when .read() / .read_to_string() are called
  if (/\.read\s*\(|read_to_string|read_to_end/.test(codeAfterImports)) {
    implicitlyUsedTraits.add('Read');
  }
  // std::io::Write — needed when .write() / .write_all() / .flush() are called
  if (/\.write\s*\(|write_all|flush\s*\(/.test(codeAfterImports)) {
    implicitlyUsedTraits.add('Write');
  }
  // std::io::BufRead — needed when .lines() / .read_line() are called
  if (/\.lines\s*\(|read_line/.test(codeAfterImports)) {
    implicitlyUsedTraits.add('BufRead');
  }
  // std::io::Seek — needed when .seek() is called
  if (/\.seek\s*\(/.test(codeAfterImports)) {
    implicitlyUsedTraits.add('Seek');
  }

  // ── 5. Filter each import ─────────────────────────────────────────────────
  const result: ImportStatement[] = [];

  for (const imp of imports) {
    // Wildcards: always keep (we cannot statically know what they bring in)
    if (imp.isWildcard) {
      result.push(imp);
      continue;
    }

    // cfg-gated imports: always keep — they are conditionally compiled and their
    // usage cannot be determined by static analysis of the current file.
    if (imp.cfgAttribute) {
      result.push(imp);
      continue;
    }

    // Aliased simple import: check if the alias (or original name) is used
    if (imp.aliases && imp.aliases.some(Boolean)) {
      const alias = imp.aliases[0];
      const original = imp.items[0];
      const aliasUsed = alias ? usedIdentifiers.has(alias) && !qualifiedOnlyIdentifiers.has(alias) : false;
      const originalUsed = usedIdentifiers.has(original) && !qualifiedOnlyIdentifiers.has(original);

      if (aliasUsed || originalUsed) {
        result.push(imp);
      }
      continue;
    }

    if (imp.isGroup) {
      // Filter items individually
      const usedItems = imp.items.filter(item => {
        // Implicit trait: used via method dispatch, never appears as bare identifier
        if (implicitlyUsedTraits.has(item)) return true;
        if (!usedIdentifiers.has(item)) return false;
        if (qualifiedOnlyIdentifiers.has(item)) return false;
        return true;
      });

      if (usedItems.length > 0) {
        result.push({
          ...imp,
          items: usedItems,
          // Keep isGroup:true even when filtered down to a single item so that
          // formatImport can honour the collapseSingleImports option correctly.
          isGroup: imp.isGroup,
        });
      }
    } else {
      // Simple import
      const item = imp.items[0];
      const used =
        implicitlyUsedTraits.has(item) ||
        (usedIdentifiers.has(item) && !qualifiedOnlyIdentifiers.has(item));

      if (used) {
        result.push(imp);
      }
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API: buildOrganizedText
// ─────────────────────────────────────────────────────────────────────────────

export interface OrganizeOptions {
  /**
   * Controls how imports are grouped.
   *
   * - `true`  (default) — three fixed groups: std / external / local.
   * - `false`           — single flat block, no grouping.
   * - `"preserve"`      — keep the developer's existing blank-line groups;
   *                       only sort alphabetically within each group.
   * - `"custom"`        — use `importOrder` to define explicit groups.
   */
  groupImports?: boolean | 'preserve' | 'custom';
  /**
   * Ordered array of module-path prefixes that define custom import groups.
   * Only used when `groupImports` is `"custom"`.
   *
   * Each entry is a module prefix string. Imports are placed in the first
   * group whose prefix matches the start of their module path.
   * Use `"*"` as a catch-all for everything not matched by a named prefix.
   *
   * Special tokens:
   *   - `"std"`  — all standard-library imports (std::, core::, alloc::)
   *   - `"crate"` — all local imports (crate::, super::, self::)
   *   - `"*"`    — catch-all for everything else
   *
   * Example: `["std", "tokio", "axum", "*", "crate"]`
   * produces: std group, tokio group, axum group, remaining external, local.
   */
  importOrder?: string[];
  /**
   * Where `pub use` re-exports are placed in the output.
   *
   * - `"inline"` (default) — mixed in with regular imports by module category.
   * - `"first"`            — own group at the very top (before std).
   * - `"last"`             — own group at the very bottom (before cfg).
   */
  pubUsePlacement?: 'inline' | 'first' | 'last';
  /** Sort imports alphabetically within each group. Default: true */
  sortAlphabetically?: boolean;
  /** Insert a blank line between each group. Default: true */
  blankLineBetweenGroups?: boolean;
  /** Collapse grouped imports that have been filtered to a single item. Default: false */
  collapseSingleImports?: boolean;
  /** Remove unused imports. Default: true */
  removeUnused?: boolean;
  /**
   * Set of external crate names read from Cargo.toml.
   * When provided, classification uses this list instead of heuristics.
   */
  knownExternalCrates?: Set<string>;
  /**
   * Set of workspace-member package names read from Cargo.toml.
   * Members are treated as local imports.
   */
  knownLocalCrates?: Set<string>;
}

/**
 * The single entry point for the full organize-imports pipeline.
 *
 * Given the raw source text of a Rust file, this function:
 *   1. Parses all `use` statements
 *   2. Removes duplicates
 *   3. Removes unused imports
 *   4. Formats and reinserts the surviving imports in place
 *
 * Returns the transformed source text.
 */
export function organizeImportsInText(
  text: string,
  options: OrganizeOptions = {}
): string {
  const { removeUnused = true } = options;

  const allImports = parseImports(text);
  if (allImports.length === 0) return text;

  const unique = removeDuplicateImports(allImports);
  const used = removeUnused ? removeUnusedImports(unique, text) : unique;

  return buildOrganizedText(used, allImports, text, options);
}

/**
 * Rebuild the source text with organized imports.
 *
 * Core principle: ONLY the lines that belong to real `use` statements are
 * replaced. Every other line in the file — comments, blank lines, file-level
 * doc comments, code — is left exactly where it is.
 *
 * Algorithm:
 *   1. Build the organized import text (sorted, grouped, filtered).
 *   2. Reconstruct the file line-by-line:
 *      - Lines BEFORE the import block: copied verbatim.
 *      - Lines INSIDE the import block range:
 *          • Lines that belong to a real use statement: replaced with the
 *            next line from the organized import section.
 *          • All other lines (comments, blanks): copied verbatim.
 *      - Lines AFTER the import block: copied verbatim, with exactly one
 *        blank line separator if the import block ends without one.
 *
 * @param imports     Imports to write (already filtered/deduped).
 * @param allImports  All imports from the original file — used to determine
 *                    the exact line range to replace.
 * @param originalText The full source text.
 * @param options     Formatting options.
 */
export function buildOrganizedText(
  imports: ImportStatement[],
  allImports: ImportStatement[],
  originalText: string,
  options: OrganizeOptions = {}
): string {
  const {
    groupImports = true,
    importOrder,
    pubUsePlacement = 'inline',
    sortAlphabetically = true,
    blankLineBetweenGroups = true,
    collapseSingleImports = false,
    knownExternalCrates,
    knownLocalCrates,
  } = options;

  const lines = originalText.split('\n');
  const importStartLine = Math.min(...allImports.map(imp => imp.startLine));
  const importEndLine = Math.max(...allImports.map(imp => imp.endLine));

  // Build the set of line indices that belong to real use statements so we
  // know exactly which lines to replace vs leave alone.
  const importLineSet = new Set(
    allImports.flatMap(imp =>
      Array.from({ length: imp.endLine - imp.startLine + 1 }, (_, k) => imp.startLine + k)
    )
  );

  // ── Build the organized import lines ──────────────────────────────────────
  // If every import was removed, the organized section is empty.
  let organizedLines: string[] = [];

  const hasCfg = imports.some(imp => imp.cfgAttribute);
  if (imports.length > 0 || hasCfg) {
    let importSection: string;
    if (groupImports === 'preserve') {
      importSection = buildPreservedGroupImports(
        imports, allImports, lines,
        sortAlphabetically, blankLineBetweenGroups, collapseSingleImports
      );
    } else if (groupImports === 'custom' && importOrder && importOrder.length > 0) {
      importSection = buildCustomGroupedImports(
        imports, importOrder,
        sortAlphabetically, blankLineBetweenGroups, collapseSingleImports,
        knownExternalCrates, knownLocalCrates, pubUsePlacement
      );
    } else if (groupImports === true) {
      importSection = buildGroupedImports(
        imports, sortAlphabetically, blankLineBetweenGroups, collapseSingleImports,
        knownExternalCrates, knownLocalCrates, pubUsePlacement
      );
    } else {
      importSection = buildFlatImports(imports, sortAlphabetically, collapseSingleImports);
    }
    organizedLines = importSection.split('\n');
  }

  // ── Collect the line indices of real import slots, in document order ───────
  // These are the ONLY lines we will replace. Everything else is copied verbatim.
  const importSlots = Array.from(importLineSet).sort((a, b) => a - b);

  // ── Reconstruct the file ───────────────────────────────────────────────────
  // Strategy: build a slot → replacement mapping, then walk the file once.
  //
  // Problem with naive slot-filling: if the organized order differs from the
  // original order (sorting changes positions), we cannot assign organized
  // line i to slot i. Instead we:
  //   1. Distribute all organized lines across the available slots.
  //   2. Where there are more organized lines than slots (multi-line expansion),
  //      the extras are inserted after the last slot.
  //   3. Where there are fewer organized lines than slots (removals), the
  //      surplus slots are turned into empty strings (blank lines) which are
  //      later collapsed.
  const slotReplacement = new Map<number, string>();
  for (let i = 0; i < importSlots.length; i++) {
    slotReplacement.set(importSlots[i], organizedLines[i] ?? '');
  }

  // Lines that didn't fit into any slot (organized has more lines than slots)
  const overflow = organizedLines.slice(importSlots.length);

  const output: string[] = [];

  for (let li = 0; li < lines.length; li++) {
    if (li < importStartLine || li > importEndLine) {
      output.push(lines[li]);
      continue;
    }

    if (slotReplacement.has(li)) {
      output.push(slotReplacement.get(li)!);
      // Flush overflow lines immediately after the last slot
      if (li === importSlots[importSlots.length - 1] && overflow.length > 0) {
        output.push(...overflow);
      }
    } else {
      // Not a real import line (comment, blank, etc.) — copy verbatim
      output.push(lines[li]);
    }
  }

  // Collapse runs of more than one consecutive blank line within and
  // immediately after the import block (catches both gaps from removed imports
  // and pre-existing multiple blank lines between the block and the first
  // line of real code).
  const firstCodeLine = output.findIndex(
    (l, idx) => idx > importEndLine && l.trim() !== '' && !l.trim().startsWith('//')
  );
  const collapseEnd = firstCodeLine === -1 ? output.length : firstCodeLine;
  const collapsed: string[] = [];
  let blankRun = 0;

  for (let li = 0; li < output.length; li++) {
    if (li >= importStartLine && li <= collapseEnd && output[li].trim() === '') {
      blankRun++;
      if (blankRun <= 1) collapsed.push(output[li]);
    } else {
      blankRun = 0;
      collapsed.push(output[li]);
    }
  }

  return collapsed.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: emit a formatted group, with cfg entries always last
// ─────────────────────────────────────────────────────────────────────────────

function emitGroups(
  groups: string[],
  cfgImports: ImportStatement[],
  collapseSingleImports: boolean,
  blankLineBetweenGroups: boolean
): string {
  if (cfgImports.length > 0) {
    const cfgLines = cfgImports.map(imp =>
      `${imp.cfgAttribute}\n${formatImport(imp, collapseSingleImports)}`
    );
    groups.push(cfgLines.join('\n'));
  }
  return blankLineBetweenGroups ? groups.join('\n\n') : groups.join('\n');
}

function renderGroup(
  group: ImportStatement[],
  sortAlphabetically: boolean,
  collapseSingleImports: boolean
): string {
  const sorted = sortAlphabetically ? sortImports(group) : group;
  return sorted.map(imp => formatImport(imp, collapseSingleImports)).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: standard 3-group layout (std / external / local)
// ─────────────────────────────────────────────────────────────────────────────

function buildGroupedImports(
  imports: ImportStatement[],
  sortAlphabetically: boolean,
  blankLineBetweenGroups: boolean,
  collapseSingleImports: boolean,
  knownExternalCrates?: Set<string>,
  knownLocalCrates?: Set<string>,
  pubUsePlacement: 'inline' | 'first' | 'last' = 'inline'
): string {
  const organized = organizeImports(imports, knownExternalCrates, knownLocalCrates, pubUsePlacement);
  const groups: string[] = [];

  // pub use re-exports first (when placement = "first")
  if (pubUsePlacement === 'first' && organized.pubUseImports.length > 0) {
    groups.push(renderGroup(organized.pubUseImports, sortAlphabetically, collapseSingleImports));
  }

  // std → external → local
  for (const group of [organized.stdImports, organized.externalImports, organized.localImports]) {
    if (group.length === 0) continue;
    groups.push(renderGroup(group, sortAlphabetically, collapseSingleImports));
  }

  // pub use re-exports last (when placement = "last")
  if (pubUsePlacement === 'last' && organized.pubUseImports.length > 0) {
    groups.push(renderGroup(organized.pubUseImports, sortAlphabetically, collapseSingleImports));
  }

  return emitGroups(groups, organized.cfgImports, collapseSingleImports, blankLineBetweenGroups);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: custom group order layout
// ─────────────────────────────────────────────────────────────────────────────

const STD_ROOTS = new Set(['std', 'core', 'alloc']);
const LOCAL_ROOTS = new Set(['crate', 'super', 'self']);

/**
 * Assign an import to the first matching entry in importOrder.
 * Returns the index of the matching entry, or the catch-all index.
 */
function matchImportOrder(
  imp: ImportStatement,
  importOrder: string[],
  knownExternalCrates?: Set<string>,
  knownLocalCrates?: Set<string>
): number {
  const root = imp.module.split('::')[0].replace(/-/g, '_');
  const category = categorizeImport(imp.module, knownExternalCrates, knownLocalCrates);

  // Two-pass strategy so specific tokens always beat a catch-all '*' that
  // appears earlier in the array.  Without this, ['std', 'tokio', '*', 'crate']
  // would match crate:: imports at '*' (index 2) instead of 'crate' (index 3).
  //
  // Pass 1: specific matches only (skip '*')
  for (let i = 0; i < importOrder.length; i++) {
    const entry = importOrder[i];
    if (entry === '*') continue;

    // Special category tokens
    if (entry === 'std' && category === 'std') return i;
    if (entry === 'crate' && category === 'local') return i;

    // Literal prefix match: "tokio" matches "tokio", "tokio::runtime", etc.
    if (root === entry || imp.module === entry || imp.module.startsWith(entry + '::')) {
      return i;
    }
  }

  // Pass 2: fall through to catch-all '*', or append at end if absent
  const catchAll = importOrder.indexOf('*');
  return catchAll === -1 ? importOrder.length : catchAll;
}

function buildCustomGroupedImports(
  imports: ImportStatement[],
  importOrder: string[],
  sortAlphabetically: boolean,
  blankLineBetweenGroups: boolean,
  collapseSingleImports: boolean,
  knownExternalCrates?: Set<string>,
  knownLocalCrates?: Set<string>,
  pubUsePlacement: 'inline' | 'first' | 'last' = 'inline'
): string {
  // Separate cfg and pub use (when not inline) upfront
  const cfgImports: ImportStatement[] = [];
  const pubUseImports: ImportStatement[] = [];
  const regularImports: ImportStatement[] = [];

  for (const imp of imports) {
    if (imp.cfgAttribute) { cfgImports.push(imp); continue; }
    if (imp.isPublic && pubUsePlacement !== 'inline') { pubUseImports.push(imp); continue; }
    regularImports.push(imp);
  }

  // Bucket regular imports by their matching importOrder slot
  const buckets = new Map<number, ImportStatement[]>();
  for (const imp of regularImports) {
    const idx = matchImportOrder(imp, importOrder, knownExternalCrates, knownLocalCrates);
    if (!buckets.has(idx)) buckets.set(idx, []);
    buckets.get(idx)!.push(imp);
  }

  // Emit in order
  const groups: string[] = [];

  if (pubUsePlacement === 'first' && pubUseImports.length > 0) {
    groups.push(renderGroup(pubUseImports, sortAlphabetically, collapseSingleImports));
  }

  // Walk importOrder slots in order, emitting non-empty buckets
  const maxSlot = Math.max(importOrder.length, ...buckets.keys());
  for (let i = 0; i <= maxSlot; i++) {
    const bucket = buckets.get(i);
    if (bucket && bucket.length > 0) {
      groups.push(renderGroup(bucket, sortAlphabetically, collapseSingleImports));
    }
  }

  if (pubUsePlacement === 'last' && pubUseImports.length > 0) {
    groups.push(renderGroup(pubUseImports, sortAlphabetically, collapseSingleImports));
  }

  return emitGroups(groups, cfgImports, collapseSingleImports, blankLineBetweenGroups);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: preserve existing group structure
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Group imports by the blank-line boundaries that existed between them in the
 * original source, then sort alphabetically within each group.
 */
function buildPreservedGroupImports(
  imports: ImportStatement[],
  allImports: ImportStatement[],
  originalLines: string[],
  sortAlphabetically: boolean,
  blankLineBetweenGroups: boolean,
  collapseSingleImports: boolean
): string {
  // A new group starts whenever there is at least one blank line between
  // consecutive imports in the original source.
  const groups: ImportStatement[][] = [];
  let currentGroup: ImportStatement[] = [];

  for (let i = 0; i < imports.length; i++) {
    if (i === 0) {
      currentGroup.push(imports[i]);
      continue;
    }

    const prevEnd = imports[i - 1].endLine;
    const thisStart = imports[i].startLine;

    // Check if there is a blank line between previous import end and this start
    let hasBlankLine = false;
    for (let li = prevEnd + 1; li < thisStart; li++) {
      if (originalLines[li]?.trim() === '') {
        hasBlankLine = true;
        break;
      }
    }

    if (hasBlankLine) {
      if (currentGroup.length > 0) groups.push(currentGroup);
      currentGroup = [imports[i]];
    } else {
      currentGroup.push(imports[i]);
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  // Separate cfg imports (always last)
  const cfgImports: ImportStatement[] = [];
  const regularGroups: string[] = [];

  for (const group of groups) {
    const cfgs = group.filter(imp => imp.cfgAttribute);
    const regular = group.filter(imp => !imp.cfgAttribute);
    cfgImports.push(...cfgs);
    if (regular.length > 0) {
      regularGroups.push(renderGroup(regular, sortAlphabetically, collapseSingleImports));
    }
  }

  // In preserve mode blank lines between groups already exist in the original
  // source and are copied verbatim by the slot map.  Passing blankLineBetweenGroups
  // to emitGroups would inject extra lines that overflow past the slot count and
  // get spliced back in, producing spurious blank lines.  Always use false here.
  return emitGroups(regularGroups, cfgImports, collapseSingleImports, false);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: flat (no grouping)
// ─────────────────────────────────────────────────────────────────────────────

function buildFlatImports(
  imports: ImportStatement[],
  sortAlphabetically: boolean,
  collapseSingleImports: boolean
): string {
  const sorted = sortAlphabetically ? sortImports(imports) : imports;
  return sorted.map(imp => formatImport(imp, collapseSingleImports)).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API: findMidFilePubUse
// ─────────────────────────────────────────────────────────────────────────────

export interface MidFilePubUse {
  line: number;   // 0-based line index
  text: string;   // the raw line text
}

/**
 * Finds `use` and `pub use` statements that appear AFTER the top-level import
 * block. These are invisible to parseImports (which stops at the first
 * non-import line) and cannot be automatically removed safely — they may be
 * inside a mod block, impl block, or guarded by #[cfg(...)].
 *
 * This function surfaces them so the caller can warn the user.
 *
 * A line qualifies when:
 *   - it starts with `use` or `pub use` (after trimming)
 *   - it appears after the line where the top-level import block ends
 *
 * Note: `use` inside mod/impl/fn bodies is intentional Rust and should NOT
 * be warned about in isolation — only warn when it follows a #[cfg(...)]
 * attribute (likely an overlooked conditional import) or when it is `pub use`
 * (a re-export that the compiler will flag if unused).
 */
export function findMidFilePubUse(text: string): MidFilePubUse[] {
  const allImports = parseImports(text);
  const importBlockEnd = allImports.length > 0
    ? Math.max(...allImports.map(i => i.endLine))
    : -1;

  const results: MidFilePubUse[] = [];
  const lines = text.split('\n');
  let prevLineWasCfg = false;

  for (let i = importBlockEnd + 1; i < lines.length; i++) {
    const trimmed = sanitize(lines[i]).trim();

    // Track whether the previous non-blank line was a #[cfg(...)] attribute
    if (trimmed !== '') {
      const isCfg = trimmed.startsWith('#[cfg(') || trimmed.startsWith('#[cfg (');

      if (trimmed.startsWith('pub use ')) {
        // Always warn about mid-file pub use — likely an unintentional re-export
        results.push({ line: i, text: lines[i] });
      } else if (trimmed.startsWith('use ') && prevLineWasCfg) {
        // Warn about a plain use that is guarded by #[cfg] mid-file —
        // this is an import that the organizer cannot see or process
        results.push({ line: i, text: lines[i] });
      }

      prevLineWasCfg = isCfg;
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal utility
// ─────────────────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}