-- Archive le texte exact du contrat accepté par le client à la signature (pas
-- seulement le numéro de version) : preuve juridique de ce qui a été signé, même
-- si le modèle de contrat évolue ensuite.

alter table booking add column contract_text text;
