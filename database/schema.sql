-- HomeBasket Stores database
-- Run once in Supabase SQL Editor using a new project. All financial writes use audited RPCs.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
alter extension pgcrypto set schema extensions;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null check (char_length(email) <= 320),
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create index if not exists business_members_user_idx
  on public.business_members (user_id);
create unique index if not exists business_members_one_business_per_user_idx
  on public.business_members (user_id);

create table if not exists public.business_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  account_type text not null check (account_type in ('cash', 'bank', 'savings')),
  sort_order smallint not null,
  created_at timestamptz not null default now(),
  unique (business_id, account_type),
  unique (id, business_id)
);

create table if not exists public.business_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  request_id uuid not null unique,
  transaction_type text not null check (transaction_type in (
    'daily_sales', 'stock_purchase', 'stock_restock', 'operating_expense',
    'household_use', 'stock_loss', 'owner_withdrawal', 'family_contribution',
    'account_transfer', 'opening_balance', 'opening_stock', 'closing_stock'
  )),
  occurred_on date not null,
  amount_kobo bigint not null check (amount_kobo > 0 and amount_kobo <= 9007199254740991),
  category text not null check (char_length(btrim(category)) between 1 and 80),
  account_id uuid,
  transfer_to_account_id uuid,
  balance_direction smallint not null default 1 check (balance_direction in (-1, 1)),
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete restrict,
  check ((deleted_at is null) = (deleted_by is null)),
  unique (id, business_id),
  foreign key (account_id, business_id)
    references public.business_accounts(id, business_id),
  foreign key (transfer_to_account_id, business_id)
    references public.business_accounts(id, business_id),
  check (
    (transaction_type = 'account_transfer'
      and account_id is not null
      and transfer_to_account_id is not null
      and account_id <> transfer_to_account_id)
    or (transaction_type <> 'account_transfer' and transfer_to_account_id is null)
  ),
  check (
    (transaction_type in ('opening_stock', 'closing_stock', 'household_use', 'stock_loss')
      and account_id is null)
    or (transaction_type not in ('opening_stock', 'closing_stock', 'household_use', 'stock_loss')
      and account_id is not null)
  ),
  check (transaction_type = 'opening_balance' or balance_direction = 1)
);

create index if not exists business_transactions_business_date_idx
  on public.business_transactions (business_id, occurred_on desc, created_at desc, id desc);
create index if not exists business_transactions_account_idx
  on public.business_transactions (account_id, occurred_on desc);
create index if not exists business_transactions_transfer_idx
  on public.business_transactions (transfer_to_account_id, occurred_on desc);

