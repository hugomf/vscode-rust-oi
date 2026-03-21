#!/usr/bin/env node
/**
 * src/cli.ts — command-line interface for the import organizer
 *
 * Usage:
 *   node out/cli.js [options] <file.rs>
 *   node out/cli.js [options] --stdin          (reads from stdin)
 *
 * Options:
 *   --write, -w          Overwrite the input file in place
 *   --check, -c          Exit 1 if the file would change (CI use)
 *   --no-remove-unused   Skip unused import removal
 *   --no-group           Disable grouping (flat output)
 *   --preserve           Preserve existing blank-line group boundaries
 *   --order <csv>        Custom group order, e.g. "std,tokio,axum,*,crate"
 *   --pub-use <place>    pub use placement: inline | first | last
 *   --stdin              Read source from stdin, write result to stdout
 *   --help, -h           Show this help
 *
 * Exit codes:
 *   0  — success (or file already organized when using --check)
 *   1  — file would change (--check mode) or error
 */

import * as fs from 'fs';
import * as path from 'path';
import { organizeImportsInText, OrganizeOptions } from './importParser';

// ─── arg parsing ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function flag(names: string[]): boolean {
    return names.some(n => args.includes(n));
}
function option(name: string): string | undefined {
    const idx = args.indexOf(name);
    return idx !== -1 ? args[idx + 1] : undefined;
}

if (flag(['--help', '-h']) || args.length === 0) {
    console.log(`
rust-import-organizer CLI

Usage:
  node out/cli.js [options] <file.rs>
  node out/cli.js [options] --stdin

Options:
  --write, -w         Overwrite file in place
  --check, -c         Exit 1 if file would change (for CI)
  --no-remove-unused  Skip unused import removal
  --no-group          Flat output, no grouping
  --preserve          Keep existing blank-line groups
  --order <csv>       Custom group order: "std,tokio,axum,*,crate"
  --pub-use <where>   pub use placement: inline | first | last
  --stdin             Read from stdin, write to stdout
  --help, -h          Show this help
  `.trim());
    process.exit(0);
}

// ─── build options ────────────────────────────────────────────────────────────

const options: OrganizeOptions = {
    removeUnused: !flag(['--no-remove-unused']),
    sortAlphabetically: true,
    blankLineBetweenGroups: true,
    collapseSingleImports: false,
};

if (flag(['--no-group'])) {
    options.groupImports = false;
} else if (flag(['--preserve'])) {
    options.groupImports = 'preserve';
} else {
    const order = option('--order');
    if (order) {
        options.groupImports = 'custom';
        options.importOrder = order.split(',').map(s => s.trim());
    } else {
        options.groupImports = true;
    }
}

const pubUse = option('--pub-use') as 'inline' | 'first' | 'last' | undefined;
if (pubUse) options.pubUsePlacement = pubUse;

// ─── read source ──────────────────────────────────────────────────────────────

const useStdin = flag(['--stdin']);
const inPlace = flag(['--write', '-w']);
const checkOnly = flag(['--check', '-c']);

let filePath: string | undefined;
let source: string;

if (useStdin) {
    source = fs.readFileSync('/dev/stdin', 'utf-8');
} else {
    filePath = args.find(a => !a.startsWith('-') && a.endsWith('.rs'));
    if (!filePath) {
        console.error('Error: no .rs file specified. Use --help for usage.');
        process.exit(1);
    }
    if (!fs.existsSync(filePath)) {
        console.error(`Error: file not found: ${filePath}`);
        process.exit(1);
    }
    source = fs.readFileSync(filePath, 'utf-8');
}

// ─── organize ─────────────────────────────────────────────────────────────────

let organized: string;
try {
    organized = organizeImportsInText(source, options);
} catch (err: any) {
    console.error(`Error organizing imports: ${err.message}`);
    process.exit(1);
}

// ─── output ───────────────────────────────────────────────────────────────────

const changed = organized !== source;

if (checkOnly) {
    if (changed) {
        console.error(`✗  ${filePath ?? 'stdin'} — imports are not organized`);
        process.exit(1);
    } else {
        console.log(`✓  ${filePath ?? 'stdin'} — already organized`);
        process.exit(0);
    }
}

if (inPlace && filePath) {
    if (changed) {
        fs.writeFileSync(filePath, organized, 'utf-8');
        console.log(`✓  organized: ${filePath}`);
    } else {
        console.log(`–  unchanged: ${filePath}`);
    }
} else {
    // Default: write to stdout
    process.stdout.write(organized);
}