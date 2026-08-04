// ================================================================
//  daily-world - actu generaliste (non crypto) de Francis le coq.
//
//  Brique ISOLEE issue du decoupage de daily-fact. Remplace l'ancienne
//  fonction "world-roost" (supprimee -> les crons renvoyaient 404).
//
//  PIPELINE EN 2 TEMPS (memes quotas que daily-crypto) :
//    A) RECHERCHE grounded (Google Search) - world -> gemini-2.5-flash
//       (fallback gemini-2.5-flash-lite). Trouve la meilleure actu.
//    B) MISE EN FORME - gemini-3.5-flash-lite (repli 3.1) : redige le message FR
//       (langue source), puis traduit en EN. Pas de grounding ici.
//
//  6 rubriques (pg_cron, corps {"kind":"..."}):
//    * wr_morning  Reveil Info du Coq        (actu internationale 12h)
//    * wr_eco      Cocorico Eco              (economie mondiale 24h)
//    * wr_midday   Actu Midi du Coq          (Europe / France 24h)
//    * wr_tech     Cocorico Tech Info        (IA / espace / tech 24h)
//    * wr_evening  Le Monde ce Soir          (actu internationale 12h)
//    * wr_night    L'actu du Jour en Bref    (recap + vigilance + a surveiller)
//
//  Diffusion : The Chicken Coop, World Roost (1489), EN par defaut
//  + bouton « Translate in French » (FR pre-enregistre).
//  Limites : 235 caracteres (rubriques), 500 (bilan).
//
//  Securite : header x-cron-secret == CRON_SECRET.
// ================================================================

const NL = String.fromCharCode(10)

// -- Modeles ---------------------------------------------------
// World -> 2.5-flash en primaire (fallback 2.5-flash-lite).
const SEARCH_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']
// Mise en forme/traduction : Gemini 3.5 Flash-Lite, repli 3.1 Flash-Lite si quota.
const FORMAT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
const AI_TIMEOUT_MS = 40000

// -- Telegram : groupes & topics -------------------------------
const WORLD_THREAD_EN = 1489        // topic EN "World Roost"

// -- Bandeaux (bucket public "assets") -------------------------
const IMG_BASE = 'https://mubqtnqulpyehkgubhnh.supabase.co/storage/v1/object/public/assets/'
const KIND_IMAGE: Record<string, string> = {
  wr_morning: 'Reveil du coq.png',
  wr_eco: 'Cocorico Eco.png',
  wr_midday: 'Actu midi du coq.png',
  wr_tech: 'Cocorico Tech Info.png',
  wr_evening: 'Le Monde Ce Soir.png',
  wr_night: 'Actu du jour en bref.png',
  // French Coop (topic 2290) — bannières à uploader dans le bucket public "assets".
  // Tant que le PNG n'existe pas, l'envoi photo échoue et retombe en texte seul.
  fr_morning: 'midiFR.png',
  fr_eu: 'expressUE.png',
  fr_evening: 'soirFR.png',
}
function imageUrlFor(kind: string): string {
  const f = KIND_IMAGE[kind]
  if (!f) return ''
  // URL STABLE (pas de cache-buster) : Telegram met l'image en cache et la
  // reutilise au lieu de la re-telecharger a chaque envoi.
  return IMG_BASE + encodeURIComponent(f)
}