create table if not exists public.business_invites (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.business_audit_log (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  transaction_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  old_record jsonb,
  new_record jsonb
);

create index if not exists business_audit_log_business_time_idx
  on public.business_audit_log (business_id, occurred_at desc);

-- A transaction change and its audit event commit or roll back together.
create or replace function public.audit_business_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.business_audit_log (
      business_id, transaction_id, action, actor_id, new_record
    ) values (
      new.business_id, new.id, 'insert', (select auth.uid()), to_jsonb(new)
    );
    return new;
  elsif tg_op = 'UPDATE'
    and old.deleted_at is null
    and new.deleted_at is not null then
    insert into public.business_audit_log (
      business_id, transaction_id, action, actor_id, old_record, new_record
    ) values (
      new.business_id, new.id, 'delete', (select auth.uid()), to_jsonb(old), to_jsonb(new)
    );
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.business_audit_log (
      business_id, transaction_id, action, actor_id, old_record, new_record
    ) values (
      new.business_id, new.id, 'update', (select auth.uid()), to_jsonb(old), to_jsonb(new)
    );
    return new;
  else
    insert into public.business_audit_log (
      business_id, transaction_id, action, actor_id, old_record
    ) values (
      old.business_id, old.id, 'delete', (select auth.uid()), to_jsonb(old)
    );
    return old;
  end if;
end;
$$;

drop trigger if exists business_transaction_audit on public.business_transactions;
create trigger business_transaction_audit
  after insert or update or delete on public.business_transactions
  for each row execute function public.audit_business_transaction();

create or replace function public.set_business_transaction_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists business_transaction_updated_at on public.business_transactions;
create trigger business_transaction_updated_at
  before update on public.business_transactions
  for each row execute function public.set_business_transaction_updated_at();

-- This membership lookup is SECURITY DEFINER to avoid recursive membership-table RLS.
create or replace function public.is_business_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.business_members as member
    where member.business_id = p_business_id and member.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_business_owner(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.business_members as member
    where member.business_id = p_business_id
      and member.user_id = (select auth.uid())
      and member.role = 'owner'
  );
$$;

-- Balances are derived from immutable transaction effects, so transfers never become income.
create or replace view public.account_balances
with (security_invoker = true)
as
select
  account.id as account_id,
  account.business_id,
  account.name,
  account.account_type,
  account.sort_order,
  coalesce(sum(
    case
      when ledger_row.account_id = account.id then
        case ledger_row.transaction_type
          when 'daily_sales' then ledger_row.amount_kobo
          when 'family_contribution' then ledger_row.amount_kobo
          when 'opening_balance' then ledger_row.amount_kobo * ledger_row.balance_direction
          when 'account_transfer' then -ledger_row.amount_kobo
          when 'stock_purchase' then -ledger_row.amount_kobo
          when 'stock_restock' then -ledger_row.amount_kobo
          when 'operating_expense' then -ledger_row.amount_kobo
          when 'owner_withdrawal' then -ledger_row.amount_kobo
          else 0
        end
      when ledger_row.transfer_to_account_id = account.id
        and ledger_row.transaction_type = 'account_transfer'
        then ledger_row.amount_kobo
      else 0
    end
  ), 0)::text as balance_kobo
from public.business_accounts as account
left join public.business_transactions as ledger_row
  on ledger_row.business_id = account.business_id
  and (ledger_row.account_id = account.id or ledger_row.transfer_to_account_id = account.id)
  and ledger_row.deleted_at is null
group by account.id, account.business_id, account.name, account.account_type, account.sort_order;

-- The first authenticated user creates a business and its three initial financial accounts.
create or replace function public.create_business(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_email text := coalesce((select auth.jwt() ->> 'email'), '');
begin
  if auth.uid() is null then raise exception 'Sign in is required.'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 100 then
    raise exception 'Business name must be between 1 and 100 characters.';
  end if;

  insert into public.businesses (name, created_by)
  values (btrim(p_name), (select auth.uid()))
  returning id into v_business_id;

  insert into public.business_members (business_id, user_id, email, role)
  values (v_business_id, (select auth.uid()), v_email, 'owner');

  insert into public.business_accounts (business_id, name, account_type, sort_order)
  values
    (v_business_id, 'Shop cash', 'cash', 1),
    (v_business_id, 'Business bank', 'bank', 2),
    (v_business_id, 'Business savings', 'savings', 3);

  return v_business_id;
end;
$$;

-- Invite tokens are returned only once. The database retains their SHA-256 digest.
create or replace function public.create_business_invite(p_business_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if auth.uid() is null or not public.is_business_owner(p_business_id) then
    raise exception 'Only the business owner can invite family members.';
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.business_invites (business_id, token_hash, expires_at, created_by)
  values (
    p_business_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    now() + interval '7 days',
    (select auth.uid())
  );
  return v_token;
end;
$$;

create or replace function public.join_business_with_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_email text := coalesce((select auth.jwt() ->> 'email'), '');
begin
  if auth.uid() is null then raise exception 'Sign in is required.'; end if;
  if p_token is null or char_length(p_token) <> 64 then
    raise exception 'The invitation code is invalid or expired.';
  end if;

  select invite.business_id into v_business_id
  from public.business_invites as invite
  where invite.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and invite.expires_at > now();
  if v_business_id is null then raise exception 'The invitation code is invalid or expired.'; end if;

  insert into public.business_members (business_id, user_id, email, role)
  values (v_business_id, (select auth.uid()), v_email, 'member')
  on conflict (business_id, user_id) do nothing;
  return v_business_id;
end;
$$;

create or replace function public.remove_business_member(p_business_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_business_owner(p_business_id) then
    raise exception 'Only the business owner can manage family access.';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'The owner cannot remove their own access.';
  end if;
  delete from public.business_members
  where business_id = p_business_id and user_id = p_user_id and role = 'member';
  if not found then raise exception 'Family member not found.'; end if;
end;
$$;

create or replace function public.validate_business_transaction(
  p_business_id uuid,
  p_type text,
  p_date date,
  p_amount bigint,
  p_account_id uuid,
  p_transfer_to uuid,
  p_direction smallint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requires_account boolean;
begin
  if p_date is null or p_date > (now() at time zone 'Africa/Lagos')::date then
    raise exception 'Transaction date must be today or earlier.';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 9007199254740991 then
    raise exception 'Amount must be positive and within the supported limit.';
  end if;
  if p_type is null or p_type not in (
    'daily_sales', 'stock_purchase', 'stock_restock', 'operating_expense',
    'household_use', 'stock_loss', 'owner_withdrawal', 'family_contribution',
    'account_transfer', 'opening_balance', 'opening_stock', 'closing_stock'
  ) then
    raise exception 'Choose a supported transaction type.';
  end if;
  v_requires_account := p_type not in ('opening_stock', 'closing_stock', 'household_use', 'stock_loss');
  if v_requires_account and p_account_id is null then
    raise exception 'Select the account used for this transaction.';
  end if;
  if not v_requires_account and p_account_id is not null then
    raise exception 'This stock adjustment does not affect a financial account.';
  end if;
  if p_type = 'account_transfer' then
    if p_transfer_to is null or p_transfer_to = p_account_id then
      raise exception 'Choose two different accounts for a transfer.';
    end if;
  elsif p_transfer_to is not null then
    raise exception 'Only an account transfer can have a destination account.';
  end if;
  if p_type <> 'opening_balance' and p_direction <> 1 then
    raise exception 'Only an opening balance can be marked as money out.';
  end if;
  if p_account_id is not null and not exists (
    select 1 from public.business_accounts as account
    where account.id = p_account_id and account.business_id = p_business_id
  ) then
    raise exception 'The selected account does not belong to this business.';
  end if;
  if p_transfer_to is not null and not exists (
    select 1 from public.business_accounts as account
    where account.id = p_transfer_to and account.business_id = p_business_id
  ) then
    raise exception 'The destination account does not belong to this business.';
  end if;
end;
$$;

-- Insert is atomic, permission-checked, and idempotent for a client retry with the same UUID.
create or replace function public.create_business_transaction(
  p_business_id uuid, p_request_id uuid, p_record jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text := p_record ->> 'transaction_type';
  v_date date := (p_record ->> 'occurred_on')::date;
  v_amount bigint := (p_record ->> 'amount_kobo')::bigint;
  v_category text := btrim(coalesce(p_record ->> 'category', ''));
  v_account uuid := nullif(p_record ->> 'account_id', '')::uuid;
  v_transfer uuid := nullif(p_record ->> 'transfer_to_account_id', '')::uuid;
  v_direction smallint := coalesce((p_record ->> 'balance_direction')::smallint, 1);
  v_notes text := nullif(btrim(coalesce(p_record ->> 'notes', '')), '');
  v_user_id uuid := (select auth.uid());
  v_transaction_id uuid;
  v_existing public.business_transactions%rowtype;
begin
  if v_user_id is null or not public.is_business_member(p_business_id) then
    raise exception 'You are not authorized to add records to this business.';
  end if;
  if p_request_id is null then raise exception 'A request ID is required.'; end if;
  if char_length(v_category) not between 1 and 80 then
    raise exception 'Category must be between 1 and 80 characters.';
  end if;
  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'Notes must be 500 characters or fewer.';
  end if;
  perform public.validate_business_transaction(
    p_business_id, v_type, v_date, v_amount, v_account, v_transfer, v_direction
  );

  insert into public.business_transactions (
    business_id, request_id, transaction_type, occurred_on, amount_kobo,
    category, account_id, transfer_to_account_id, balance_direction, notes, created_by
  ) values (
    p_business_id, p_request_id, v_type, v_date, v_amount,
    v_category, v_account, v_transfer, v_direction, v_notes, v_user_id
  )
  on conflict (request_id) do nothing
  returning id into v_transaction_id;

  if v_transaction_id is null then
    select * into v_existing
    from public.business_transactions as ledger_row
    where ledger_row.request_id = p_request_id;
    if v_existing.business_id is distinct from p_business_id
       or v_existing.created_by is distinct from v_user_id
       or v_existing.transaction_type is distinct from v_type
       or v_existing.occurred_on is distinct from v_date
       or v_existing.amount_kobo is distinct from v_amount
       or v_existing.category is distinct from v_category
       or v_existing.account_id is distinct from v_account
       or v_existing.transfer_to_account_id is distinct from v_transfer
       or v_existing.balance_direction is distinct from v_direction
       or v_existing.notes is distinct from v_notes then
      raise exception 'This request ID already belongs to a different transaction. Start a new record.';
    end if;
    if v_existing.deleted_at is not null then
      raise exception 'This request was already recorded and later deleted. Start a new record if the transaction should be added again.';
    end if;
    v_transaction_id := v_existing.id;
  end if;
  return v_transaction_id;
end;
$$;

-- Corrections are owner-only. The trigger preserves the original creator and captures before/after.
create or replace function public.update_business_transaction(p_transaction_id uuid, p_record jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.business_transactions%rowtype;
  v_type text := p_record ->> 'transaction_type';
  v_date date := (p_record ->> 'occurred_on')::date;
  v_amount bigint := (p_record ->> 'amount_kobo')::bigint;
  v_category text := btrim(coalesce(p_record ->> 'category', ''));
  v_account uuid := nullif(p_record ->> 'account_id', '')::uuid;
  v_transfer uuid := nullif(p_record ->> 'transfer_to_account_id', '')::uuid;
  v_direction smallint := coalesce((p_record ->> 'balance_direction')::smallint, 1);
  v_notes text := nullif(btrim(coalesce(p_record ->> 'notes', '')), '');
begin
  select * into v_old from public.business_transactions
  where id = p_transaction_id for update;
  if not found or v_old.deleted_at is not null or not public.is_business_owner(v_old.business_id) then
    raise exception 'Only the business owner can edit this record.';
  end if;
  if char_length(v_category) not between 1 and 80 then
    raise exception 'Category must be between 1 and 80 characters.';
  end if;
  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'Notes must be 500 characters or fewer.';
  end if;
  perform public.validate_business_transaction(
    v_old.business_id, v_type, v_date, v_amount, v_account, v_transfer, v_direction
  );

  update public.business_transactions
  set transaction_type = v_type,
      occurred_on = v_date,
      amount_kobo = v_amount,
      category = v_category,
      account_id = v_account,
      transfer_to_account_id = v_transfer,
      balance_direction = v_direction,
      notes = v_notes
  where id = p_transaction_id;
  return p_transaction_id;
end;
$$;

create or replace function public.delete_business_transaction(p_transaction_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
begin
  select business_id into v_business_id
  from public.business_transactions where id = p_transaction_id for update;
  if not found or not exists (
    select 1 from public.business_transactions
    where id = p_transaction_id and deleted_at is null
  ) or not public.is_business_owner(v_business_id) then
    raise exception 'Only the business owner can delete this record.';
  end if;
  update public.business_transactions
  set deleted_at = now(), deleted_by = (select auth.uid())
  where id = p_transaction_id and deleted_at is null;
  return p_transaction_id;
end;
$$;

create or replace function public.list_business_audit(p_business_id uuid)
returns setof public.business_audit_log
language sql
stable
security definer
set search_path = ''
as $$
  select log.* from public.business_audit_log as log
  where log.business_id = p_business_id and public.is_business_owner(p_business_id)
  order by log.occurred_at desc
  limit 50;
$$;

-- RLS is a second authorization layer: table writes are not granted to browser roles.
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.business_accounts enable row level security;
alter table public.business_transactions enable row level security;
alter table public.business_invites enable row level security;
alter table public.business_audit_log enable row level security;

drop policy if exists "Members read their business" on public.businesses;
create policy "Members read their business" on public.businesses
  for select to authenticated using (public.is_business_member(id));
drop policy if exists "Members read their team" on public.business_members;
create policy "Members read their team" on public.business_members
  for select to authenticated using (public.is_business_member(business_id));
drop policy if exists "Members read their accounts" on public.business_accounts;
create policy "Members read their accounts" on public.business_accounts
  for select to authenticated using (public.is_business_member(business_id));
drop policy if exists "Members read business transactions" on public.business_transactions;
create policy "Members read business transactions" on public.business_transactions
  for select to authenticated using (
    deleted_at is null and public.is_business_member(business_id)
  );
drop policy if exists "Owner reads audit history" on public.business_audit_log;
create policy "Owner reads audit history" on public.business_audit_log
  for select to authenticated using (public.is_business_owner(business_id));

revoke all on public.businesses, public.business_members, public.business_accounts,
  public.business_transactions, public.business_invites, public.business_audit_log
  from anon, authenticated;
grant select on public.businesses, public.business_members, public.business_accounts,
  public.business_transactions to authenticated;
grant select on public.account_balances to authenticated;

revoke all on function public.audit_business_transaction() from public, anon, authenticated;
revoke all on function public.set_business_transaction_updated_at() from public, anon, authenticated;
revoke all on function public.is_business_member(uuid) from public, anon;
revoke all on function public.is_business_owner(uuid) from public, anon;
revoke all on function public.validate_business_transaction(uuid, text, date, bigint, uuid, uuid, smallint)
  from public, anon, authenticated;
revoke all on function public.create_business(text) from public, anon;
revoke all on function public.create_business_invite(uuid) from public, anon;
revoke all on function public.join_business_with_invite(text) from public, anon;
revoke all on function public.remove_business_member(uuid, uuid) from public, anon;
revoke all on function public.create_business_transaction(uuid, uuid, jsonb) from public, anon;
revoke all on function public.update_business_transaction(uuid, jsonb) from public, anon;
revoke all on function public.delete_business_transaction(uuid) from public, anon;
revoke all on function public.list_business_audit(uuid) from public, anon;

grant execute on function public.is_business_member(uuid) to authenticated;
grant execute on function public.is_business_owner(uuid) to authenticated;
grant execute on function public.create_business(text) to authenticated;
grant execute on function public.create_business_invite(uuid) to authenticated;
grant execute on function public.join_business_with_invite(text) to authenticated;
grant execute on function public.remove_business_member(uuid, uuid) to authenticated;
grant execute on function public.create_business_transaction(uuid, uuid, jsonb) to authenticated;
grant execute on function public.update_business_transaction(uuid, jsonb) to authenticated;
grant execute on function public.delete_business_transaction(uuid) to authenticated;
grant execute on function public.list_business_audit(uuid) to authenticated;

-- Realtime lets other signed-in devices refresh promptly after a committed ledger change.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'business_transactions'
     ) then
    alter publication supabase_realtime add table public.business_transactions;
  end if;
end;
$$;
