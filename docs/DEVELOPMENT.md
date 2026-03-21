# Development Guide

This document provides comprehensive instructions for developing the Rust Import Organizer VS Code extension.

## Prerequisites

- Node.js v16 or higher
- npm
- VS Code (for development and testing)

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/hugomf/vscode-rust-oi.git
   cd vscode-rust-oi
   ```

2. Install dependencies:
   ```bash
   npm install
   ```


## Understand the Code

* Review the Main Parser Architecture document [IMPORT_PARSER.md](./IMPORT_PARSER.md).

* Add your fix / new feature.

## Building

Compile the TypeScript code to JavaScript:
```bash
npm run compile
```

## Testing

### Running All Tests

Execute the complete test suite:
```bash
npm test
```

### Test Coverage

The test suite has 399 tests across six files:

| File | Tests | What it covers |
|------|-------|---------------|
| `importParser.test.ts` | ~169 | Parsing, categorization, sorting, merging, formatting, unused removal, cfg imports, Cargo classification, comment preservation, custom groups, pub use placement, preserve mode |
| `extension.test.ts` | ~55 | All configuration settings, organize-on-save pipeline, range-fix regression, bug regressions |
| `autoImport.test.ts` | 22 | Diagnostic scanning, candidate fetching, single-match auto-apply, multi-match disambiguation |
| `cargoParser.test.ts` | 30 | Cargo.toml parsing, workspace member extraction, dep normalisation, `classifyWithCargo` |
| `cargoWorkspace.test.ts` | 10 | VS Code filesystem adapter, Cargo.toml discovery |
| `stress_test.test.ts` | 45 | Edge cases: raw identifiers, nested braces, CRLF, shebang, 50-import files, real-world patterns |
| `fixture.test.ts` | 6 | Comprehensive fixture snapshot tests with real-world Rust code patterns, alias handling, nested imports, and unused import detection |

### Running Specific Test Files

Run tests for a specific module:
```bash
npm test -- --testPathPattern=importParser
npm test -- --testPathPattern=extension
npm test -- --testPathPattern=autoImport
npm test -- --testPathPattern=cargoParser
npm test -- --testPathPattern=stress
npm test -- --testPathPattern=fixture
```

### Fixture Tests

Fixture tests use real Rust code files to validate import organization behavior:

- **Location**: `fixtures/input/` and `fixtures/expected/`
- **Update expected outputs**: `UPDATE_FIXTURES=true npm test -- --testPathPattern=fixture`
- **Add new fixture**: Create `fixtures/input/my-case.rs`, then run the update command to generate the expected output

## Architecture

```
extension.ts         VS Code adapter — commands, keybindings, Code Actions, on-save hook
autoImport.ts        Rust Analyzer integration — diagnostic scanning, candidate fetching, QuickPick
importParser.ts      All parsing and transformation logic — no VS Code dependency, fully testable
cargoParser.ts       Cargo.toml parser — pure TypeScript, no VS Code dependency
cargoWorkspace.ts    VS Code adapter for cargoParser — reads Cargo.toml via the filesystem API
```

### Core API

The `importParser.ts` module provides the main public API:

| Export | Purpose |
|--------|---------|
| `organizeImportsInText(text, options)` | Main entry point — runs the full pipeline and returns the transformed source |
| `buildOrganizedText(used, all, text, options)` | Rebuilds source text using `all` for range calculation |
| `parseImports(text)` | Parses all `use` statements from a Rust source string |
| `removeUnusedImports(imports, text)` | Filters to only imports referenced in the code |
| `removeDuplicateImports(imports)` | Removes exact duplicates |
| `mergeImports(imports)` | Combines separate same-module imports into a single grouped import |
| `organizeImports(imports, externalCrates?, localCrates?, pubUsePlacement?)` | Splits into std / external / local / pubUse / cfg buckets |
| `sortImports(imports)` | Sorts by module path |
| `formatImport(imp, collapseSingle)` | Formats a single import statement as a string |
| `categorizeImport(module, externalCrates?, localCrates?)` | Returns `'std'`, `'external'`, or `'local'` |
| `findMidFilePubUse(text)` | Finds `pub use` statements outside the top-level import block |

## Making Changes

### 1. Understand the Code Structure

- **VS Code integration**: `extension.ts` - handles commands, keybindings, and VS Code APIs
- **Core logic**: `importParser.ts` - pure TypeScript logic, fully testable without VS Code
- **Auto-import**: `autoImport.ts` - Rust Analyzer integration for adding missing imports
- **Cargo support**: `cargoParser.ts` and `cargoWorkspace.ts` - workspace and dependency analysis

### 2. Write Tests First

For new features or bug fixes:

1. **Add unit tests** to the appropriate test file
2. **Add integration tests** if needed
3. **Add fixture tests** for complex real-world scenarios

### 3. Implement the Feature

1. **Start with core logic** in `importParser.ts` (if applicable)
2. **Update VS Code integration** in `extension.ts` (if needed)
3. **Ensure backward compatibility** with existing settings and behavior

### 4. Test Thoroughly

1. **Run unit tests**: `npm test`
2. **Test manually** in VS Code development host
3. **Test edge cases** with fixture files

## Adding New Tests

### Unit Tests

Add tests to the appropriate file:

- **Parser logic**: `importParser.test.ts`
- **VS Code integration**: `extension.test.ts`
- **Auto-import**: `autoImport.test.ts`
- **Cargo parsing**: `cargoParser.test.ts`
- **Workspace integration**: `cargoWorkspace.test.ts`

Example test structure:
```typescript
describe('feature name', () => {
  it('should handle basic case', () => {
    // Test implementation
  });

  it('should handle edge case', () => {
    // Test implementation
  });
});
```

### Fixture Tests

For comprehensive real-world testing:

1. Create input file: `fixtures/input/my-feature.rs`
2. Run: `UPDATE_FIXTURES=true npm test -- --testPathPattern=fixture`
3. Review generated: `fixtures/expected/my-feature.expected.rs`
4. Commit both files

### Stress Tests

For edge cases and performance:
- Add to `stress_test.test.ts`
- Test with large files, unusual syntax, or complex scenarios

## Manual Testing

### Running Locally

1. Open the project in VS Code
2. Press `F5` to launch an Extension Development Host window
3. Open any `.rs` file and test the extension

### Testing Commands

Available commands in the development host:
- `Organize Rust Imports`
- `Organize Rust Imports + Auto Import`

### Testing Keyboard Shortcuts

- Windows/Linux: `Shift+Alt+O`
- macOS: `Shift+Option+O`

### Testing Context Menu

Right-click in a Rust file to access the commands.

## Code Style and Best Practices

### TypeScript Guidelines

- Use strict TypeScript configuration
- Write type-safe code
- Include JSDoc comments for public APIs
- Follow existing code patterns

### Testing Guidelines

- **Unit tests**: Test individual functions in isolation
- **Integration tests**: Test VS Code integration
- **Fixture tests**: Test with real Rust code
- **Stress tests**: Test edge cases and performance

### Architecture Guidelines

- **Separation of concerns**: Keep VS Code logic separate from core parsing logic
- **Pure functions**: Core logic should be testable without VS Code
- **Error handling**: Graceful handling of malformed input
- **Performance**: Efficient parsing for large files

## Releasing

### Automated Release Process

The project includes an automated release script that handles version bumping, changelog updates, and publishing:

```bash
# Bump version automatically
node scripts/release.js patch    # 0.2.6 → 0.2.7
node scripts/release.js minor    # 0.2.6 → 0.3.0
node scripts/release.js major    # 0.2.6 → 1.0.0

