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
    directive: "Recherche la plus grosse actualité EUROPÉENNE ou FRANÇAISE des 24 dernières heures. Si l'actu concerne un pays en particulier, précise-le impérativement pour que ce soit clair.",
  },
  wr_tech: {
    hookFr: '💡 Cocorico Tech Info :',
    hookEn: '💡 Cocorico Tech News:',
    directive: "Recherche la principale actualité des 24 dernières heures concernant l'IA, l'ESPACE ou les NOUVELLES TECHNOLOGIES.",
  },
  wr_evening: {
    hookFr: '🌍 Le Monde ce Soir :',
    hookEn: '🌍 The World Tonight:',
    directive: "Recherche l'actualité INTERNATIONALE majeure des 12 dernières heures. Sélectionne UNIQUEMENT l'événement ayant le plus fort impact potentiel mondial.",
  },
}
// "L'actu du Jour en Bref" (ex-"Bilan Info du Soir") : le hook EST la 1re ligne du message.
const NIGHT_HOOK_FR = "🌙 L'essentiel de l'actu du Jour en Bref, résumé 👇 :"
const NIGHT_HOOK_EN = "🌙 The Day in Review — today's essentials 👇:"

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
  for (const model of FORMAT_MODELS) {
    try {
      const res = await tfetch(geminiUrl(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature, maxOutputTokens: 2048 } }),
      }, 25000)
      if (res.status === 429) { console.warn('formatCall 429 ' + model); continue }
      if (!res.ok) { console.error('formatCall HTTP', res.status, model); continue }
      const out = extractText(await res.json())
      if (out) return out
    } catch (e) { console.error('formatCall exception', model, String(e)) }
  }
  return ''
}

