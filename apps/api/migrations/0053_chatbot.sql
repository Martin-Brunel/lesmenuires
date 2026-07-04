-- Chatbot IA : activation + conversations et messages.
alter table property
  add column chatbot_enabled boolean not null default false;

create table chat_conversation (
  id              uuid primary key default gen_random_uuid(),
  session_token   text unique not null,
  locale          text not null default 'fr',
  visitor_name    text,
  visitor_email   text,
  contact_left_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table chat_message (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat_conversation(id) on delete cascade,
  role            text not null check (role in ('user','assistant','contact')),
  content         text not null,
  created_at      timestamptz not null default now()
);

create index chat_message_conv_idx on chat_message(conversation_id, created_at);
create index chat_conversation_email_idx on chat_conversation(lower(visitor_email));
