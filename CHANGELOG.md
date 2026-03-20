# Change Log

All notable changes to the "rust-import-organizer" extension will be documented in this file.

## [0.1.0] - 2026-03-19

### Added
- Initial release of Rust Import Organizer
- Automatic import organization for Rust files
- Smart grouping of imports into three categories:
  - Standard library imports (std::*)
  - External crate imports
  - Local imports (crate::*, super::*, self::*)
- Alphabetical sorting within each group
- Duplicate import removal
- Multi-line import support
- Configurable settings:
  - `groupImports`: Enable/disable import grouping
  - `sortAlphabetically`: Enable/disable alphabetical sorting
  - `blankLineBetweenGroups`: Add blank lines between import groups
  - `collapseSingleImports`: Collapse single-item imports
- Keyboard shortcut: Shift+Alt+O (Shift+Option+O on macOS)
- Command palette integration: "Organize Rust Imports"

## [Unreleased]

### Planned Features
- Auto-organize on save (optional)
- Custom import grouping rules
- Support for external configuration files
- Integration with rustfmt
- More granular sorting options