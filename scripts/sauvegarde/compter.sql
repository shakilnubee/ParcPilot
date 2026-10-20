-- Parc Pilot — comptage des lignes, pour comparer la base SOURCE et la base RESTAURÉE.
-- Lecture seule. Utilisé par .github/workflows/sauvegarde.yml (psql -At -f …).
-- Sortie : une ligne « table|nombre » par table, triée (comparable avec diff).
select string_agg(
         format('select %L || ''|'' || count(*) from %I.%I', schemaname || '.' || tablename, schemaname, tablename),
         ' union all ' order by schemaname, tablename)
       || ' order by 1'
from pg_tables
where schemaname = 'public'
   or (schemaname = 'auth' and tablename in ('users', 'identities'))
   or (schemaname = 'storage' and tablename in ('buckets', 'objects'))
\gexec
