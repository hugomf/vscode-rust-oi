import * as vscode from 'vscode';
import { parseCargoToml, emptyWorkspace, CargoWorkspace } from './cargoParser';

export { CargoWorkspace, parseCargoToml, classifyWithCargo } from './cargoParser';

export async function loadCargoWorkspace(
    documentUri: vscode.Uri
): Promise<CargoWorkspace> {
    try {
        const cargoPath = await findCargoToml(documentUri);
        if (!cargoPath) return emptyWorkspace();
        const raw = await vscode.workspace.fs.readFile(cargoPath);
        const text = Buffer.from(raw).toString('utf-8');
        return parseCargoToml(text);
    } catch {
        return emptyWorkspace();
    }
}

async function findCargoToml(documentUri: vscode.Uri): Promise<vscode.Uri | undefined> {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of workspaceFolders) {
        const candidate = vscode.Uri.joinPath(folder.uri, 'Cargo.toml');
        if (await fileExists(candidate)) return candidate;
    }
    let dir = vscode.Uri.joinPath(documentUri, '..');
    const roots = new Set(workspaceFolders.map(f => f.uri.fsPath));
    for (let depth = 0; depth < 10; depth++) {
        const candidate = vscode.Uri.joinPath(dir, 'Cargo.toml');
        if (await fileExists(candidate)) return candidate;
        if (roots.has(dir.fsPath)) break;
        const parent = vscode.Uri.joinPath(dir, '..');
        if (parent.fsPath === dir.fsPath) break;
        dir = parent;
    }
    return undefined;
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try { await vscode.workspace.fs.stat(uri); return true; }
    catch { return false; }
}