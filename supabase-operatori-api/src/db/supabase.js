import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: true,
      },
    }
  );
} else {
  console.warn('[Supabase] Mancano SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY nel .env: avvio senza client Supabase');
}

export { supabase };
export default supabase;