type WSlot = 'wr_morning' | 'wr_eco' | 'wr_midday' | 'wr_tech' | 'wr_evening'
interface WDef { hookFr: string; hookEn: string; directive: string }
const WORLD: Record<WSlot, WDef> = {
  wr_morning: {
    hookFr: '⏰ Réveil Info du Coq :',
    hookEn: '⏰ Rooster Morning News:',
    directive: "Recherche l'actualité INTERNATIONALE majeure des 12 dernières heures. Sélectionne UNIQUEMENT l'événement ayant le plus fort impact potentiel mondial.",
  },
  wr_eco: {
    hookFr: '🐓 Cocorico Éco :',
    hookEn: '🐓 Cocorico Economy News:',
    directive: "Recherche les actualités ÉCONOMIQUES mondiales des 24 dernières heures. Choisis la plus importante en termes d'impact sur les marchés ou l'économie mondiale.",
  },
  wr_midday: {
    hookFr: '☀️ Actu Midi du Coq :',
    hookEn: '☀️ Midday Rooster News:',
    directive: "Recherche la plus grosse actualité INTERNATIONALE des 24 dernières heures (portée mondiale, tous continents). Si l'actu concerne un pays en particulier, précise-le impérativement pour que ce soit clair.",
  },
  wr_tech: {
    hookFr: '💡 Cocorico Tech Info :',
    hookEn: '💡 Cocorico Tech News:',
    directive: "Recherche la principale actualité TECH des 24 dernières heures. PRIORITÉ ABSOLUE à l'IA : si un nouveau MODÈLE d'IA plus puissant est sorti ou qu'un modèle a évolué (nouvelle version, capacités, benchmarks), c'est LE sujet à retenir — annonce-le clairement. Ne traite l'ESPACE ou les autres nouvelles technologies QUE s'il n'y a AUCUNE actu IA pertinente sur la période.",
  },
  wr_evening: {
    hookFr: '🌍 Le Monde ce Soir :',
    hookEn: '🌍 The World Tonight:',
    directive: "Recherche l'actualité INTERNATIONALE la plus FRAÎCHE de cette FIN DE JOURNÉE (dernières 6 à 8 heures) : le développement marquant le plus récent, à fort impact mondial. Prends la meilleure actu du moment, même si le sujet est lié à un événement plus large déjà connu (donne l'angle le plus récent).",
  },
}
// "L'actu du Jour en Bref" (ex-"Bilan Info du Soir") : le hook EST la 1re ligne du message.
const NIGHT_HOOK_FR = "🌙 L'essentiel de l'actu du Jour en Bref, résumé 👇 :"
const NIGHT_HOOK_EN = "🌙 The Day in Review — today's essentials 👇:"

// ── FRENCH COOP (topic 2290) : news FR en priorité + bouton EN ──
// 3 créneaux Paris : 11h35 actu FR · 15h15 actu UE · 19h50 actu FR.
// Message NATIF EN FRANÇAIS (défaut), bouton « Translate in English 🇬🇧 ».
const FRENCH_COOP_THREAD = 2290
type FSlot = 'fr_morning' | 'fr_eu' | 'fr_evening'
const FRCOOP: Record<FSlot, WDef> = {
  fr_morning: {
    hookFr: '🇫🇷 🕛 Le Coq de Midi :',
    hookEn: '🇫🇷 🕛 Le Coq de Midi :',
    directive: "Recherche LA plus grosse actualité FRANÇAISE (France) des dernières 24 heures : politique, société, économie, faits marquants. Choisis l'événement au plus fort impact pour le public français.",
  },
  fr_eu: {
    hookFr: '🇪🇺 🕒 Le Cocorico Express :',
    hookEn: '🇪🇺 🕒 Le Cocorico Express :',
    directive: "Recherche LA plus grosse actualité de l'UNION EUROPÉENNE des dernières 24 heures (institutions UE, décisions de Bruxelles, actualité d'un État membre à portée européenne). Choisis l'événement au plus fort impact européen.",
  },
  fr_evening: {
    hookFr: '🇫🇷 🌙 Le Cocorico du Soir :',
    hookEn: '🇫🇷 🌙 Le Cocorico du Soir :',
    directive: "Recherche LA plus grosse actualité FRANÇAISE (France) des dernières 24 heures qui marque cette fin de journée. Choisis l'événement au plus fort impact pour le public français.",
  },
}

// -- Reseau ----------------------------------------------------
async function tfetch(input: string, init: RequestInit = {}, ms = 10000): Promise<Response> {
  return await globalThis.fetch(input, { ...init, signal: AbortSignal.timeout(ms) })
}
function geminiUrl(model: string): string {
  const key = Deno.env.get('GEMINI_API_KEY') || ''
  return 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + key
}
function extractText(data: any): string {
  const cand = data && data.candidates ? data.candidates[0] : null
  const parts = cand && cand.content && cand.content.parts ? cand.content.parts : []
  return parts.map((p: any) => (p && p.text) ? p.text : '').join('').trim()
}

