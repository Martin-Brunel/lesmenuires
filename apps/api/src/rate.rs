//! Minimal in-memory fixed-window rate limiter (no external dependency).
//!
//! Suited to this single-instance, self-hosted deployment: it guards the
//! brute-force / spam-prone endpoints (admin login, magic-link request, cart
//! creation). Behind the Caddy reverse proxy the client IP is read from
//! `X-Forwarded-For`. Not a distributed limiter — if the API is ever scaled to
//! several replicas, move to a shared store (Redis) or a proxy-level limit.

use crate::error::AppError;
use axum::http::HeaderMap;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

struct Window {
    count: u32,
    started: Instant,
}

#[derive(Default)]
pub struct RateLimiter {
    // key = "{bucket}:{client}" → current fixed window.
    buckets: Mutex<HashMap<String, Window>>,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Allow at most `max` requests per `window` for a given `bucket`+`client`.
    /// Returns `Err(TooManyRequests)` once the limit is exceeded within the window.
    pub fn check(
        &self,
        bucket: &str,
        client: &str,
        max: u32,
        window: Duration,
    ) -> Result<(), AppError> {
        let now = Instant::now();
        let key = format!("{bucket}:{client}");
        let mut map = self.buckets.lock().unwrap_or_else(|e| e.into_inner());

        // Opportunistic cleanup so the map can't grow unbounded from unique IPs.
        if map.len() > 10_000 {
            map.retain(|_, w| now.duration_since(w.started) < window);
        }

        let entry = map.entry(key).or_insert(Window {
            count: 0,
            started: now,
        });
        if now.duration_since(entry.started) >= window {
            entry.count = 0;
            entry.started = now;
        }
        entry.count += 1;
        if entry.count > max {
            return Err(AppError::TooManyRequests);
        }
        Ok(())
    }
}

/// Best-effort client identifier for rate limiting. Behind Caddy the real client
/// IP is the first hop in `X-Forwarded-For`; fall back to a constant so an absent
/// header still shares a bucket (fails safe toward limiting) rather than bypassing.
pub fn client_ip(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}
