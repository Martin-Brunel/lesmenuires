-- Transactionnels vers un destinataire fixe (prestataires : ménage, linge,
-- conciergerie…). Vide = envoyé au client du dossier (comportement historique).
alter table email_automation add column recipient_email text not null default '';
