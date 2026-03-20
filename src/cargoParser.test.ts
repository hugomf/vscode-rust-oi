// cargoParser.test.ts
//
// Tests for the pure Cargo.toml parsing logic. cargoWorkspace.ts wraps this
// with the VS Code filesystem API and has no testable logic of its own beyond
// the parse step covered here.

import { parseCargoToml, classifyWithCargo, emptyWorkspace } from './cargoParser';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function cratesOf(toml: string): Set<string> {
    return parseCargoToml(toml).externalCrates;
}

function membersOf(toml: string): Set<string> {
    return parseCargoToml(toml).workspaceMembers;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. parseCargoToml — [dependencies]
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCargoToml — [dependencies]', () => {
    it('extracts a simple string dependency', () => {
        expect(cratesOf(`[dependencies]\nserde = "1.0"`).has('serde')).toBe(true);
    });

    it('extracts an inline-table dependency', () => {
        const toml = `[dependencies]\ntokio = { version = "1", features = ["full"] }`;
        expect(cratesOf(toml).has('tokio')).toBe(true);
    });

    it('extracts multiple dependencies', () => {
        const toml = `[dependencies]\nserde = "1.0"\ntokio = "1"\nanyhow = "1"`;
        const crates = cratesOf(toml);
        expect(crates.has('serde')).toBe(true);
        expect(crates.has('tokio')).toBe(true);
        expect(crates.has('anyhow')).toBe(true);
    });

    it('normalises hyphenated names to underscores', () => {
        const toml = `[dependencies]\nmy-crate = "1.0"\nserde-json = "1.0"`;
        const crates = cratesOf(toml);
        expect(crates.has('my_crate')).toBe(true);
        expect(crates.has('serde_json')).toBe(true);
        expect(crates.has('my-crate')).toBe(false);
    });

    it('handles a package rename (alias = { package = "real-name" })', () => {
        const toml = `[dependencies]\nhttp = { package = "real-http-lib", version = "1.0" }`;
        const crates = cratesOf(toml);
        expect(crates.has('real_http_lib')).toBe(true);
    });

    it('skips comment lines', () => {
        const toml = `[dependencies]\n# this is a comment\nserde = "1.0"`;
        expect(cratesOf(toml).has('serde')).toBe(true);
        expect(cratesOf(toml).size).toBe(1);
    });

    it('skips blank lines without error', () => {
        const toml = `[dependencies]\n\nserde = "1.0"\n\ntokio = "1"`;
        const crates = cratesOf(toml);
        expect(crates.has('serde')).toBe(true);
        expect(crates.has('tokio')).toBe(true);
    });

    it('returns empty set when [dependencies] is absent', () => {
        const toml = `[package]\nname = "hello"\nversion = "0.1.0"`;
        expect(cratesOf(toml).size).toBe(0);
    });

    it('returns empty set for empty string input', () => {
        expect(cratesOf('').size).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. parseCargoToml — [dev-dependencies] and [build-dependencies]
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCargoToml — dev and build dependencies', () => {
    it('extracts [dev-dependencies]', () => {
        const toml = `[dev-dependencies]\nmockall = "0.11"\npretty_assertions = "1"`;
        const crates = cratesOf(toml);
        expect(crates.has('mockall')).toBe(true);
        expect(crates.has('pretty_assertions')).toBe(true);
    });

    it('extracts [build-dependencies]', () => {
        const toml = `[build-dependencies]\ncc = "1.0"`;
        expect(cratesOf(toml).has('cc')).toBe(true);
    });

    it('combines deps from all three sections', () => {
        const toml = `
[dependencies]
serde = "1"

[dev-dependencies]
mockall = "0.11"

[build-dependencies]
cc = "1"
`;
        const crates = cratesOf(toml);
        expect(crates.has('serde')).toBe(true);
        expect(crates.has('mockall')).toBe(true);
        expect(crates.has('cc')).toBe(true);
    });

    it('does not pick up non-dep keys like [package] fields', () => {
        const toml = `[package]\nname = "my-app"\nversion = "0.1.0"\nedition = "2021"`;
        expect(cratesOf(toml).size).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. parseCargoToml — [workspace]
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCargoToml — [workspace] members', () => {
    it('extracts workspace members from a single-line array', () => {
        const toml = `[workspace]\nmembers = ["crates/my-lib", "crates/my-app"]`;
        const members = membersOf(toml);
        expect(members.has('my_lib')).toBe(true);
        expect(members.has('my_app')).toBe(true);
    });

    it('extracts workspace members from a multi-line array', () => {
        const toml = `[workspace]\nmembers = [\n  "crates/auth",\n  "crates/core",\n]`;
        const members = membersOf(toml);
        expect(members.has('auth')).toBe(true);
        expect(members.has('core')).toBe(true);
    });

    it('uses only the last path segment as the member name', () => {
        const toml = `[workspace]\nmembers = ["deeply/nested/path/my-crate"]`;
        const members = membersOf(toml);
        expect(members.has('my_crate')).toBe(true);
        expect(members.has('deeply')).toBe(false);
    });

    it('normalises hyphens to underscores in member names', () => {
        const toml = `[workspace]\nmembers = ["packages/my-service"]`;
        const members = membersOf(toml);
        expect(members.has('my_service')).toBe(true);
        expect(members.has('my-service')).toBe(false);
    });

    it('returns empty set when there is no [workspace] section', () => {
        const toml = `[package]\nname = "hello"\n[dependencies]\nserde = "1"`;
        expect(membersOf(toml).size).toBe(0);
    });

    it('extracts workspace.dependencies', () => {
        const toml = `[workspace.dependencies]\nshared-utils = { version = "1.0" }`;
        expect(cratesOf(toml).has('shared_utils')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. parseCargoToml — realistic full Cargo.toml
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCargoToml — realistic Cargo.toml', () => {
    const REALISTIC = `
[package]
name = "my-server"
version = "0.3.1"
edition = "2021"

[dependencies]
axum = { version = "0.7", features = ["json", "ws"] }
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
anyhow = "1"
tracing = "0.1"
uuid = { version = "1", features = ["v4"] }
sqlx = { version = "0.7", features = ["postgres", "runtime-tokio"] }

[dev-dependencies]
mockall = "0.11"
pretty_assertions = "1"
tokio = { version = "1", features = ["test-util"] }

[build-dependencies]
tonic-build = "0.10"
`;

    it('extracts all runtime dependencies', () => {
        const crates = cratesOf(REALISTIC);
        for (const name of ['axum', 'tokio', 'serde', 'serde_json', 'anyhow', 'tracing', 'uuid', 'sqlx']) {
            expect(crates.has(name)).toBe(true);
        }
    });

    it('extracts dev and build dependencies', () => {
        const crates = cratesOf(REALISTIC);
        expect(crates.has('mockall')).toBe(true);
        expect(crates.has('tonic_build')).toBe(true);
    });

    it('does not include [package] fields as crate names', () => {
        const crates = cratesOf(REALISTIC);
        expect(crates.has('name')).toBe(false);
        expect(crates.has('version')).toBe(false);
        expect(crates.has('edition')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. parseCargoToml — workspace + dependencies together
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCargoToml — workspace with dependencies', () => {
    const WS_TOML = `
[workspace]
members = [
  "crates/api",
  "crates/db-layer",
  "crates/shared",
]

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
tokio = { version = "1", features = ["full"] }

[dependencies]
anyhow = "1"
`;

    it('extracts members and deps from the same file', () => {
        const ws = parseCargoToml(WS_TOML);
        expect(ws.workspaceMembers.has('api')).toBe(true);
        expect(ws.workspaceMembers.has('db_layer')).toBe(true);
        expect(ws.workspaceMembers.has('shared')).toBe(true);
        expect(ws.externalCrates.has('serde')).toBe(true);
        expect(ws.externalCrates.has('tokio')).toBe(true);
        expect(ws.externalCrates.has('anyhow')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. classifyWithCargo
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyWithCargo', () => {
    const ws = parseCargoToml(`
[dependencies]
serde = "1"
tokio = "1"

[workspace]
members = ["crates/my-lib", "crates/my-app"]
`);

    it('returns "external" for a known dependency', () => {
        expect(classifyWithCargo('serde', ws)).toBe('external');
        expect(classifyWithCargo('tokio', ws)).toBe('external');
    });

    it('returns "local" for a workspace member', () => {
        expect(classifyWithCargo('my_lib', ws)).toBe('local');
        expect(classifyWithCargo('my_app', ws)).toBe('local');
    });

    it('returns undefined for an unknown crate', () => {
        expect(classifyWithCargo('unknown_crate', ws)).toBeUndefined();
        expect(classifyWithCargo('reqwest', ws)).toBeUndefined();
    });

    it('normalises hyphens in the query name', () => {
        expect(classifyWithCargo('my-lib', ws)).toBe('local');
    });

    it('is case-sensitive (Rust crate names are lowercase)', () => {
        expect(classifyWithCargo('Serde', ws)).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. emptyWorkspace
// ─────────────────────────────────────────────────────────────────────────────

describe('emptyWorkspace', () => {
    it('returns an object with two empty sets', () => {
        const ws = emptyWorkspace();
        expect(ws.externalCrates.size).toBe(0);
        expect(ws.workspaceMembers.size).toBe(0);
    });

    it('classifyWithCargo returns undefined for any input against an empty workspace', () => {
        const ws = emptyWorkspace();
        expect(classifyWithCargo('serde', ws)).toBeUndefined();
        expect(classifyWithCargo('std', ws)).toBeUndefined();
    });
});