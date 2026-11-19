import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(url && key);
const db = configured ? createClient(url, key) : null;

async function rpc(name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export const createEvent = (names, rules) =>
  rpc('create_event', { p_names: names, p_rules: rules });

export const getEvent = (id, adminKey) =>
  rpc('get_event', { p_event: id, p_admin_key: adminKey || null });

export const updateRules = (id, adminKey, rules) =>
  rpc('update_rules', { p_event: id, p_admin_key: adminKey, p_rules: rules });

export const reveal = (personId, pin) =>
  rpc('reveal', { p_person: personId, p_pin: pin });

export const resetPerson = (id, adminKey, personId) =>
  rpc('reset_person', { p_event: id, p_admin_key: adminKey, p_person: personId });
