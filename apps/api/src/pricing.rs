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

/// Rental = week + extras. Tourist tax = rate × adults × nights.
///
/// `tax_included` chooses how the tax enters the file total:
/// - `false` (default): `total` = rental, the tax is added in full to the balance
///   (pure pass-through, deposit computed on the rental only).
/// - `true`: `total` = rental + tax, the deposit % applies on the tax-inclusive
///   total, and the balance is the remainder.
///
/// The grand total collected (deposit + balance) is `rental + tax` either way.
pub fn compute(
    week_price_cents: i64,
    extras: &[i64],
    deposit_pct: i64,
    tourist_tax_per_adult_night_cents: i64,
    adults: i64,
    nights: i64,
    tax_included: bool,
) -> Totals {
    let extras_total_cents: i64 = extras.iter().sum();
    let rental_cents = week_price_cents + extras_total_cents;
    let tourist_tax_cents =
        tourist_tax_per_adult_night_cents.max(0) * adults.max(0) * nights.max(0);

    let total_cents = if tax_included {
        rental_cents + tourist_tax_cents
    } else {
        rental_cents
    };
    let deposit_cents = ((total_cents * deposit_pct) as f64 / 100.0).round() as i64;
    let balance_cents = if tax_included {
        total_cents - deposit_cents
    } else {
        rental_cents - deposit_cents + tourist_tax_cents
    };
    Totals {
        week_price_cents,
        extras_total_cents,
        total_cents,
        deposit_cents,
        balance_cents,
        tourist_tax_cents,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn week_only_no_tax() {
        let t = compute(100_000, &[], 30, 0, 2, NIGHTS_PER_WEEK, false);
        assert_eq!(t.total_cents, 100_000);
        assert_eq!(t.deposit_cents, 30_000);
        assert_eq!(t.tourist_tax_cents, 0);
        assert_eq!(t.balance_cents, 70_000);
        // Deposit + balance always reconstitute total + tax (no cent drift).
        assert_eq!(
            t.deposit_cents + t.balance_cents,
            t.total_cents + t.tourist_tax_cents
        );
    }

    #[test]
    fn with_extras() {
        let t = compute(100_000, &[5_000, 2_500], 30, 0, 2, NIGHTS_PER_WEEK, false);
        assert_eq!(t.extras_total_cents, 7_500);
        assert_eq!(t.total_cents, 107_500);
        assert_eq!(t.deposit_cents, 32_250);
        assert_eq!(t.balance_cents, 75_250);
    }

    #[test]
    fn tourist_tax_excluded_from_total() {
        // 1,50 €/adulte/nuit, 2 adultes, 7 nuits → 21,00 € ; taxe hors total (défaut).
        let t = compute(100_000, &[], 30, 150, 2, NIGHTS_PER_WEEK, false);
        assert_eq!(t.tourist_tax_cents, 2_100);
        assert_eq!(t.total_cents, 100_000); // hors taxe (revenu locatif)
        assert_eq!(t.deposit_cents, 30_000); // acompte sur le locatif seul
        assert_eq!(t.balance_cents, 72_100); // (100000-30000) + 2100
    }

    #[test]
    fn tourist_tax_included_in_total() {
        // Même séjour, taxe incluse : total = locatif + taxe, acompte sur le total.
        let t = compute(100_000, &[], 30, 150, 2, NIGHTS_PER_WEEK, true);
        assert_eq!(t.tourist_tax_cents, 2_100);
        assert_eq!(t.total_cents, 102_100); // locatif + taxe
        assert_eq!(t.deposit_cents, 30_630); // 30 % de 102100
        assert_eq!(t.balance_cents, 71_470); // 102100 - 30630
                                             // Grand total encaissé identique au cas exclu (100000 + 2100).
        assert_eq!(t.deposit_cents + t.balance_cents, 102_100);
    }

    #[test]
    fn deposit_rounds_half_up() {
        // total impair × 30 % → arrondi au centime, sans dérive.
        let t = compute(33_333, &[], 30, 0, 1, NIGHTS_PER_WEEK, false);
        assert_eq!(t.deposit_cents, 10_000); // round(9999.9) = 10000
        assert_eq!(t.deposit_cents + t.balance_cents, t.total_cents);
    }

    #[test]
    fn zero_and_negative_inputs_are_safe() {
        let t = compute(0, &[], 0, -50, -3, -1, false);
        assert_eq!(t.total_cents, 0);
        assert_eq!(t.deposit_cents, 0);
        assert_eq!(t.tourist_tax_cents, 0); // négatifs bornés à 0
        assert_eq!(t.balance_cents, 0);
    }

    #[test]
    fn full_deposit_leaves_only_tax_in_balance() {
        let t = compute(80_000, &[], 100, 150, 3, NIGHTS_PER_WEEK, false);
        assert_eq!(t.deposit_cents, 80_000);
        assert_eq!(t.tourist_tax_cents, 3_150);
        assert_eq!(t.balance_cents, 3_150); // rental fully covered, only tax remains
    }
}
