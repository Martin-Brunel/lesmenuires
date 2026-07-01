-- Data-integrity guards: constrain booking/payment status & type to the values
-- the code actually uses (availability_week already had such a CHECK). Tables are
-- empty on a fresh deployment so validation is instant.

alter table booking
  add constraint booking_status_check
  check (status in ('cart', 'confirmed', 'balance_paid', 'cancelled'));

alter table payment
  add constraint payment_type_check
  check (type in ('deposit', 'balance', 'caution_auth', 'caution_capture',
                  'caution_release', 'refund'));

alter table payment
  add constraint payment_status_check
  check (status in ('pending', 'succeeded', 'authorized', 'captured',
                    'released', 'refunded', 'failed'));
