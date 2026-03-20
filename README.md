# Rust Import Organizer

A VS Code extension that automatically organizes Rust imports with intelligent grouping and sorting.

## Features

- **Automatic Import Organization**: Organizes `use` statements in Rust files
- **Smart Grouping**: Groups imports into three categories:
  - Standard library imports (`std::*`)
  - External crate imports
  - Local imports (`crate::*`, `super::*`, `self::*`)
- **Alphabetical Sorting**: Sorts imports alphabetically within each group
- **Duplicate Removal**: Automatically removes duplicate imports
- **Configurable Options**: Customize behavior through VS Code settings

## Installation

1. Open VS Code
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) to open the Command Palette
3. Type "Extensions: Install Extension"
4. Search for "Rust Import Organizer"
5. Click Install

## Usage

### Command Palette
1. Open a Rust file
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
3. Type "Organize Rust Imports"
4. Press Enter

### Keyboard Shortcut
- **Windows/Linux**: `Shift+Alt+O`
- **macOS**: `Shift+Option+O`

## Configuration

You can configure the extension through VS Code settings:

```json
{
  "rust-import-organizer.groupImports": true,
  "rust-import-organizer.sortAlphabetically": true,
  "rust-import-organizer.blankLineBetweenGroups": true,
  "rust-import-organizer.collapseSingleImports": false
}
```

### Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `groupImports` | boolean | `true` | Group imports by category (std, external, local) |
| `sortAlphabetically` | boolean | `true` | Sort imports alphabetically within groups |
| `blankLineBetweenGroups` | boolean | `true` | Add blank line between import groups |
| `collapseSingleImports` | boolean | `false` | Collapse single-item imports to one line |

## Example

### Before
```rust
use std::collections::HashMap;
use my_crate::utils::helper;
use std::io::Read;
use my_crate::models::User;
use crate::internal::module;
use std::fs::File;
```

### After (with grouping enabled)
```rust
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;

use my_crate::models::User;
use my_crate::utils::helper;

use crate::internal::module;
```

## Features in Detail

### Import Grouping
The extension categorizes imports into three groups:
1. **Standard Library**: All `std::*` imports
2. **External Crates**: All third-party crate imports
3. **Local Imports**: All `crate::*`, `super::*`, and `self::*` imports

### Alphabetical Sorting
Within each group, imports are sorted alphabetically by module path, making it easy to find specific imports.

### Duplicate Removal
If you have duplicate import statements, the extension will automatically remove them, keeping only one instance.

### Multi-line Import Support
The extension properly handles multi-line imports with grouped items:
```rust
use my_crate::{
    module1::Item1,
    module2::Item2,
    module3::Item3,
};
```

## Development

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn

### Building from Source
```bash
# Clone the repository
git clone https://github.com/hugomf/rust-import-organizer.git
cd rust-import-organizer

# Install dependencies
npm install

# Compile the extension
npm run compile

# Watch for changes during development
npm run watch
```

### Running the Extension
1. Open this project in VS Code
2. Press `F5` to launch a new VS Code window with the extension loaded
3. Open a Rust file and test the organization feature

## License

MIT License

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Issues

If you encounter any issues or have feature requests, please file them on the [GitHub Issues page](https://github.com/your-username/rust-import-organizer/issues).