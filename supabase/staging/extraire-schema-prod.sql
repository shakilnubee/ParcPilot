-- ============================================================================
--  Parc Pilot — EXTRACTION DE LA STRUCTURE de la base (aucune donnée)
-- ============================================================================
--  Lecture seule. À lancer dans le SQL Editor du projet SOURCE (ex. la prod).
--  Renvoie UNE cellule de texte : le script SQL qui recrée la même structure
--  (extensions, séquences, tables, contraintes, index, fonctions, vues, droits
--  des vues, RLS, policies public + storage, déclencheurs, buckets).
--
--  Pour l'appliquer sur un projet VIDE (ex. le staging), dans son SQL Editor :
--    begin;
--    set local check_function_bodies = off;   -- fonctions SQL avant les tables
--    <sections dans cet ordre : Extensions, Séquences, Fonctions, Tables,
--     Contraintes, Index, Vues, Droits, RLS, Policies, Déclencheurs, Buckets>
--    commit;
--  Contrôle de conformité : supabase/staging/README.md (empreintes identiques).
--
--  Utilisé le 16/10/2026 pour créer le staging (parc-pilot-staging).
-- ============================================================================
with
tabs as (
  select c.oid, c.relname from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') order by c.relname
),
ext as (
  select string_agg(format('create extension if not exists %I with schema %I;', e.extname, n.nspname), E'\n' order by e.extname) as s
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname not in ('plpgsql')
),
seq as (
  select string_agg(format('create sequence if not exists public.%I;', c.relname), E'\n' order by c.relname) as s
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
),
tbl as (
  select string_agg(
    format(E'create table if not exists public.%I (\n%s\n);', t.relname,
      (select string_agg(format('  %I %s%s%s', a.attname, format_type(a.atttypid, a.atttypmod),
              case when a.attidentity in ('a','d') then ' generated ' || case a.attidentity when 'a' then 'always' else 'by default' end || ' as identity' else '' end
              || case when ad.adbin is not null and a.attidentity = '' then ' default ' || pg_get_expr(ad.adbin, ad.adrelid) else '' end,
              case when a.attnotnull then ' not null' else '' end, ''), E',\n' order by a.attnum)
       from pg_attribute a left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
       where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped)),
    E'\n\n' order by t.relname) as s from tabs t
),
cons as (
  select string_agg(format('alter table public.%I add constraint %I %s;', t.relname, co.conname, pg_get_constraintdef(co.oid)), E'\n'
         order by case co.contype when 'p' then 0 when 'u' then 1 when 'c' then 2 else 3 end, t.relname, co.conname) as s
  from tabs t join pg_constraint co on co.conrelid = t.oid
),
idx as (
  select string_agg(pg_get_indexdef(i.indexrelid) || ';', E'\n' order by t.relname) as s
  from tabs t join pg_index i on i.indrelid = t.oid
  where not exists (select 1 from pg_constraint co where co.conindid = i.indexrelid)
),
fns as (
  select string_agg(pg_get_functiondef(p.oid) || ';', E'\n\n' order by p.proname) as s
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
),
vws as (
  select string_agg(format(E'create or replace view public.%I%s as\n%s', c.relname,
           case when c.reloptions is not null then ' with (' || array_to_string(c.reloptions, ', ') || ')' else '' end,
           pg_get_viewdef(c.oid, true)), E'\n\n' order by c.relname) as s
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
),
rls as (
  select string_agg(format('alter table public.%I enable row level security;', t.relname) ||
           case when c.relforcerowsecurity then format(E'\nalter table public.%I force row level security;', t.relname) else '' end, E'\n' order by t.relname) as s
  from tabs t join pg_class c on c.oid = t.oid where c.relrowsecurity
),
pol as (
  select string_agg(format('create policy %I on %I.%I as %s for %s to %s%s%s;', p.policyname, p.schemaname, p.tablename,
           p.permissive, p.cmd, array_to_string(p.roles, ', '),
           case when p.qual is not null then ' using (' || p.qual || ')' else '' end,
           case when p.with_check is not null then ' with check (' || p.with_check || ')' else '' end), E'\n'
         order by p.schemaname, p.tablename, p.policyname) as s
  from pg_policies p where p.schemaname in ('public', 'storage')
),
trg as (
  select string_agg(pg_get_triggerdef(tg.oid) || ';', E'\n' order by c.relname, tg.tgname) as s
  from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
  where c.relnamespace = 'public'::regnamespace and not tg.tgisinternal
),
bkt as (
  select string_agg(format('insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (%L, %L, %s, %s, %s) on conflict (id) do nothing;',
           b.id, b.name, case when b.public then 'true' else 'false' end, coalesce(b.file_size_limit::text, 'null'), coalesce(quote_literal(b.allowed_mime_types::text) || '::text[]', 'null')), E'\n') as s
  from storage.buckets b
),
grt as (
  -- Pour chaque vue : on retire d'abord TOUS les droits (une seule fois), puis on redonne exactement ceux de la prod.
  select string_agg(s, E'\n' order by ord, s) as s from (
    select 0 as ord, format('revoke all on public.%I from anon, authenticated;', c.relname) as s
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
    union all
    select 1, format('grant %s on public.%I to %s;', string_agg(privilege_type, ', ' order by privilege_type), table_name, grantee)
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated')
        and table_name in (select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')
      group by table_name, grantee
  ) g
)
select concat_ws(E'\n\n',
  '-- ===== Extensions', (select s from ext),
  '-- ===== Séquences', (select s from seq),
  '-- ===== Tables', (select s from tbl),
  '-- ===== Contraintes (clés primaires, uniques, checks, clés étrangères)', (select s from cons),
  '-- ===== Index', (select s from idx),
  '-- ===== Fonctions', (select s from fns),
  '-- ===== Vues', (select s from vws),
  '-- ===== Droits sur les vues', (select s from grt),
  '-- ===== RLS', (select s from rls),
  '-- ===== Policies (public + storage)', (select s from pol),
  '-- ===== Déclencheurs', (select s from trg),
  '-- ===== Buckets de stockage', (select s from bkt)
) as ddl;
