//! Payment provider abstraction (Stripe + mock).
//!
//! `from_env` returns the real `StripeProvider` when `STRIPE_SECRET_KEY` (sk_…)
//! is set, otherwise a `MockProvider` that simulates the whole flow.

use crate::error::AppError;
use async_trait::async_trait;
use std::sync::Arc;
use uuid::Uuid;

/// A created deposit PaymentIntent.
pub struct DepositIntent {
    pub intent_id: String,
    pub client_secret: String,
    pub customer_id: Option<String>,
}

/// Result of retrieving the deposit intent (for confirmation).
pub struct DepositResult {
    pub paid: bool,
    pub customer_id: Option<String>,
    pub payment_method_id: Option<String>,
}

#[async_trait]
pub trait PaymentProvider: Send + Sync {
    fn name(&self) -> &'static str;
    fn publishable_key(&self) -> Option<String>;

    /// Deposit PaymentIntent (saves the card for later off-session use).
    async fn create_deposit_intent(
        &self,
        reference: &str,
        amount_cents: i64,
    ) -> Result<DepositIntent, AppError>;

    /// Read the deposit intent status + saved card (after the buyer paid).
    async fn retrieve_deposit(&self, intent_id: &str) -> Result<DepositResult, AppError>;

    /// On-session PaymentIntent for the remaining balance, so a customer whose
    /// off-session charge failed (SCA/3DS, expired card) can pay in the browser.
    /// Reuses the booking's existing Stripe customer when known.
    async fn create_balance_intent(
        &self,
        reference: &str,
        amount_cents: i64,
        customer_ref: Option<&str>,
    ) -> Result<DepositIntent, AppError>;

    /// Off-session charge on the saved card (balance). `idem` is a stable
    /// idempotency key so a retried tick never double-charges.
    async fn charge_off_session(
        &self,
        customer_ref: &str,
        payment_method_ref: &str,
        amount_cents: i64,
        idem: &str,
    ) -> Result<String, AppError>;

    async fn release(&self, intent_id: &str, idem: &str) -> Result<(), AppError>;
    /// Refund (partial or full) a captured PaymentIntent. Returns the refund id.
    /// `idem` is a stable key so a retried refund never double-refunds.
    async fn refund(
        &self,
        intent_id: &str,
        amount_cents: i64,
        idem: &str,
    ) -> Result<String, AppError>;
}

fn fake(prefix: &str) -> String {
    format!("{prefix}_{}", Uuid::new_v4().simple())
}

// ---------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------

pub struct MockProvider;

#[async_trait]
impl PaymentProvider for MockProvider {
    fn name(&self) -> &'static str {
        "mock"
    }
    fn publishable_key(&self) -> Option<String> {
        None
    }
    async fn create_deposit_intent(
        &self,
        _reference: &str,
        _amount_cents: i64,
    ) -> Result<DepositIntent, AppError> {
        let intent_id = fake("mock_pi");
        Ok(DepositIntent {
            client_secret: format!("{intent_id}_secret"),
            intent_id,
            customer_id: Some("mock_cus".into()),
        })
    }
    async fn retrieve_deposit(&self, _intent_id: &str) -> Result<DepositResult, AppError> {
        Ok(DepositResult {
            paid: true,
            customer_id: Some("mock_cus".into()),
            payment_method_id: Some("mock_pm".into()),
        })
    }
    async fn create_balance_intent(
        &self,
        _reference: &str,
        _amount_cents: i64,
        _customer_ref: Option<&str>,
    ) -> Result<DepositIntent, AppError> {
        let intent_id = fake("mock_pi");
        Ok(DepositIntent {
            client_secret: format!("{intent_id}_secret"),
            intent_id,
            customer_id: Some("mock_cus".into()),
        })
    }
    async fn charge_off_session(
        &self,
        _customer_ref: &str,
        _payment_method_ref: &str,
        _amount_cents: i64,
        _idem: &str,
    ) -> Result<String, AppError> {
        Ok(fake("mock_pi"))
    }
    async fn release(&self, _intent_id: &str, _idem: &str) -> Result<(), AppError> {
        Ok(())
    }
    async fn refund(
        &self,
        _intent_id: &str,
        _amount_cents: i64,
        _idem: &str,
    ) -> Result<String, AppError> {
        Ok("re_mock".to_string())
    }
}

