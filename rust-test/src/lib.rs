//! Test library for import organizer fixture

// Re-export everything so the fixture can use it
pub use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
pub use std::fs::{File, OpenOptions};
pub use std::io::{self, BufRead, Read, Seek, SeekFrom, Write};
pub use std::path::{Path, PathBuf};
pub use std::sync::{Arc, Mutex, RwLock};
pub use std::time::{Duration, Instant};

// Re-export external crates
pub use anyhow::Result as AnyhowResult;
pub use axum::{extract::Json as AxumJson, Router as AxumRouter};
pub use chrono::{DateTime, Utc as ChronoUtc};
pub use serde::{Deserialize as SerdeDe, Serialize as SerdeSer};
pub use thiserror::Error;
pub use tokio::runtime::Runtime;
pub use tokio::sync::{Mutex as TokioMutex, RwLock as TokioRwLock};

// Mock modules for local imports
pub mod config {
    pub struct Settings;
    impl Settings {
        pub fn new() -> Self {
            Self
        }
    }
}

pub mod models {
    pub struct User;
    impl User {
        pub fn new() -> Self {
            Self
        }
    }
}

pub mod utils {
    pub mod helpers {
        pub fn helper() {}
    }
}

pub mod local_utils {
    pub fn local_helper() {}
}

pub mod internal {
    pub struct InternalItem;
}

pub mod test_helpers {
    pub fn setup() {}
}

pub mod unix_advanced {
    pub struct Feature;
}

pub mod keywords {
    pub type r#type = ();
    pub type r#impl = ();
    pub const r#fn: () = ();
}

pub mod parent_module {
    pub struct ParentType;
}

// Mock sqlx types
pub mod sqlx {
    pub struct Row;
    impl Row {
        pub fn get<T>(&self, _col: &str) -> T {
            unimplemented!()
        }
    }
    pub trait Executor {}
    pub struct PgPool;
    impl Executor for PgPool {}
}

// Mock json crate
pub mod json {
    #[macro_export]
    macro_rules! json_macro {
        ($($tt:tt)*) => {{
            let _ = serde_json::json!($($tt)*);
        }};
    }
    pub use json_macro as json;
}

pub mod result {
    pub type Result<T> = std::result::Result<T, ()>;
}
