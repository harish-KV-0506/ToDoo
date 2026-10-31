create table if not exists public.direct_message_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  initial_message text not null check (char_length(trim(initial_message)) between 1 and 1000),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);

create unique index if not exists direct_message_requests_pending_pair_idx
  on public.direct_message_requests (
    least(sender_id, recipient_id),
    greatest(sender_id, recipient_id)
  )
  where status = 'pending';

create index if not exists direct_message_requests_recipient_status_idx
  on public.direct_message_requests (recipient_id, status, created_at desc);

alter table public.direct_message_requests enable row level security;

drop policy if exists "Members can view their message requests" on public.direct_message_requests;
create policy "Members can view their message requests"
on public.direct_message_requests for select to authenticated
using (auth.uid() = sender_id or auth.uid() = recipient_id);

drop policy if exists "Members can request messages from non-connections" on public.direct_message_requests;
create policy "Members can request messages from non-connections"
on public.direct_message_requests for insert to authenticated
with check (
  sender_id = auth.uid()
  and sender_id <> recipient_id
  and not exists (
    select 1
    from public.professional_connections
    where status = 'accepted'
      and (
        (requester_id = sender_id and addressee_id = recipient_id)
        or (requester_id = recipient_id and addressee_id = sender_id)
      )
  )
);

drop policy if exists "Recipients can accept or decline message requests" on public.direct_message_requests;
create policy "Recipients can accept or decline message requests"
on public.direct_message_requests for update to authenticated
using (recipient_id = auth.uid() and status = 'pending')
with check (recipient_id = auth.uid() and status in ('accepted', 'declined'));

grant select, insert on public.direct_message_requests to authenticated;
grant update (status) on public.direct_message_requests to authenticated;

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> recipient_id)
);

create index if not exists direct_messages_conversation_created_idx
  on public.direct_messages (
    least(sender_id, recipient_id),
    greatest(sender_id, recipient_id),
    created_at
  );

alter table public.direct_messages enable row level security;

drop policy if exists "Participants can read direct messages" on public.direct_messages;
create policy "Participants can read direct messages"
on public.direct_messages for select to authenticated
using (auth.uid() = sender_id or auth.uid() = recipient_id);

drop policy if exists "Members can message connections and accepted requests" on public.direct_messages;
create policy "Members can message connections and accepted requests"
on public.direct_messages for insert to authenticated
with check (
  sender_id = auth.uid()
  and sender_id <> recipient_id
  and (
    exists (
      select 1
      from public.professional_connections
      where status = 'accepted'
        and (
          (requester_id = sender_id and addressee_id = recipient_id)
          or (requester_id = recipient_id and addressee_id = sender_id)
        )
    )
    or exists (
      select 1
      from public.direct_message_requests
      where status = 'accepted'
        and (
          (sender_id = direct_messages.sender_id and recipient_id = direct_messages.recipient_id)
          or (sender_id = direct_messages.recipient_id and recipient_id = direct_messages.sender_id)
        )
    )
  )
);

drop policy if exists "Recipients can mark direct messages as read" on public.direct_messages;
create policy "Recipients can mark direct messages as read"
on public.direct_messages for update to authenticated
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

grant select, insert on public.direct_messages to authenticated;
grant update (read_at) on public.direct_messages to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'direct_message_requests'
    ) then
      alter publication supabase_realtime add table public.direct_message_requests;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'direct_messages'
    ) then
      alter publication supabase_realtime add table public.direct_messages;
    end if;
  end if;
end;
$$;