// ---------------------------------------------------------------------------
// Stripe (REST API via reqwest, form-encoded)
// ---------------------------------------------------------------------------

pub struct StripeProvider {
    secret_key: String,
    publishable_key: Option<String>,
    http: reqwest::Client,
}

impl StripeProvider {
    pub fn new(secret_key: String, publishable_key: Option<String>) -> Self {
        Self {
            secret_key,
            publishable_key,
            // Bound every Stripe call: a hung request would otherwise stall the
            // scheduler tick (off-session charges) or a payment handler indefinitely.
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .unwrap_or_default(),
        }
    }

    async fn handle(&self, res: reqwest::Response) -> Result<serde_json::Value, AppError> {
        let status = res.status();
        let body: serde_json::Value = res
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("stripe json: {e}")))?;
        if !status.is_success() {
            let msg = body
                .pointer("/error/message")
                .and_then(|m| m.as_str())
                .unwrap_or("erreur Stripe");
            // 429 (rate limit) and 5xx (Stripe outage) are TRANSIENT: the charge may
            // have applied even though the response failed. Return Internal so the
            // scheduler keeps the same idempotency key (safe replay) instead of
            // advancing it and risking a double charge. Card declines / invalid
            // requests (4xx) are definitive → BadRequest (retry with a fresh key).
            if status.as_u16() == 429 || status.is_server_error() {
                return Err(AppError::Internal(format!(
                    "Stripe transitoire ({status}): {msg}"
                )));
            }
            return Err(AppError::BadRequest(format!("Stripe : {msg}")));
        }
        Ok(body)
    }

    /// POST with an optional Stripe `Idempotency-Key`. Passing a stable key makes
    /// a retried request return the original result instead of creating a new
    /// charge/refund — essential for the scheduler's automatic retries.
    async fn post_idem(
        &self,
        path: &str,
        form: &[(&str, String)],
        idem: Option<&str>,
    ) -> Result<serde_json::Value, AppError> {
        let mut req = self
            .http
            .post(format!("https://api.stripe.com/v1{path}"))
            .bearer_auth(&self.secret_key);
        if let Some(key) = idem {
            req = req.header("Idempotency-Key", key);
        }
        let res = req
            .form(form)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("stripe http: {e}")))?;
        self.handle(res).await
    }

    async fn get(&self, path: &str) -> Result<serde_json::Value, AppError> {
        let res = self
            .http
            .get(format!("https://api.stripe.com/v1{path}"))
            .bearer_auth(&self.secret_key)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("stripe http: {e}")))?;
        self.handle(res).await
    }
}

fn jstr(v: &serde_json::Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string()
}