// -- Journal anti-doublon (slots wr_*) -------------------------
// sinceHours: fenêtre glissante (ex. 36h) pour l'anti-doublon ; sans argument,
// on garde la JOURNÉE civile (utilisé par le bilan du soir).
async function fetchTodayWorldTopics(sinceHours?: number): Promise<string[]> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return []
  try {
    const filter = (sinceHours && sinceHours > 0)
      ? 'created_at=gte.' + encodeURIComponent(new Date(Date.now() - sinceHours * 3600 * 1000).toISOString())
      : 'day=eq.' + new Date().toISOString().slice(0, 10)
    const res = await tfetch(
      url + '/rest/v1/daily_news_log?' + filter + '&slot=like.wr_*&select=summary&order=created_at',
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

function formatPromptWorld(facts: string): string {
  return [
    "Tu es Francis le coq, présentateur d'actualité vif mais fiable pour une chaîne Telegram grand public FRANCOPHONE.",
    'Voici des FAITS VÉRIFIÉS déjà recherchés sur le sujet du jour :',
    '---',
    facts,
    '---',
    'Rédige le message final EN FRANÇAIS, clair et vulgarisé pour que tout le monde comprenne.',
    '',
    'FORMAT - DEUX blocs séparés par UNE ligne vide :',
    "(1) une phrase d'accroche COURTE et percutante ;",
    '(2) une ligne vide, puis UNE ou DEUX phrases qui expliquent simplement.',
    '',
    'RÈGLES STRICTES :',
    '- 235 CARACTÈRES MAXIMUM (un court titre de rubrique est ajouté automatiquement avant ; laisse de la marge).',
    "- N'écris AUCUN titre, label ni préfixe. Commence directement par l'accroche.",
    "- Base-toi UNIQUEMENT sur les faits ci-dessus. N'invente JAMAIS de faits, chiffres, noms ou conclusions.",
    "- AUDIENCE INTERNATIONALE : si l'actu concerne un pays précis (surtout la France), NOMME-le explicitement.",
    '- 100% factuel et NEUTRE. Sujet politique/géopolitique/conflit : sobrement, aucun parti pris. Un seul emoji maximum.',
    '- Si les faits valent NONE ou sont vides, réponds exactement : NONE',
    '',
    'Réponds UNIQUEMENT avec le message final en français (ou NONE), rien d autre.',
  ].join(NL)
}

async function generateWorld(slot: WSlot): Promise<{ ok: boolean; frText: string; reason: string }> {
  const def = WORLD[slot]
  const covered = await fetchTodayWorldTopics(36)   // anti-doublon sur 36h glissantes
  const facts = await groundedSearch(searchPromptWorld(def, covered))
  if (!facts || facts.toUpperCase().indexOf('NONE') === 0) return { ok: false, frText: '', reason: 'etape A: pas d actu' }
  const msg = await formatCall(formatPromptWorld(facts))
  if (!msg || msg.toUpperCase().indexOf('NONE') === 0) return { ok: false, frText: '', reason: 'etape B: vide/NONE' }
  return { ok: true, frText: def.hookFr + NL + NL + splitAccroche(msg), reason: '' }
}

// == BILAN DU SOIR (wr_night, sans recherche) ==================
function formatPromptNight(topics: string[]): string {
  const block = topics.map((n, i) => (i + 1) + '. ' + n).join(NL)
  return [
    "Tu es Francis le coq. Fais le bilan de fin de journée de l'actu MONDE / ÉCONOMIE / TECH pour une chaîne Telegram grand public FRANCOPHONE.",
    '',
    "Voici les sujets publiés aujourd'hui, dans l'ordre :",
    block,
    '',
    'Écris le bilan EXACTEMENT dans cette structure (rien avant la 1re ligne 👉) :',
    '👉 <résumé en UNE phrase du sujet 1>',
    '👉 <résumé en UNE phrase du sujet 2>',
    '👉 <résumé en UNE phrase du sujet 3>',
    '',
    '🌍 Point de vigilance : <UNE phrase sur le principal risque / la tension à garder à l’œil qui ressort des sujets du jour>',
    '',
    '👀 À surveiller demain : <UNE phrase sur ce qui pourrait se passer demain à partir des sujets du jour>',
    '',
    'RÈGLES :',
    '- UNE puce 👉 PAR sujet ci-dessus, dans le MÊME ordre. Moins de sujets = moins de puces.',
    '- Si un sujet concerne un pays précis (surtout la France), PRÉCISE le pays.',
    "- Les lignes « 🌍 Point de vigilance » et « 👀 À surveiller demain » sont OPTIONNELLES : ne les mets QUE si elles découlent logiquement des sujets du jour et apportent une info cohérente. Si tu n'as rien de pertinent ou de cohérent, OMETS entièrement la ligne concernée (ne l'écris pas du tout, n'invente rien).",
    '- 700 CARACTÈRES MAXIMUM au total. Une seule phrase courte par ligne.',
    "- Base-toi UNIQUEMENT sur les sujets ci-dessus. N'invente JAMAIS. Garde les marqueurs 👉 / 🌍 / 👀 exactement. Aucun titre.",
    '',
    'Réponds UNIQUEMENT avec le bilan, rien d autre.',
  ].join(NL)
}

async function generateWorldNight(): Promise<{ ok: boolean; frText: string; reason: string }> {
  const topics = await fetchTodayWorldTopics()
  if (topics.length === 0) return { ok: false, frText: '', reason: 'aucune actu du jour' }
  const out = await formatCall(formatPromptNight(topics))
  if (out && out.indexOf('👉') >= 0) {
    return { ok: true, frText: NIGHT_HOOK_FR + NL + NL + out, reason: '' }
  }
  return { ok: false, frText: '', reason: 'format inattendu' }
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
async function storeI18n(chatId: number, messageId: number, en: string, fr: string): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key || !messageId) return
  try {
    await tfetch(url + '/rest/v1/news_i18n', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, en, fr }),
    })
  } catch (e) { console.error('storeI18n', String(e)) }
}
async function postI18n(token: string, chatId: number, threadId: number, imgUrl: string, defaultLang: 'en' | 'fr', en: string, fr: string): Promise<void> {
  const text = (defaultLang === 'fr') ? fr : en
  const base: any = { chat_id: chatId, disable_web_page_preview: true, reply_markup: NLANG_BTN }
  if (threadId) base.message_thread_id = threadId
  let messageId = 0
  if (imgUrl) {
    try { const r = await tfetch('https://api.telegram.org/bot' + token + '/sendPhoto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, photo: imgUrl, caption: text }) }); const d = await r.json(); if (d && d.ok) messageId = Number(d.result?.message_id) || 0 } catch (e) { console.error('postI18n photo', String(e)) }
  }
  if (!messageId) {
    try { const r = await tfetch('https://api.telegram.org/bot' + token + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, text }) }); const d = await r.json(); if (d && d.ok) messageId = Number(d.result?.message_id) || 0 } catch (e) { console.error('postI18n text', String(e)) }
  }
  await storeI18n(chatId, messageId, en, fr)
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
const KIND_JOB: Record<string, string> = { wr_morning: 'world-morning', wr_eco: 'world-eco', wr_midday: 'world-midday', wr_tech: 'world-tech', wr_evening: 'world-evening', wr_night: 'world-night' }

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
    const valid = ['wr_morning', 'wr_eco', 'wr_midday', 'wr_tech', 'wr_evening', 'wr_night']
    if (body && valid.indexOf(body.kind) >= 0) kind = body.kind
    if (body && body.dryRun === true) dryRun = true
  } catch { /* corps vide -> wr_morning */ }

  const gen = () => (kind === 'wr_night') ? generateWorldNight() : generateWorld(kind as WSlot)

  if (dryRun) {
    const r = await gen()
    return new Response(JSON.stringify({ kind, ok: r.ok, reason: r.reason, length: r.frText.length, text: r.frText }, null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const bg = (async () => {
    try {
      const result = await gen()
      if (!result.ok) { console.error('daily-world[' + kind + '] echec:', result.reason); return }
      const imgUrl = imageUrlFor(kind)
      const hookEn = (kind === 'wr_night') ? NIGHT_HOOK_EN : WORLD[kind as WSlot].hookEn
      const fr = result.frText
      // Traduction EN avant de poster, pour pré-enregistrer les DEUX versions.
      const frBody = fr.split(NL + NL).slice(1).join(NL + NL) // retire le hook FR
      const enBody = await translateToEnglish(frBody)   // essaie 3.5 puis 3.1, valide chaque sortie
      // Traduction valide → EN (en-tête EN + corps EN). Sinon repli COHÉRENT sur le
      // FR complet (jamais d'en-tête EN collé à un corps FR).
      const en = translationLooksValid(frBody, enBody) ? (hookEn + NL + NL + enBody) : fr
      // The Chicken Coop (World Roost), EN par défaut + bouton 🇬🇧/🇫🇷 (FR pré-enregistré).
      // Poulailler supprimé : plus d'envoi FR séparé.
      await postI18n(botToken, chatId, WORLD_THREAD_EN, imgUrl, 'en', en, fr)
      if (kind !== 'wr_night') await logDailyTopic(kind, fr)
      if (kind === 'wr_night') await dmOwnerCopy(botToken, en)   // recap 21h40 -> owner (pour X)
      await markSent(KIND_JOB[kind] || ('world-' + kind))
      console.log('daily-world[' + kind + '] poste:', result.frText.slice(0, 80))
    } catch (e) { console.error('daily-world[' + kind + '] bg exception:', String(e)) }
  })()
  ;(globalThis as any).EdgeRuntime?.waitUntil?.(bg)
  return new Response('accepted', { status: 202 })
})
