//! Comprehensive test fixture for Rust import organizer
//! This file exercises parsing, aliasing, nesting, formatting, and unused detection
//!
//!
//! # Run your extension and check these specific patterns
//!     cargo check test_fixture.rs 2>&1 | head -20
//! # Or use rustfmt to verify syntax is valid after your changes
//!    rustfmt --check test_fixture.rs

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 1: Basic Aliases (The Original Bug Scenario)
// ═════════════════════════════════════════════════════════════════════════════

use std::collections::{BTreeMap as OrderedMap, HashMap as Map, HashSet};
use std::fs::File as F;
use std::io::{BufRead, Read as IoRead, Write as IoWrite};
pub use std::io::Read;
// ═════════════════════════════════════════════════════════════════════════════
// SECTION 2: Deeply Nested Braces with Aliases at Multiple Levels
// ═════════════════════════════════════════════════════════════════════════════
use std::path::{Path as P, PathBuf as PB};
use std::prelude::*;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value as JsonValue};
use tokio::prelude::*;
// ═════════════════════════════════════════════════════════════════════════════
// SECTION 3: Simple Imports (Some Used, Some Unused)
// ═════════════════════════════════════════════════════════════════════════════

pub use crate::config::Settings as AppSettings;
pub use crate::models::User;

#[cfg(test)]
use crate::test_helpers::setup;
// ═════════════════════════════════════════════════════════════════════════════
// SECTION 4: Wildcard Imports (Should Always Be Kept)
// ═════════════════════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 5: Re-exports (pub use)
// ═════════════════════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 6: Cfg-Gated Imports (Should Always Be Kept)
// ═════════════════════════════════════════════════════════════════════════════

#[cfg(feature = "advanced")]
#[cfg(unix)]
use crate::unix_advanced::Feature;

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 7: Raw Identifiers
// ═════════════════════════════════════════════════════════════════════════════

use crate::keywords::{r#fn, r#impl as ImplKeyword, r#type as TypeKeyword};

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 8: Local Imports (crate, super, self)
// ═════════════════════════════════════════════════════════════════════════════

use self::local_utils::local_helper;
use super::parent_module::ParentType;
use crate::utils::helpers;

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 9: External Crates (Various Patterns)
// ═════════════════════════════════════════════════════════════════════════════

use anyhow::Result as AnyhowResult;
use axum::{extract::Json as AxumJson, Router as AxumRouter};
use chrono::{DateTime, Utc as ChronoUtc};
use serde::{Deserialize as SerdeDe, Serialize as SerdeSer};
use thiserror::Error;
use tokio::runtime::Runtime;
use tokio::sync::{Mutex as TokioMutex, RwLock as TokioRwLock};
use uuid::Uuid; // Unused - should be removed

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 10: Extreme Nesting
// ═════════════════════════════════════════════════════════════════════════════

use a::b::{
    c::{d::E as NestedE, f::G},
    h::I as NestedI,
};
use std::io::Write as W2;

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 11: Multi-line with Trailing Commas and Comments
// ═════════════════════════════════════════════════════════════════════════════

use std::collections::{
    BTreeMap, // Unused - should be removed
    HashMap,  // Used
    VecDeque, // Unused - should be removed
};

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 12: Same Module at Different Levels (Edge Case)
// ═════════════════════════════════════════════════════════════════════════════

use std::io;
use std::io::Read as StdRead;
use std::io::Write as StdWrite;

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 13: Implicit Trait Usage (Should Be Detected)
// ═════════════════════════════════════════════════════════════════════════════

use anyhow::Context;
use sqlx::Executor; // Used via .execute()
use sqlx::Row; // Used via .get()
use std::io::BufRead; // Used via .lines()
use std::io::Read; // Used via .read_to_string()
use std::io::Seek; // Used via .seek()
use std::io::Write; // Used via .write_all() // Used via .context()

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 14: Unused Aliases (Should Remove Only Unused Items)
// ═════════════════════════════════════════════════════════════════════════════

use serde_json::{Map as JM, Number, Value as JV}; // Only JV used

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 15: Complex Real-World Pattern
// ═════════════════════════════════════════════════════════════════════════════

use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    fs::{File as StdFile, OpenOptions},
    io::{self, BufRead, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, RwLock},
    time::{Duration, Instant},
};

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 16: Potential Confusion Patterns
// ═════════════════════════════════════════════════════════════════════════════

use json::json as json_macro; // Module "json", item "json", alias "json_macro"
use result::Result as Res; // Common name collision pattern

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 17: Attributes on Imports
// ═════════════════════════════════════════════════════════════════════════════

#[allow(unused_imports)]
use std::sync::mpsc::channel;

#[doc(hidden)]
pub use crate::internal::InternalItem;