// -- Etape A : recherche grounded ------------------------------
async function groundedSearch(prompt: string): Promise<string> {
  for (const model of SEARCH_MODELS) {
    try {
      const res = await tfetch(geminiUrl(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.4 },
        }),
      }, AI_TIMEOUT_MS)
      if (res.status === 429) { console.warn('groundedSearch 429 sur ' + model + ', repli'); continue }
      if (!res.ok) { console.error('groundedSearch HTTP', res.status, model, (await res.text()).slice(0, 140)); continue }
      const out = extractText(await res.json())
      if (out) return out
    } catch (e) { console.error('groundedSearch exception', model, String(e)) }
  }
  return ''
}

// -- Etape B : mise en forme / traduction (3.5-flash-lite, repli 3.1) -----
async function formatCall(prompt: string, temperature = 0.4): Promise<string> {
  // 2 tours : 3.5 puis 3.1 ; si tout échoue (429/rate limit), pause ~7 s et on refait.
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const model of FORMAT_MODELS) {
      try {
        const res = await tfetch(geminiUrl(model), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature, maxOutputTokens: 2048 } }),
        }, 25000)
        if (res.status === 429) { console.warn('formatCall 429 ' + model + ' (tour ' + (attempt + 1) + ')'); continue }
        if (!res.ok) { console.error('formatCall HTTP', res.status, model); continue }
        const out = extractText(await res.json())
        if (out) return out
      } catch (e) { console.error('formatCall exception', model, String(e)) }
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 7000))
  }
  return ''
}

// -- Journal anti-doublon (slots wr_*) -------------------------
// sinceHours: fenêtre glissante (ex. 36h) pour l'anti-doublon ; sans argument,
// on garde la JOURNÉE civile (utilisé par le bilan du soir).
async function fetchTodayWorldTopics(sinceHours?: number, slotLike = 'wr_*'): Promise<string[]> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return []
  try {
    const filter = (sinceHours && sinceHours > 0)
      ? 'created_at=gte.' + encodeURIComponent(new Date(Date.now() - sinceHours * 3600 * 1000).toISOString())
      : 'day=eq.' + new Date().toISOString().slice(0, 10)
    const res = await tfetch(
      url + '/rest/v1/daily_news_log?' + filter + '&slot=like.' + slotLike + '&select=summary&order=created_at',
      { headers: { apikey: key, Authorization: 'Bearer ' + key } },
    )
    if (!res.ok) return []
    const rows = await res.json()
    return (Array.isArray(rows) ? rows : []).map((r: any) => String((r && r.summary) || '')).filter(Boolean)
  } catch { return [] }
}
async function logDailyTopic(slot: string, summary: string): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return
  try {
    const today = new Date().toISOString().slice(0, 10)
    await tfetch(url + '/rest/v1/daily_news_log', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ day: today, slot, summary }),
    })
  } catch { /* best-effort */ }
}

// -- Decoupe accroche / explication (sans regex) ---------------
function splitAccroche(s: string): string {
  const t = s.trim()
  if (t.indexOf(NL) >= 0) return t
  const dot = t.indexOf('. ')
  if (dot > 0 && dot < t.length - 2) return t.slice(0, dot + 1) + NL + NL + t.slice(dot + 2)
  return t
}

// == RUBRIQUES (wr_morning..wr_evening) ========================
function searchPromptWorld(def: WDef, covered: string[]): string {
  const dedup = covered.length
    ? NL + "DEJA COUVERT SUR LES 36 DERNIERES HEURES (ci-dessous). Prefere FORTEMENT un SUJET VRAIMENT DIFFERENT (autre evenement/pays/dossier, pas le meme sous un autre angle). Tu ne peux revenir sur l'un de ces sujets QUE s'il y a un developpement SIGNIFICATIF et VRAIMENT NOUVEAU depuis. Sinon, ne le repete pas." + NL + covered.map((s) => '- ' + s).join(NL) + NL
    : ''
  return [
    "Tu es un chercheur d'actualité pour une chaîne Telegram grand public FRANCOPHONE.",
    def.directive,
    dedup,
    "Rapporte les FAITS VÉRIFIÉS trouvés : quoi, où, qui, chiffres/dates clés, pourquoi c'est important, et le média source. 3 à 6 lignes factuelles courtes, sans mise en forme.",
    'Si tu ne trouves vraiment aucune actu réelle, réponds exactement : NONE',
  ].join(NL)
}

