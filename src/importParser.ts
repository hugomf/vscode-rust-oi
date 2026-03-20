export interface ImportStatement {
  originalText: string;
  module: string;
  items: string[];
  isGroup: boolean;
  startLine: number;
  endLine: number;
}

export interface OrganizedImports {
  stdImports: ImportStatement[];
  externalImports: ImportStatement[];
  localImports: ImportStatement[];
}

// Strip non-ASCII characters that editors can accidentally insert (e.g. ∏, smart quotes)
function sanitize(line: string): string {
  return line.replace(/[^\x00-\x7F]/g, '');
}

export function parseImports(text: string): ImportStatement[] {
  const lines = text.split('\n');
  const imports: ImportStatement[] = [];
  let i = 0;

  while (i < lines.length) {
    // Sanitize before any check so stray non-ASCII chars don't hide use statements
    const line = sanitize(lines[i]).trim();

    if (line === '' || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) {
      i++;
      continue;
    }

    if (line.startsWith('use ')) {
      const importInfo = parseUseStatement(lines, i);
      if (importInfo) {
        imports.push(importInfo.statement);
        i = importInfo.nextLine;
        continue;
      }
    }

    // Stop at the first non-import, non-comment, non-blank line.
    // This prevents picking up `use super::*` inside mod blocks.
    if (imports.length > 0) {
      break;
    }

    i++;
  }

  return imports;
}

function parseUseStatement(
  lines: string[],
  startIndex: number
): { statement: ImportStatement; nextLine: number } | null {
  let fullStatement = '';
  let endIndex = startIndex;

  for (let i = startIndex; i < lines.length; i++) {
    // Sanitize each line so stray characters don't break the regex
    const sanitized = sanitize(lines[i]);
    fullStatement += (i === startIndex ? '' : '\n') + sanitized;

    if (sanitized.trimEnd().endsWith(';')) {
      endIndex = i;
      break;
    }

    if (i === lines.length - 1) {
      endIndex = i;
    }
  }

  const trimmedStatement = fullStatement.trim();

  // Grouped: use module::{item1, item2};
  const groupMatch = trimmedStatement.match(
    /^use\s+([\w:]+(?:::[\w:]+)*)\s*::\s*\{\s*([^}]*)\}\s*;$/s
  );
  if (groupMatch) {
    const module = groupMatch[1];
    const items = groupMatch[2]
      .trim()
      .split(',')
      .map(item => item.trim())
      .filter(item => item.length > 0);

    return {
      statement: {
        originalText: fullStatement,
        module,
        items,
        isGroup: true,
        startLine: startIndex,
        endLine: endIndex,
      },
      nextLine: endIndex + 1,
    };
  }

  // Simple: use module::item; or use module::item as alias;
  const simpleMatch = trimmedStatement.match(
    /^use\s+([\w:]+(?:::[\w:]+)*)\s*(?:as\s+\w+)?\s*;$/
  );
  if (simpleMatch) {
    const fullPath = simpleMatch[1];
    const parts = fullPath.split('::');

    return {
      statement: {
        originalText: fullStatement,
        module: parts.slice(0, -1).join('::') || parts[0],
        items: [parts[parts.length - 1]],
        isGroup: false,
        startLine: startIndex,
        endLine: endIndex,
      },
      nextLine: endIndex + 1,
    };
  }

  return null;
}

export function categorizeImport(module: string): 'std' | 'external' | 'local' {
  if (module.startsWith('std::') || module === 'std') {
    return 'std';
  }

  if (
    module.startsWith('crate::') ||
    module.startsWith('super::') ||
    module.startsWith('self::')
  ) {
    return 'local';
  }

  const firstPart = module.split('::')[0];
  if (firstPart === 'crate' || firstPart === 'super' || firstPart === 'self') {
    return 'local';
  }

  return 'external';
}

export function organizeImports(imports: ImportStatement[]): OrganizedImports {
  const organized: OrganizedImports = {
    stdImports: [],
    externalImports: [],
    localImports: [],
  };

  for (const imp of imports) {
    const category = categorizeImport(imp.module);
    console.log(`Import: ${imp.module} -> Category: ${category}`);
    switch (category) {
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

export function sortImports(imports: ImportStatement[]): ImportStatement[] {
  return [...imports].sort((a, b) => {
    const moduleCompare = a.module.localeCompare(b.module);
    if (moduleCompare !== 0) return moduleCompare;
    return a.items[0].localeCompare(b.items[0]);
  });
}

export function formatImport(imp: ImportStatement, collapseSingle: boolean): string {
  // If there's only one item, collapse to simple import format (regardless of original isGroup)
  if (imp.items.length === 1) {
    return `use ${imp.module}::${imp.items[0]};`;
  }

  if (collapseSingle && imp.items.length === 1) {
    return `use ${imp.module}::${imp.items[0]};`;
  }

  const sortedItems = [...imp.items].sort();
  if (sortedItems.length <= 3) {
    return `use ${imp.module}::{${sortedItems.join(', ')}};`;
  }

  const itemsFormatted = sortedItems.map(item => `    ${item}`).join(',\n');
  return `use ${imp.module}::{\n${itemsFormatted},\n};`;
}

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

export function removeUnusedImports(imports: ImportStatement[], text: string): ImportStatement[] {
  // Get all identifiers used in the code (excluding the import section)
  const lines = text.split('\n');
  const importEndLine = Math.max(...imports.map(imp => imp.endLine));
  const codeAfterImports = lines.slice(importEndLine + 1).join('\n');
  
  // Extract all identifiers from the code
  const usedIdentifiers = new Set<string>();
  
  // Match identifiers (words that are not keywords)
  const identifierRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
  let match;
  while ((match = identifierRegex.exec(codeAfterImports)) !== null) {
    usedIdentifiers.add(match[1]);
  }
  
  console.log('Used identifiers:', Array.from(usedIdentifiers));
  
  // Filter imports to only include used ones
  const result: ImportStatement[] = [];
  
  for (const imp of imports) {
    if (imp.isGroup) {
      // For grouped imports, filter out unused items
      const usedItems = imp.items.filter(item => usedIdentifiers.has(item));
      
      if (usedItems.length > 0) {
        // Keep the import with only used items
        result.push({
          ...imp,
          items: usedItems,
        });
        console.log(`Grouped import ${imp.module}::{${imp.items.join(', ')}} - Kept: ${usedItems.join(', ')}`);
      } else {
        console.log(`Grouped import ${imp.module}::{${imp.items.join(', ')}} - Removed (no items used)`);
      }
    } else {
      // For simple imports, check if the item is used
      const isUsed = usedIdentifiers.has(imp.items[0]);
      console.log(`Simple import ${imp.module}::${imp.items[0]} - Used: ${isUsed}`);
      
      if (isUsed) {
        result.push(imp);
      }
    }
  }
  
  return result;
}
