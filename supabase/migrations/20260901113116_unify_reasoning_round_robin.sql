-- Unify all reasoning provider configs to round_robin for even distribution.
-- Hash-seeded round_robin (selector.ts roundRobinOrder) distributes across all
-- active reasoning models via hash(sessionId) % n, without global counter.
-- Cooldown/eligibility still provides failover when a key is rate-limited.

update public.provider_configs
   set selection_strategy = 'round_robin',
       updated_at = now()
 where capability = 'reasoning'
   and selection_strategy <> 'round_robin';
