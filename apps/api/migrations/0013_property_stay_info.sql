-- Infos de préparation au séjour, éditables dans l'admin, affichées dans
-- l'espace client (rappel logement / consignes d'arrivée / règles).
alter table property
  add column if not exists arrival_instructions text not null default '',
  add column if not exists house_rules          text not null default '';

update property set
  arrival_instructions =
    'Arrivée à partir de 17h le samedi. Les clés se récupèrent dans la boîte à clés sécurisée à l''entrée de la résidence (code envoyé par e-mail 48h avant l''arrivée). Parking en sous-sol, place n°12. En cas de retard, prévenez-nous au 06 00 00 00 00.',
  house_rules = E'6 personnes maximum\nLogement non-fumeur\nAnimaux non admis\nCalme après 22h\nTri sélectif : local à l''entrée du bâtiment\nDépart avant 10h le samedi, logement rangé et vaisselle faite'
where coalesce(arrival_instructions, '') = '';
