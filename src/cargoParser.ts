import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CargoWorkspace {
    externalCrates: Set<string>;
    workspaceMembers: Set<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure functions — no VS Code dependency
// ─────────────────────────────────────────────────────────────────────────────

export function parseCargoToml(toml: string): CargoWorkspace {
    const externalCrates = new Set<string>();
    const workspaceMembers = new Set<string>();

    const DEP_SECTIONS = new Set([
        'dependencies',
        'dev-dependencies',
        'build-dependencies',
        'workspace.dependencies',
    ]);

    let currentSection = '';
    let inWorkspaceMembers = false;

    for (const rawLine of toml.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        if (line.startsWith('[')) {
            inWorkspaceMembers = false;
            currentSection = line.replace(/^\[+/, '').replace(/\]+$/, '').trim().toLowerCase();
            if (currentSection === 'workspace.members') inWorkspaceMembers = true;
            continue;
        }

        if (currentSection === 'workspace' && line.startsWith('members')) {
            inWorkspaceMembers = true;
        }

        if (inWorkspaceMembers) {
            for (const m of line.matchAll(/"([^"]+)"/g)) {
                workspaceMembers.add(path.basename(m[1]).replace(/-/g, '_'));
            }
            if (line.includes(']')) inWorkspaceMembers = false;
            continue;
        }

        if (DEP_SECTIONS.has(currentSection)) {
            const assignIdx = line.indexOf('=');
            if (assignIdx === -1) continue;
            const key = line.slice(0, assignIdx).trim().replace(/^"(.*)"$/, '$1');
            const crateName = key.replace(/-/g, '_');
            if (crateName && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(crateName)) {
                externalCrates.add(crateName);
            }
            const packageMatch = line.match(/package\s*=\s*"([^"]+)"/);
            if (packageMatch) externalCrates.add(packageMatch[1].replace(/-/g, '_'));
        }
    }

    return { externalCrates, workspaceMembers };
}

export function classifyWithCargo(
    moduleName: string,
    workspace: CargoWorkspace
): 'external' | 'local' | undefined {
    const normalized = moduleName.replace(/-/g, '_');
    if (workspace.externalCrates.has(normalized)) return 'external';
    if (workspace.workspaceMembers.has(normalized)) return 'local';
    return undefined;
}

export function emptyWorkspace(): CargoWorkspace {
    return { externalCrates: new Set(), workspaceMembers: new Set() };
}