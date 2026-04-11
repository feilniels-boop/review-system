-- Run in Supabase SQL Editor or via: supabase db push

create table if not exists public_reviews (
  id uuid primary key default gen_random_uuid(),
  review text not null,
  sentiment text not null check (sentiment in ('positive', 'negative')),
  topic text not null check (topic in ('delivery', 'product', 'service', 'other')),
  urgency text not null check (urgency in ('low', 'medium', 'high')),
  summary text not null,
  created_at timestamptz not null default now()
);

create table if not exists all_reviews (
  id uuid primary key default gen_random_uuid(),
  review text not null,
  sentiment text not null check (sentiment in ('positive', 'negative')),
  topic text not null check (topic in ('delivery', 'product', 'service', 'other')),
  urgency text not null check (urgency in ('low', 'medium', 'high')),
  summary text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_public_reviews_created_at on public_reviews (created_at desc);
create index if not exists idx_all_reviews_created_at on all_reviews (created_at desc);