function stripColon(s: string): string { return s.replace(/\s*:\s*$/, '') }

// Prompt structuré : l'IA renvoie des MARQUEURS (jamais de balises HTML), on
// génère EN et FR séparément puis on habille en HTML → zéro balise traduite.
function newsBlockPrompt(facts: string, lang: 'English' | 'French'): string {
  return [
    'You are Francis the rooster — a sharp but reliable news anchor. Using ONLY the verified facts below, craft ONE clean, easy-to-read news item IN ' + lang.toUpperCase() + '.',
    'FACTS:',
    '---', facts, '---',
    'Output EXACTLY these marker lines (nothing before or after, no title):',
    'THEME: <emoji> <1 to 3 word category, e.g. Artificial Intelligence, Defense, Economy, Elections>',
    'HEAD: <ONE short, punchy headline sentence>',
    'SUMMARY: <exactly 1 to 2 SHORT sentences — the essential only. NO dates, decree numbers, official names or minutiae unless truly crucial. Keep it light and easy to read>',
    "INSIGHT: <1 to 2 SHORT punchy sentences — Francis' level-headed takeaway. NO hype, NO 'stay tuned'/'we'll be back'>",
    'RULES:',
    '- NO bullet points. Keep it tight and airy.',
    '- Base everything ONLY on the facts. NEVER invent figures, names or conclusions. Neutral, no bias on sensitive topics.',
    '- Keep the markers EXACTLY: THEME:, HEAD:, SUMMARY:, INSIGHT:. Write the values in ' + lang.toUpperCase() + '.',
    '- If the facts are empty or NONE, output only: NONE',
    'Output ONLY the marker lines.',
  ].join(NL)
}
type NewsData = { theme: string; head: string; summary: string; bullets: string[]; insight: string }
function parseNewsBlock(s: string): NewsData {
  const out: NewsData = { theme: '', head: '', summary: '', bullets: [], insight: '' }
  for (const raw of (s || '').split(NL)) {
    const line = raw.trim()
    if (/^THEME\s*:/i.test(line)) out.theme = line.replace(/^THEME\s*:/i, '').trim()
    else if (/^HEAD\s*:/i.test(line)) out.head = line.replace(/^HEAD\s*:/i, '').trim()
    else if (/^SUMMARY\s*:/i.test(line)) out.summary = line.replace(/^SUMMARY\s*:/i, '').trim()
    else if (/^BULLET\s*:/i.test(line)) { const b = line.replace(/^BULLET\s*:/i, '').trim(); if (b) out.bullets.push(b) }
    else if (/^INSIGHT\s*:/i.test(line)) out.insight = line.replace(/^INSIGHT\s*:/i, '').trim()
  }
  return out
}
// Libellés FIGÉS : 📌 In Brief / En bref · signature 🐓 Francis' Take / Le mot de Francis.
function buildNewsBlock(title: string, lang: 'en' | 'fr', p: NewsData): string {
  const sec = lang === 'fr' ? 'En bref' : 'In Brief'
  const sig = lang === 'fr' ? 'Le mot de Francis' : "Francis' Take"
  const parts: string[] = ['<b>' + esc(title) + '</b>']
  if (p.theme) parts.push('', '<b>' + esc(p.theme) + '</b>')
  if (p.head) parts.push('🚨 ' + esc(p.head))
  if (p.summary) parts.push('', '📌 <b>' + sec + '</b>', esc(p.summary))
  if (p.insight) parts.push('', '🐓 <b>' + sig + '</b>', esc(p.insight))
  return parts.join(NL)
}