// ═════════════════════════════════════════════════════════════════════════════
// SECTION 18: Single Item Groups (Collapse Test)
// ═════════════════════════════════════════════════════════════════════════════

use std::path::Path as SinglePathAlias;

// ═════════════════════════════════════════════════════════════════════════════
// CODE SECTION - Using the Imports
// ═════════════════════════════════════════════════════════════════════════════

fn test_basic_aliases() -> JsonValue {
    let map: Map<String, i32> = Map::new();
    let ordered: OrderedMap<String, i32> = OrderedMap::new();
    let _set: HashSet<i32> = HashSet::new();
    let data = json!({"key": "value"});
    let mut buf = Vec::new();
    let _: &mut dyn IoRead = &mut &buf[..];
    let _: &mut dyn IoWrite = &mut Vec::new();
    let _: &mut dyn BufRead = &mut &buf[..];
    data
}

fn test_nested_aliases() {
    let mut buf = Vec::new();
    let _: &mut dyn R = &mut &buf[..];
    let _: &mut dyn W = &mut Vec::new();
    let _: &mut dyn BR = &mut &buf[..];
    let _f: F = F::open("test").unwrap();
    let _p: &P = P::new("test");
    let _pb: PB = PB::from("test");
}

fn test_simple_imports() {
    let _f = File::open("test.txt").unwrap();
    // Arc, Duration, Thread are unused
}

fn test_raw_identifiers() {
    let _: TypeKeyword = ();
    let _: ImplKeyword = ();
    let _: r#fn = ();
}

fn test_local_imports() {
    let _ = helpers::helper();
    let _: ParentType = unimplemented!();
    let _ = local_helper();
}

fn test_external_crates() -> AnyhowResult<()> {
    let _runtime = Runtime::new().unwrap();
    let _lock: TokioRwLock<i32> = TokioRwLock::new(0);
    let _mutex: TokioMutex<i32> = TokioMutex::new(0);
    let _router: AxumRouter = unimplemented!();
    let _: AxumJson<String> = unimplemented!();
    let _: SerdeDe = unimplemented!();
    let _: SerdeSer = unimplemented!();
    let _: DateTime<ChronoUtc> = unimplemented!();
    Ok(())
}

fn test_extreme_nesting() {
    let _: NestedE = unimplemented!();
    let _: NestedI = unimplemented!();
    let _: W2 = unimplemented!();
}

fn test_implicit_traits() {
    // Read - used via .read_to_string()
    let mut file = File::open("test").unwrap();
    let mut contents = String::new();
    file.read_to_string(&mut contents).unwrap();

    // Write - used via .write_all()
    let mut buf = Vec::new();
    buf.write_all(b"data").unwrap();

    // BufRead - used via .lines()
    let cursor = std::io::Cursor::new("line1\nline2");
    let _: std::io::Lines<&[u8]> = cursor.lines();

    // Seek - used via .seek()
    let mut cursor = std::io::Cursor::new(vec![0u8; 10]);
    cursor.seek(SeekFrom::Start(0)).unwrap();

    // Row - used via .get()
    // sqlx::Row would be used like: row.get("column")

    // Context - used via .context()
    // anyhow::Context would be used like: result.context("msg")
}

fn test_unused_aliases() {
    let _: JV = json!({});
    // JM and Number are unused - should be removed from import
}

fn test_complex_real_world() {
    let _f: StdFile = StdFile::open("test").unwrap();
    let _opts = OpenOptions::new();
    let _io: &io = unimplemented!();
    let _path: &Path = Path::new("test");
    let _pb: PathBuf = PathBuf::from("test");
    let _map: HashMap<String, i32> = HashMap::new();
    let _arc: Arc<i32> = Arc::new(0);
    let _mutex: Mutex<i32> = Mutex::new(0);
    let _rwlock: RwLock<i32> = RwLock::new(0);
    let _dur: Duration = Duration::from_secs(1);
    let _inst: Instant = Instant::now();
}

fn test_confusion_patterns() {
    json_macro!({"key": "value"});
    let _: Res<()> = Ok(());
}

fn test_single_alias() {
    let _: SinglePathAlias = Path::new("test");
}

// Main function to ensure everything compiles
fn main() {
    test_basic_aliases();
    test_nested_aliases();
    test_simple_imports();
    test_raw_identifiers();
    test_local_imports();
    test_external_crates().unwrap();
    test_extreme_nesting();
    test_implicit_traits();
    test_unused_aliases();
    test_complex_real_world();
    test_confusion_patterns();
    test_single_alias();

    // Use re-exported items
    let _: User = unimplemented!();
    let _: AppSettings = unimplemented!();
    let _: StdRead = unimplemented!();
}
