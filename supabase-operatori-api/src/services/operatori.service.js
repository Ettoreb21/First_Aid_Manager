import supabase from '../db/supabase.js';

export async function ensureTable() {
  if (!supabase) return; // avvio senza Supabase: non bloccare
  try {
    const { error } = await supabase
      .from('operatori')
      .select('id')
      .limit(1);
    if (error) {
      console.warn('[Supabase] Tabella operatori non disponibile o errore:', error.message);
    }
  } catch (e) {
    console.warn('[Supabase] Errore verifica tabella operatori:', e.message);
  }
}

export async function getAllOperatori() {
  if (!supabase) throw new Error('Supabase non configurato: imposta SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY');
  const { data, error } = await supabase
    .from('operatori')
    .select('*')
    .order('id', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getOperatoreById(id) {
  if (!supabase) throw new Error('Supabase non configurato: imposta SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY');
  const { data, error } = await supabase
    .from('operatori')
    .select('*')
    .eq('id', id)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null; // not found
    throw new Error(error.message);
  }
  return data;
}

export async function createOperatore(data) {
  if (!supabase) throw new Error('Supabase non configurato: imposta SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY');
  const { nome, email, reparto, stato, quantita, quantita_minima, tag } = data;
  const { data: inserted, error } = await supabase
    .from('operatori')
    .insert({ nome, email, reparto, stato, quantita, quantita_minima, tag })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return inserted;
}

export async function updateOperatore(id, data) {
  if (!supabase) throw new Error('Supabase non configurato: imposta SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY');
  const { nome, email, reparto, stato, quantita, quantita_minima, tag } = data;
  const { data: updated, error } = await supabase
    .from('operatori')
    .update({ nome, email, reparto, stato, quantita, quantita_minima, tag })
    .eq('id', id)
    .select('*')
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(error.message);
  }
  return updated;
}

export async function deleteOperatore(id) {
  if (!supabase) throw new Error('Supabase non configurato: imposta SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY');
  const { data, error } = await supabase
    .from('operatori')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) {
    if (error.code === 'PGRST116') return false;
    throw new Error(error.message);
  }
  return (data?.length ?? 0) > 0;
}