// Générateur commun (World Roost + French Coop) : facts groundés, puis EN + FR
// structurés indépendamment (balises jamais traduites).
async function genNews(slot: string, def: WDef, slotLike: string): Promise<{ ok: boolean; en: string; fr: string; logText: string; reason: string }> {
  // Le Monde ce Soir = actu de FIN DE JOURNÉE : dédup court (6h) pour ne pas
  // s'auto-bloquer sur les rubriques du jour et se retrouver sans actu (❌).
  const dedupHours = slot === 'wr_evening' ? 6 : 36
  const covered = await fetchTodayWorldTopics(dedupHours, slotLike)
  const facts = await groundedSearch(searchPromptWorld(def, covered))
  if (!facts || facts.toUpperCase().indexOf('NONE') === 0) return { ok: false, en: '', fr: '', logText: '', reason: 'etape A: pas d actu' }
  const enS = await formatCall(newsBlockPrompt(facts, 'English'))   // séquentiel (évite les 429 en rafale)
  const frS = await formatCall(newsBlockPrompt(facts, 'French'))
  const enP = parseNewsBlock(enS)
  const frP = parseNewsBlock(frS)
  if (!enP.head && !enP.summary && !frP.head && !frP.summary) return { ok: false, en: '', fr: '', logText: '', reason: 'etape B: structure vide' }
  const enData = (enP.head || enP.summary) ? enP : frP
  const frData = (frP.head || frP.summary) ? frP : enP
  const en = buildNewsBlock(stripColon(def.hookEn), 'en', enData)
  const fr = buildNewsBlock(stripColon(def.hookFr), 'fr', frData)
  const logText = (enData.theme ? enData.theme + ' — ' : '') + enData.head
  return { ok: true, en, fr, logText, reason: '' }
}

async function generateWorld(slot: WSlot): Promise<{ ok: boolean; en: string; fr: string; logText: string; reason: string }> {
  return await genNews(slot, WORLD[slot], 'wr_*')
}
async function generateFrench(slot: FSlot): Promise<{ ok: boolean; en: string; fr: string; logText: string; reason: string }> {
  return await genNews(slot, FRCOOP[slot], 'fr_*')
}

