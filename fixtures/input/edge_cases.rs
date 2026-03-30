//! Edge Cases Fixture - Tests tricky import scenarios for importParser
//! This fixture focuses on edge cases and complex patterns that challenge the parser
//!
//! Key scenarios tested:
//! 1. Associated function calls (Uuid::new_v4(), HashMap::new()) - should keep imports
//! 2. Qualified-only enum variants - should remove imports
//! 3. Mixed aliases and plain items in groups
//! 4. Multi-level nesting with aliases
//! 5. Comment preservation
//! 6. cfg-gated imports with unused identifiers
//! 7. Wildcard combinations
//! 8. Raw identifiers
//! 9. Unicode and special characters
//! 10. Edge cases (empty, unbalanced, extreme nesting)

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 1: Associated Function Calls (Should Keep)
// ═════════════════════════════════════════════════════════════════════════════
// These types appear ONLY in qualified position (Type::method())
// but as associated function calls, NOT enum variants

use std::collections::BTreeMap;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use uuid::Uuid;

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 2: Qualified-Only Enum Variants (Should Remove)
// ═════════════════════════════════════════════════════════════════════════════
// These appear ONLY as qualified enum variants, never as associated function calls

use chrono::{DateTime, Utc};
use my_enum::Status;

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 3: Mixed Aliases and Plain Items in Groups
// ═════════════════════════════════════════════════════════════════════════════

use serde_json::{json, Map, Number, Value as JsonValue};
use std::io::{BufRead, Read as R, Write as W};

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 4: Multi-Level Nesting with Aliases at Different Levels
// ═════════════════════════════════════════════════════════════════════════════

use std::{
    collections::{HashMap as Map, HashSet as Set},
    fs::File,
    io::{Read as IoRead, Write as IoWrite},
};