# Or specify explicit version
node scripts/release.js 0.2.8
```

**What the release script does:**
1. Ensures git working tree is clean
2. Runs the full test suite
3. Bumps version in `package.json`
4. Prepends a CHANGELOG entry for the new version
5. Commits with message: "chore: release v0.2.7"
6. Creates git tag: `v0.2.7`
7. Pushes commit and tag to GitHub

### Manual Release Process

If you prefer manual control or need to customize the release:

#### Version Bump

1. **Update version in `package.json`**:
   ```json
   {
     "version": "0.2.7"
   }
   ```

2. **Update `CHANGELOG.md`**:
   - Add new version section at the top
   - Document changes, new features, and bug fixes
   - Use the format: `## [0.2.7] - YYYY-MM-DD`

3. **Update `README.md`** if needed (version numbers in examples, etc.)

#### Build and Package

1. **Clean build**:
   ```bash
   npm run clean
   npm run compile
   ```

2. **Run full test suite**:
   ```bash
   npm test
   ```

3. **Package extension**:
   ```bash
   npm run package
   ```

#### Publishing

1. **Create GitHub release** with changelog
2. **Publish to VS Code Marketplace** using `vsce`:
   ```bash
   vsce publish --no-dependencies -p "$VSCE_PAT"
   ```
   (Requires VSCE_PAT environment variable with marketplace token)

