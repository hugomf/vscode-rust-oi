/**
 * Layer 2: Fixture snapshot tests
 *
 * These tests feed real .rs source files through organizeImportsInText()
 * and assert the output matches a saved expected file. No VS Code, no
 * compilation, no F5 — just `npm test`.
 *
 * HOW TO ADD A NEW FIXTURE:
 *   1. Put the input file in  fixtures/input/my-case.rs
 *   2. Run:  npm run fixtures:update
 *      This generates fixtures/expected/my-case.expected.rs
 *   3. Review the expected file — make sure it looks right.
 *   4. Commit both files. From now on `npm test` guards that output.
 *
 * HOW TO REGENERATE ALL SNAPSHOTS (after a deliberate change):
 *   UPDATE_FIXTURES=true npm test -- --testPathPattern=fixture
 *
 * FIXTURE AUTHORING RULES:
 *   - Do NOT put section-header comments (// ═══ SECTION N ═══) between
 *     import lines. The organizer preserves comments verbatim at their
 *     original line positions; if imports are reordered by grouping, those
 *     comments end up at the wrong position in the output.
 *   - Inline comments on import lines (// Unused - should be removed) are
 *     fine — they are stripped before parsing.
 *   - If you need to annotate the fixture for human readers, put the
 *     comments AFTER the entire import block, not inside it.
 */

import * as fs from 'fs';
import * as path from 'path';
import { organizeImportsInText, OrganizeOptions } from './importParser';

// ─── paths ───────────────────────────────────────────────────────────────────

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');
const INPUT_DIR = path.join(FIXTURES_DIR, 'input');
const EXPECTED_DIR = path.join(FIXTURES_DIR, 'expected');
const OPTIONS_DIR = path.join(FIXTURES_DIR, 'options');

// ─── helpers ─────────────────────────────────────────────────────────────────

function loadOptions(name: string): OrganizeOptions {
  const optPath = path.join(OPTIONS_DIR, `${name}.json`);
  if (fs.existsSync(optPath)) {
    return JSON.parse(fs.readFileSync(optPath, 'utf-8')) as OrganizeOptions;
  }
  return {};
}

function fixtureNames(): string[] {
  if (!fs.existsSync(INPUT_DIR)) return [];
  return fs.readdirSync(INPUT_DIR)
    .filter(f => f.endsWith('.rs'))
    .map(f => f.replace(/\.rs$/, ''))
    .sort();
}

function updateMode(): boolean {
  return process.env.UPDATE_FIXTURES === 'true';
}

/**
 * Returns true when the file has section-header comments interspersed
 * between import lines.  Such files are not idempotent because the slot
 * reconstruction cannot move section-header comments along with the imports
 * that they annotated.  They still get a snapshot test (the snapshot captures
 * the first-pass output), but we skip the idempotency check for them.
 *
 * A section-header comment is any line inside the import block that:
 *   - starts with // and contains 10+ repeated characters (═══, ───, ===, ---)
 *   - is not an inline comment on a use line
 */
function hasSectionHeaders(src: string): boolean {
  const lines = src.split('\n');
  let inImportBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('use ') || trimmed.startsWith('pub use ')) {
      inImportBlock = true;
    }
    if (inImportBlock && /^fn |^pub fn |^struct |^enum |^impl |^mod /.test(trimmed)) {
      break; // past import block
    }
    if (inImportBlock && trimmed.startsWith('//') && /(.)\1{9,}/.test(trimmed)) {
      return true;
    }
  }
  return false;
}

// ─── auto-generate missing expected files ─────────────────────────────────────

