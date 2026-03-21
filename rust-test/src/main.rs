//! Manual test runner for the fixture

use std::fs;
use std::process::Command;

fn main() {
    println!("🧪 Rust Import Organizer Test Runner");
    println!("=====================================\n");

    // Step 1: Check original compiles
    println!("1. Checking original fixture compiles...");
    let status = Command::new("cargo")
        .args(&["check", "--message-format=short"])
        .status()
        .expect("Failed to run cargo check");

    if !status.success() {
        eprintln!("❌ Original fixture does not compile!");
        std::process::exit(1);
    }
    println!("✅ Original fixture compiles\n");

    // Step 2: Backup original
    println!("2. Creating backup...");
    let original = fs::read_to_string("test_fixture.rs").expect("Failed to read fixture");
    fs::write("test_fixture.rs.bak", &original).expect("Failed to create backup");
    println!("✅ Backup created\n");

    // Step 3: Prompt for manual organization
    println!("3. Manual step required:");
    println!("   Please run your VS Code extension on 'test_fixture.rs'");
    println!("   Press Enter when done...");

    let mut input = String::new();
    std::io::stdin().read_line(&mut input).unwrap();

    // Step 4: Check organized file
    println!("4. Checking organized fixture...");
    let organized =
        fs::read_to_string("test_fixture.rs").expect("Failed to read organized fixture");

    // Quick checks
    let checks = vec![
        (
            "JsonValue preserved",
            organized.contains("Value as JsonValue"),
        ),
        ("IoRead preserved", organized.contains("Read as IoRead")),
        ("Arc removed", !organized.contains("use std::sync::Arc;")),
        ("Uuid removed", !organized.contains("use uuid::Uuid;")),
        ("Wildcard kept", organized.contains("use std::prelude::*;")),
    ];

    for (name, passed) in checks {
        if passed {
            println!("   ✅ {}", name);
        } else {
            println!("   ❌ {}", name);
        }
    }

    // Step 5: Check compilation
    println!("\n5. Checking organized fixture compiles...");
    let status = Command::new("cargo")
        .args(&["check", "--message-format=short"])
        .status()
        .expect("Failed to run cargo check");

    if status.success() {
        println!("✅ Organized fixture compiles!\n");
    } else {
        eprintln!("❌ Organized fixture does not compile!\n");
    }

    // Step 6: Restore or keep
    println!("6. Restore original? (y/n)");
    input.clear();
    std::io::stdin().read_line(&mut input).unwrap();

    if input.trim().to_lowercase() == "y" {
        fs::write("test_fixture.rs", original).unwrap();
        println!("✅ Original restored");
    } else {
        println!("ℹ️  Kept organized version");
    }

    println!("\nDone!");
}
