-- Parc Pilot — export des RÈGLES D'ACCÈS du stockage (policies sur storage.objects / storage.buckets).
-- Lecture seule. Le dump officiel « supabase db dump » IGNORE le schéma storage (géré par Supabase) :
-- ces règles — cloisonnement des fichiers par société — doivent donc être sauvegardées à part.
-- Sortie : un script SQL rejouable (drop + create de chaque policy) sur une base restaurée.
select coalesce(string_agg(
         format('drop policy if exists %I on %I.%I;', policyname, schemaname, tablename) || E'\n' ||
         format('create policy %I on %I.%I as %s for %s to %s%s%s;',
                policyname, schemaname, tablename, permissive, cmd, array_to_string(roles, ', '),
                case when qual is not null then ' using (' || qual || ')' else '' end,
                case when with_check is not null then ' with check (' || with_check || ')' else '' end),
         E'\n' order by tablename, policyname), '-- (aucune règle)')
from pg_policies
where schemaname = 'storage';
