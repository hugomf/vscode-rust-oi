import * as fs from 'fs';
import * as path from 'path';
import {
  formatImport,
  ImportStatement,
  organizeImports,
  parseImports,
  removeDuplicateImports,
  removeUnusedImports,
  sortImports,
} from './importParser';

// Helper function to read test files
function readTestFile(filename: string): string {
  const filePath = path.join(__dirname, '..', filename);
  return fs.readFileSync(filePath, 'utf-8');
}

// Test data based on test-unused.rs
const testUnusedCode = `// Test file for Rust Import Organizer - Unused imports test
// This file has some imports that should be removed

use std::collections::HashMap;
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
    println!("This is a test file for the Rust Import Organizer");

    // Only use some of the imports
    let map: HashMap<String, i32> = HashMap::new();
    let file = File::open("test.txt").unwrap();
    let path = Path::new("test.txt");
    let result: Result<()> = Ok(());
    let user = User::new("test".to_string());
    let runtime = Runtime::new().unwrap();
    let settings = Settings::new();
}

pub struct Example {
    name: String,
    value: i32,
}

impl Example {
    pub fn new(name: String, value: i32) -> Self {
        Self { name, value }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_example() {
        let example = Example::new("test".to_string(), 42);
        assert_eq!(example.value, 42);
    }
}`;

