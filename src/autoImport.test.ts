// autoImport.test.ts
//
// The VS Code API is not available in Jest — we mock the entire `vscode` module
// and reconstruct only the parts autoImport.ts actually touches.

import { ImportCandidate } from './autoImport';

// ─────────────────────────────────────────────────────────────────────────────
// VS Code API mock
// ─────────────────────────────────────────────────────────────────────────────

// Captured calls so tests can assert on them
const appliedEdits: any[] = [];
const executedCommands: string[] = [];
let quickPickResult: any = undefined;   // set per-test
let codeActionsResult: any[] = [];          // set per-test
let diagnosticsResult: any[] = [];          // set per-test

jest.mock('vscode', () => {
    class Range {
        constructor(
            public start: any,
            public end: any,
        ) { }
    }
    class Position {
        constructor(public line: number, public character: number) { }
    }
    const CodeActionKind = {
        QuickFix: { value: 'quickfix' },
        SourceOrganizeImports: { value: 'source.organizeImports' },
    };
    return {
        Range,
        Position,
        CodeActionKind,
        languages: {
            getDiagnostics: (_uri: any) => diagnosticsResult,
        },
        commands: {
            executeCommand: async (cmd: string, ...args: any[]) => {
                executedCommands.push(cmd);
                if (cmd === 'vscode.executeCodeActionProvider') {
                    return codeActionsResult;
                }
                return undefined;
            },
        },
        workspace: {
            applyEdit: async (edit: any) => {
                appliedEdits.push(edit);
                return true;
            },
        },
        window: {
            showQuickPick: async (_items: any[], _opts: any) => quickPickResult,
        },
        Uri: { file: (p: string) => ({ fsPath: p, toString: () => p }) },
    };
}, { virtual: true });

// Import AFTER mock is registered
import { runAutoImport } from './autoImport';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeDocument(text = '') {
    return {
        uri: { fsPath: '/fake/src/main.rs', toString: () => '/fake/src/main.rs' },
        languageId: 'rust',
        getText: () => text,
        getText2: (range: any) => '',
    } as any;
}

function makeCodeAction(title: string, importPath: string): any {
    return {
        title,
        kind: { value: 'quickfix' },
        edit: { _fake: `edit:${importPath}` },
        command: undefined,
    };
}

