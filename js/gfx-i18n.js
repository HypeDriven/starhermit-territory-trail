'use strict';

// Localized strings for the Graphics settings section. The rest of the game is
// English-only; this panel picks its locale from navigator.language.

const EN = {
  graphics: 'Graphics', quality: 'Quality', auto: 'Auto (detected: {tier})', fromPreset: 'From preset ({tier})',
  renderScale: 'Render scale', adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
  postUnavailable: 'Post-processing is unavailable on this device; effects that need it are skipped.',
  cat: { shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Color grade', antialias: 'Anti-aliasing', detail: 'Surface detail', particles: 'Particles', background: 'Ambient motion' },
  tier: { low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra', medium: 'Medium', off: 'Off', on: 'On', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Plain', detailed: 'Detailed', static: 'Static', animated: 'Animated' },
  words: { noShadows: 'no shadows', shadows: 'shadows', ao: 'ambient occlusion', aoFull: 'full ambient occlusion', bloom: 'bloom', noAA: 'no anti-aliasing' },
};

const GB = Object.assign({}, EN, {
  cat: Object.assign({}, EN.cat, { grade: 'Colour grade' }),
});

const ES = {
  graphics: 'Gráficos', quality: 'Calidad', auto: 'Automática (detectada: {tier})', fromPreset: 'Según el preajuste ({tier})',
  renderScale: 'Escala de renderizado', adaptive: 'Resolución adaptativa', showFps: 'Mostrar fotogramas por segundo',
  postUnavailable: 'El posprocesado no está disponible en este dispositivo; se omiten los efectos que lo necesitan.',
  cat: { shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Corrección de color', antialias: 'Antialiasing', detail: 'Detalle de superficies', particles: 'Partículas', background: 'Movimiento ambiental' },
  tier: { low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra', medium: 'Media', off: 'No', on: 'Sí', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Detallado', static: 'Estático', animated: 'Animado' },
  words: { noShadows: 'sin sombras', shadows: 'sombras', ao: 'oclusión ambiental', aoFull: 'oclusión ambiental completa', bloom: 'resplandor', noAA: 'sin antialiasing' },
};

const ES419 = Object.assign({}, ES, {
  renderScale: 'Escala de render',
  postUnavailable: 'El posprocesamiento no está disponible en este dispositivo; se omiten los efectos que lo necesitan.',
});

const DE = {
  graphics: 'Grafik', quality: 'Qualität', auto: 'Automatisch (erkannt: {tier})', fromPreset: 'Laut Voreinstellung ({tier})',
  renderScale: 'Renderskalierung', adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
  postUnavailable: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar; Effekte, die sie brauchen, entfallen.',
  cat: { shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Bloom', grade: 'Farbkorrektur', antialias: 'Kantenglättung', detail: 'Oberflächendetails', particles: 'Partikel', background: 'Umgebungsbewegung' },
  tier: { low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra', medium: 'Mittel', off: 'Aus', on: 'An', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Schlicht', detailed: 'Detailliert', static: 'Statisch', animated: 'Animiert' },
  words: { noShadows: 'keine Schatten', shadows: 'Schatten', ao: 'Umgebungsverdeckung', aoFull: 'volle Umgebungsverdeckung', bloom: 'Bloom', noAA: 'keine Kantenglättung' },
};

const FR = {
  graphics: 'Graphismes', quality: 'Qualité', auto: 'Automatique (détectée : {tier})', fromPreset: 'Selon le préréglage ({tier})',
  renderScale: 'Échelle de rendu', adaptive: 'Résolution adaptative', showFps: 'Afficher les images par seconde',
  postUnavailable: 'Le post-traitement n’est pas disponible sur cet appareil ; les effets qui en dépendent sont ignorés.',
  cat: { shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Halo lumineux', grade: 'Étalonnage des couleurs', antialias: 'Anticrénelage', detail: 'Détail des surfaces', particles: 'Particules', background: 'Mouvement ambiant' },
  tier: { low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra', medium: 'Moyenne', off: 'Désactivé', on: 'Activé', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Détaillé', static: 'Statique', animated: 'Animé' },
  words: { noShadows: 'sans ombres', shadows: 'ombres', ao: 'occlusion ambiante', aoFull: 'occlusion ambiante complète', bloom: 'halo', noAA: 'sans anticrénelage' },
};

const FRCA = Object.assign({}, FR, {
  showFps: 'Afficher la fréquence d’images',
});

const PT = {
  graphics: 'Gráficos', quality: 'Qualidade', auto: 'Automática (detectada: {tier})', fromPreset: 'Da predefinição ({tier})',
  renderScale: 'Escala de renderização', adaptive: 'Resolução adaptativa', showFps: 'Mostrar taxa de quadros',
  postUnavailable: 'O pós-processamento não está disponível neste dispositivo; os efeitos que dependem dele são ignorados.',
  cat: { shadows: 'Sombras', ao: 'Oclusão de ambiente', bloom: 'Brilho', grade: 'Correção de cor', antialias: 'Antisserrilhamento', detail: 'Detalhe das superfícies', particles: 'Partículas', background: 'Movimento ambiente' },
  tier: { low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra', medium: 'Média', off: 'Desligado', on: 'Ligado', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simples', detailed: 'Detalhado', static: 'Estático', animated: 'Animado' },
  words: { noShadows: 'sem sombras', shadows: 'sombras', ao: 'oclusão de ambiente', aoFull: 'oclusão de ambiente completa', bloom: 'brilho', noAA: 'sem antisserrilhamento' },
};

const IT = {
  graphics: 'Grafica', quality: 'Qualità', auto: 'Automatica (rilevata: {tier})', fromPreset: 'Dal preset ({tier})',
  renderScale: 'Scala di rendering', adaptive: 'Risoluzione adattiva', showFps: 'Mostra frequenza fotogrammi',
  postUnavailable: 'La post-elaborazione non è disponibile su questo dispositivo; gli effetti che la richiedono vengono saltati.',
  cat: { shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore', grade: 'Correzione colore', antialias: 'Antialiasing', detail: 'Dettaglio superfici', particles: 'Particelle', background: 'Movimento ambientale' },
  tier: { low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra', medium: 'Media', off: 'No', on: 'Sì', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Semplice', detailed: 'Dettagliato', static: 'Statico', animated: 'Animato' },
  words: { noShadows: 'nessuna ombra', shadows: 'ombre', ao: 'occlusione ambientale', aoFull: 'occlusione ambientale completa', bloom: 'bagliore', noAA: 'nessun antialiasing' },
};

export const GFX_STRINGS = {
  'en-US': EN, 'en-GB': GB, 'es-419': ES419, 'es-ES': ES, 'de-DE': DE,
  'fr-FR': FR, 'fr-CA': FRCA, 'pt-BR': PT, 'it-IT': IT,
};

const FALLBACK_BY_LANG = { en: 'en-US', es: 'es-419', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR', it: 'it-IT' };

export function pickLocale(lang) {
  const l = String(lang || 'en-US');
  if (GFX_STRINGS[l]) return l;
  const lower = l.toLowerCase();
  for (const k of Object.keys(GFX_STRINGS)) if (k.toLowerCase() === lower) return k;
  if (/^en-(gb|au|nz|ie|za|in)/i.test(l)) return 'en-GB';
  if (/^es-es/i.test(l)) return 'es-ES';
  if (/^fr-ca/i.test(l)) return 'fr-CA';
  return FALLBACK_BY_LANG[lower.slice(0, 2)] || 'en-US';
}

export function gfxStrings(lang) {
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
  return GFX_STRINGS[pickLocale(lang || nav)];
}