#[async_trait]
impl PaymentProvider for StripeProvider {
    fn name(&self) -> &'static str {
        "stripe"
    }
    fn publishable_key(&self) -> Option<String> {
        self.publishable_key.clone()
    }

    async fn create_deposit_intent(
        &self,
        reference: &str,
        amount_cents: i64,
    ) -> Result<DepositIntent, AppError> {
        // Stable keys per booking reference: a retried pay-deposit (double click,
        // lost response) reuses the same customer + PaymentIntent instead of
        // spawning orphans. The reference is invalidated on any cart change, so
        // the amount tied to a reference never varies.
        let customer = self
            .post_idem(
                "/customers",
                &[("metadata[reference]", reference.to_string())],
                Some(&format!("cus-{reference}")),
            )
            .await?;
        let customer_id = jstr(&customer, "id");

        let pi = self
            .post_idem(
                "/payment_intents",
                &[
                    ("amount", amount_cents.to_string()),
                    ("currency", "eur".to_string()),
                    ("customer", customer_id.clone()),
                    ("setup_future_usage", "off_session".to_string()),
                    ("automatic_payment_methods[enabled]", "true".to_string()),
                    ("metadata[reference]", reference.to_string()),
                ],
                Some(&format!("pi-deposit-{reference}")),
            )
            .await?;

        Ok(DepositIntent {
            intent_id: jstr(&pi, "id"),
            client_secret: jstr(&pi, "client_secret"),
            customer_id: Some(customer_id),
        })
    }

    async fn create_balance_intent(
        &self,
        reference: &str,
        amount_cents: i64,
        customer_ref: Option<&str>,
    ) -> Result<DepositIntent, AppError> {
        // Reuse the existing customer when known (keeps the saved card). Stable key
        // per reference: the balance is fixed, so a retried pay-balance reuses the
        // same intent instead of spawning orphans.
        let mut params = vec![
            ("amount", amount_cents.to_string()),
            ("currency", "eur".to_string()),
            ("automatic_payment_methods[enabled]", "true".to_string()),
            ("metadata[reference]", reference.to_string()),
            ("metadata[kind]", "balance".to_string()),
        ];
        if let Some(cus) = customer_ref.filter(|c| !c.is_empty()) {
            params.push(("customer", cus.to_string()));
        }
        let pi = self
            .post_idem(
                "/payment_intents",
                &params,
                Some(&format!("pi-balance-{reference}")),
            )
            .await?;
        Ok(DepositIntent {
            intent_id: jstr(&pi, "id"),
            client_secret: jstr(&pi, "client_secret"),
            customer_id: customer_ref.map(|c| c.to_string()),
        })
    }

    async fn retrieve_deposit(&self, intent_id: &str) -> Result<DepositResult, AppError> {
        let pi = self.get(&format!("/payment_intents/{intent_id}")).await?;
        Ok(DepositResult {
            paid: pi.get("status").and_then(|s| s.as_str()) == Some("succeeded"),
            customer_id: pi
                .get("customer")
                .and_then(|c| c.as_str())
                .map(String::from),
            payment_method_id: pi
                .get("payment_method")
                .and_then(|p| p.as_str())
                .map(String::from),
        })
    }

    async fn charge_off_session(
        &self,
        customer_ref: &str,
        payment_method_ref: &str,
        amount_cents: i64,
        idem: &str,
    ) -> Result<String, AppError> {
        let pi = self
            .post_idem(
                "/payment_intents",
                &[
                    ("amount", amount_cents.to_string()),
                    ("currency", "eur".to_string()),
                    ("customer", customer_ref.to_string()),
                    ("payment_method", payment_method_ref.to_string()),
                    ("off_session", "true".to_string()),
                    ("confirm", "true".to_string()),
                ],
                Some(idem),
            )
            .await?;
        Ok(jstr(&pi, "id"))
    }

    async fn release(&self, intent_id: &str, idem: &str) -> Result<(), AppError> {
        self.post_idem(
            &format!("/payment_intents/{intent_id}/cancel"),
            &[],
            Some(idem),
        )
        .await?;
        Ok(())
    }

    async fn refund(
        &self,
        intent_id: &str,
        amount_cents: i64,
        idem: &str,
    ) -> Result<String, AppError> {
        let r = self
            .post_idem(
                "/refunds",
                &[
                    ("payment_intent", intent_id.to_string()),
                    ("amount", amount_cents.to_string()),
                ],
                Some(idem),
            )
            .await?;
        Ok(jstr(&r, "id"))
    }
}

// ---------------------------------------------------------------------------

/// True when a real Stripe secret key is configured (provider is Stripe, not mock).
/// Used to fail closed: require a verified webhook secret and refuse the mock
/// provider in production.
pub fn stripe_active() -> bool {
    matches!(std::env::var("STRIPE_SECRET_KEY"), Ok(key) if key.starts_with("sk_"))
}

pub fn from_env() -> Arc<dyn PaymentProvider> {
    match std::env::var("STRIPE_SECRET_KEY") {
        Ok(key) if key.starts_with("sk_") => {
            let pk = std::env::var("STRIPE_PUBLISHABLE_KEY")
                .ok()
                .filter(|k| !k.is_empty());
            tracing::info!("payments: provider 'stripe'");
            Arc::new(StripeProvider::new(key, pk))
        }
        Ok(key) if !key.is_empty() => {
            tracing::warn!("STRIPE_SECRET_KEY format inattendu — fallback mock");
            Arc::new(MockProvider)
        }
        _ => {
            tracing::info!("payments: provider 'mock' (aucune clé Stripe)");
            Arc::new(MockProvider)
        }
    }
}
