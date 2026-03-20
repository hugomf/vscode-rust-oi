import {
  parseImports,
  organizeImports,
  formatImport,
  removeDuplicateImports,
  removeUnusedImports,
  ImportStatement,
} from './importParser';

// Copy the helper functions from extension.ts for testing
function buildOrganizedText(
  imports: ImportStatement[],
  originalText: string,
  groupImports: boolean,
  sortAlphabetically: boolean,
  blankLineBetweenGroups: boolean,
  collapseSingleImports: boolean
): string {
  if (imports.length === 0) {
    return originalText;
  }

  const lines = originalText.split('\n');

  const importStartLine = Math.min(...imports.map(imp => imp.startLine));
  const importEndLine = Math.max(...imports.map(imp => imp.endLine));

  const beforeImports = lines.slice(0, importStartLine).join('\n');

  const rawAfterLines = lines.slice(importEndLine + 1);
  const firstNonBlank = rawAfterLines.findIndex(l => l.trim() !== '');
  const afterImports = firstNonBlank === -1 ? '' : rawAfterLines.slice(firstNonBlank).join('\n');

  const importSection = groupImports
    ? buildGroupedImports(imports, sortAlphabetically, blankLineBetweenGroups, collapseSingleImports)
    : buildFlatImports(imports, sortAlphabetically, collapseSingleImports);

  let result = beforeImports;
  if (result && !result.endsWith('\n')) {
    result += '\n';
  }
  result += importSection;
  if (afterImports) {
    result += '\n\n' + afterImports;
  }

  return result;
}

function buildGroupedImports(
  imports: ImportStatement[],
  sortAlphabetically: boolean,
  blankLineBetweenGroups: boolean,
  collapseSingleImports: boolean
): string {
  const organized = organizeImports(imports);
  
  const groups: string[] = [];

  if (organized.stdImports.length > 0) {
    const sorted = sortAlphabetically ? [...organized.stdImports].sort((a, b) => a.module.localeCompare(b.module)) : organized.stdImports;
    groups.push(sorted.map(imp => formatImport(imp, collapseSingleImports)).join('\n'));
  }

  if (organized.externalImports.length > 0) {
    const sorted = sortAlphabetically ? [...organized.externalImports].sort((a, b) => a.module.localeCompare(b.module)) : organized.externalImports;
    groups.push(sorted.map(imp => formatImport(imp, collapseSingleImports)).join('\n'));
  }

  if (organized.localImports.length > 0) {
    const sorted = sortAlphabetically ? [...organized.localImports].sort((a, b) => a.module.localeCompare(b.module)) : organized.localImports;
    groups.push(sorted.map(imp => formatImport(imp, collapseSingleImports)).join('\n'));
  }

  return blankLineBetweenGroups ? groups.join('\n\n') : groups.join('\n');
}

function buildFlatImports(
  imports: ImportStatement[],
  sortAlphabetically: boolean,
  collapseSingleImports: boolean
): string {
  const sorted = sortAlphabetically ? [...imports].sort((a, b) => a.module.localeCompare(b.module)) : imports;
  return sorted.map(imp => formatImport(imp, collapseSingleImports)).join('\n');
}

