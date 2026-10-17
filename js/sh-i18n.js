// sh-i18n.js — strings for the StarHermit platform controls (sign-in,
// invite, session expired, terms required, results leaderboard line) in every
// supported locale; callers pass the game locale (js/i18n.js).
const en = {
  signIn: 'Sign in with StarHermit', invite: 'Invite a friend',
  copied: 'Invite link copied to the clipboard', copyFail: 'Copy this invite link: {url}',
  signedOut: 'Signed out — progress stays on this device',
  expiredTitle: 'Your session expired', expiredBody: 'Your StarHermit session ended, so the room connection stopped. Go back to StarHermit to start a fresh session.',
  relaunch: 'Back to StarHermit', playLocal: 'Play on this device',
  termsTitle: 'Your StarHermit terms need attention', termsBody: 'StarHermit needs you to accept its updated terms, so the room connection stopped. Open the game again from StarHermit to review them and keep playing.',
  lbPosting: 'Posting score to the leaderboard…', lbRank: 'Leaderboard rank: #{rank}', lbPosted: 'Score posted to the leaderboard.', lbNotPosted: 'Score not posted to the leaderboard.',
};
const es = {
  signIn: 'Iniciar sesión con StarHermit', invite: 'Invitar a un amigo',
  copied: 'Enlace de invitación copiado al portapapeles', copyFail: 'Copia este enlace de invitación: {url}',
  signedOut: 'Sesión cerrada: el progreso se queda en este dispositivo',
  expiredTitle: 'Tu sesión expiró', expiredBody: 'Tu sesión de StarHermit terminó y se detuvo la conexión con la sala. Vuelve a StarHermit para iniciar una nueva sesión.',
  relaunch: 'Volver a StarHermit', playLocal: 'Jugar en este dispositivo',
  termsTitle: 'Acepta los términos de StarHermit', termsBody: 'StarHermit necesita que aceptes sus términos actualizados, así que se detuvo la conexión con la sala. Vuelve a abrir el juego desde StarHermit para revisarlos y seguir jugando.',
  lbPosting: 'Publicando la puntuación en la clasificación…', lbRank: 'Puesto en la clasificación: #{rank}', lbPosted: 'Puntuación publicada en la clasificación.', lbNotPosted: 'No se pudo publicar la puntuación en la clasificación.',
};
const fr = {
  signIn: 'Se connecter avec StarHermit', invite: 'Inviter un ami',
  copied: 'Lien d’invitation copié dans le presse-papiers', copyFail: 'Copiez ce lien d’invitation : {url}',
  signedOut: 'Déconnecté — la progression reste sur cet appareil',
  expiredTitle: 'Votre session a expiré', expiredBody: 'Votre session StarHermit est terminée, la connexion à la salle a donc été interrompue. Retournez sur StarHermit pour démarrer une nouvelle session.',
  relaunch: 'Retour à StarHermit', playLocal: 'Jouer sur cet appareil',
  termsTitle: 'Conditions StarHermit à accepter', termsBody: 'StarHermit a besoin que vous acceptiez ses conditions mises à jour : la connexion à la salle a donc été interrompue. Rouvrez le jeu depuis StarHermit pour les consulter et continuer à jouer.',
  lbPosting: 'Envoi du score au classement…', lbRank: 'Rang au classement : #{rank}', lbPosted: 'Score envoyé au classement.', lbNotPosted: 'Score non envoyé au classement.',
};
export const SH_STRINGS = {
  'en-US': en, 'en-GB': en, 'es-419': es, 'es-ES': { ...es, lbNotPosted: 'No se ha podido publicar la puntuación en la clasificación.' },
  'de-DE': {
    signIn: 'Mit StarHermit anmelden', invite: 'Freund einladen',
    copied: 'Einladungslink in die Zwischenablage kopiert', copyFail: 'Kopiere diesen Einladungslink: {url}',
    signedOut: 'Abgemeldet – der Fortschritt bleibt auf diesem Gerät',
    expiredTitle: 'Deine Sitzung ist abgelaufen', expiredBody: 'Deine StarHermit-Sitzung ist beendet, daher wurde die Raumverbindung getrennt. Kehre zu StarHermit zurück, um eine neue Sitzung zu starten.',
    relaunch: 'Zurück zu StarHermit', playLocal: 'Auf diesem Gerät spielen',
    termsTitle: 'StarHermit-Bedingungen bestätigen', termsBody: 'StarHermit braucht deine Zustimmung zu den aktualisierten Nutzungsbedingungen, daher wurde die Raumverbindung getrennt. Öffne das Spiel erneut über StarHermit, um sie zu prüfen und weiterzuspielen.',
    lbPosting: 'Punktzahl wird in die Bestenliste eingetragen…', lbRank: 'Platz in der Bestenliste: #{rank}', lbPosted: 'Punktzahl in die Bestenliste eingetragen.', lbNotPosted: 'Punktzahl wurde nicht in die Bestenliste eingetragen.',
  },
  'fr-FR': fr, 'fr-CA': { ...fr, lbPosting: 'Envoi du pointage au classement…', lbPosted: 'Pointage envoyé au classement.', lbNotPosted: 'Pointage non envoyé au classement.' },
  'pt-BR': {
    signIn: 'Entrar com StarHermit', invite: 'Convidar um amigo',
    copied: 'Link de convite copiado para a área de transferência', copyFail: 'Copie este link de convite: {url}',
    signedOut: 'Sessão encerrada — o progresso fica neste dispositivo',
    expiredTitle: 'Sua sessão expirou', expiredBody: 'Sua sessão do StarHermit terminou e a conexão com a sala foi interrompida. Volte ao StarHermit para iniciar uma nova sessão.',
    relaunch: 'Voltar ao StarHermit', playLocal: 'Jogar neste dispositivo',
    termsTitle: 'Aceite os termos do StarHermit', termsBody: 'O StarHermit precisa que você aceite os termos atualizados, por isso a conexão com a sala foi interrompida. Abra o jogo de novo pelo StarHermit para revisá-los e continuar jogando.',
    lbPosting: 'Enviando pontuação para o placar…', lbRank: 'Posição no placar: #{rank}', lbPosted: 'Pontuação enviada para o placar.', lbNotPosted: 'A pontuação não foi enviada para o placar.',
  },
  'it-IT': {
    signIn: 'Accedi con StarHermit', invite: 'Invita un amico',
    copied: 'Link di invito copiato negli appunti', copyFail: 'Copia questo link di invito: {url}',
    signedOut: 'Disconnesso: i progressi restano su questo dispositivo',
    expiredTitle: 'La tua sessione è scaduta', expiredBody: 'La tua sessione StarHermit è terminata, quindi la connessione alla stanza si è interrotta. Torna su StarHermit per avviare una nuova sessione.',
    relaunch: 'Torna a StarHermit', playLocal: 'Gioca su questo dispositivo',
    termsTitle: 'Accetta i termini di StarHermit', termsBody: 'StarHermit ha bisogno che tu accetti i termini aggiornati, quindi la connessione alla stanza si è interrotta. Riapri il gioco da StarHermit per leggerli e continuare a giocare.',
    lbPosting: 'Invio del punteggio alla classifica…', lbRank: 'Posizione in classifica: #{rank}', lbPosted: 'Punteggio inviato alla classifica.', lbNotPosted: 'Punteggio non inviato alla classifica.',
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