// == DAY IN REVIEW (wr_night, sans recherche) — format structuré ===
function esc(s: string): string { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
function stripTags(s: string): string { return (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') }
function dayReviewPrompt(lang: 'English' | 'French', topics: string[]): string {
  const block = topics.map((n, i) => (i + 1) + '. ' + n).join(NL)
  return [
    'You are Francis the rooster. Write the end-of-day WORLD / ECONOMY / TECH recap IN ' + lang.toUpperCase() + ' for a general Telegram audience.',
    '',
    "Today's stories (in order):",
    block,
    '',
    'Produce a STRUCTURED recap using EXACTLY this marker format (nothing before, no title):',
    'BIG: <flag/emoji> <the SINGLE biggest story of the day in ONE sentence>',
    'BRIEF: <flag/emoji> <short item> | <flag/emoji> <short item> | <flag/emoji> <short item>',
    'IMPACT: <ONE sentence on the market / geopolitical impact of the day>',
    'TOMORROW: <ONE sentence on what to watch tomorrow>',
    '',
    'RULES:',
    '- BIG = the most important story. BRIEF = the OTHER stories, one short clause each, each prefixed by a relevant COUNTRY FLAG or emoji, separated by " | " (2 to 5 items).',
    '- If a story concerns a specific country (especially France), use its flag and NAME it.',
    '- Base everything ONLY on the stories above. NEVER invent. Factual and neutral.',
    '- Keep the markers EXACTLY: "BIG:", "BRIEF:", "IMPACT:", "TOMORROW:" and the " | " separators.',
    '',
    'Output ONLY these marker lines.',
  ].join(NL)
}
type ReviewData = { big: string; briefs: string[]; impact: string; tomorrow: string }
function parseReview(s: string): ReviewData {
  const out: ReviewData = { big: '', briefs: [], impact: '', tomorrow: '' }
  for (const raw of (s || '').split(NL)) {
    const line = raw.trim()
    if (/^BIG\s*:/i.test(line)) out.big = line.replace(/^BIG\s*:/i, '').trim()
    else if (/^BRIEF\s*:/i.test(line)) out.briefs = line.replace(/^BRIEF\s*:/i, '').split('|').map((x) => x.trim()).filter(Boolean)
    else if (/^IMPACT\s*:/i.test(line)) out.impact = line.replace(/^IMPACT\s*:/i, '').trim()
    else if (/^TOMORROW\s*:/i.test(line)) out.tomorrow = line.replace(/^TOMORROW\s*:/i, '').trim()
  }
  return out
}
function buildReview(lang: 'en' | 'fr', p: ReviewData): string {
  const fr = lang === 'fr'
  const L = fr
    ? { title: 'Le jour en revue', big: 'À la une', brief: 'En bref', impact: 'Impact marché', tomorrow: 'Demain' }
    : { title: 'Day in Review', big: 'Big Story', brief: 'In Brief', impact: 'Market Impact', tomorrow: 'Tomorrow' }
  const parts: string[] = ['🌙 <b>' + L.title + '</b>']
  if (p.big) parts.push('', '🔥 <b>' + L.big + '</b>', esc(p.big))
  if (p.briefs.length) parts.push('', '⚡ <b>' + L.brief + '</b>', ...p.briefs.map((b) => '• ' + esc(b)))
  if (p.impact) parts.push('', '🎯 <b>' + L.impact + '</b>', esc(p.impact))
  if (p.tomorrow) parts.push('', '🍎 <b>' + L.tomorrow + '</b>', esc(p.tomorrow))
  return parts.join(NL)
}
async function generateWorldNight(): Promise<{ ok: boolean; en: string; fr: string; reason: string }> {
  const topics = await fetchTodayWorldTopics()
  if (topics.length === 0) return { ok: false, en: '', fr: '', reason: 'aucune actu du jour' }
  const [enStruct, frStruct] = await Promise.all([
    formatCall(dayReviewPrompt('English', topics)),
    formatCall(dayReviewPrompt('French', topics)),
  ])
  const enP = parseReview(enStruct); const frP = parseReview(frStruct)
  if (!enP.big && !enP.briefs.length) return { ok: false, en: '', fr: '', reason: 'night: structure vide (out=' + (enStruct || '').slice(0, 60) + ')' }
  const en = buildReview('en', enP)
  const fr = buildReview('fr', (frP.big || frP.briefs.length) ? frP : enP)
  return { ok: true, en, fr, reason: '' }
}

// Vrai si `out` est une traduction PLAUSIBLE de `src` : ni vide, ni tronquée
// (< 40 %), ni un écho, ni SOUS-TRADUITE (trop de lignes restées identiques).
function translationLooksValid(src: string, out: string): boolean {
  if (!out) return false
  const norm = (s: string) => s.toLowerCase().replace(/[^a-zà-ÿ]/gi, '')
  const ns = norm(src), no = norm(out)
  if (no.length < ns.length * 0.4) return false
  const lines = src.split(NL).map((l) => l.trim()).filter((l) => norm(l).length >= 12)
  if (lines.length >= 3) {
    const outSet = new Set(out.split(NL).map((l) => l.trim()))
    let same = 0; for (const l of lines) if (outSet.has(l)) same++
    if (same / lines.length > 0.5) return false   // contenu resté dans la langue source
  }
  return true
}
// Traduction fiable : essaie chaque modèle (3.5-lite puis 3.1-lite) et renvoie la
// PREMIÈRE sortie réellement traduite ; à défaut, la meilleure disponible.
async function translateReliable(prompt: string, src: string, temperature = 0.3): Promise<string> {
  let best = ''
  for (const model of FORMAT_MODELS) {
    try {
      const res = await tfetch(geminiUrl(model), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature, maxOutputTokens: 2048 } }),
      }, 25000)
      if (!res.ok) continue
      const out = extractText(await res.json())
      if (out && out.length > best.length) best = out
      if (translationLooksValid(src, out)) return out
    } catch (e) { console.error('translateReliable', model, String(e)) }
  }
  return best
}

// -- Traduction EN (le francais est la source) -----------------
async function translateToEnglish(frBody: string): Promise<string> {
  const prompt = [
    'Translate the following French Telegram news message into natural, fluent ENGLISH for a general-audience international channel.',
    'RULES:',
    '- Keep ALL emojis exactly where they are, and keep the same line breaks / layout.',
    '- Do NOT translate or alter: numbers, %, prices, URLs, and proper names (people, places, companies, products).',
    '- Translate the ENTIRE message into English (every sentence). Nothing meaningful should stay in French.',
    '- Natural, clear English, no robotic tone. Output ONLY the translated message, nothing else.',
    '',
    'MESSAGE:',
    frBody,
  ].join(NL)
  return await translateReliable(prompt, frBody, 0.3)
}