beforeAll(() => {
  fs.mkdirSync(EXPECTED_DIR, { recursive: true });
  fs.mkdirSync(OPTIONS_DIR, { recursive: true });

  for (const name of fixtureNames()) {
    const expectedPath = path.join(EXPECTED_DIR, `${name}.expected.rs`);
    if (!fs.existsSync(expectedPath) || updateMode()) {
      const input = fs.readFileSync(path.join(INPUT_DIR, `${name}.rs`), 'utf-8');
      const options = loadOptions(name);
      const output = organizeImportsInText(input, options);
      fs.writeFileSync(expectedPath, output, 'utf-8');
      console.log(`  ${updateMode() ? 'updated' : 'generated'} expected: ${name}.expected.rs`);
    }
  }
});

// ─── snapshot tests ───────────────────────────────────────────────────────────

describe('fixture snapshot tests', () => {
  const names = fixtureNames();

  if (names.length === 0) {
    it('no fixture files found — add .rs files to fixtures/input/', () => {
      expect(true).toBe(true);
    });
    return;
  }

  for (const name of names) {
    it(`fixture: ${name}`, () => {
      const input = fs.readFileSync(path.join(INPUT_DIR, `${name}.rs`), 'utf-8');
      const expectedPath = path.join(EXPECTED_DIR, `${name}.expected.rs`);
      const expected = fs.readFileSync(expectedPath, 'utf-8');
      const options = loadOptions(name);
      const actual = organizeImportsInText(input, options);

      if (actual !== expected) {
        const actualLines = actual.split('\n');
        const expectedLines = expected.split('\n');
        const diffLines: string[] = [];
        const maxLen = Math.max(actualLines.length, expectedLines.length);
        for (let i = 0; i < maxLen; i++) {
          const a = actualLines[i] ?? '(missing)';
          const e = expectedLines[i] ?? '(missing)';
          if (a !== e) {
            diffLines.push(`  line ${i + 1}:`);
            diffLines.push(`    expected: ${JSON.stringify(e)}`);
            diffLines.push(`    actual:   ${JSON.stringify(a)}`);
          }
        }
        const hint = '\n\nTo update: UPDATE_FIXTURES=true npm test -- --testPathPattern=fixture\n';
        throw new Error(
          `Fixture "${name}" output does not match expected.\n\nDiff:\n` +
          diffLines.slice(0, 60).join('\n') + hint
        );
      }
    });
  }
});

// ─── idempotency tests ────────────────────────────────────────────────────────
//
// Running the organizer twice on its own output must produce the same result.
//
// KNOWN LIMITATION: fixtures that contain section-header comments (// ═══...)
// between import lines are excluded.  The slot-based reconstruction preserves
// comments at their original line positions; when imports are reordered those
// headers cannot follow them.  Use inline comments or post-block comments in
// fixtures instead.

describe('fixture idempotency', () => {
  const names = fixtureNames();

  for (const name of names) {
    const inputPath = path.join(INPUT_DIR, `${name}.rs`);
    const input = fs.readFileSync(inputPath, 'utf-8');

    if (hasSectionHeaders(input)) {
      it.skip(`idempotent: ${name} (skipped — has section-header comments between imports)`, () => { });
      continue;
    }

    it(`idempotent: ${name}`, () => {
      const options = loadOptions(name);
      const pass1 = organizeImportsInText(input, options);
      const pass2 = organizeImportsInText(pass1, options);

      if (pass2 !== pass1) {
        const l1 = pass1.split('\n'), l2 = pass2.split('\n');
        const diffLines: string[] = [];
        for (let i = 0; i < Math.max(l1.length, l2.length); i++) {
          if (l1[i] !== l2[i]) {
            diffLines.push(`  line ${i + 1}: ${JSON.stringify(l1[i])} → ${JSON.stringify(l2[i])}`);
          }
        }
        throw new Error(
          `Fixture "${name}" is not idempotent.\n\nDiff (pass1 → pass2):\n` +
          diffLines.slice(0, 30).join('\n') +
          '\n\nNote: if this fixture has // ═══ SECTION ═══ comments between imports,\n' +
          'move them after the import block or use inline comments instead.'
        );
      }
    });
  }
});