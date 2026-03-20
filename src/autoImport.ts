import * as vscode from 'vscode';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ImportCandidate {
    /** The full import path, e.g. "std::collections::HashMap" */
    importPath: string;
    /** The symbol name being imported, e.g. "HashMap" */
    symbol: string;
    /** The raw LSP CodeAction returned by rust-analyzer */
    action: vscode.CodeAction;
}

export interface AutoImportResult {
    added: string[];
    skipped: string[];
    failed: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry: run auto-import for the whole document
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Finds all unresolved symbols in `document`, queries rust-analyzer for import
 * suggestions, auto-applies single matches, and shows a QuickPick for every
 * symbol that has more than one candidate (disambiguation).
 *
 * Returns a summary of what was added, skipped, and failed.
 */
export async function runAutoImport(
    document: vscode.TextDocument,
    progress?: vscode.Progress<{ message?: string }>
): Promise<AutoImportResult> {
    const result: AutoImportResult = { added: [], skipped: [], failed: [] };

    progress?.report({ message: 'Scanning for unresolved symbols…' });

    // ── 1. Collect all rust-analyzer diagnostics for unresolved names ──────────
    const unresolvedRanges = getUnresolvedSymbolRanges(document);
    if (unresolvedRanges.length === 0) return result;

    progress?.report({ message: `Found ${unresolvedRanges.length} unresolved symbol(s)` });

    // ── 2. For each unresolved symbol, ask rust-analyzer for import actions ────
    // Deduplicate by symbol name so we don't show the same QuickPick twice.
    const seen = new Set<string>();
    const symbolCandidates: Map<string, ImportCandidate[]> = new Map();

    for (const range of unresolvedRanges) {
        // Use the document text as the dedup key; fall back to a range-based key
        // so that the mock/test environment (where getText(range) may return '')
        // still deduplicates correctly.
        const rawWord = document.getText(range);
        const rangeKey = rawWord || `${range.start.line}:${range.start.character}`;
        if (seen.has(rangeKey)) continue;
        seen.add(rangeKey);

        const candidates = await fetchImportCandidates(document, range);

        if (candidates.length > 0) {
            // Use the symbol name derived from the first candidate's import path as
            // the canonical key — this works even when getText(range) returns empty.
            const symbol = candidates[0].symbol || rawWord || rangeKey;
            // If we already have candidates for this symbol (different range, same name)
            // merge rather than overwrite.
            if (!symbolCandidates.has(symbol)) {
                symbolCandidates.set(symbol, candidates);
            }
        } else {
            // Extract symbol from the diagnostic message as fallback
            const failedSymbol = rawWord || extractSymbolFromRange(range);
            result.failed.push(failedSymbol);
        }
    }

    // ── 3. Process each symbol ─────────────────────────────────────────────────
    for (const [symbol, candidates] of symbolCandidates) {
        progress?.report({ message: `Resolving '${symbol}'…` });

        if (candidates.length === 1) {
            // Unambiguous — apply immediately
            const applied = await applyImportAction(candidates[0].action);
            if (applied) {
                result.added.push(candidates[0].importPath);
            } else {
                result.failed.push(symbol);
            }
        } else {
            // Ambiguous — show disambiguation QuickPick
            const chosen = await disambiguate(symbol, candidates);
            if (chosen) {
                const applied = await applyImportAction(chosen.action);
                if (applied) {
                    result.added.push(chosen.importPath);
                } else {
                    result.failed.push(symbol);
                }
            } else {
                // User dismissed the picker
                result.skipped.push(symbol);
            }
        }
    }

    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostic scanning
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the ranges of all unresolved-name diagnostics in the document.
 * rust-analyzer uses code "E0412", "E0433", "unresolved-import", or
 * "unresolved-use" depending on context; we also match on the message text
 * as a fallback.
 */
function getUnresolvedSymbolRanges(document: vscode.TextDocument): vscode.Range[] {
    const UNRESOLVED_CODES = new Set([
        'E0412',          // cannot find type in scope
        'E0422',          // cannot find struct/variant/function in scope
        'E0425',          // cannot find value in scope
        'E0433',          // failed to resolve
        'E0436',          // functional record update
        'unresolved-import',
        'unresolved-use',
    ]);

    const diagnostics = vscode.languages.getDiagnostics(document.uri);
    const ranges: vscode.Range[] = [];

    for (const diag of diagnostics) {
        // Match by code
        const code = typeof diag.code === 'object' ? String(diag.code.value) : String(diag.code ?? '');
        if (UNRESOLVED_CODES.has(code)) {
            ranges.push(diag.range);
            continue;
        }
        // Fallback: match common rust-analyzer / rustc message patterns
        const msg = diag.message.toLowerCase();
        if (
            msg.includes('unresolved import') ||
            msg.includes('cannot find') ||
            msg.includes('failed to resolve') ||
            msg.includes('not found in')
        ) {
            ranges.push(diag.range);
        }
    }

    return ranges;
}

// ─────────────────────────────────────────────────────────────────────────────
// rust-analyzer code action fetching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Asks VS Code's language client (rust-analyzer) for `quickfix` code actions
 * at `range`, then filters to those that add an import.
 */
async function fetchImportCandidates(
    document: vscode.TextDocument,
    range: vscode.Range
): Promise<ImportCandidate[]> {
    try {
        const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
            'vscode.executeCodeActionProvider',
            document.uri,
            range,
            vscode.CodeActionKind.QuickFix.value
        );

        if (!actions || actions.length === 0) return [];

        return actions
            .filter((action: vscode.CodeAction) => isImportAction(action))
            .map((action: vscode.CodeAction) => ({
                importPath: extractImportPath(action),
                symbol: extractSymbolName(action),
                action,
            }))
            .filter((c: ImportCandidate) => c.importPath !== '');

    } catch {
        return [];
    }
}

/**
 * Heuristic: rust-analyzer titles its import actions as:
 *   "Import `std::collections::HashMap`"
 *   "Add `use std::collections::HashMap;`"
 */
function isImportAction(action: vscode.CodeAction): boolean {
    const t = action.title.toLowerCase();
    return (
        t.startsWith('import `') ||
        t.startsWith("add `use ") ||
        t.includes('import ') ||
        t.includes('use ')
    );
}

/**
 * Extracts the import path from the action title.
 * Handles:
 *   "Import `std::collections::HashMap`"   → "std::collections::HashMap"
 *   "Add `use std::collections::HashMap;`" → "std::collections::HashMap"
 */
function extractImportPath(action: vscode.CodeAction): string {
    // Try backtick-enclosed path first
    const backtick = action.title.match(/`([^`]+)`/);
    if (backtick) {
        return backtick[1]
            .replace(/^use\s+/, '')
            .replace(/;$/, '')
            .trim();
    }
    return '';
}

function extractSymbolName(action: vscode.CodeAction): string {
    const path = extractImportPath(action);
    if (!path) return '';
    const parts = path.split('::');
    return parts[parts.length - 1];
}

// ─────────────────────────────────────────────────────────────────────────────
// Disambiguation QuickPick
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shows a QuickPick so the user can choose which import to add when multiple
 * candidates exist for the same symbol — exactly like the Java extension.
 */
async function disambiguate(
    symbol: string,
    candidates: ImportCandidate[]
): Promise<ImportCandidate | undefined> {
    interface CandidateItem extends vscode.QuickPickItem {
        candidate: ImportCandidate;
    }

    const items: CandidateItem[] = candidates.map(c => {
        const parts = c.importPath.split('::');
        const crate = parts[0];
        const modulePath = parts.slice(0, -1).join('::');

        return {
            label: `$(package) ${c.importPath}`,
            description: crate === 'std' ? 'standard library' : `crate: ${crate}`,
            detail: `use ${modulePath}::${symbol};`,
            candidate: c,
        };
    });

    const picked = await vscode.window.showQuickPick<CandidateItem>(items, {
        title: `Multiple imports found for '${symbol}' — pick one`,
        placeHolder: 'Select the import to add, or press Escape to skip',
        matchOnDetail: true,
    });

    return picked?.candidate;
}

// ─────────────────────────────────────────────────────────────────────────────
// Symbol extraction fallback
// ─────────────────────────────────────────────────────────────────────────────

/** Last-resort symbol name when document.getText(range) is unavailable. */
function extractSymbolFromRange(range: vscode.Range): string {
    return `unknown:${range.start.line}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Applying a CodeAction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies a VS Code CodeAction's WorkspaceEdit (and optionally its command).
 * Returns true if the edit was applied successfully.
 */
async function applyImportAction(action: vscode.CodeAction): Promise<boolean> {
    try {
        if (action.edit) {
            const ok = await vscode.workspace.applyEdit(action.edit);
            if (!ok) return false;
        }
        if (action.command) {
            await vscode.commands.executeCommand(
                action.command.command,
                ...(action.command.arguments ?? [])
            );
        }
        return true;
    } catch {
        return false;
    }
}