use a::b::{
    c::{d::Item as NestedItem, e::Feature},
    f::G as GItem,
};

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 5: Comment Preservation (Lines starting with // should be kept)
// ═════════════════════════════════════════════════════════════════════════════

use std::fs::File;
// use std::io::Read; // Commented out - should be preserved
use std::sync::Arc;
// use std::time::Duration; // Commented out - should be preserved

/* TODO: Add these later
   use std::path::Path;
   use std::path::PathBuf;
*/
use std::collections::HashMap;

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 6: Cfg-Gated Imports with Unused Identifiers (Always Kept)
// ═════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
use crate::test_helpers::setup; // Never used in main code but kept due to cfg

#[cfg(feature = "metrics")]
use prometheus::{Counter, Gauge}; // Never used but kept due to cfg

#[cfg(all(unix, feature = "advanced"))]
use crate::unix::AdvancedFeature;

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 7: Wildcard Combinations
// ═════════════════════════════════════════════════════════════════════════════

use std::io::*;
use std::prelude::*; // Wildcard - always kept
use tokio::prelude::*; // Wildcard - always kept even if unused // Another wildcard from same crate family

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 8: Raw Identifiers
// ═════════════════════════════════════════════════════════════════════════════

use crate::keywords::{r#fn as FnKeyword, r#impl, r#type as TypeKeyword};
use parser::r#match as parse_match;

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 9: Unicode and Special Characters
// ═════════════════════════════════════════════════════════════════════════════

// 日本語 - Japanese comment
use std::collections::HashMap;
// 🎉 Emoji comment
use serde::Serialize;

use std::sync::Arc; // Unused - should be removed

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 10: Edge Cases (Empty, Unbalanced, Extreme)
// ═════════════════════════════════════════════════════════════════════════════

 // Empty braces - should handle gracefully
use std::fs::File;
use std::sync::Arc; // Unused - should be removed

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 11: Re-exports with Aliases
// ═════════════════════════════════════════════════════════════════════════════

pub use crate::config::Settings as AppSettings;
pub use crate::models::User;
pub use crate::utils::helpers::helper as public_helper;

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 12: Same Module at Different Nesting Levels
// ═════════════════════════════════════════════════════════════════════════════

use std::io;
use std::io::Read;
use std::io::Write as W;
use std::io::{self, BufRead};

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 13: Local Imports (crate, super, self)
// ═════════════════════════════════════════════════════════════════════════════

use self::local::LocalType;
use super::parent::ParentType;
use crate::internal::InternalType;
use crate::utils::helpers; // Unused - should be removed

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 14: Implicit Trait Usage (Method Dispatch)
// ═════════════════════════════════════════════════════════════════════════════
// These traits are used via method calls, never as bare identifiers

use anyhow::Context; // Used via .context()
use sqlx::Executor;
use sqlx::Row; // Used via .get()
use std::io::BufRead; // Used via .lines()
use std::io::Read; // Used via .read()
use std::io::Seek; // Used via .seek()
use std::io::Write; // Used via .write_all() // Used via .execute()

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 15: Complex Multi-Line with Comments and Trailing Commas
// ═════════════════════════════════════════════════════════════════════════════

use std::collections::{
    BTreeMap,   // Unused - should be removed
    BinaryHeap, // Unused - should be removed
    HashMap,    // Used
    HashSet,    // Used
    VecDeque,   // Unused - should be removed
};

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 16: Pub Use in Different Contexts
// ═════════════════════════════════════════════════════════════════════════════

pub use crate::api::Response;
pub use crate::models::Data;
use std::fs::File; // All pub use should be marked isPublic

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 17: Attributes on Imports
// ═════════════════════════════════════════════════════════════════════════════

#[allow(unused_imports)]
use std::sync::mpsc::channel;

#[doc(hidden)]
pub use crate::internal::Secret;

#[cfg_attr(feature = "serde", derive(Debug))]
use serde::Deserialize;

// ═════════════════════════════════════════════════════════════════════════════
// CODE SECTION - Using the Imports
// ═════════════════════════════════════════════════════════════════════════════

fn associated_function_calls() {
    // These are associated function calls - imports should be kept
    let uuid1 = Uuid::new_v4();
    let uuid2 = Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap();

    let map = HashMap::<String, i32>::new();
    let bmap = BTreeMap::<String, i32>::new();

    let arc1 = Arc::new(42);
    let arc2 = Arc::clone(&arc1);

    let path = PathBuf::from("/tmp/test");
}

fn qualified_enum_variants() {
    // These are qualified enum variants - imports should be removed
    enum Event {
        DateTime(i64),
        Status(Status),
    }

    let _e1 = Event::DateTime(0);
    let _e2 = Event::Status(Status::Active);
}

fn mixed_aliases_and_plain() {
    // Keep JsonValue and json (JsonValue used, json! macro used)
    let val: JsonValue = json!({"key": "value"});

    // Keep Read as R and Write as W (aliases used)
    let _: R = unimplemented!();
    let _: W = unimplemented!();

    // Keep BufRead (used directly)
    let cursor = std::io::Cursor::new("test");
    for _line in cursor.lines() {}
}

fn multi_level_nesting() {
    // From std::*
    let _: Map<String, i32> = unimplemented!();
    let _: Set<i32> = unimplemented!();
    let _: IoRead = unimplemented!();
    let _: IoWrite = unimplemented!();
    let _f = File::open("test").unwrap();

    // From a::b::*
    let _: NestedItem = unimplemented!();
    let _: Feature = unimplemented!();
    let _: GItem = unimplemented!();
}

fn comment_preservation_test() {
    let _f = File::open("test").unwrap();
    let _: Arc<i32> = unimplemented!(); // Arc is used
    let _map: HashMap<String, i32> = HashMap::new();
}

fn cfg_gated_test() {
    // setup, Counter, Gauge, AdvancedFeature are never used here
    // but they should be kept because they're cfg-gated
}

fn wildcard_test() {
    // Wildcards bring in many items - we can't tell what's used
    // so they're always kept regardless
}

fn raw_identifiers() {
    let _: TypeKeyword = unimplemented!();
    let _: FnKeyword = unimplemented!();
    let _: r#impl = unimplemented!();
    let _ = parse_match("test");
}

fn unicode_test() {
    let _: HashMap<String, i32> = HashMap::new();
    let _: Serialize = unimplemented!();
}

fn edge_cases_test() {
    let _f = File::open("test").unwrap();
}

fn re_exports_test() {
    let _: User = unimplemented!();
    let _: AppSettings = unimplemented!();
    let _ = public_helper();
}

fn same_module_test() {
    let _io: io = unimplemented!();
    let _: Read = unimplemented!();
    let _: W = unimplemented!();
    let _ = BufRead;
}

fn local_imports_test() {
    let _: InternalType = unimplemented!();
    let _: ParentType = unimplemented!();
    let _: LocalType = unimplemented!();
}

fn implicit_traits_test() {
    // Context - used via .context()
    let result: Result<(), &'static str> = Err("error");
    let _ = result.context("failed");

    // Read - used via .read()
    let mut buf = [0u8; 100];
    let _ = std::io::Cursor::new(&buf[..]).read(&mut buf);

    // Write - used via .write_all()
    let mut v = Vec::new();
    v.write_all(b"test").unwrap();

    // BufRead - used via .lines()
    let cursor = std::io::Cursor::new("line1\nline2");
    for _line in cursor.lines() {}

    // Seek - used via .seek()
    let mut cursor = std::io::Cursor::new(vec![0u8; 10]);
    cursor.seek(std::io::SeekFrom::Start(0)).unwrap();

    // Row - used via .get() (hypothetical sqlx usage)
    // let row: sqlx::Row = ...;
    // let _val = row.get("column");

    // Executor - used via .execute() (hypothetical sqlx usage)
    // pool.execute(query).await;
}

fn complex_multiline_test() {
    let _map: HashMap<String, i32> = HashMap::new();
    let _set: HashSet<i32> = HashSet::new();
    // BTreeMap, VecDeque, BinaryHeap are unused - should be removed
}

fn pub_use_test() {
    let _: Response = unimplemented!();
    let _f = File::open("test").unwrap();
    let _: Data = unimplemented!();
}

fn attributes_test() {
    let (tx, _rx) = channel();
    let _ = tx.send(1);
}

fn main() {
    associated_function_calls();
    qualified_enum_variants();
    mixed_aliases_and_plain();
    multi_level_nesting();
    comment_preservation_test();
    cfg_gated_test();
    wildcard_test();
    raw_identifiers();
    unicode_test();
    edge_cases_test();
    re_exports_test();
    same_module_test();
    local_imports_test();
    implicit_traits_test();
    complex_multiline_test();
    pub_use_test();
    attributes_test();
}
