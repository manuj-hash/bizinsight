-- BizInsight additive foundation migration.
-- Review and back up the database before applying. This file is NOT auto-applied.
begin;

alter table public.products
  add column if not exists reserved_quantity integer not null default 0,
  add column if not exists archived_at timestamptz;
alter table public.products
  drop constraint if exists products_reserved_quantity_check;
alter table public.products
  add constraint products_reserved_quantity_check
  check (reserved_quantity >= 0 and reserved_quantity <= stock_quantity);

alter table public.customers
  add column if not exists is_active boolean not null default true,
  add column if not exists archived_at timestamptz;

alter table public.orders
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists payment_method text;
alter table public.orders
  drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status = any (array['pending','confirmed','processing','completed','cancelled']));
alter table public.orders
  drop constraint if exists orders_payment_status_check;
alter table public.orders
  add constraint orders_payment_status_check
  check (payment_status = any (array['unpaid','partially_paid','paid','refunded','partially_refunded']));

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  order_id uuid references public.orders(id) on delete restrict,
  movement_type text not null check (movement_type in
    ('opening_balance','stock_in','reservation','sale_completion','cancellation_release','return','damaged','adjustment')),
  quantity_delta integer not null default 0,
  reserved_delta integer not null default 0,
  reference text,
  notes text,
  event_key text unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (quantity_delta <> 0 or reserved_delta <> 0)
);
create index if not exists stock_movements_product_created_idx
  on public.stock_movements(product_id, created_at desc);
create index if not exists stock_movements_order_idx
  on public.stock_movements(order_id) where order_id is not null;

alter table public.stock_movements enable row level security;
drop policy if exists "bizinsight staff read stock movements" on public.stock_movements;
create policy "bizinsight staff read stock movements"
  on public.stock_movements for select to authenticated
  using (public.is_bizinsight_admin_or_staff());
drop policy if exists "bizinsight staff insert stock movements" on public.stock_movements;
create policy "bizinsight staff insert stock movements"
  on public.stock_movements for insert to authenticated
  with check (public.is_bizinsight_admin_or_staff());

-- New order creation: create a pending order only. No stock is reserved or deducted here.
create or replace function public.create_bizinsight_order_v2(
  p_order_number text,
  p_customer_id uuid,
  p_items jsonb,
  p_tax_amount numeric default 0,
  p_discount_amount numeric default 0
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_subtotal numeric := 0;
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity integer;
  v_product_id uuid;
begin
  if not public.is_bizinsight_admin_or_staff() then
    raise exception 'Not authorised';
  end if;
  if coalesce(trim(p_order_number),'') = '' then raise exception 'Order number is required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one order item is required';
  end if;
  if coalesce(p_tax_amount,0) < 0 or coalesce(p_discount_amount,0) < 0 then
    raise exception 'Tax and discount cannot be negative';
  end if;
  if (select count(*) from jsonb_array_elements(p_items)) <>
     (select count(distinct value->>'product_id') from jsonb_array_elements(p_items)) then
    raise exception 'Duplicate products are not allowed in an order';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) order by value->>'product_id'
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity is null or v_quantity <= 0 then raise exception 'Quantity must be a positive integer'; end if;
    select * into v_product from public.products where id=v_product_id and archived_at is null for update;
    if not found or not v_product.is_active then raise exception 'Product is missing or inactive'; end if;
    if (v_product.stock_quantity - v_product.reserved_quantity) < v_quantity then
      raise exception 'Insufficient available stock for product %', v_product.name;
    end if;
    v_subtotal := v_subtotal + (v_product.price * v_quantity);
  end loop;

  if coalesce(p_discount_amount,0) > v_subtotal + coalesce(p_tax_amount,0) then
    raise exception 'Discount cannot exceed subtotal plus tax';
  end if;

  insert into public.orders(order_number,customer_id,status,subtotal,tax_amount,discount_amount,total_amount,payment_status)
  values (p_order_number,p_customer_id,'pending',v_subtotal,coalesce(p_tax_amount,0),
          coalesce(p_discount_amount,0),v_subtotal+coalesce(p_tax_amount,0)-coalesce(p_discount_amount,0),'unpaid')
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    select * into v_product from public.products where id=v_product_id;
    insert into public.order_items(order_id,product_id,quantity,unit_price)
    values(v_order_id,v_product_id,v_quantity,v_product.price);
  end loop;
  return v_order_id;