// -- Telegram --------------------------------------------------
async function postToGroup(token: string, chatId: number, text: string, threadId = 0): Promise<void> {
  const body: any = { chat_id: chatId, text, disable_web_page_preview: true }
  if (threadId) body.message_thread_id = threadId
  const res = await tfetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) console.error('postToGroup HTTP', res.status, (await res.text()).slice(0, 160))
}
async function postPhotoToGroup(token: string, chatId: number, photoUrl: string, caption: string, threadId = 0): Promise<boolean> {
  try {
    const body: any = { chat_id: chatId, photo: photoUrl, caption }
    if (threadId) body.message_thread_id = threadId
    const res = await tfetch('https://api.telegram.org/bot' + token + '/sendPhoto', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!data || !data.ok) { console.error('postPhotoToGroup:', JSON.stringify(data).slice(0, 160)); return false }
    return true
  } catch (e) { console.error('postPhotoToGroup exception:', String(e)); return false }
}
async function sendWithBanner(token: string, chatId: number, imgUrl: string, text: string, threadId = 0): Promise<void> {
  if (imgUrl) {
    const ok = await postPhotoToGroup(token, chatId, imgUrl, text, threadId)
    if (!ok) await postToGroup(token, chatId, text, threadId)
  } else {
    await postToGroup(token, chatId, text, threadId)
  }
}

// ── Bascule de langue PRÉ-ENREGISTRÉE (bouton 🇬🇧/🇫🇷 instantané) ──
const NLANG_BTN = { inline_keyboard: [[{ text: 'Translate in French 🇫🇷', callback_data: 'nlang:fr' }]] }
// Version FR par défaut (French Coop) : bouton vers l'anglais, bascule "home=fr".
const NLANG_FR_BTN = { inline_keyboard: [[{ text: 'Translate in English 🇬🇧', callback_data: 'nlangf:en' }]] }
async function storeI18n(chatId: number, messageId: number, en: string, fr: string, html = false): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key || !messageId) return
  try {
    await tfetch(url + '/rest/v1/news_i18n', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, en, fr, html }),
    })
  } catch (e) { console.error('storeI18n', String(e)) }
}
async function postI18n(token: string, chatId: number, threadId: number, imgUrl: string, defaultLang: 'en' | 'fr', en: string, fr: string, html = false, btn: any = NLANG_BTN): Promise<void> {
  const text = (defaultLang === 'fr') ? fr : en
  const base: any = { chat_id: chatId, disable_web_page_preview: true, reply_markup: btn }
  if (html) base.parse_mode = 'HTML'
  if (threadId) base.message_thread_id = threadId
  let messageId = 0
  if (imgUrl) {
    try { const r = await tfetch('https://api.telegram.org/bot' + token + '/sendPhoto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, photo: imgUrl, caption: text }) }); const d = await r.json(); if (d && d.ok) messageId = Number(d.result?.message_id) || 0 } catch (e) { console.error('postI18n photo', String(e)) }
  }
  if (!messageId) {
    try { const r = await tfetch('https://api.telegram.org/bot' + token + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, text }) }); const d = await r.json(); if (d && d.ok) messageId = Number(d.result?.message_id) || 0 } catch (e) { console.error('postI18n text', String(e)) }
  }
  await storeI18n(chatId, messageId, en, fr, html)
}

// Copie EN -> owner uniquement (pour coller sur X). SANS lien : le lien t.me
// dans un post X provoque un shadowban -> il se met en commentaire via /x… du bot.
const OWNER_DM_ID = 6593812300
// Boutons sous la copie owner : 📋 Copier (copy_text natif, si <=256 car) +
// 📤 Publier sur X (ouvre X avec le texte deja pre-rempli).
function xShareKeyboard(fullText: string) {
  const xBtn = { text: '📤 Publier sur X', url: 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(fullText) }
  const row = (fullText.length <= 256)
    ? [{ text: '📋 Copier', copy_text: { text: fullText } }, xBtn]
    : [xBtn]
  return { inline_keyboard: [row] }
}
// Copie owner en TEXTE seul + boutons (l'owner ajoute l'image lui-même).
async function dmOwnerCopy(token: string, enText: string): Promise<void> {
  try {
    await tfetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: OWNER_DM_ID, text: enText, disable_web_page_preview: true, reply_markup: xShareKeyboard(enText) }),
    })
  } catch (e) { console.error('dmOwnerCopy:', String(e)) }
}

