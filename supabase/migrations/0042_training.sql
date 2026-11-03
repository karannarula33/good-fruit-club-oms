-- Learn GFC: guided onboarding inside the OMS (admin, 2026-11-03). One
-- module per handbook section: lesson screens (content_md, screens split by a
-- line "---"; "try it" steps are ```tryit blocks inside it), a quick check
-- (training_questions, pass mark 80%) and an "I've read and understood"
-- acknowledgement. Rules live in src/lib/training/progress.ts.
--
-- Editing a module bumps its version; a learner who completed an older
-- version has to review it again (view the screens, pass the check and
-- acknowledge, all for the new version).
--
-- Security: learners only ever READ their own rows. Every write (screen
-- views, try-it ticks, quiz attempts and grading, acknowledgements) goes
-- through the server actions in src/app/actions/training.ts, which check the
-- caller and write with the service role, so nobody can mark themselves
-- complete or read the quiz answers from the browser. Questions (with the
-- correct answers) are admin-readable only.

create table public.training_modules (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  summary text not null default '',
  order_index integer not null,
  content_md text not null default '',
  version integer not null default 1,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

create table public.training_questions (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.training_modules (id) on delete cascade,
  order_index integer not null default 0,
  kind text not null default 'mcq' check (kind in ('mcq', 'scenario')),
  scenario text,                       -- the member's message, for kind = 'scenario'
  prompt text not null,
  options jsonb not null,              -- ["option", ...]
  correct_index integer not null,
  explanation text not null default '',
  is_active boolean not null default true
);
create index training_questions_module_idx on public.training_questions (module_id, order_index);

create table public.training_assignments (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles (id)
);

create table public.training_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  module_id uuid not null references public.training_modules (id) on delete cascade,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'completed', 'needs_review')),
  started_at timestamptz,
  completed_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_version integer,
  completed_version integer,           -- highest version ever completed (drives "needs review")
  module_version integer,              -- version the status was last worked out for
  best_score integer,                  -- best quick-check % for module_version
  updated_at timestamptz not null default now(),
  primary key (user_id, module_id)
);

create table public.training_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  module_id uuid not null references public.training_modules (id) on delete cascade,
  module_version integer not null,
  score integer not null,              -- percent
  correct integer not null,
  total integer not null,
  passed boolean not null,
  answers jsonb not null,              -- [{ questionId, chosen, correct }]
  attempted_at timestamptz not null default now()
);
create index training_attempts_user_idx on public.training_attempts (user_id, module_id, attempted_at desc);

create table public.training_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  module_id uuid not null references public.training_modules (id) on delete cascade,
  module_version integer not null,
  screen_index integer,
  event text not null check (event in ('viewed', 'try_it_done', 'reset')),
  at timestamptz not null default now()
);
create index training_events_user_idx on public.training_events (user_id, module_id, at desc);

alter table public.training_modules enable row level security;
alter table public.training_questions enable row level security;
alter table public.training_assignments enable row level security;
alter table public.training_progress enable row level security;
alter table public.training_attempts enable row level security;
alter table public.training_events enable row level security;

-- Modules (lesson text, no answers): anyone with a role.
create policy "training_modules_select_any_role"
  on public.training_modules for select
  using (public.has_role());
create policy "training_modules_all_admin"
  on public.training_modules for all
  using (public.is_admin()) with check (public.is_admin());

-- Questions carry the answers: admin only (learners get them without the
-- answers from the server).
create policy "training_questions_all_admin"
  on public.training_questions for all
  using (public.is_admin()) with check (public.is_admin());

-- Assignment, progress, attempts, events: your own rows, or everything for admin.
create policy "training_assignments_select_own"
  on public.training_assignments for select
  using (user_id = auth.uid() or public.is_admin());
create policy "training_assignments_all_admin"
  on public.training_assignments for all
  using (public.is_admin()) with check (public.is_admin());

create policy "training_progress_select_own"
  on public.training_progress for select
  using (user_id = auth.uid() or public.is_admin());

create policy "training_attempts_select_own"
  on public.training_attempts for select
  using (user_id = auth.uid() or public.is_admin());

create policy "training_events_select_own"
  on public.training_events for select
  using (user_id = auth.uid() or public.is_admin());
