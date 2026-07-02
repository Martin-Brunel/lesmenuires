-- Signature du contrat par lien e-mail (réservations manuelles) : jeton
-- capability unique par dossier. Le lien reste valable après signature — il
-- sert alors de copie consultable/imprimable du contrat pour le client.
alter table booking add column contract_sign_token text unique;
