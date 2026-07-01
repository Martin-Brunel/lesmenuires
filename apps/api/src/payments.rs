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

    /// Off-session charge on the saved card (balance).
    async fn charge_off_session(
        &self,
        customer_ref: &str,
        payment_method_ref: &str,
        amount_cents: i64,
    ) -> Result<String, AppError>;

    /// Manual-capture authorization (caution hold).
    async fn authorize_hold(
        &self,
        customer_ref: &str,
        payment_method_ref: &str,
        amount_cents: i64,
    ) -> Result<String, AppError>;

    async fn capture(&self, intent_id: &str, amount_cents: i64) -> Result<(), AppError>;
    async fn release(&self, intent_id: &str) -> Result<(), AppError>;
    /// Refund (partial or full) a captured PaymentIntent. Returns the refund id.
    async fn refund(&self, intent_id: &str, amount_cents: i64) -> Result<String, AppError>;
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
    async fn charge_off_session(
        &self,
        _customer_ref: &str,
        _payment_method_ref: &str,
        _amount_cents: i64,
    ) -> Result<String, AppError> {
        Ok(fake("mock_pi"))
    }
    async fn authorize_hold(
        &self,
        _customer_ref: &str,
        _payment_method_ref: &str,
        _amount_cents: i64,
    ) -> Result<String, AppError> {
        Ok(fake("mock_auth"))
    }
    async fn capture(&self, _intent_id: &str, _amount_cents: i64) -> Result<(), AppError> {
        Ok(())
    }
    async fn release(&self, _intent_id: &str) -> Result<(), AppError> {
        Ok(())
    }
    async fn refund(&self, _intent_id: &str, _amount_cents: i64) -> Result<String, AppError> {
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
            http: reqwest::Client::new(),
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
            return Err(AppError::BadRequest(format!("Stripe : {msg}")));
        }
        Ok(body)
    }

    async fn post(
        &self,
        path: &str,
        form: &[(&str, String)],
    ) -> Result<serde_json::Value, AppError> {
        let res = self
            .http
            .post(format!("https://api.stripe.com/v1{path}"))
            .bearer_auth(&self.secret_key)
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
        let customer = self
            .post(
                "/customers",
                &[("metadata[reference]", reference.to_string())],
            )
            .await?;
        let customer_id = jstr(&customer, "id");

        let pi = self
            .post(
                "/payment_intents",
                &[
                    ("amount", amount_cents.to_string()),
                    ("currency", "eur".to_string()),
                    ("customer", customer_id.clone()),
                    ("setup_future_usage", "off_session".to_string()),
                    ("automatic_payment_methods[enabled]", "true".to_string()),
                    ("metadata[reference]", reference.to_string()),
                ],
            )
            .await?;

        Ok(DepositIntent {
            intent_id: jstr(&pi, "id"),
            client_secret: jstr(&pi, "client_secret"),
            customer_id: Some(customer_id),
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
    ) -> Result<String, AppError> {
        let pi = self
            .post(
                "/payment_intents",
                &[
                    ("amount", amount_cents.to_string()),
                    ("currency", "eur".to_string()),
                    ("customer", customer_ref.to_string()),
                    ("payment_method", payment_method_ref.to_string()),
                    ("off_session", "true".to_string()),
                    ("confirm", "true".to_string()),
                ],
            )
            .await?;
        Ok(jstr(&pi, "id"))
    }

    async fn authorize_hold(
        &self,
        customer_ref: &str,
        payment_method_ref: &str,
        amount_cents: i64,
    ) -> Result<String, AppError> {
        let pi = self
            .post(
                "/payment_intents",
                &[
                    ("amount", amount_cents.to_string()),
                    ("currency", "eur".to_string()),
                    ("customer", customer_ref.to_string()),
                    ("payment_method", payment_method_ref.to_string()),
                    ("off_session", "true".to_string()),
                    ("confirm", "true".to_string()),
                    ("capture_method", "manual".to_string()),
                ],
            )
            .await?;
        Ok(jstr(&pi, "id"))
    }

    async fn capture(&self, intent_id: &str, amount_cents: i64) -> Result<(), AppError> {
        self.post(
            &format!("/payment_intents/{intent_id}/capture"),
            &[("amount_to_capture", amount_cents.to_string())],
        )
        .await?;
        Ok(())
    }

    async fn release(&self, intent_id: &str) -> Result<(), AppError> {
        self.post(&format!("/payment_intents/{intent_id}/cancel"), &[])
            .await?;
        Ok(())
    }

    async fn refund(&self, intent_id: &str, amount_cents: i64) -> Result<String, AppError> {
        let r = self
            .post(
                "/refunds",
                &[
                    ("payment_intent", intent_id.to_string()),
                    ("amount", amount_cents.to_string()),
                ],
            )
            .await?;
        Ok(jstr(&r, "id"))
    }
}

// ---------------------------------------------------------------------------

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
