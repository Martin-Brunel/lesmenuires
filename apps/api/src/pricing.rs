//! Server-side pricing. Amounts are always computed here from catalog prices —
//! never trusted from the client.

/// Nights in a strict Saturday→Saturday week.
pub const NIGHTS_PER_WEEK: i64 = 7;

pub struct Totals {
    pub week_price_cents: i64,
    pub extras_total_cents: i64,
    /// Rental total (accommodation + extras). Excludes the tourist tax, which is a
    /// pass-through collected for the commune, not rental revenue.
    pub total_cents: i64,
    pub deposit_cents: i64,
    /// Remaining rental + the full tourist tax (collected before arrival).
    pub balance_cents: i64,
    /// Taxe de séjour = rate per adult per night × adults × nights (minors exempt).
    pub tourist_tax_cents: i64,
}

/// total = week + extras ; deposit = round(total * pct%) on the rental only ;
/// tourist tax is added in full to the balance (pass-through for the commune).
pub fn compute(
    week_price_cents: i64,
    extras: &[i64],
    deposit_pct: i64,
    tourist_tax_per_adult_night_cents: i64,
    adults: i64,
    nights: i64,
) -> Totals {
    let extras_total_cents: i64 = extras.iter().sum();
    let total_cents = week_price_cents + extras_total_cents;
    let deposit_cents = ((total_cents * deposit_pct) as f64 / 100.0).round() as i64;
    let tourist_tax_cents =
        tourist_tax_per_adult_night_cents.max(0) * adults.max(0) * nights.max(0);
    let balance_cents = total_cents - deposit_cents + tourist_tax_cents;
    Totals {
        week_price_cents,
        extras_total_cents,
        total_cents,
        deposit_cents,
        balance_cents,
        tourist_tax_cents,
    }
}
