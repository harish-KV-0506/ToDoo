create or replace function public.valid_profile_social_links(links text[])
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select cardinality(links) <= 10
    and array_position(links, null) is null
    and not exists (
      select 1
      from unnest(links) as item(link)
      where char_length(link) > 2048 or link !~* '^https?://'
    );
$$;

revoke all on function public.valid_profile_social_links(text[]) from public, anon;
grant execute on function public.valid_profile_social_links(text[]) to authenticated;

create table if not exists public.private_profile_details (
  user_id uuid primary key references auth.users (id) on delete cascade,
  linkedin_url text check (
    linkedin_url is null
    or (char_length(linkedin_url) <= 2048 and linkedin_url ~* '^https://([a-z0-9-]+\.)*linkedin\.com/')
  ),
  social_links text[] not null default '{}'
    check (public.valid_profile_social_links(social_links)),
  date_of_birth date check (date_of_birth is null or date_of_birth <= current_date),
  birthday_visibility text not null default 'hidden'
    check (birthday_visibility in ('public', 'hide_year', 'hidden'))
);

alter table public.private_profile_details enable row level security;

drop policy if exists "Members can read their own private profile details" on public.private_profile_details;
create policy "Members can read their own private profile details"
on public.private_profile_details for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Members can create their own private profile details" on public.private_profile_details;
create policy "Members can create their own private profile details"
on public.private_profile_details for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "Members can update their own private profile details" on public.private_profile_details;
create policy "Members can update their own private profile details"
on public.private_profile_details for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant select, insert, update on public.private_profile_details to authenticated;

create or replace function public.get_public_profile_details()
returns table (
  user_id uuid,
  linkedin_url text,
  social_links text[],
  public_birthday text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    detail.user_id,
    detail.linkedin_url,
    detail.social_links,
    case detail.birthday_visibility
      when 'public' then to_char(detail.date_of_birth, 'YYYY-MM-DD')
      when 'hide_year' then to_char(detail.date_of_birth, 'FMMonth FMDD')
      else null
    end
  from public.private_profile_details as detail
  where auth.uid() is not null;
$$;

revoke all on function public.get_public_profile_details() from public, anon;
grant execute on function public.get_public_profile_details() to authenticated;
