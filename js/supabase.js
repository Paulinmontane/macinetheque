// ============================================================================
//  Connexion à Supabase (comptes + base de données).
//  La bibliothèque officielle est chargée par index.html (lib/supabase.js)
//  et disponible dans window.supabase.
// ============================================================================
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

/** Vrai si js/config.js a bien été rempli. */
export const isConfigured =
  /^https?:\/\//.test(SUPABASE_URL) && SUPABASE_PUBLISHABLE_KEY.length > 20 && !SUPABASE_PUBLISHABLE_KEY.includes('COLLE_ICI');

/**
 * Adresse du site, du type https://pseudo.github.io/macinetheque/ : c'est là
 * que renvoient les liens des emails (confirmation, mot de passe oublié).
 * Elle doit figurer dans les « Redirect URLs » de Supabase (README, étape 5).
 */
export const SITE_URL = location.origin + location.pathname.replace(/index\.html$/, '');

// Si l'on arrive depuis un lien reçu par email, l'adresse contient un jeton
// (ou une erreur) après le « # ». On le note AVANT que Supabase ne le consomme.
const hashParams = new URLSearchParams(location.hash.startsWith('#/') ? '' : location.hash.slice(1));
export const urlAuth = {
  type: hashParams.get('type'), // « recovery » = lien de mot de passe oublié
  error: hashParams.get('error_description') || hashParams.get('error'),
  errorCode: hashParams.get('error_code'),
};

export const sb = isConfigured
  ? window.supabase.createClient(SUPABASE_URL.replace(/\/+$/, ''), SUPABASE_PUBLISHABLE_KEY.trim(), {
    auth: {
      persistSession: true, // on reste connecté (stockage local du navigateur)
      autoRefreshToken: true, // la session est prolongée automatiquement
      detectSessionInUrl: true, // lit le jeton des liens reçus par email
    },
  })
  : null;