describe('extension helper functions', () => {
  describe('buildOrganizedText', () => {
    it('should return original text when imports is empty', () => {
      const originalText = `fn main() {
  println!("Hello");
}`;
      const result = buildOrganizedText([], originalText, true, true, true, false);
      expect(result).toBe(originalText);
    });

    it('should organize imports with code before them', () => {
      const originalText = `// Some comment
use std::collections::HashMap;

fn main() {
  let map = HashMap::new();
}`;
      
      const imports = parseImports(originalText);
      const result = buildOrganizedText(imports, originalText, true, true, true, false);
      
      expect(result).toContain('use std::collections::HashMap;');
      expect(result).toContain('fn main()');
    });

    it('should preserve code after imports', () => {
      const originalText = `use std::collections::HashMap;

fn main() {
  let map = HashMap::new();
}

pub struct Example;`;
      
      const imports = parseImports(originalText);
      const result = buildOrganizedText(imports, originalText, true, true, true, false);
      
      expect(result).toContain('fn main()');
      expect(result).toContain('pub struct Example');
    });

    it('should handle imports at the start of file with no before content', () => {
      const originalText = `use std::collections::HashMap;

fn main() {}`;
      
      const imports = parseImports(originalText);
      const result = buildOrganizedText(imports, originalText, true, true, true, false);
      
      expect(result.startsWith('use std::collections::HashMap;')).toBe(true);
    });
  });

  describe('buildGroupedImports', () => {
    it('should group imports into std, external, and local categories', () => {
      const imports: ImportStatement[] = [
        {
          originalText: 'use std::collections::HashMap;',
          module: 'std::collections',
          items: ['HashMap'],
          isGroup: false,
          startLine: 0,
          endLine: 0,
        },
        {
          originalText: 'use serde::Serialize;',
          module: 'serde',
          items: ['Serialize'],
          isGroup: false,
          startLine: 1,
          endLine: 1,
        },
        {
          originalText: 'use crate::config::Settings;',
          module: 'crate::config',
          items: ['Settings'],
          isGroup: false,
          startLine: 2,
          endLine: 2,
        },
      ];
      
      const result = buildGroupedImports(imports, true, true, false);
      
      expect(result).toContain('std::collections');
      expect(result).toContain('serde');
      expect(result).toContain('crate::config');
    });

    it('should add blank lines between groups when enabled', () => {
      const imports: ImportStatement[] = [
        {
          originalText: 'use std::collections::HashMap;',
          module: 'std::collections',
          items: ['HashMap'],
          isGroup: false,
          startLine: 0,
          endLine: 0,
        },
        {
          originalText: 'use serde::Serialize;',
          module: 'serde',
          items: ['Serialize'],
          isGroup: false,
          startLine: 1,
          endLine: 1,
        },
      ];
      
      const resultWithBlanks = buildGroupedImports(imports, false, true, false);
      const resultWithoutBlanks = buildGroupedImports(imports, false, false, false);
      
      expect(resultWithBlanks).toContain('\n\n');
      expect(resultWithoutBlanks).not.toContain('\n\n');
    });

    it('should handle empty categories gracefully', () => {
      // Only std imports, no external or local
      const imports: ImportStatement[] = [
        {
          originalText: 'use std::collections::HashMap;',
          module: 'std::collections',
          items: ['HashMap'],
          isGroup: false,
          startLine: 0,
          endLine: 0,
        },
      ];
      
      const result = buildGroupedImports(imports, false, true, false);
      expect(result).toContain('std::collections');
      expect(result).not.toMatch(/\n\n\n/); // No extra blank lines
    });
  });

  describe('buildFlatImports', () => {
    it('should flatten all imports without grouping', () => {
      const imports: ImportStatement[] = [
        {
          originalText: 'use std::collections::HashMap;',
          module: 'std::collections',
          items: ['HashMap'],
          isGroup: false,
          startLine: 0,
          endLine: 0,
        },
        {
          originalText: 'use serde::Serialize;',
          module: 'serde',
          items: ['Serialize'],
          isGroup: false,
          startLine: 1,
          endLine: 1,
        },
        {
          originalText: 'use crate::config::Settings;',
          module: 'crate::config',
          items: ['Settings'],
          isGroup: false,
          startLine: 2,
          endLine: 2,
        },
      ];
      
      const result = buildFlatImports(imports, false, false);
      
      // Should not have blank lines (flat mode)
      expect(result).not.toContain('\n\n');
      expect(result).toContain('std::collections');
      expect(result).toContain('serde');
      expect(result).toContain('crate::config');
    });

    it('should sort imports alphabetically when enabled', () => {
      const imports: ImportStatement[] = [
        {
          originalText: 'use std::collections::HashMap;',
          module: 'std::collections',
          items: ['HashMap'],
          isGroup: false,
          startLine: 0,
          endLine: 0,
        },
        {
          originalText: 'use serde::Serialize;',
          module: 'serde',
          items: ['Serialize'],
          isGroup: false,
          startLine: 1,
          endLine: 1,
        },
        {
          originalText: 'use crate::config::Settings;',
          module: 'crate::config',
          items: ['Settings'],
          isGroup: false,
          startLine: 2,
          endLine: 2,
        },
      ];
      
      const sortedResult = buildFlatImports(imports, true, false);
      const crateIndex = sortedResult.indexOf('crate::config');
      const serdeIndex = sortedResult.indexOf('serde');
      const stdIndex = sortedResult.indexOf('std::collections');
      
      // crate comes first alphabetically, then serde, then std
      expect(crateIndex).toBeLessThan(serdeIndex);
      expect(serdeIndex).toBeLessThan(stdIndex);
    });
  });

  // Note: Full integration tests require the actual test-unused.rs file
  // The importParser.test.ts already tests the core logic with that file
});