function makeDiagnostic(code: string, message: string, line = 0): any {
    return {
        range: { start: { line, character: 0 }, end: { line, character: 5 } },
        message,
        code: { value: code },
        severity: 0,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reset state between tests
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
    appliedEdits.length = 0;
    executedCommands.length = 0;
    quickPickResult = undefined;
    codeActionsResult = [];
    diagnosticsResult = [];
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. No diagnostics → nothing to do
// ─────────────────────────────────────────────────────────────────────────────

describe('runAutoImport — no unresolved symbols', () => {
    it('returns empty result when there are no diagnostics', async () => {
        diagnosticsResult = [];
        const result = await runAutoImport(makeDocument());
        expect(result.added).toHaveLength(0);
        expect(result.skipped).toHaveLength(0);
        expect(result.failed).toHaveLength(0);
    });

    it('ignores non-unresolved diagnostics (e.g. warnings)', async () => {
        diagnosticsResult = [
            makeDiagnostic('unused_variables', 'unused variable: `x`'),
        ];
        const result = await runAutoImport(makeDocument());
        expect(result.added).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Single unambiguous candidate → auto-apply
// ─────────────────────────────────────────────────────────────────────────────

describe('runAutoImport — single candidate (unambiguous)', () => {
    it('applies the import and reports it as added', async () => {
        diagnosticsResult = [
            makeDiagnostic('E0412', 'cannot find type `HashMap` in this scope'),
        ];
        codeActionsResult = [
            makeCodeAction('Import `std::collections::HashMap`', 'std::collections::HashMap'),
        ];

        const result = await runAutoImport(makeDocument());

        expect(result.added).toEqual(['std::collections::HashMap']);
        expect(result.skipped).toHaveLength(0);
        expect(result.failed).toHaveLength(0);
        expect(appliedEdits).toHaveLength(1);
    });

    it('handles "Add `use ...`" style titles', async () => {
        diagnosticsResult = [
            makeDiagnostic('E0433', 'failed to resolve: use of undeclared crate or module `serde`'),
        ];
        codeActionsResult = [
            makeCodeAction('Add `use serde::Serialize;`', 'serde::Serialize'),
        ];

        const result = await runAutoImport(makeDocument());
        expect(result.added).toEqual(['serde::Serialize']);
    });

    it('deduplicates the same symbol appearing multiple times in diagnostics', async () => {
        diagnosticsResult = [
            makeDiagnostic('E0412', 'cannot find type `HashMap`', 0),
            makeDiagnostic('E0412', 'cannot find type `HashMap`', 3),
        ];
        codeActionsResult = [
            makeCodeAction('Import `std::collections::HashMap`', 'std::collections::HashMap'),
        ];

        const result = await runAutoImport(makeDocument());
        // Should only add once despite two diagnostics for the same symbol
        expect(result.added).toHaveLength(1);
        expect(appliedEdits).toHaveLength(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Multiple candidates → disambiguation QuickPick
// ─────────────────────────────────────────────────────────────────────────────

describe('runAutoImport — multiple candidates (disambiguation)', () => {
    const errorAction = makeCodeAction('Import `anyhow::Error`', 'anyhow::Error');
    const stdErrAction = makeCodeAction('Import `std::error::Error`', 'std::error::Error');
    const serdeErrAction = makeCodeAction('Import `serde_json::Error`', 'serde_json::Error');

    beforeEach(() => {
        diagnosticsResult = [
            makeDiagnostic('E0412', 'cannot find type `Error` in this scope'),
        ];
        codeActionsResult = [errorAction, stdErrAction, serdeErrAction];
    });

    it('shows a QuickPick when there are multiple candidates', async () => {
        // User picks the first option
        quickPickResult = {
            label: '$(package) anyhow::Error',
            candidate: { importPath: 'anyhow::Error', symbol: 'Error', action: errorAction },
        };

        const result = await runAutoImport(makeDocument());
        expect(result.added).toEqual(['anyhow::Error']);
        expect(appliedEdits).toHaveLength(1);
    });

    it('reports skipped when user dismisses the QuickPick (Escape)', async () => {
        quickPickResult = undefined; // Escape returns undefined

        const result = await runAutoImport(makeDocument());
        expect(result.skipped).toEqual(['Error']);
        expect(result.added).toHaveLength(0);
        expect(appliedEdits).toHaveLength(0);
    });

    it('applies the user-chosen import when they pick the second option', async () => {
        quickPickResult = {
            label: '$(package) std::error::Error',
            candidate: { importPath: 'std::error::Error', symbol: 'Error', action: stdErrAction },
        };

        const result = await runAutoImport(makeDocument());
        expect(result.added).toEqual(['std::error::Error']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. No suggestions from rust-analyzer → failed
// ─────────────────────────────────────────────────────────────────────────────

describe('runAutoImport — no suggestions available', () => {
    it('reports symbol as failed when rust-analyzer returns no actions', async () => {
        diagnosticsResult = [
            makeDiagnostic('E0412', 'cannot find type `MyMissingType`'),
        ];
        codeActionsResult = []; // rust-analyzer has no suggestion

        const result = await runAutoImport(makeDocument());
        // When getText(range) returns '' (mock), fallback key is used
        expect(result.failed).toHaveLength(1);
        expect(result.added).toHaveLength(0);
    });

    it('reports failed when rust-analyzer returns actions that are not import actions', async () => {
        diagnosticsResult = [
            makeDiagnostic('E0412', 'cannot find type `Foo`'),
        ];
        // These are real rust-analyzer actions but not import suggestions
        codeActionsResult = [
            makeCodeAction('Create struct `Foo`', 'Foo'),
            makeCodeAction('Change to `foo` (a local)', 'foo'),
        ];

        const result = await runAutoImport(makeDocument());
        // When no import actions exist, symbol is tracked by fallback key
        expect(result.failed).toHaveLength(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Mixed scenario — some auto-resolved, some disambiguated, some failed
// ─────────────────────────────────────────────────────────────────────────────

describe('runAutoImport — mixed scenario', () => {
    it('handles all three outcomes in a single file', async () => {
        // HashMap (line 0) → unambiguous
        // Error   (line 1) → ambiguous, user picks anyhow::Error
        // Ghost   (line 2) → no suggestions

        const hashMapAction = makeCodeAction('Import `std::collections::HashMap`', 'std::collections::HashMap');
        const errAction1 = makeCodeAction('Import `anyhow::Error`', 'anyhow::Error');
        const errAction2 = makeCodeAction('Import `std::error::Error`', 'std::error::Error');

        diagnosticsResult = [
            makeDiagnostic('E0412', 'cannot find type `HashMap`', 0),
            makeDiagnostic('E0412', 'cannot find type `Error`', 1),
            makeDiagnostic('E0412', 'cannot find type `Ghost`', 2),
        ];

        // Route code actions by the range's start line
        const vscode = require('vscode');
        const origExecute = vscode.commands.executeCommand;
        vscode.commands.executeCommand = async (cmd: string, ...args: any[]) => {
            if (cmd !== 'vscode.executeCodeActionProvider') return origExecute(cmd, ...args);
            const range = args[1]; // second arg is the range
            const line = range?.start?.line ?? -1;
            if (line === 0) return [hashMapAction];
            if (line === 1) return [errAction1, errAction2];
            return []; // Ghost
        };

        // User picks anyhow::Error for the disambiguation
        quickPickResult = {
            label: '$(package) anyhow::Error',
            candidate: { importPath: 'anyhow::Error', symbol: 'Error', action: errAction1 },
        };

        const result = await runAutoImport(makeDocument());

        // Restore
        vscode.commands.executeCommand = origExecute;

        expect(result.added.sort()).toEqual(['anyhow::Error', 'std::collections::HashMap'].sort());
        expect(result.skipped).toHaveLength(0);
        expect(result.failed.length).toBe(1); // Ghost
        expect(appliedEdits).toHaveLength(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Diagnostic code matching
// ─────────────────────────────────────────────────────────────────────────────

describe('diagnostic code matching', () => {
    const codes = ['E0412', 'E0422', 'E0425', 'E0433', 'unresolved-import', 'unresolved-use'];

    for (const code of codes) {
        it(`recognises diagnostic code ${code}`, async () => {
            diagnosticsResult = [makeDiagnostic(code, `unresolved: Foo`)];
            codeActionsResult = [makeCodeAction('Import `some::Foo`', 'some::Foo')];
            const result = await runAutoImport(makeDocument());
            expect(result.added).toEqual(['some::Foo']);
        });
    }

    it('matches on message text when code is not in the known set', async () => {
        diagnosticsResult = [{
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
            message: 'cannot find value `foo` in this scope',
            code: { value: 'unknown_code' },
            severity: 0,
        }];
        codeActionsResult = [makeCodeAction('Import `some::foo`', 'some::foo')];
        const result = await runAutoImport(makeDocument());
        expect(result.added).toEqual(['some::foo']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. importPath extraction from various title formats
// ─────────────────────────────────────────────────────────────────────────────

describe('import path extraction', () => {
    const cases: [string, string][] = [
        ['Import `std::collections::HashMap`', 'std::collections::HashMap'],
        ['Add `use serde::Serialize;`', 'serde::Serialize'],
        ['Import `tokio::runtime::Runtime`', 'tokio::runtime::Runtime'],
        ['Add `use crate::config::Settings;`', 'crate::config::Settings'],
    ];

    for (const [title, expectedPath] of cases) {
        it(`extracts "${expectedPath}" from title "${title}"`, async () => {
            diagnosticsResult = [makeDiagnostic('E0412', 'unresolved')];
            codeActionsResult = [makeCodeAction(title, expectedPath)];
            const result = await runAutoImport(makeDocument());
            expect(result.added).toEqual([expectedPath]);
        });
    }
});