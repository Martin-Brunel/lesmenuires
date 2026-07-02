-- Pays du client : passage au code ISO 3166-1 alpha-2 (affichage localisé
-- côté front). Migration des libellés français existants les plus courants ;
-- les valeurs inconnues sont conservées telles quelles.
update customer set country = upper(country) where length(trim(country)) = 2;
update customer set country = 'FR' where lower(trim(country)) = 'france';
update customer set country = 'BE' where lower(trim(country)) = 'belgique';
update customer set country = 'CH' where lower(trim(country)) = 'suisse';
update customer set country = 'LU' where lower(trim(country)) = 'luxembourg';
update customer set country = 'DE' where lower(trim(country)) = 'allemagne';
update customer set country = 'IT' where lower(trim(country)) = 'italie';
update customer set country = 'ES' where lower(trim(country)) = 'espagne';
update customer set country = 'PT' where lower(trim(country)) = 'portugal';
update customer set country = 'NL' where lower(trim(country)) = 'pays-bas';
update customer set country = 'GB' where lower(trim(country)) in ('royaume-uni', 'angleterre');
update customer set country = 'MC' where lower(trim(country)) = 'monaco';
update customer set country = 'US' where lower(trim(country)) in ('états-unis', 'etats-unis', 'usa');
update customer set country = 'CA' where lower(trim(country)) = 'canada';
