//! Server-side pricing. Amounts are always computed here from catalog prices —
//! never trusted from the client.

pub struct Totals {
    pub week_price_cents: i64,
    pub extras_total_cents: i64,
    pub total_cents: i64,
    pub deposit_cents: i64,
    pub balance_cents: i64,
}

/// Mirrors the front prototype: total = week + extras, deposit = round(total * pct%).
pub fn compute(week_price_cents: i64, extras: &[i64], deposit_pct: i64) -> Totals {
    let extras_total_cents: i64 = extras.iter().sum();
    let total_cents = week_price_cents + extras_total_cents;
    let deposit_cents = ((total_cents * deposit_pct) as f64 / 100.0).round() as i64;
    let balance_cents = total_cents - deposit_cents;
    Totals {
        week_price_cents,
        extras_total_cents,
        total_cents,
        deposit_cents,
        balance_cents,
    }
}
