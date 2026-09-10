-- Dairy social graph and content schema.
-- Run this in Supabase SQL Editor before switching the API from Netlify Blobs.

create extension if not exists pgcrypto;

create type public.post_audience as enum ('public', 'friends', 'private');
create type public.friendship_status as enum ('pending', 'accepted', 'blocked');
create type public.reaction_type as enum ('like', 'love', 'haha', 'wow', 'sad', 'angry');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text not null check (char_length(display_name) between 1 and 80),
  bio text not null default '' check (char_length(bio) <= 500),
  avatar_url text,
  cover_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.friendships (
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status public.friendship_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  audience public.post_audience not null default 'public',
  media jsonb not null default '[]'::jsonb,
  location text check (location is null or char_length(location) <= 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction public.reaction_type not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz,
  primary key (conversation_id, user_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);

create index posts_feed_idx on public.posts (created_at desc);
create index posts_author_idx on public.posts (author_id, created_at desc);
create index friendships_lookup_idx on public.friendships (addressee_id, requester_id, status);
create index comments_post_idx on public.comments (post_id, created_at);

create or replace function public.is_friend(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and ((f.requester_id = auth.uid() and f.addressee_id = target_user)
        or (f.requester_id = target_user and f.addressee_id = auth.uid()))
  );
$$;

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.posts enable row level security;
alter table public.reactions enable row level security;
alter table public.comments enable row level security;

alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;

create policy "profiles are visible to signed-in users"
  on public.profiles for select to authenticated using (true);
create policy "users create their own profile"
  on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "users update their own profile"
  on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "users see their friendship records"
  on public.friendships for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());
create policy "users create their own requests"
  on public.friendships for insert to authenticated with check (requester_id = auth.uid());
create policy "participants update friendship status"
  on public.friendships for update to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid())
  with check (requester_id = auth.uid() or addressee_id = auth.uid());
create policy "participants delete friendships"
  on public.friendships for delete to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

create policy "users see permitted posts"
  on public.posts for select to authenticated
  using (audience = 'public' or author_id = auth.uid() or (audience = 'friends' and public.is_friend(author_id)));
create policy "users create their own posts"
  on public.posts for insert to authenticated with check (author_id = auth.uid());
create policy "users update their own posts"
  on public.posts for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "users delete their own posts"
  on public.posts for delete to authenticated using (author_id = auth.uid());

create policy "users see reactions on permitted posts"
  on public.reactions for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));
create policy "users manage their own reactions"
  on public.reactions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "users see comments on permitted posts"
  on public.comments for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));
create policy "users create their own comments"
  on public.comments for insert to authenticated with check (author_id = auth.uid());
create policy "users update their own comments"
  on public.comments for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "users delete their own comments"
  on public.comments for delete to authenticated
  using (author_id = auth.uid());

create policy "participants see their conversations"
  on public.conversations for select to authenticated
  using (exists (select 1 from public.conversation_participants cp where cp.conversation_id = id and cp.user_id = auth.uid()));
create policy "users create conversations"
  on public.conversations for insert to authenticated with check (true);

create policy "participants see their participants"
  on public.conversation_participants for select to authenticated
  using (user_id = auth.uid());
create policy "users join conversations"
  on public.conversation_participants for insert to authenticated with check (user_id = auth.uid());
create policy "users update their read state"
  on public.conversation_participants for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "participants see messages"
  on public.messages for select to authenticated
  using (exists (select 1 from public.conversation_participants cp where cp.conversation_id = conversation_id and cp.user_id = auth.uid()));
create policy "users send messages"
  on public.messages for insert to authenticated with check (sender_id = auth.uid());
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

insert into storage.buckets (id, name, public)
values ('post-media', 'post-media', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('stories', 'stories', true)
on conflict (id) do update set public = true;

drop policy if exists "users upload their own post media" on storage.objects;
create policy "users upload their own post media"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users delete their own post media" on storage.objects;
create policy "users delete their own post media"
  on storage.objects for delete to authenticated
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users update their own post media" on storage.objects;
create policy "users update their own post media"
  on storage.objects for update to authenticated
  using (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'post-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users upload their own avatar" on storage.objects;
create policy "users upload their own avatar"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users delete their own avatar" on storage.objects;
create policy "users delete their own avatar"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users update their own avatar" on storage.objects;
create policy "users update their own avatar"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

alter publication supabase_realtime add table public.messages;

create table public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_url text not null,
  media_type text not null check (media_type in ('image', 'video')),
  text text check (char_length(text) <= 500),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

create index stories_user_idx on public.stories (user_id, created_at desc);
create index stories_expires_idx on public.stories (expires_at);

alter table public.stories enable row level security;

create policy "stories are visible while active"
  on public.stories for select to authenticated
  using (expires_at > now());
create policy "users create their own stories"
  on public.stories for insert to authenticated with check (user_id = auth.uid());
create policy "users delete their own stories"
  on public.stories for delete to authenticated using (user_id = auth.uid());

drop policy if exists "users upload their own stories" on storage.objects;
create policy "users upload their own stories"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users delete their own stories" on storage.objects;
create policy "users delete their own stories"
  on storage.objects for delete to authenticated
  using (bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text);
