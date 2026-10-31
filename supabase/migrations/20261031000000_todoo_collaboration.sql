create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 70),
  created_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (char_length(email) between 3 and 320),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  invited_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 180),
  description text check (description is null or char_length(description) <= 1000),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  due_date date,
  assigned_to uuid references auth.users (id) on delete set null,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspace_members_user_id_idx on public.workspace_members (user_id);
create index workspace_invitations_workspace_id_idx on public.workspace_invitations (workspace_id, created_at desc);
create index tasks_workspace_created_idx on public.tasks (workspace_id, created_at desc);
create index tasks_workspace_due_idx on public.tasks (workspace_id, due_date);
create index tasks_assigned_to_idx on public.tasks (assigned_to);

create or replace function public.touch_task_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_task_updated_at
before update on public.tasks
for each row execute function public.touch_task_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  selected_name text;
begin
  selected_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Teammate'
  );
  insert into public.profiles (user_id, display_name)
  values (new.id, left(selected_name, 70))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.workspace_members member
    where member.workspace_id = target_workspace
      and member.user_id = auth.uid()
  );
$$;

create or replace function public.shares_workspace_with(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.workspace_members viewer
    join public.workspace_members shared
      on shared.workspace_id = viewer.workspace_id
    where viewer.user_id = auth.uid()
      and shared.user_id = target_user
  );
$$;

create or replace function public.create_workspace(workspace_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  created_workspace uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in before creating a board.';
  end if;
  if workspace_name is null or char_length(trim(workspace_name)) not between 1 and 80 then
    raise exception 'Board names must contain between 1 and 80 characters.';
  end if;

  insert into public.workspaces (name, created_by)
  values (trim(workspace_name), auth.uid())
  returning id into created_workspace;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (created_workspace, auth.uid(), 'owner');

  return created_workspace;
end;
$$;

create or replace function public.create_workspace_invitation(
  target_workspace uuid,
  invited_email text,
  token_hash text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_email text;
begin
  if auth.uid() is null or not public.is_workspace_member(target_workspace) then
    raise exception 'Only a board member can invite someone.';
  end if;

  normalized_email := lower(trim(invited_email));
  if normalized_email is null
    or char_length(normalized_email) not between 3 and 320
    or position('@' in normalized_email) < 2
    or token_hash is null
    or token_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception 'Enter a valid email address.';
  end if;

  if exists (
    select 1
    from public.workspace_members member
    join auth.users account on account.id = member.user_id
    where member.workspace_id = target_workspace
      and lower(account.email) = normalized_email
  ) then
    raise exception 'That account is already a board member.';
  end if;

  delete from public.workspace_invitations invitation
  where invitation.workspace_id = target_workspace
    and lower(invitation.email) = normalized_email
    and invitation.accepted_at is null;

  insert into public.workspace_invitations (
    workspace_id, email, token_hash, invited_by, expires_at
  )
  values (
    target_workspace,
    normalized_email,
    token_hash,
    auth.uid(),
    now() + interval '7 days'
  );
end;
$$;

create or replace function public.accept_workspace_invitation(invitation_token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid;
  current_email text;
  invited_workspace uuid;
begin
  current_user_id := auth.uid();
  current_email := lower(coalesce(auth.jwt() ->> 'email', ''));

  if current_user_id is null or invitation_token is null or char_length(invitation_token) <> 64 then
    raise exception 'Sign in with the invited email address to accept this invitation.';
  end if;

  select invitation.workspace_id
  into invited_workspace
  from public.workspace_invitations invitation
  where invitation.token_hash = encode(
    extensions.digest(convert_to(invitation_token, 'UTF8'), 'sha256'),
    'hex'
  )
    and invitation.accepted_at is null
    and invitation.expires_at > now()
    and lower(invitation.email) = current_email
  for update;

  if invited_workspace is null then
    raise exception 'This invitation is invalid, expired, or for a different email address.';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (invited_workspace, current_user_id, 'member')
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invitations
  set accepted_at = now()
  where token_hash = encode(
    extensions.digest(convert_to(invitation_token, 'UTF8'), 'sha256'),
    'hex'
  );

  return invited_workspace;
end;
$$;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.tasks enable row level security;

create policy "Profiles are visible to you and your board teammates"
on public.profiles for select to authenticated
using (user_id = auth.uid() or public.shares_workspace_with(user_id));

create policy "You can update your own profile"
on public.profiles for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "Members can view their boards"
on public.workspaces for select to authenticated
using (public.is_workspace_member(id));

create policy "Members can view their board roster"
on public.workspace_members for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "Members can view board invitations"
on public.workspace_invitations for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "Members can view board tasks"
on public.tasks for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "Members can create board tasks"
on public.tasks for insert to authenticated
with check (
  auth.uid() = created_by
  and public.is_workspace_member(workspace_id)
  and (
    assigned_to is null
    or exists (
      select 1
      from public.workspace_members assignee
      where assignee.workspace_id = tasks.workspace_id
        and assignee.user_id = tasks.assigned_to
    )
  )
);

create policy "Members can update board tasks"
on public.tasks for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (
  public.is_workspace_member(workspace_id)
  and (
    assigned_to is null
    or exists (
      select 1
      from public.workspace_members assignee
      where assignee.workspace_id = tasks.workspace_id
        and assignee.user_id = tasks.assigned_to
    )
  )
);

create policy "Members can delete board tasks"
on public.tasks for delete to authenticated
using (public.is_workspace_member(workspace_id));

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.touch_task_updated_at() from public, anon, authenticated;
revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.shares_workspace_with(uuid) from public, anon;
revoke all on function public.create_workspace(text) from public, anon;
revoke all on function public.create_workspace_invitation(uuid, text, text) from public, anon;
revoke all on function public.accept_workspace_invitation(text) from public, anon;

grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.shares_workspace_with(uuid) to authenticated;
grant execute on function public.create_workspace(text) to authenticated;
grant execute on function public.create_workspace_invitation(uuid, text, text) to authenticated;
grant execute on function public.accept_workspace_invitation(text) to authenticated;

grant select on public.profiles, public.workspaces, public.workspace_members, public.workspace_invitations, public.tasks to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
    ) then
      alter publication supabase_realtime add table public.tasks;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workspace_members'
    ) then
      alter publication supabase_realtime add table public.workspace_members;
    end if;
  end if;
end;
$$;