// Marque l'ENVOI REEL (apres publication Telegram OK) pour le rapport 22h20.
async function markSent(jobKey: string): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return
  try {
    const today = new Date().toISOString().slice(0, 10)
    await tfetch(url + '/rest/v1/automation_sent', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ day: today, job_key: jobKey }),
    })
  } catch { /* best-effort */ }
}
const KIND_JOB: Record<string, string> = { wr_morning: 'world-morning', wr_eco: 'world-eco', wr_midday: 'world-midday', wr_tech: 'world-tech', wr_evening: 'world-evening', wr_night: 'world-night', fr_morning: 'fr-morning', fr_eu: 'fr-eu', fr_evening: 'fr-evening' }
const FR_KINDS = ['fr_morning', 'fr_eu', 'fr_evening']

// -- Point d'entree --------------------------------------------
Deno.serve(async (req: Request) => {
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('forbidden', { status: 403 })

  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  const botToken = Deno.env.get('BOT_TOKEN')
  const chatId = Number(Deno.env.get('FACT_CHAT_ID') ?? '-1003842240104')
  if (!geminiKey || !botToken) return new Response('missing config', { status: 500 })

  let kind = 'wr_morning'
  let dryRun = false
  try {
    const body = await req.json()
    const valid = ['wr_morning', 'wr_eco', 'wr_midday', 'wr_tech', 'wr_evening', 'wr_night', ...FR_KINDS]
    if (body && valid.indexOf(body.kind) >= 0) kind = body.kind
    if (body && body.dryRun === true) dryRun = true
  } catch { /* corps vide -> wr_morning */ }

  const isFrCoop = FR_KINDS.indexOf(kind) >= 0
  const gen = () => (kind === 'wr_night') ? generateWorldNight() : isFrCoop ? generateFrench(kind as FSlot) : generateWorld(kind as WSlot)

  if (dryRun) {
    const r: any = await gen()
    const t = r.en || r.fr || ''
    return new Response(JSON.stringify({ kind, ok: r.ok, reason: r.reason, length: t.length, en: r.en, fr: r.fr }, null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const bg = (async () => {
    try {
      const result: any = await gen()
      if (!result.ok) { console.error('daily-world[' + kind + '] echec:', result.reason); return }
      const imgUrl = imageUrlFor(kind)
      // Day in Review (wr_night) : format STRUCTURÉ HTML (EN + FR déjà construits).
      if (kind === 'wr_night') {
        await postI18n(botToken, chatId, WORLD_THREAD_EN, imgUrl, 'en', result.en, result.fr, true)
        await dmOwnerCopy(botToken, stripTags(result.en))   // recap 21h40 -> owner (pour X)
        await markSent(KIND_JOB[kind] || ('world-' + kind))
        console.log('daily-world[wr_night] poste')
        return
      }
      // wr_* et fr_* : nouveau format STRUCTURÉ (EN + FR déjà construits, HTML gras).
      // World Roost = EN par défaut (bouton FR) ; French Coop = FR par défaut (bouton EN).
      const thread = isFrCoop ? FRENCH_COOP_THREAD : WORLD_THREAD_EN
      const defaultLang = isFrCoop ? 'fr' : 'en'
      const btn = isFrCoop ? NLANG_FR_BTN : NLANG_BTN
      await postI18n(botToken, chatId, thread, imgUrl, defaultLang, result.en, result.fr, true, btn)
      await logDailyTopic(kind, result.logText || stripTags(result.fr))
      await markSent(KIND_JOB[kind] || ('world-' + kind))
      console.log('daily-world[' + kind + '] poste (format structuré):', (result.logText || '').slice(0, 80))
    } catch (e) { console.error('daily-world[' + kind + '] bg exception:', String(e)) }
  })()
  ;(globalThis as any).EdgeRuntime?.waitUntil?.(bg)
  return new Response('accepted', { status: 202 })
})
