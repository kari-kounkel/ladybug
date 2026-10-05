alter table public.ladybug_team_members add column if not exists admin_access_hash text;
alter table public.ladybug_team_events add column if not exists hq_details jsonb not null default '{}'::jsonb;
alter table public.ladybug_team_events add column if not exists team_updates jsonb not null default '[]'::jsonb;
alter table public.ladybug_team_signups add column if not exists status text not null default 'accepted' check (status in ('accepted','in_progress','done'));
alter table public.ladybug_team_signups add column if not exists internal_notes text not null default '';
