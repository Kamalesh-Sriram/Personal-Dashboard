/* Hands the page the three PUBLIC values it needs to reach your Supabase
   project. Set them once as Netlify environment variables and every
   device picks them up. Nothing secret is ever returned from here: the
   service role key and the VAPID private key stay in the function
   environment. */
import { env, json } from '../lib/auth.mjs';

export default async () => {
  const cfg = env();
  return json({ supabaseUrl: cfg.url, supabaseAnonKey: cfg.anonKey, vapidPublicKey: cfg.vapidPublic });
};
