-- ============================================================================
--  GMAIL-ACTIONS — planification pg_cron (MODÈLE, à appliquer SEULEMENT à l'activation)
-- ============================================================================
--  ⚠️ NE PAS appliquer tant que la simulation n'est pas validée. Ce fichier n'est PAS
--  une migration : il n'est pas exécuté par la CI. Il sert à PLANIFIER l'appel récurrent
--  de la fonction gmail-actions UNE FOIS que :
--    1) la migration des tables (gmail_traites / gmail_a_verifier) est appliquée en prod,
--    2) la simulation a été validée (action 'simulate'),
--    3) le secret GMAIL_ACTIONS_ENABLED = '1' est posé (sinon 'run' reste dormant),
--    4) le secret GMAIL_ACTIONS_SECRET (ou KM_RELANCE_SECRET réutilisé) est posé.
--
--  Remplacer <<GMAIL_ACTIONS_SECRET>> par la vraie valeur AU MOMENT de l'exécution dans
--  l'éditeur SQL (ne pas committer la vraie valeur — dépôt public).
--
--  Désinstallation : select cron.unschedule('gmail-actions-reguliere');
-- ============================================================================

-- Idempotent : retire l'ancienne planification si elle existe.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'gmail-actions-reguliere') then
    perform cron.unschedule('gmail-actions-reguliere');
  end if;
end $$;

-- Toutes les 15 minutes : POST { action: 'run' } vers la fonction, protégé par le secret cron.
select cron.schedule(
  'gmail-actions-reguliere',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://tzjuptlzoywjeigmyfuj.supabase.co/functions/v1/gmail-actions',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<<GMAIL_ACTIONS_SECRET>>'),
    body    := jsonb_build_object('action','run')
  );
  $$
);
