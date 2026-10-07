// sh-i18n.js — strings for the StarHermit platform controls (sign-in,
// invite, session expired) in every supported locale, picked from navigator.language.
const en = {
  signIn: 'Sign in with StarHermit', invite: 'Invite a friend',
  copied: 'Invite link copied to the clipboard', copyFail: 'Copy this invite link: {url}',
  signedOut: 'Signed out — progress stays on this device',
  expiredTitle: 'Your session expired', expiredBody: 'Your StarHermit session ended, so the room connection stopped. Go back to StarHermit to start a fresh session.',
  relaunch: 'Back to StarHermit', playLocal: 'Play on this device',
};
const es = {
  signIn: 'Iniciar sesión con StarHermit', invite: 'Invitar a un amigo',
  copied: 'Enlace de invitación copiado al portapapeles', copyFail: 'Copia este enlace de invitación: {url}',
  signedOut: 'Sesión cerrada: el progreso se queda en este dispositivo',
  expiredTitle: 'Tu sesión expiró', expiredBody: 'Tu sesión de StarHermit terminó y se detuvo la conexión con la sala. Vuelve a StarHermit para iniciar una nueva sesión.',
  relaunch: 'Volver a StarHermit', playLocal: 'Jugar en este dispositivo',
};
const fr = {
  signIn: 'Se connecter avec StarHermit', invite: 'Inviter un ami',
  copied: 'Lien d’invitation copié dans le presse-papiers', copyFail: 'Copiez ce lien d’invitation : {url}',
  signedOut: 'Déconnecté — la progression reste sur cet appareil',
  expiredTitle: 'Votre session a expiré', expiredBody: 'Votre session StarHermit est terminée, la connexion à la salle a donc été interrompue. Retournez sur StarHermit pour démarrer une nouvelle session.',
  relaunch: 'Retour à StarHermit', playLocal: 'Jouer sur cet appareil',
};
export const SH_STRINGS = {
  'en-US': en, 'en-GB': en, 'es-419': es, 'es-ES': es,
  'de-DE': {
    signIn: 'Mit StarHermit anmelden', invite: 'Freund einladen',
    copied: 'Einladungslink in die Zwischenablage kopiert', copyFail: 'Kopiere diesen Einladungslink: {url}',
    signedOut: 'Abgemeldet – der Fortschritt bleibt auf diesem Gerät',
    expiredTitle: 'Deine Sitzung ist abgelaufen', expiredBody: 'Deine StarHermit-Sitzung ist beendet, daher wurde die Raumverbindung getrennt. Kehre zu StarHermit zurück, um eine neue Sitzung zu starten.',
    relaunch: 'Zurück zu StarHermit', playLocal: 'Auf diesem Gerät spielen',
  },
  'fr-FR': fr, 'fr-CA': fr,
  'pt-BR': {
    signIn: 'Entrar com StarHermit', invite: 'Convidar um amigo',
    copied: 'Link de convite copiado para a área de transferência', copyFail: 'Copie este link de convite: {url}',
    signedOut: 'Sessão encerrada — o progresso fica neste dispositivo',
    expiredTitle: 'Sua sessão expirou', expiredBody: 'Sua sessão do StarHermit terminou e a conexão com a sala foi interrompida. Volte ao StarHermit para iniciar uma nova sessão.',
    relaunch: 'Voltar ao StarHermit', playLocal: 'Jogar neste dispositivo',
  },
  'it-IT': {
    signIn: 'Accedi con StarHermit', invite: 'Invita un amico',
    copied: 'Link di invito copiato negli appunti', copyFail: 'Copia questo link di invito: {url}',
    signedOut: 'Disconnesso: i progressi restano su questo dispositivo',
    expiredTitle: 'La tua sessione è scaduta', expiredBody: 'La tua sessione StarHermit è terminata, quindi la connessione alla stanza si è interrotta. Torna su StarHermit per avviare una nuova sessione.',
    relaunch: 'Torna a StarHermit', playLocal: 'Gioca su questo dispositivo',
  },
};
const BY_LANG = { en: 'en-US', es: 'es-419', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR', it: 'it-IT' };

export function shLocale(tag) {
  const t = String(tag || 'en-US');
  const exact = Object.keys(SH_STRINGS).find(k => k.toLowerCase() === t.toLowerCase());
  if (exact) return exact;
  const lang = t.split('-')[0].toLowerCase();
  if (lang === 'es' && /-es$/i.test(t)) return 'es-ES';
  if (lang === 'en' && /-(gb|ie|au|nz|za|in)$/i.test(t)) return 'en-GB';
  if (lang === 'fr' && /-ca$/i.test(t)) return 'fr-CA';
  return BY_LANG[lang] || 'en-US';
}

export function shText(key, vars = {}, tag = (typeof navigator !== 'undefined' ? navigator.language : 'en-US')) {
  const s = SH_STRINGS[shLocale(tag)][key] ?? en[key];
  return String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}
