# Quick Development Guide

This guide provides quick instructions for common development tasks including using the release script.

## Quick Setup

```bash
# Clone and setup
git clone https://github.com/hugomf/vscode-rust-oi.git
cd vscode-rust-oi
npm install

# Build and test
npm run compile
npm test
```


## Understand the Code

* Review the Main Parser Architecture document [IMPORT_PARSER.md](./IMPORT_PARSER.md).

* Add your fix / new feature.

## Common Development Tasks

### Running Tests

```bash
# Run all tests
npm test

# Run specific test files
npm test -- --testPathPattern=importParser
npm test -- --testPathPattern=extension
npm test -- --testPathPattern=fixture

# Update fixture expected outputs
UPDATE_FIXTURES=true npm test -- --testPathPattern=fixture
```

### Manual Testing

```bash
# Launch VS Code development host
npm run compile
# Press F5 in VS Code to start extension development host
# Open any .rs file and test the commands
```

### Integration Testing

```bash
# Run full integration test (compiles, organizes fixtures, cargo check)
bash scripts/integration-test.sh

# Skip cargo check for faster testing
bash scripts/integration-test.sh --no-cargo
```

## Using the Release Script

The project includes an automated release script that handles version bumping, changelog updates, and publishing.

### Quick Release Commands

```bash
# Bump patch version (0.2.6 → 0.2.7)
node scripts/release.js patch

# Bump minor version (0.2.6 → 0.3.0)
node scripts/release.js minor

# Bump major version (0.2.6 → 1.0.0)
node scripts/release.js major

# Specify explicit version
node scripts/release.js 0.2.8
```

### What the Release Script Does

1. **Checks git status** - Ensures working tree is clean
2. **Runs tests** - Executes full test suite (`npm run test:ci`)
3. **Bumps version** - Updates `package.json` version
4. **Updates changelog** - Prepends new version entry to `CHANGELOG.md`
5. **Commits changes** - Creates commit with message "chore: release v0.2.7"
6. **Creates tag** - Tags with `v0.2.7`
7. **Pushes to GitHub** - Pushes commit and tag

### Release Process Flow

```bash
# Example: patch release
node scripts/release.js patch

# Output:
# 1. Checking git status...
#   Clean — on branch main
# 2. Running test suite...
#   All tests passed
# 3. Bumping version: 0.2.6 → 0.2.7
#   Updated package.json
# 4. Updating CHANGELOG.md...
#   Prepended CHANGELOG entry — edit it before the commit is pushed!
#
#   CHANGELOG.md has been updated with a placeholder entry.
#   Open it now, fill in the release notes, then come back.
#
#   Press Enter when CHANGELOG is ready...
#
# 5. Committing and tagging v0.2.7...
# 6. Pushing to GitHub...
#
#   Released v0.2.7
#   GitHub Actions will now:
#     1. Run the full test suite
#     2. Package the .vsix
#     3. Publish to the VS Code Marketplace
#     4. Create a GitHub Release with the .vsix attached
```

### Manual Release Steps (if needed)

If you need more control over the release process:

```bash
# 1. Update version in package.json
npm version patch --no-git-tag-version

# 2. Update CHANGELOG.md manually
# Add new version section with release notes

# 3. Commit and tag
git add package.json CHANGELOG.md
git commit -m "chore: release v0.2.7"
git tag v0.2.7
git push origin main --tags

# 4. CI will automatically publish to marketplace
```

## Development Workflow

### 1. Make Changes

```bash
# Create feature branch
git checkout -b feature/new-import-grouping

# Make your changes to src/ files
# Add tests to src/*test.ts files
```

### 2. Test Changes

```bash
# Run tests
npm test

# Test manually in VS Code development host
# Press F5 and test in extension development host
```

### 3. Update Fixtures (if needed)

```bash
# If your changes affect import organization output
UPDATE_FIXTURES=true npm test -- --testPathPattern=fixture
```

### 4. Commit and Push

```bash
git add .
git commit -m "feat: add new import grouping feature"
git push origin feature/new-import-grouping
```

### 5. Create Pull Request

- Go to GitHub and create PR
- CI will run automatically
- Merge when tests pass and approved

## Troubleshooting

### Release Script Issues

```bash
# If release script fails due to untracked changes
git status  # Check for untracked files
git add .   # Add untracked files or stash them
git commit -m "WIP: temporary commit"
# Then run release script again
```

### Test Failures

```bash
# If fixture tests fail
UPDATE_FIXTURES=true npm test -- --testPathPattern=fixture

# If integration tests fail
bash scripts/integration-test.sh
```

### Build Issues

```bash
# Clean build
npm run clean
npm run compile

# Check TypeScript errors
npm run compile
```

## Quick Commands Reference

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies |
| `npm run compile` | Build TypeScript |
| `npm test` | Run all tests |
| `npm run clean` | Clean build artifacts |
| `node scripts/release.js patch` | Patch release |
| `node scripts/release.js minor` | Minor release |
| `node scripts/release.js major` | Major release |
| `bash scripts/integration-test.sh` | Full integration test |
| `UPDATE_FIXTURES=true npm test` | Update fixture expectations |

## Next Steps

- See [DEVELOPMENT.md](./DEVELOPMENT.md) for comprehensive development documentation
- See [README.md](./README.md) for user-facing documentation
- Check [CHANGELOG.md](./CHANGELOG.md) for release history