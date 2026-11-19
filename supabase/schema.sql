-- Тайният Дядо Коледа: схема за Supabase.
-- Пусни целия файл веднъж в Supabase -> SQL Editor -> Run.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.events (
  id         uuid primary key default gen_random_uuid(),
  admin_key  uuid not null default gen_random_uuid(),
  rules      text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.people (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  name            text not null,
  receiver_id     uuid references public.people(id),
  pin_hash        text,
  failed_attempts int not null default 0,
  drawn_at        timestamptz
);
create index if not exists people_event_idx on public.people(event_id);

-- Клиентът няма директен достъп до таблиците: само през функциите долу.
alter table public.events enable row level security;
alter table public.people enable row level security;
revoke all on public.events from anon, authenticated;
revoke all on public.people from anon, authenticated;

-- Създава събитие и веднага определя разпределението като една голяма
-- случайна верига (A->B->C->A). Така никой не получава себе си и
-- последният човек никога не остава без валидно име.
create or replace function public.create_event(p_names text[], p_rules text)
returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_event public.events;
  v_names text[];
  v_ids   uuid[];
  v_n     int;
  i       int;
begin
  select coalesce(array_agg(trim(x)), '{}') into v_names
  from unnest(p_names) x where trim(x) <> '';

  v_n := coalesce(array_length(v_names, 1), 0);
  if v_n < 3 then
    raise exception 'Трябват поне 3 участника';
  end if;
  if v_n > 100 then
    raise exception 'Най-много 100 участника';
  end if;
  if (select count(distinct lower(x)) from unnest(v_names) x) <> v_n then
    raise exception 'Имената трябва да са различни';
  end if;

  insert into events(rules) values (left(coalesce(p_rules, ''), 5000))
  returning * into v_event;

  -- участниците във случаен ред
  select array_agg(id) into v_ids from (
    select gen_random_uuid() as id, x from unnest(v_names) x
  ) t;
  insert into people(id, event_id, name)
  select v_ids[o], v_event.id, v_names[o]
  from generate_subscripts(v_names, 1) o;

  -- v_ids е в реда на v_names; разбъркваме индексите и свързваме в кръг
  declare
    v_perm int[];
  begin
    select array_agg(g order by random()) into v_perm
    from generate_series(1, v_n) g;
    for i in 1..v_n loop
      update people
         set receiver_id = v_ids[v_perm[(i % v_n) + 1]]
       where id = v_ids[v_perm[i]];
    end loop;
  end;

  return json_build_object('id', v_event.id, 'admin_key', v_event.admin_key);
end;
$$;

-- Публичен изглед: правила + списък с имена и кой вече е тегли (без имена на получатели).
create or replace function public.get_event(p_event uuid, p_admin_key uuid default null)
returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_event public.events;
begin
  select * into v_event from events where id = p_event;
  if not found then
    return null;
  end if;
  return json_build_object(
    'id', v_event.id,
    'rules', v_event.rules,
    'is_admin', (p_admin_key is not null and p_admin_key = v_event.admin_key),
    'people', (
      select coalesce(json_agg(json_build_object(
               'id', p.id,
               'name', p.name,
               'drawn', p.pin_hash is not null,
               'locked', p.failed_attempts >= 5
             ) order by p.name), '[]'::json)
      from people p where p.event_id = p_event
    )
  );
end;
$$;

create or replace function public.update_rules(p_event uuid, p_admin_key uuid, p_rules text)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  update events set rules = left(coalesce(p_rules, ''), 5000)
   where id = p_event and admin_key = p_admin_key;
  if not found then
    raise exception 'Нямаш право да редактираш';
  end if;
end;
$$;

-- Първо извикване: задава PIN и разкрива получателя. Следващи: нужен е верният PIN.
-- След 5 грешни опита името се заключва (защита от налучкване).
create or replace function public.reveal(p_person uuid, p_pin text)
returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_p      public.people;
  v_target text;
  v_rules  text;
begin
  if p_pin is null or p_pin !~ '^\d{4}$' then
    raise exception 'PIN трябва да е 4 цифри';
  end if;

  select * into v_p from people where id = p_person for update;
  if not found then
    raise exception 'Непознат участник';
  end if;
  if v_p.failed_attempts >= 5 then
    raise exception 'Името е заключено след твърде много грешни опити. Помоли организатора да го отключи.';
  end if;

  if v_p.pin_hash is null then
    update people
       set pin_hash = crypt(p_pin, gen_salt('bf')), drawn_at = now()
     where id = p_person;
  elsif v_p.pin_hash = crypt(p_pin, v_p.pin_hash) then
    update people set failed_attempts = 0 where id = p_person;
  else
    update people set failed_attempts = failed_attempts + 1 where id = p_person;
    raise exception 'Грешен PIN';
  end if;

  select r.name into v_target from people r where r.id = v_p.receiver_id;
  select e.rules into v_rules from events e where e.id = v_p.event_id;
  return json_build_object('receiver', v_target, 'rules', v_rules);
end;
$$;

-- Организаторът може да нулира PIN на забравил човек (името остава непроменено,
-- човекът задава нов PIN и вижда същия получател).
create or replace function public.reset_person(p_event uuid, p_admin_key uuid, p_person uuid)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not exists (select 1 from events where id = p_event and admin_key = p_admin_key) then
    raise exception 'Нямаш право';
  end if;
  update people
     set pin_hash = null, failed_attempts = 0, drawn_at = null
   where id = p_person and event_id = p_event;
end;
$$;

grant execute on function public.create_event(text[], text)      to anon, authenticated;
grant execute on function public.get_event(uuid, uuid)           to anon, authenticated;
grant execute on function public.update_rules(uuid, uuid, text) to anon, authenticated;
grant execute on function public.reveal(uuid, text)              to anon, authenticated;
grant execute on function public.reset_person(uuid, uuid, uuid)  to anon, authenticated;
