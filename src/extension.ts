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
  const cargo = await loadCargoWorkspace(document.uri);

  const groupImportsSetting = config.get<boolean | string>('groupImports', true);

  return {
    groupImports: groupImportsSetting as boolean | 'preserve' | 'custom',
    importOrder: config.get<string[]>('importOrder', []),
    pubUsePlacement: config.get<'inline' | 'first' | 'last'>('pubUsePlacement', 'inline'),
    sortAlphabetically: config.get<boolean>('sortAlphabetically', true),
    blankLineBetweenGroups: config.get<boolean>('blankLineBetweenGroups', true),
    collapseSingleImports: config.get<boolean>('collapseSingleImports', false),
    removeUnused: true,
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

  const document = editor.document;
  const originalText = document.getText();

  const config = vscode.workspace.getConfiguration('rust-import-organizer');
  const enableAutoImport = config.get<boolean>('enableAutoImport', true);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Rust Import Organizer', cancellable: false },
    async progress => {

      // -------------------------------
      // AUTO IMPORT
      // -------------------------------
      if (withAutoImport && enableAutoImport) {
        progress.report({ message: 'Adding missing imports...' });
        const autoResult = await runAutoImport(document, progress);
        if (autoResult.added.length > 0) await delay(300);
        reportAutoImportSummary(autoResult);
      }

      progress.report({ message: 'Organizing imports...' });

      try {
        // 🧠 Let rust-analyzer refresh diagnostics
        await delay(150);

        // -------------------------------
        // STEP 1: APPLY UNUSED IMPORT FIXES (SAFE)
        // -------------------------------
        const unusedEdits = getUnusedImportEdits(document);

        if (unusedEdits.length > 0) {
          const edit = new vscode.WorkspaceEdit();
          edit.set(document.uri, unusedEdits);
          await vscode.workspace.applyEdit(edit);
        }

        // -------------------------------
        // STEP 2: RUN YOUR ORGANIZER
        // -------------------------------
        const updatedText = document.getText();
        const options = await getOrganizeOptions(document);

        const newText = organizeImportsInText(updatedText, options);

        if (newText !== updatedText) {
          const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(updatedText.length)
          );
          await editor.edit(editBuilder => editBuilder.replace(fullRange, newText));
        }

        // -------------------------------
        // WARN ABOUT MID-FILE PUB USE
        // -------------------------------
        const midFile = findMidFilePubUse(updatedText);
        if (midFile.length > 0) {
          const lines = midFile.map(m => `line ${m.line + 1}`).join(', ');
          vscode.window.showWarningMessage(
            `Found ${midFile.length} mid-file pub use (${lines}) — cannot auto-organize.`
          );
        }

      } catch (error) {
        vscode.window.showErrorMessage(`Error organizing imports: ${error}`);
      }
    }
  );
}

// ✅ THIS is the correct way (no string slicing)
function getUnusedImportEdits(document: vscode.TextDocument): vscode.TextEdit[] {
  const diagnostics = vscode.languages.getDiagnostics(document.uri);

  return diagnostics
    .filter(d =>
      d.source === 'rust-analyzer' &&
      (
        d.code === 'unused_imports' ||
        (typeof d.message === 'string' &&
          d.message.toLowerCase().includes('unused import'))
      )
    )
    .map(d => vscode.TextEdit.delete(d.range));
}

async function buildOrganizeEdit(document: vscode.TextDocument): Promise<vscode.TextEdit[]> {
  const options = await getOrganizeOptions(document);
  const text = document.getText();
  const newText = organizeImportsInText(text, options);

  if (newText === text) return [];

  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(text.length)
  );

  return [vscode.TextEdit.replace(fullRange, newText)];
}

function reportAutoImportSummary(result: { added: string[]; skipped: string[]; failed: string[] }) {
  const parts: string[] = [];
  if (result.added.length > 0) parts.push(`Added ${result.added.length}`);
  if (result.skipped.length > 0) parts.push(`Skipped ${result.skipped.length}`);
  if (result.failed.length > 0) parts.push(`${result.failed.length} unresolved`);
  if (parts.length > 0) vscode.window.showInformationMessage(`Auto-import: ${parts.join(', ')}`);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function deactivate() { }