describe('importParser', () => {
  describe('test.rs file', () => {
    it('should parse all imports from test.rs correctly', () => {
      const testRsContent = `// Test file for Rust Import Organizer
// This file demonstrates various import patterns that the extension can organize

use std::collections::HashMap;
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
    println!("This is a test file for the Rust Import Organizer");
}

pub struct Example {
    name: String,
    value: i32,
}

impl Example {
    pub fn new(name: String, value: i32) -> Self {
        Self { name, value }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_example() {
        let example = Example::new("test".to_string(), 42);
        assert_eq!(example.value, 42);
    }
}`;

      const imports = parseImports(testRsContent);
      const uniqueImports = removeDuplicateImports(imports);
      
      // All 15 imports should be parsed
      expect(imports.length).toBe(15);
      expect(uniqueImports.length).toBe(15);
      
      // Verify categorization works on all imports
      const organized = organizeImports(uniqueImports);
      expect(organized.stdImports.length).toBe(5);
      expect(organized.externalImports.length).toBe(6);
      expect(organized.localImports.length).toBe(4);
      
      // Verify specific imports
      const stdModules = organized.stdImports.map(imp => imp.module);
      expect(stdModules).toContain('std::collections');
      expect(stdModules).toContain('std::fs');
      expect(stdModules).toContain('std::io');
      expect(stdModules).toContain('std::path');
      expect(stdModules).toContain('std::sync');
    });
  });

  describe('test-unused.rs file', () => {
    it('should remove unused imports and organize remaining imports', () => {
      const testUnusedRsContent = `// Test file for Rust Import Organizer - Unused imports test
// This file has some imports that should be removed

use std::collections::HashMap;
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
    println!("This is a test file for the Rust Import Organizer");
    
    // Only use some of the imports
    let map: HashMap<String, i32> = HashMap::new();
    let file = File::open("test.txt").unwrap();
    let path = Path::new("test.txt");
    let result: Result<()> = Ok(());
    let user = User::new("test".to_string());
    let runtime = Runtime::new().unwrap();
    let settings = Settings::new();
}

pub struct Example {
    name: String,
    value: i32,
}

impl Example {
    pub fn new(name: String, value: i32) -> Self {
        Self { name, value }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_example() {
        let example = Example::new("test".to_string(), 42);
        assert_eq!(example.value, 42);
    }
}`;

      const imports = parseImports(testUnusedRsContent);
      const uniqueImports = removeDuplicateImports(imports);
      const usedImports = removeUnusedImports(uniqueImports, testUnusedRsContent);
      const organized = organizeImports(usedImports);
      
      // Should only keep 7 used imports
      expect(usedImports.length).toBe(7);
      
      // Verify categorization
      expect(organized.stdImports.length).toBe(3);
      expect(organized.externalImports.length).toBe(3);
      expect(organized.localImports.length).toBe(1);
      
      // Verify specific imports that should be kept
      const usedModules = usedImports.map(imp => imp.module);
      expect(usedModules).toContain('std::collections');
      expect(usedModules).toContain('std::fs');
      expect(usedModules).toContain('std::path');
      expect(usedModules).toContain('anyhow');
      expect(usedModules).toContain('my_crate::models');
      expect(usedModules).toContain('tokio::runtime');
      expect(usedModules).toContain('crate::config');
      
      // Verify specific imports that should be removed
      expect(usedModules).not.toContain('std::io');
      expect(usedModules).not.toContain('std::sync');
      expect(usedModules).not.toContain('chrono');
      expect(usedModules).not.toContain('my_crate::utils');
      expect(usedModules).not.toContain('serde');
      expect(usedModules).not.toContain('super::parent_module');
      expect(usedModules).not.toContain('crate::internal');
      expect(usedModules).not.toContain('crate::utils::helpers');
    });

    it('should handle grouped imports correctly by filtering unused items', () => {
      const testUnusedRsContent = `// Test file for Rust Import Organizer - Unused imports test
// This file has some imports that should be removed

use std::collections::HashMap;
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
    println!("This is a test file for the Rust Import Organizer");
    
    // Only use some of the imports
    let map: HashMap<String, i32> = HashMap::new();
    let file = File::open("test.txt").unwrap();
    let path = Path::new("test.txt");
    let result: Result<()> = Ok(());
    let user = User::new("test".to_string());
    let runtime = Runtime::new().unwrap();
    let settings = Settings::new();
}

pub struct Example {
    name: String,
    value: i32,
}

impl Example {
    pub fn new(name: String, value: i32) -> Self {
        Self { name, value }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_example() {
        let example = Example::new("test".to_string(), 42);
        assert_eq!(example.value, 42);
    }
}`;

      const imports = parseImports(testUnusedRsContent);
      const uniqueImports = removeDuplicateImports(imports);
      const usedImports = removeUnusedImports(uniqueImports, testUnusedRsContent);
      
      // Find the std::path import (grouped)
      const pathImport = usedImports.find(imp => imp.module === 'std::path');
      expect(pathImport).toBeDefined();
      expect(pathImport?.isGroup).toBe(true);
      expect(pathImport?.items).toContain('Path');
      expect(pathImport?.items).not.toContain('PathBuf');
    });

    it('should format imports correctly after organization', () => {
      const testUnusedRsContent = `// Test file for Rust Import Organizer - Unused imports test
// This file has some imports that should be removed

use std::collections::HashMap;
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
    println!("This is a test file for the Rust Import Organizer");
    
    // Only use some of the imports
    let map: HashMap<String, i32> = HashMap::new();
    let file = File::open("test.txt").unwrap();
    let path = Path::new("test.txt");
    let result: Result<()> = Ok(());
    let user = User::new("test".to_string());
    let runtime = Runtime::new().unwrap();
    let settings = Settings::new();
}

pub struct Example {
    name: String,
    value: i32,
}

impl Example {
    pub fn new(name: String, value: i32) -> Self {
        Self { name, value }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_example() {
        let example = Example::new("test".to_string(), 42);
        assert_eq!(example.value, 42);
    }
}`;

      const imports = parseImports(testUnusedRsContent);
      const uniqueImports = removeDuplicateImports(imports);
      const usedImports = removeUnusedImports(uniqueImports, testUnusedRsContent);
      
      // Test formatting of each import
      usedImports.forEach(imp => {
        // With collapseSingle=true, grouped imports with single item should be collapsed
        const formatted = formatImport(imp, true);
        
        // Single-item imports (regardless of original isGroup) should not have braces
        if (imp.items.length === 1) {
          expect(formatted).toMatch(/^use .+::\w+;$/);
        } else {
          // Multiple items should have braces
          expect(formatted).toMatch(/^use .+::\{.+\};$/);
        }
      });
    });
  });
  describe('parseImports', () => {
    it('should parse all imports from the test file', () => {
      const imports = parseImports(testUnusedCode);
      expect(imports.length).toBe(15);
      
      // Check that we have the expected imports
      const modules = imports.map(imp => imp.module);
      expect(modules).toContain('std::collections');
      expect(modules).toContain('std::fs');
      expect(modules).toContain('std::io');
      expect(modules).toContain('std::path');
      expect(modules).toContain('std::sync');
      expect(modules).toContain('anyhow');
      expect(modules).toContain('chrono');
      expect(modules).toContain('my_crate::models');
      expect(modules).toContain('my_crate::utils');
      expect(modules).toContain('serde');
      expect(modules).toContain('tokio::runtime');
      expect(modules).toContain('super::parent_module');
      expect(modules).toContain('crate::config');
      expect(modules).toContain('crate::internal');
      expect(modules).toContain('crate::utils::helpers');
    });
  });

  describe('removeUnusedImports', () => {
    it('should remove unused imports', () => {
      const imports = parseImports(testUnusedCode);
      const usedImports = removeUnusedImports(imports, testUnusedCode);
      
      // Should only keep used imports
      const usedModules = usedImports.map(imp => imp.module);
      
      // These should be kept (used in the code)
      expect(usedModules).toContain('std::collections');
      expect(usedModules).toContain('std::fs');
      expect(usedModules).toContain('std::path');
      expect(usedModules).toContain('anyhow');
      expect(usedModules).toContain('my_crate::models');
      expect(usedModules).toContain('tokio::runtime');
      expect(usedModules).toContain('crate::config');
      
      // These should be removed (not used in the code)
      expect(usedModules).not.toContain('std::io');
      expect(usedModules).not.toContain('std::sync');
      expect(usedModules).not.toContain('chrono');
      expect(usedModules).not.toContain('my_crate::utils');
      expect(usedModules).not.toContain('serde');
      expect(usedModules).not.toContain('super::parent_module');
      expect(usedModules).not.toContain('crate::internal');
      expect(usedModules).not.toContain('crate::utils::helpers');
    });

    it('should handle grouped imports correctly', () => {
      const imports = parseImports(testUnusedCode);
      const usedImports = removeUnusedImports(imports, testUnusedCode);
      
      // Find the std::path import (grouped)
      const pathImport = usedImports.find(imp => imp.module === 'std::path');
      expect(pathImport).toBeDefined();
      expect(pathImport?.isGroup).toBe(true);
      expect(pathImport?.items).toContain('Path');
      // PathBuf should not be in the used imports since it's not used
      expect(pathImport?.items).not.toContain('PathBuf');
    });

    it('should keep at least one import from grouped imports if any item is used', () => {
      const imports = parseImports(testUnusedCode);
      const usedImports = removeUnusedImports(imports, testUnusedCode);
      
      // The std::path import should be kept because Path is used
      const pathImport = usedImports.find(imp => imp.module === 'std::path');
      expect(pathImport).toBeDefined();
    });
  });

  describe('organizeImports', () => {
    it('should categorize imports correctly', () => {
      const imports = parseImports(testUnusedCode);
      const organized = organizeImports(imports);
      
      // Check std imports
      const stdModules = organized.stdImports.map(imp => imp.module);
      expect(stdModules).toContain('std::collections');
      expect(stdModules).toContain('std::fs');
      expect(stdModules).toContain('std::io');
      expect(stdModules).toContain('std::path');
      expect(stdModules).toContain('std::sync');
      
      // Check external imports
      const externalModules = organized.externalImports.map(imp => imp.module);
      expect(externalModules).toContain('anyhow');
      expect(externalModules).toContain('chrono');
      expect(externalModules).toContain('my_crate::models');
      expect(externalModules).toContain('my_crate::utils');
      expect(externalModules).toContain('serde');
      expect(externalModules).toContain('tokio::runtime');
      
      // Check local imports
      const localModules = organized.localImports.map(imp => imp.module);
      expect(localModules).toContain('super::parent_module');
      expect(localModules).toContain('crate::config');
      expect(localModules).toContain('crate::internal');
      expect(localModules).toContain('crate::utils::helpers');
    });
  });

  describe('sortImports', () => {
    it('should sort imports alphabetically', () => {
      const imports = parseImports(testUnusedCode);
      const sorted = sortImports(imports);
      
      // Check that imports are sorted by module
      for (let i = 0; i < sorted.length - 1; i++) {
        const current = sorted[i].module;
        const next = sorted[i + 1].module;
        expect(current.localeCompare(next)).toBeLessThanOrEqual(0);
      }
    });
  });

  describe('formatImport', () => {
    it('should format simple imports correctly', () => {
      const simpleImport: ImportStatement = {
        originalText: 'use std::collections::HashMap;',
        module: 'std::collections',
        items: ['HashMap'],
        isGroup: false,
        startLine: 0,
        endLine: 0,
      };
      
      const formatted = formatImport(simpleImport, false);
      expect(formatted).toBe('use std::collections::HashMap;');
    });

    it('should format grouped imports correctly', () => {
      const groupedImport: ImportStatement = {
        originalText: 'use std::path::{Path, PathBuf};',
        module: 'std::path',
        items: ['Path', 'PathBuf'],
        isGroup: true,
        startLine: 0,
        endLine: 0,
      };
      
      const formatted = formatImport(groupedImport, false);
      expect(formatted).toBe('use std::path::{Path, PathBuf};');
    });
  });

  describe('full workflow', () => {
    it('should organize and remove unused imports', () => {
      const imports = parseImports(testUnusedCode);
      const uniqueImports = removeUnusedImports(imports, testUnusedCode);
      const usedImports = removeUnusedImports(uniqueImports, testUnusedCode);
      
      // Should have 7 used imports
      expect(usedImports.length).toBe(7);
      
      // Organize the used imports
      const organized = organizeImports(usedImports);
      
      // Should have 3 std imports
      expect(organized.stdImports.length).toBe(3);
      
      // Should have 3 external imports
      expect(organized.externalImports.length).toBe(3);
      
      // Should have 1 local import
      expect(organized.localImports.length).toBe(1);
    });
  });

  describe('test.rs file (using actual file)', () => {
    it('should read test.rs and parse all imports correctly', () => {
      const testRsContent = readTestFile('test.rs');
      
      // Parse imports from the file
      const imports = parseImports(testRsContent);
      
      // Should find 15 imports
      expect(imports.length).toBe(15);
      
      // Remove duplicates (none expected)
      const uniqueImports = removeDuplicateImports(imports);
      expect(uniqueImports.length).toBe(15);
      
      // Check for unused imports (test.rs main function doesn't use most imports)
      const usedImports = removeUnusedImports(uniqueImports, testRsContent);
      
      // In test.rs, the main function only prints a message and doesn't use any imports
      // So all imports should be removed as unused
      expect(usedImports.length).toBe(0);
      
      // But organize should still work with empty array
      const organized = organizeImports(usedImports);
      expect(organized.stdImports.length).toBe(0);
      expect(organized.externalImports.length).toBe(0);
      expect(organized.localImports.length).toBe(0);
    });

    it('should parse all import types from test.rs', () => {
      const testRsContent = readTestFile('test.rs');
      const imports = parseImports(testRsContent);
      
      // Verify we have different types of imports
      const modules = imports.map(imp => imp.module);
      
      // Std imports
      expect(modules).toContain('std::collections');
      expect(modules).toContain('std::fs');
      expect(modules).toContain('std::io');
      expect(modules).toContain('std::path');
      expect(modules).toContain('std::sync');
      
      // External imports
      expect(modules).toContain('anyhow');
      expect(modules).toContain('chrono');
      expect(modules).toContain('my_crate::models');
      expect(modules).toContain('my_crate::utils');
      expect(modules).toContain('serde');
      expect(modules).toContain('tokio::runtime');
      
      // Local imports
      expect(modules).toContain('super::parent_module');
      expect(modules).toContain('crate::config');
      expect(modules).toContain('crate::internal');
      expect(modules).toContain('crate::utils::helpers');
    });
  });

  describe('test-unused.rs file (using actual file)', () => {
    it('should read test-unused.rs and remove unused imports', () => {
      const testUnusedRsContent = readTestFile('test-unused.rs');
      
      // Parse imports from the file
      const imports = parseImports(testUnusedRsContent);
      
      // Should find 15 imports initially
      expect(imports.length).toBe(15);
      
      // Remove duplicates
      const uniqueImports = removeDuplicateImports(imports);
      expect(uniqueImports.length).toBe(15);
      
      // Remove unused imports
      const usedImports = removeUnusedImports(uniqueImports, testUnusedRsContent);
      
      // Should only keep 7 used imports (based on what is used in main function)
      expect(usedImports.length).toBe(7);
      
      // Verify the used imports
      const usedModules = usedImports.map(imp => imp.module);
      expect(usedModules).toContain('std::collections');
      expect(usedModules).toContain('std::fs');
      expect(usedModules).toContain('std::path');
      expect(usedModules).toContain('anyhow');
      expect(usedModules).toContain('my_crate::models');
      expect(usedModules).toContain('tokio::runtime');
      expect(usedModules).toContain('crate::config');
      
      // Verify unused imports are removed
      expect(usedModules).not.toContain('std::io');
      expect(usedModules).not.toContain('std::sync');
      expect(usedModules).not.toContain('chrono');
      expect(usedModules).not.toContain('my_crate::utils');
      expect(usedModules).not.toContain('serde');
      expect(usedModules).not.toContain('super::parent_module');
      expect(usedModules).not.toContain('crate::internal');
      expect(usedModules).not.toContain('crate::utils::helpers');
    });

    it('should organize used imports from test-unused.rs correctly', () => {
      const testUnusedRsContent = readTestFile('test-unused.rs');
      const imports = parseImports(testUnusedRsContent);
      const uniqueImports = removeDuplicateImports(imports);
      const usedImports = removeUnusedImports(uniqueImports, testUnusedRsContent);
      const organized = organizeImports(usedImports);
      
      // Verify categorization
      expect(organized.stdImports.length).toBe(3);  // HashMap, File, Path
      expect(organized.externalImports.length).toBe(3);  // Result, User, Runtime
      expect(organized.localImports.length).toBe(1);  // Settings
      
      // Check specific categorizations
      const stdModules = organized.stdImports.map(imp => imp.module);
      expect(stdModules).toContain('std::collections');
      expect(stdModules).toContain('std::fs');
      expect(stdModules).toContain('std::path');
      
      const externalModules = organized.externalImports.map(imp => imp.module);
      expect(externalModules).toContain('anyhow');
      expect(externalModules).toContain('my_crate::models');
      expect(externalModules).toContain('tokio::runtime');
      
      const localModules = organized.localImports.map(imp => imp.module);
      expect(localModules).toContain('crate::config');
    });

    it('should handle grouped imports in test-unused.rs correctly', () => {
      const testUnusedRsContent = readTestFile('test-unused.rs');
      const imports = parseImports(testUnusedRsContent);
      const usedImports = removeUnusedImports(imports, testUnusedRsContent);
      
      // Find the std::path import (grouped)
      const pathImport = usedImports.find(imp => imp.module === 'std::path');
      expect(pathImport).toBeDefined();
      expect(pathImport?.isGroup).toBe(true);
      
      // Only Path is used, PathBuf is not
      expect(pathImport?.items).toContain('Path');
      expect(pathImport?.items).not.toContain('PathBuf');
    });

    it('should format grouped imports with single item without brackets', () => {
      const testUnusedRsContent = readTestFile('test-unused.rs');
      const imports = parseImports(testUnusedRsContent);
      const usedImports = removeUnusedImports(imports, testUnusedRsContent);
      
      // Find the std::path import (was grouped, now has only Path)
      const pathImport = usedImports.find(imp => imp.module === 'std::path');
      expect(pathImport).toBeDefined();
      
      // When a grouped import has only one item, it should be formatted without brackets
      // use std::path::{Path} should become use std::path::Path;
      const formatted = formatImport(pathImport!, true);
      expect(formatted).toBe('use std::path::Path;');
    });

    it('should produce complete organized output with single-item groups collapsed', () => {
      const testUnusedRsContent = readTestFile('test-unused.rs');
      const imports = parseImports(testUnusedRsContent);
      const uniqueImports = removeDuplicateImports(imports);
      const usedImports = removeUnusedImports(uniqueImports, testUnusedRsContent);
      const organized = organizeImports(usedImports);
      
      // Format all imports with collapseSingle=true to collapse grouped imports with single items
      const formattedStdImports = organized.stdImports.map(imp => formatImport(imp, true));
      const formattedExternalImports = organized.externalImports.map(imp => formatImport(imp, true));
      const formattedLocalImports = organized.localImports.map(imp => formatImport(imp, true));
      
      // The std::path import should be collapsed to use std::path::Path;
      expect(formattedStdImports).toContain('use std::path::Path;');
      
      // Verify all formatted imports
      const allFormatted = [
        ...formattedStdImports,
        ...formattedExternalImports,
        ...formattedLocalImports
      ];
      
      // Should have 7 formatted imports total
      expect(allFormatted.length).toBe(7);
      
      // All grouped imports with single items should be collapsed
      // std::path::{Path, PathBuf} became std::path::Path
      // std::collections::HashMap stays as is (simple import)
      // etc.
    });

    it('should NOT keep unused local imports (module, process_data)', () => {
      const testUnusedRsContent = readTestFile('test-unused.rs');
      const imports = parseImports(testUnusedRsContent);
      const uniqueImports = removeDuplicateImports(imports);
      const usedImports = removeUnusedImports(uniqueImports, testUnusedRsContent);
      
      // Get all modules that are kept
      const usedModules = usedImports.map(imp => imp.module);
      
      // These should NOT be in the used imports (they are unused)
      expect(usedModules).not.toContain('crate::internal');
      expect(usedModules).not.toContain('crate::utils::helpers');
      
      // Only these 7 should be kept
      expect(usedImports.length).toBe(7);
    });
  });
});