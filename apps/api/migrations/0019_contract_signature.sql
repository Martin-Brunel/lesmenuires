-- Persist the contract acceptance & signature as legal evidence: which version of
-- the contract/CGV the customer accepted, when, and the drawn signature image.
-- Without this the funnel's canvas signature was never stored (no proof at all).

alter table booking
  add column contract_version    text,
  add column contract_accepted_at timestamptz,
  add column signature_png        text; -- PNG data URL of the drawn signature