end;
$$;

-- Idempotent, transactional order lifecycle. All inventory mutations happen here.
create or replace function public.transition_bizinsight_order(
  p_order_id uuid,
  p_new_status text
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_event text;
begin
  if not public.is_bizinsight_admin_or_staff() then raise exception 'Not authorised'; end if;
  if p_new_status not in ('confirmed','processing','completed','cancelled') then
    raise exception 'Unsupported order transition';
  end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.status = p_new_status then return v_order.status; end if;

  if p_new_status='confirmed' and v_order.status='pending' then
    for v_item in select * from public.order_items where order_id=p_order_id order by product_id
    loop
      select * into v_product from public.products where id=v_item.product_id for update;
      if not found or not v_product.is_active then raise exception 'A product is unavailable'; end if;
      if v_product.stock_quantity-v_product.reserved_quantity < v_item.quantity then
        raise exception 'Insufficient available stock for product %',v_product.name;
      end if;
      update public.products set reserved_quantity=reserved_quantity+v_item.quantity where id=v_product.id;
      v_event := 'order:'||p_order_id::text||':confirmed:'||v_product.id::text;
      insert into public.stock_movements(product_id,order_id,movement_type,quantity_delta,reserved_delta,reference,event_key,created_by)
      values(v_product.id,p_order_id,'reservation',0,v_item.quantity,v_order.order_number,v_event,auth.uid())
      on conflict(event_key) do nothing;
    end loop;
  elsif p_new_status='processing' and v_order.status='confirmed' then
    null;
  elsif p_new_status='completed' and v_order.status='processing' then
    for v_item in select * from public.order_items where order_id=p_order_id order by product_id
    loop
      select * into v_product from public.products where id=v_item.product_id for update;
      if not found or v_product.reserved_quantity < v_item.quantity or v_product.stock_quantity < v_item.quantity then
        raise exception 'Reserved stock is inconsistent for product %',coalesce(v_product.name,v_item.product_id::text);
      end if;
      update public.products
        set stock_quantity=stock_quantity-v_item.quantity,
            reserved_quantity=reserved_quantity-v_item.quantity
        where id=v_product.id;
      v_event := 'order:'||p_order_id::text||':completed:'||v_product.id::text;
      insert into public.stock_movements(product_id,order_id,movement_type,quantity_delta,reserved_delta,reference,event_key,created_by)
      values(v_product.id,p_order_id,'sale_completion',-v_item.quantity,-v_item.quantity,v_order.order_number,v_event,auth.uid())
      on conflict(event_key) do nothing;
    end loop;
  elsif p_new_status='cancelled' and v_order.status in ('pending','confirmed','processing') then
    if v_order.status in ('confirmed','processing') then
      for v_item in select * from public.order_items where order_id=p_order_id order by product_id
      loop
        select * into v_product from public.products where id=v_item.product_id for update;
        if not found or v_product.reserved_quantity < v_item.quantity then
          raise exception 'Cannot release reservation for product %',v_item.product_id;
        end if;
        update public.products set reserved_quantity=reserved_quantity-v_item.quantity where id=v_product.id;
        v_event := 'order:'||p_order_id::text||':cancelled:'||v_product.id::text;
        insert into public.stock_movements(product_id,order_id,movement_type,quantity_delta,reserved_delta,reference,event_key,created_by)
        values(v_product.id,p_order_id,'cancellation_release',0,-v_item.quantity,v_order.order_number,v_event,auth.uid())
        on conflict(event_key) do nothing;
      end loop;
    end if;
  else
    raise exception 'Invalid order transition: % -> %',v_order.status,p_new_status;
  end if;

  update public.orders set status=p_new_status,updated_at=now() where id=p_order_id;
  return p_new_status;
end;
$$;

revoke all on function public.create_bizinsight_order_v2(text,uuid,jsonb,numeric,numeric) from public, anon;
revoke all on function public.transition_bizinsight_order(uuid,text) from public, anon;
grant execute on function public.create_bizinsight_order_v2(text,uuid,jsonb,numeric,numeric) to authenticated;
grant execute on function public.transition_bizinsight_order(uuid,text) to authenticated;


-- Record the existing physical stock as an opening balance without changing it.
insert into public.stock_movements(product_id,movement_type,quantity_delta,reference,event_key)
select p.id,'opening_balance',p.stock_quantity,'Opening balance at ledger activation','opening:'||p.id::text
from public.products p
where p.stock_quantity > 0
on conflict(event_key) do nothing;

-- Controlled stock-in / return / damage / adjustment endpoint. No direct quantity edits.
create or replace function public.adjust_bizinsight_stock(
  p_product_id uuid,
  p_quantity_delta integer,
  p_movement_type text,
  p_notes text default null
) returns integer
language plpgsql
security invoker
set search_path = ''
as $
declare
  v_product public.products%rowtype;
  v_next integer;
begin
  if not public.is_bizinsight_admin_or_staff() then raise exception 'Not authorised'; end if;
  if p_quantity_delta = 0 then raise exception 'Quantity change cannot be zero'; end if;
  if p_movement_type not in ('stock_in','return','damaged','adjustment') then
    raise exception 'Unsupported manual stock movement';
  end if;
  select * into v_product from public.products where id=p_product_id and archived_at is null for update;
  if not found then raise exception 'Product not found'; end if;
  v_next := v_product.stock_quantity + p_quantity_delta;
  if v_next < v_product.reserved_quantity then
    raise exception 'Stock cannot be reduced below reserved quantity';
  end if;
  update public.products set stock_quantity=v_next,updated_at=now() where id=p_product_id;
  insert into public.stock_movements(product_id,movement_type,quantity_delta,reserved_delta,notes,created_by)
  values(p_product_id,p_movement_type,p_quantity_delta,0,p_notes,auth.uid());
  return v_next;
end;
$;
revoke all on function public.adjust_bizinsight_stock(uuid,integer,text,text) from public, anon;
grant execute on function public.adjust_bizinsight_stock(uuid,integer,text,text) to authenticated;


-- Privileged role change: narrowly scoped SECURITY DEFINER with explicit caller checks.
create or replace function public.set_bizinsight_user_role(p_target_user_id uuid,p_new_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $
declare
  v_actor_role text;
  v_target_role text;
  v_admin_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select role into v_actor_role from public.profiles where id=auth.uid();
  if v_actor_role is distinct from 'admin' then raise exception 'Administrator access required'; end if;
  if p_new_role not in ('admin','staff') then raise exception 'Role must be admin or staff'; end if;
  if p_target_user_id=auth.uid() then raise exception 'You cannot change your own role'; end if;
  select role into v_target_role from public.profiles where id=p_target_user_id for update;
  if not found then raise exception 'Target profile not found'; end if;
  if v_target_role='admin' and p_new_role='staff' then
    select count(*) into v_admin_count from public.profiles where role='admin';
    if v_admin_count <= 1 then raise exception 'The last administrator cannot be demoted'; end if;
  end if;
  update public.profiles set role=p_new_role,updated_at=now() where id=p_target_user_id;
end;
$;
revoke all on function public.set_bizinsight_user_role(uuid,text) from public, anon;
grant execute on function public.set_bizinsight_user_role(uuid,text) to authenticated;

-- Keep the old service-role-only function for compatibility; new API must use v2.
commit;
