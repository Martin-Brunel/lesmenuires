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

/// Best-effort client identifier for rate limiting. Behind a single trusted proxy
/// (Caddy) that appends the real peer IP to `X-Forwarded-For`, the spoof-resistant
/// value is the LAST hop: a client may prepend fake entries but cannot stop Caddy
/// from appending its true peer IP on the right. Taking the first hop instead would
/// let an attacker rotate a fake `X-Forwarded-For` to get a fresh bucket per request
/// and bypass every limit. Falls back to a shared constant so an absent header still
/// shares one bucket (fails toward limiting, never bypass).
pub fn client_ip(headers: &HeaderMap) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.rsplit(',').next())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const WINDOW: Duration = Duration::from_secs(60);

    #[test]
    fn allows_up_to_max_then_blocks() {
        let rl = RateLimiter::new();
        for _ in 0..3 {
            assert!(rl.check("login", "1.2.3.4", 3, WINDOW).is_ok());
        }
        // 4th within the window is rejected.
        assert!(rl.check("login", "1.2.3.4", 3, WINDOW).is_err());
    }

    #[test]
    fn different_clients_are_independent() {
        let rl = RateLimiter::new();
        assert!(rl.check("login", "a", 1, WINDOW).is_ok());
        assert!(rl.check("login", "a", 1, WINDOW).is_err()); // a exhausted
        assert!(rl.check("login", "b", 1, WINDOW).is_ok()); // b unaffected
    }

    #[test]
    fn different_buckets_are_independent() {
        let rl = RateLimiter::new();
        assert!(rl.check("login", "a", 1, WINDOW).is_ok());
        assert!(rl.check("login", "a", 1, WINDOW).is_err());
        // Same client, different bucket → separate counter.
        assert!(rl.check("request-link", "a", 1, WINDOW).is_ok());
    }

    #[test]
    fn window_reset_allows_again() {
        let rl = RateLimiter::new();
        // A zero-length window means every call starts a fresh window → never blocks.
        assert!(rl.check("b", "c", 1, Duration::from_secs(0)).is_ok());
        assert!(rl.check("b", "c", 1, Duration::from_secs(0)).is_ok());
    }

    fn hdrs(xff: Option<&str>) -> HeaderMap {
        let mut h = HeaderMap::new();
        if let Some(v) = xff {
            h.insert("x-forwarded-for", v.parse().unwrap());
        }
        h
    }

    #[test]
    fn client_ip_takes_last_hop_trimmed() {
        // The trusted proxy (Caddy) appends the real peer IP on the right; a client
        // may only prepend fake entries on the left, which we must ignore.
        assert_eq!(client_ip(&hdrs(Some("203.0.113.7, 10.0.0.1"))), "10.0.0.1");
        assert_eq!(client_ip(&hdrs(Some("  198.51.100.2  "))), "198.51.100.2");
        // A spoofed leftmost entry cannot change the bucket.
        assert_eq!(client_ip(&hdrs(Some("1.1.1.1, 9.9.9.9"))), "9.9.9.9");
    }

    #[test]
    fn client_ip_falls_back_when_absent_or_empty() {
        assert_eq!(client_ip(&hdrs(None)), "unknown");
        assert_eq!(client_ip(&hdrs(Some(""))), "unknown");
    }
}
