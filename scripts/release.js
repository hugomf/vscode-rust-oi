#!/usr/bin/env node
/**
 * scripts/release.js
 *
 * The one command to cut a release. Run locally:
 *   node scripts/release.js patch    → 0.2.6 → 0.2.7
 *   node scripts/release.js minor    → 0.2.6 → 0.3.0
 *   node scripts/release.js major    → 0.2.6 → 1.0.0
 *   node scripts/release.js 0.2.8    → explicit version
 *
 * What it does:
 *   1. Ensures git working tree is clean (no uncommitted changes)
 *   2. Runs the full test suite — aborts if anything fails
 *   3. Bumps the version in package.json
 *   4. Prepends a CHANGELOG entry for the new version
 *   5. Commits: "chore: release v0.2.7"
 *   6. Tags:    v0.2.7
 *   7. Pushes the commit + tag → GitHub Actions takes it from there
 *
 * The push of the tag triggers the `publish` job in ci.yml, which:
 *   - Re-runs the full test suite
 *   - Packages the .vsix
 *   - Publishes to the VS Code Marketplace
 *   - Creates a GitHub Release with the .vsix attached
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── helpers ─────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
    console.log(`  $ ${cmd}`);
    return execSync(cmd, { stdio: opts.quiet ? 'pipe' : 'inherit', encoding: 'utf-8' });
}

function die(msg) {
    console.error(`\nError: ${msg}`);
    process.exit(1);
}

// ─── parse bump type ─────────────────────────────────────────────────────────

const bump = process.argv[2];
if (!bump) {
    die('Usage: node scripts/release.js <patch|minor|major|x.y.z>');
}

// ─── check git is clean ───────────────────────────────────────────────────────

console.log('\n1. Checking git status...');
const status = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
if (status) {
    die(`Working tree has uncommitted changes:\n${status}\n\nCommit or stash before releasing.`);
}

const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
if (!['main', 'master'].includes(branch)) {
    console.warn(`  Warning: releasing from branch "${branch}" (not main/master)`);
    // Not blocking — you might release from a hotfix branch intentionally
}
console.log(`  Clean — on branch ${branch}`);

// ─── run full test suite ──────────────────────────────────────────────────────

console.log('\n2. Running test suite...');
try {
    run('npm run test:ci');
} catch {
    die('Tests failed — aborting release. Fix all failures before releasing.');
}
console.log('  All tests passed');

// ─── calculate new version ────────────────────────────────────────────────────

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const current = pkg.version;
const [major, minor, patch] = current.split('.').map(Number);

let newVersion;
if (bump === 'patch') {
    newVersion = `${major}.${minor}.${patch + 1}`;
} else if (bump === 'minor') {
    newVersion = `${major}.${minor + 1}.0`;
} else if (bump === 'major') {
    newVersion = `${major + 1}.0.0`;
} else if (/^\d+\.\d+\.\d+$/.test(bump)) {
    newVersion = bump;
} else {
    die(`Unknown bump type: "${bump}". Use patch, minor, major, or x.y.z`);
}

console.log(`\n3. Bumping version: ${current} → ${newVersion}`);

// ─── update package.json ──────────────────────────────────────────────────────

pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
console.log('  Updated package.json');

// ─── prepend CHANGELOG entry ─────────────────────────────────────────────────

console.log('\n4. Updating CHANGELOG.md...');
const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
const today = new Date().toISOString().slice(0, 10);

const changelogEntry = `## [${newVersion}] - ${today}\n\n### Changed\n- (fill in before committing)\n\n---\n\n`;

if (fs.existsSync(changelogPath)) {
    const existing = fs.readFileSync(changelogPath, 'utf-8');
    // Insert after the first line (the "# Change Log" heading)
    const lines = existing.split('\n');
    const insertAt = lines.findIndex(l => l.startsWith('## ['));
    if (insertAt !== -1) {
        lines.splice(insertAt, 0, ...changelogEntry.split('\n'));
        fs.writeFileSync(changelogPath, lines.join('\n'), 'utf-8');
    } else {
        fs.writeFileSync(changelogPath, existing + '\n' + changelogEntry, 'utf-8');
    }
} else {
    fs.writeFileSync(changelogPath, `# Change Log\n\n${changelogEntry}`, 'utf-8');
}
console.log('  Prepended CHANGELOG entry — edit it before the commit is pushed!');

// ─── pause and let the user edit the CHANGELOG ────────────────────────────────

const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log('\n  CHANGELOG.md has been updated with a placeholder entry.');
console.log('  Open it now, fill in the release notes, then come back.\n');

rl.question('  Press Enter when CHANGELOG is ready...', () => {
    rl.close();
    doCommitAndPush();
});

// ─── commit, tag, push ────────────────────────────────────────────────────────

function doCommitAndPush() {
    const tag = `v${newVersion}`;

    console.log(`\n5. Committing and tagging ${tag}...`);
    run(`git add package.json CHANGELOG.md`);
    run(`git commit -m "chore: release ${tag}"`);
    run(`git tag ${tag}`);

    console.log('\n6. Pushing to GitHub...');
    run('git push');
    run(`git push origin ${tag}`);

    console.log(`
─────────────────────────────────────────────────────
  Released ${tag}

  GitHub Actions will now:
    1. Run the full test suite
    2. Package the .vsix
    3. Publish to the VS Code Marketplace
    4. Create a GitHub Release with the .vsix attached

  Monitor progress at:
  https://github.com/hugomf/vscode-rust-oi/actions
─────────────────────────────────────────────────────
`);
}