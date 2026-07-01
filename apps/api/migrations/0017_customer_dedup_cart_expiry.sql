-- (a) Deduplicate customers by e-mail so a returning client sees ALL their
--     bookings in /espace (create_booking used to INSERT a new customer row on
--     every attempt, fragmenting history and the magic-link login).
-- (b) Enforce e-mail uniqueness (case-insensitive) so future writes upsert.
-- (c) Allow the 'expired' booking status for the abandoned-cart cleanup job.

-- Repoint bookings from duplicate customers to the earliest ("kept") row.
with ranked as (
  select id,
         first_value(id) over (
           partition by lower(email) order by created_at, id
         ) as keep_id
  from customer
  where coalesce(email, '') <> ''
)
update booking b
set customer_id = r.keep_id
from ranked r
where b.customer_id = r.id
  and r.id <> r.keep_id;

-- Delete the now-orphaned duplicate customers (their sessions/magic links
-- cascade away; the client simply re-authenticates once).
with ranked as (
  select id,
         first_value(id) over (
           partition by lower(email) order by created_at, id
         ) as keep_id
  from customer
  where coalesce(email, '') <> ''
)
delete from customer c
using ranked r
where c.id = r.id
  and r.id <> r.keep_id;

-- Case-insensitive uniqueness for non-empty e-mails only.
create unique index customer_email_lower_uniq
  on customer (lower(email))
  where coalesce(email, '') <> '';

-- Extend the status guard with 'expired' (abandoned carts swept by the scheduler).
alter table booking drop constraint if exists booking_status_check;
alter table booking
  add constraint booking_status_check
  check (status in ('cart', 'confirmed', 'balance_paid', 'cancelled', 'expired'));
