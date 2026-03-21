import * as vscode from 'vscode';
import { organizeImportsInText, findMidFilePubUse } from './importParser';
import { runAutoImport } from './autoImport';
import { loadCargoWorkspace } from './cargoWorkspace';

export function activate(context: vscode.ExtensionContext) {
  console.log('Rust Import Organizer is now active!');

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'rust-import-organizer.organizeImports',
      () => runOrganizeCommand(false)
    ),
    vscode.commands.registerCommand(
      'rust-import-organizer.organizeImportsWithAutoImport',
      () => runOrganizeCommand(true)
    ),
  );

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { language: 'rust', scheme: 'file' },
      new RustImportCodeActionProvider(),
      { providedCodeActionKinds: RustImportCodeActionProvider.kinds }
    )
  );

  context.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument(event => {
      if (event.document.languageId !== 'rust') return;
      const config = vscode.workspace.getConfiguration('rust-import-organizer');
      if (!config.get<boolean>('organizeOnSave', false)) return;
      event.waitUntil(buildOrganizeEdit(event.document));
    })
  );
}

class RustImportCodeActionProvider implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.SourceOrganizeImports];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    if (!context.only?.contains(vscode.CodeActionKind.SourceOrganizeImports)) {
      return [];
    }
    const organize = new vscode.CodeAction(
      'Organize Rust imports',
      vscode.CodeActionKind.SourceOrganizeImports
    );
    organize.command = {
      command: 'rust-import-organizer.organizeImports',
      title: 'Organize Rust imports',
      arguments: [document],
    };
    return [organize];
  }
}

async function getOrganizeOptions(
  document: vscode.TextDocument
): Promise<Parameters<typeof organizeImportsInText>[1]> {
  const config = vscode.workspace.getConfiguration('rust-import-organizer');

  // Load Cargo.toml for accurate crate classification
  const cargo = await loadCargoWorkspace(document.uri);

  // groupImports can be boolean, "preserve", or "custom"
  const groupImportsSetting = config.get<boolean | string>('groupImports', true);

  return {
    groupImports: groupImportsSetting as boolean | 'preserve' | 'custom',
    importOrder: config.get<string[]>('importOrder', []),
    pubUsePlacement: config.get<'inline' | 'first' | 'last'>('pubUsePlacement', 'inline'),
    sortAlphabetically: config.get<boolean>('sortAlphabetically', true),
    blankLineBetweenGroups: config.get<boolean>('blankLineBetweenGroups', true),
    collapseSingleImports: config.get<boolean>('collapseSingleImports', false),
    removeUnused: config.get<boolean>('removeUnused', true),
    knownExternalCrates: cargo.externalCrates,
    knownLocalCrates: cargo.workspaceMembers,
  };
}

async function runOrganizeCommand(withAutoImport: boolean): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor found');
    return;
  }
  if (editor.document.languageId !== 'rust') {
    vscode.window.showErrorMessage('This command only works with Rust files');
    return;
  }

  const config = vscode.workspace.getConfiguration('rust-import-organizer');
  const enableAutoImport = config.get<boolean>('enableAutoImport', true);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Rust Import Organizer', cancellable: false },
    async progress => {
      if (withAutoImport && enableAutoImport) {
        progress.report({ message: 'Adding missing imports...' });
        const autoResult = await runAutoImport(editor.document, progress);
        if (autoResult.added.length > 0) await delay(300);
        reportAutoImportSummary(autoResult);
      }

      progress.report({ message: 'Organizing imports...' });
      try {
        const text = editor.document.getText();
        const options = await getOrganizeOptions(editor.document);
        const newText = organizeImportsInText(text, options);

        if (newText !== text) {
          const fullRange = new vscode.Range(
            editor.document.positionAt(0),
            editor.document.positionAt(text.length)
          );
          await editor.edit(editBuilder => editBuilder.replace(fullRange, newText));
        }

        // Warn about any pub use statements that appear after the import block —
        // these are invisible to the organizer and may be unintentional re-exports.
        const midFile = findMidFilePubUse(text);
        if (midFile.length > 0) {
          const lines = midFile.map(m => `line ${m.line + 1}`).join(', ');
          const msg = midFile.length === 1
            ? `Found a mid-file pub use on ${lines} — it cannot be organized automatically. Remove it manually if unused.`
            : `Found ${midFile.length} mid-file pub use statements (${lines}) — they cannot be organized automatically.`;
          vscode.window.showWarningMessage(msg);
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Error organizing imports: ${error}`);
      }
    }
  );
}

async function buildOrganizeEdit(document: vscode.TextDocument): Promise<vscode.TextEdit[]> {
  const text = document.getText();
  const options = await getOrganizeOptions(document);
  const newText = organizeImportsInText(text, options);
  if (newText === text) return [];
  const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
  return [vscode.TextEdit.replace(fullRange, newText)];
}

function reportAutoImportSummary(result: { added: string[]; skipped: string[]; failed: string[] }) {
  const parts: string[] = [];
  if (result.added.length > 0) parts.push(`Added ${result.added.length} import${result.added.length > 1 ? 's' : ''}`);
  if (result.skipped.length > 0) parts.push(`Skipped ${result.skipped.length} (dismissed)`);
  if (result.failed.length > 0) parts.push(`${result.failed.length} unresolved (no suggestions)`);
  if (parts.length > 0) vscode.window.showInformationMessage(`Auto-import: ${parts.join(', ')}`);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function deactivate() { }