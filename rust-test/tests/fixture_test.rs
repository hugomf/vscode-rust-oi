//! Integration test for import organizer fixture

use std::fs;
use std::process::Command;

/// Path to the fixture file
const FIXTURE_PATH: &str = "test_fixture.rs";

/// Run the VS Code extension CLI or your organizer tool
fn run_organizer(input_path: &str, output_path: &str) -> Result<String, String> {
    // Option 1: If you have a CLI tool
    // Command::new("rust-import-organizer")
    //     .args(&[input_path, "-o", output_path])
    //     .output()
    //     .map_err(|e| format!("Failed to run organizer: {}", e))?;

    // Option 2: Use VS Code CLI (if your extension exposes commands)
    // Command::new("code")
    //     .args(&["--command", "rustImportOrganizer.organize", input_path])
    //     .output()
    //     .map_err(|e| format!("Failed to run VS Code: {}", e))?;

    // Option 3: For now, manually copy the organized file
    // Replace this with your actual organizer invocation
    fs::copy(input_path, output_path).map_err(|e| format!("Failed to copy: {}", e))?;

    Ok("Success".to_string())
}

/// Check if Rust code compiles
fn check_compiles(path: &str) -> Result<(), String> {
    let output = Command::new("cargo")
        .args(&["check", "--message-format=short"])
        .current_dir(".")
        .output()
        .map_err(|e| format!("Failed to run cargo check: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Compilation failed:\n{}", stderr));
    }
    Ok(())
}

#[test]
fn test_fixture_compiles_before_organization() {
    // Ensure the original fixture compiles
    check_compiles(FIXTURE_PATH).expect("Fixture should compile before organization");
}

#[test]
fn test_fixture_organization() {
    // Read original
    let original = fs::read_to_string(FIXTURE_PATH).expect("Failed to read fixture");

    // Create backup
    fs::write("test_fixture.rs.bak", &original).expect("Failed to create backup");

    // Run organizer
    run_organizer(FIXTURE_PATH, FIXTURE_PATH).expect("Organization should succeed");

    // Read organized
    let organized = fs::read_to_string(FIXTURE_PATH).expect("Failed to read organized fixture");

    // Verify specific patterns
    assert!(
        organized.contains("use serde_json::{json, Value as JsonValue};"),
        "Should preserve Value as JsonValue"
    );

    assert!(
        !organized.contains("use std::sync::Arc;"),
        "Should remove unused Arc"
    );

    assert!(
        !organized.contains("use uuid::Uuid;"),
        "Should remove unused Uuid"
    );

    assert!(
        organized.contains("use std::prelude::*;"),
        "Should keep wildcard import"
    );

    // Check compilation after organization
    check_compiles(FIXTURE_PATH).expect("Fixture should compile after organization");

    // Restore backup
    fs::write(FIXTURE_PATH, original).expect("Failed to restore backup");
}

#[test]
fn test_specific_alias_preservation() {
    let original = fs::read_to_string(FIXTURE_PATH).unwrap();

    // Run your extension here manually or via CLI

    let organized = fs::read_to_string(FIXTURE_PATH).unwrap();

    // Check that JsonValue alias is preserved
    assert!(
        organized.contains("Value as JsonValue"),
        "JsonValue alias should be preserved"
    );

    // Check that JV alias is preserved (it's used)
    assert!(
        organized.contains("Value as JV") || organized.contains("as JV"),
        "JV alias should be preserved"
    );

    // Restore
    fs::write(FIXTURE_PATH, original).unwrap();
}
