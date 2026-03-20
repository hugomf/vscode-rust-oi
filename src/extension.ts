import * as vscode from 'vscode';
import {
  parseImports,
  organizeImports,
  sortImports,
  formatImport,
  removeDuplicateImports,
  removeUnusedImports,
  ImportStatement,
} from './importParser';

export function activate(context: vscode.ExtensionContext) {
  console.log('=========================================');
  console.log('Rust Import Organizer is now active!');
  console.log('=========================================');

  vscode.window.showInformationMessage('Rust Import Organizer extension loaded!');

  const organizeImportsCommand = vscode.commands.registerCommand(
    'rust-import-organizer.organizeImports',
    organizeRustImports
  );

  context.subscriptions.push(organizeImportsCommand);
}

async function organizeRustImports(): Promise<void> {
  console.log('organizeRustImports called');
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    console.log('No active editor found');
    vscode.window.showErrorMessage('No active editor found');
    return;
  }

  console.log('Editor language:', editor.document.languageId);
  if (editor.document.languageId !== 'rust') {
    console.log('Not a Rust file');
    vscode.window.showErrorMessage('This command only works with Rust files');
    return;
  }

  const config = vscode.workspace.getConfiguration('rust-import-organizer');
  const groupImports = config.get<boolean>('groupImports', true);
  const sortAlphabetically = config.get<boolean>('sortAlphabetically', true);
  const blankLineBetweenGroups = config.get<boolean>('blankLineBetweenGroups', true);
  const collapseSingleImports = config.get<boolean>('collapseSingleImports', false);

  try {
    const document = editor.document;
    const text = document.getText();

    console.log('Parsing imports...');
    const imports = parseImports(text);
    console.log('Found', imports.length, 'imports');

    if (imports.length === 0) {
      console.log('No imports found');
      vscode.window.showInformationMessage('No imports found to organize');
      return;
    }

    const uniqueImports = removeDuplicateImports(imports);
    const usedImports = removeUnusedImports(uniqueImports, text);

    const newText = buildOrganizedText(
      usedImports,
      text,
      groupImports,
      sortAlphabetically,
      blankLineBetweenGroups,
      collapseSingleImports
    );

    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(text.length)
    );

    await editor.edit(editBuilder => {
      editBuilder.replace(fullRange, newText);
    });

    vscode.window.showInformationMessage('Imports organized successfully');
  } catch (error) {
    vscode.window.showErrorMessage(`Error organizing imports: ${error}`);
  }
}

function buildOrganizedText(
  imports: ImportStatement[],
  originalText: string,
  groupImports: boolean,
  sortAlphabetically: boolean,
  blankLineBetweenGroups: boolean,
  collapseSingleImports: boolean
): string {
  if (imports.length === 0) {
    return originalText;
  }

  const lines = originalText.split('\n');

  const importStartLine = Math.min(...imports.map(imp => imp.startLine));
  const importEndLine = Math.max(...imports.map(imp => imp.endLine));

  const beforeImports = lines.slice(0, importStartLine).join('\n');

  // Skip any blank lines that sat between the import block and the rest of the file
  const rawAfterLines = lines.slice(importEndLine + 1);
  const firstNonBlank = rawAfterLines.findIndex(l => l.trim() !== '');
  const afterImports = firstNonBlank === -1 ? '' : rawAfterLines.slice(firstNonBlank).join('\n');

  const importSection = groupImports
    ? buildGroupedImports(imports, sortAlphabetically, blankLineBetweenGroups, collapseSingleImports)
    : buildFlatImports(imports, sortAlphabetically, collapseSingleImports);

  let result = beforeImports;
  if (result && !result.endsWith('\n')) {
    result += '\n';
  }
  result += importSection;
  if (afterImports) {
    result += '\n\n' + afterImports;
  }

  return result;
}

function buildGroupedImports(
  imports: ImportStatement[],
  sortAlphabetically: boolean,
  blankLineBetweenGroups: boolean,
  collapseSingleImports: boolean
): string {
  const organized = organizeImports(imports);
  console.log('Grouped imports - std:', organized.stdImports.length, 'external:', organized.externalImports.length, 'local:', organized.localImports.length);
  
  const groups: string[] = [];

  if (organized.stdImports.length > 0) {
    const sorted = sortAlphabetically ? sortImports(organized.stdImports) : organized.stdImports;
    groups.push(sorted.map(imp => formatImport(imp, collapseSingleImports)).join('\n'));
  }

  if (organized.externalImports.length > 0) {
    const sorted = sortAlphabetically ? sortImports(organized.externalImports) : organized.externalImports;
    groups.push(sorted.map(imp => formatImport(imp, collapseSingleImports)).join('\n'));
  }

  if (organized.localImports.length > 0) {
    const sorted = sortAlphabetically ? sortImports(organized.localImports) : organized.localImports;
    groups.push(sorted.map(imp => formatImport(imp, collapseSingleImports)).join('\n'));
  }

  return blankLineBetweenGroups ? groups.join('\n\n') : groups.join('\n');
}

function buildFlatImports(
  imports: ImportStatement[],
  sortAlphabetically: boolean,
  collapseSingleImports: boolean
): string {
  const sorted = sortAlphabetically ? sortImports(imports) : imports;
  return sorted.map(imp => formatImport(imp, collapseSingleImports)).join('\n');
}

export function deactivate() {
  console.log('Rust Import Organizer is now deactivated');
}