3. **Update documentation** if needed

### Pre-release Checklist

- [ ] All tests pass
- [ ] Manual testing completed
- [ ] Changelog updated with meaningful release notes
- [ ] Version bumped in package.json
- [ ] Documentation updated
- [ ] No breaking changes (or properly documented)
- [ ] Extension packages successfully
- [ ] Release script or manual process completed
- [ ] GitHub Actions CI passes on release tag

## Debugging

### VS Code Debugging

1. Set breakpoints in the extension code
2. Press `F5` to launch development host
3. Use the Debug Console for inspection

### Logging

Use VS Code's output channels for debugging:
```typescript
const outputChannel = vscode.window.createOutputChannel('Rust Import Organizer');
outputChannel.appendLine('Debug message');
```

### Common Issues

- **Import parsing fails**: Check for malformed Rust syntax
- **Auto-import not working**: Verify Rust Analyzer is installed and working
- **Settings not applying**: Check VS Code settings and extension activation

## Contributing

### Pull Request Guidelines

1. **Open an issue first** to discuss significant changes
2. **Write tests** for new functionality
3. **Update documentation** for user-facing changes
4. **Follow existing code style**
5. **Ensure all tests pass**

### Code Review Process

- Tests are required for new features
- Documentation updates needed for user-facing changes
- Performance impact considered for large file handling
- Backward compatibility maintained

## Performance Considerations

### Large Files

- Import parsing should be efficient for files with 100+ imports
- Use streaming or chunked processing for very large files
- Avoid blocking the UI thread

### Memory Usage

- Clean up temporary data structures
- Use efficient data structures for import tracking
- Consider garbage collection impact

### Responsiveness

- Provide progress indicators for long operations
- Allow cancellation of long-running operations
- Use async/await for non-blocking operations

## Continuous Integration (CI)

The project uses GitHub Actions for automated testing, building, and deployment.

### CI Workflow Overview

The CI pipeline consists of four main jobs that run on every push and pull request:

1. **Unit & Snapshot Tests** (`unit-tests`)
   - Runs on Ubuntu latest
   - Installs Node.js 20 and npm dependencies
   - Executes full test suite: `npm test -- --ci --forceExit`
   - Tests all core functionality including parsing, formatting, and fixture validation

2. **Integration Tests** (`integration`)
   - Runs after unit tests complete successfully
   - Installs Rust toolchain and Cargo dependencies
   - Runs CLI integration tests and cargo check validation
   - Ensures the extension works correctly with real Rust projects

3. **Build & Package** (`package`)
   - Compiles TypeScript code
   - Packages the extension as a `.vsix` file
   - Uploads the `.vsix` as a build artifact for manual testing
   - Available for download from the Actions run page

4. **Publish to Marketplace** (`publish`) - Conditional
   - Only runs when a version tag is pushed (e.g., `v0.2.7`)
   - Or when manually triggered with `publish=true`
   - Publishes to VS Code Marketplace using VSCE_PAT token
   - Creates GitHub Release with the `.vsix` attached

### CI Triggers

- **Push to main/master/develop**: Runs CI only (tests + build, no publish)
- **Pull request**: Runs CI only
- **Push version tag** (`v*.*.*`): Runs CI + package + publish to Marketplace
- **Manual dispatch**: Can trigger with optional publish flag

### CI Environment

- **Node.js**: Version 20
- **Rust**: Stable toolchain
- **Caching**: Cargo dependencies cached for faster builds
- **Concurrency**: Cancels in-progress runs on new commits

### CI Secrets

For publishing to work, the repository must have:
- `VSCE_PAT`: Personal access token for VS Code Marketplace
  - Scope: Marketplace → Manage
  - Generated at: https://dev.azure.com → User settings → Personal access tokens

### Monitoring CI

- View CI status: https://github.com/hugomf/vscode-rust-oi/actions
- Download `.vsix` artifacts for manual testing
- Monitor marketplace publishing in the `publish` job logs

### Local CI Testing

To run the same tests that CI executes:

```bash
# Run full test suite (same as CI)
npm test -- --ci --forceExit

# Run integration tests
bash scripts/integration-test.sh

# Build and package (same as CI)
npm run compile
npm run package
```

### CI Best Practices

- **Keep tests fast**: CI should complete within reasonable time
- **Use caching**: Dependencies are cached to speed up builds
- **Fail fast**: Unit tests run before integration tests
- **Artifact retention**: `.vsix` files kept for 30 days
- **Environment isolation**: Each job runs on fresh Ubuntu environment
