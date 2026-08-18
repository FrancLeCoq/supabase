-- reflex_home() servait a charger les 3 niveaux au demarrage de l'application.
-- Le client ne fait plus aucun appel au lancement : les lignes sous les niveaux
-- viennent d'un cache local, rafraichi seulement a l'ouverture du classement
-- general ou apres un record. La fonction n'est donc plus appelee par personne,
-- et on ne laisse pas une fonction SECURITY DEFINER inutile exposee a anon.
drop function if exists public.reflex_home(text);
