// ================================================================
//  daily-crypto - briefs crypto de Francis le coq (Telegram).
//
//  Brique ISOLÉE issue du découpage de " daily-fact ". Si elle plante,
//  le reste (World, Hot, Q&A du bot, jeux...) continue de tourner.
//
//  PIPELINE EN 2 TEMPS (optimise les quotas gratuits Gemini) :
//    A) RECHERCHE grounded (Google Search) - modèle 2.5 (quota 20 RPD) :
//         crypto -> gemini-2.5-flash-lite  (fallback gemini-2.5-flash)
//       Rôle : trouver la meilleure actu et en extraire les FAITS vérifiés.
//    B) MISE EN FORME + vérif critères - gemini-3.5-flash-lite (repli 3.1) :
//       Rôle : rédiger le message final (template + limite de caractères)
//       à partir des faits de l'étape A. Pas de grounding ici.
//
//  Créneaux (pg_cron, corps {"kind":"..."}):
//    * morning 05:00 UTC   ⏰ Crypto Morning
//    * midday  12:00 UTC   🌞 Crypto Midday
//    * evening 19:00 UTC   🌆 Crypto Evening
//    * night   20:30 UTC   🌙 Crypto Night (récap du jour)
//
//  Diffusion : EN d'abord -> " The Chicken Coop " Crypto Coop (1490),
//  La version FR est accessible via le bouton « Translate » du message.
//
//  Sécurité : header x-cron-secret == CRON_SECRET.
// ================================================================

const NL = String.fromCharCode(10)

// -- Modèles ---------------------------------------------------
// Étape A (recherche grounded) : on tente le 1er, repli sur le 2e si 429.
const SEARCH_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash']
// Étape B (mise en forme / vérif / traduction) : quota large, pas de grounding.
// Mise en forme/traduction : Gemini 3.5 Flash-Lite, repli 3.1 Flash-Lite si quota.
const FORMAT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
const AI_TIMEOUT_MS = 40000

// -- Telegram : groupes & topics -------------------------------
const CRYPTO_THREAD_EN = 1490       // topic EN " Crypto Coop "

// -- Bandeaux (bucket public "assets") -------------------------
const IMG_BASE = 'https://mubqtnqulpyehkgubhnh.supabase.co/storage/v1/object/public/assets/'
const KIND_IMAGE: Record<string, string> = {
  morning: 'Crypto Morning.png',
  midday: 'Crypto Midday.png',
  evening: 'Crypto Evening.png',
  night: 'Crypto Night.png',
}
function imageUrlFor(kind: string): string {
  const f = KIND_IMAGE[kind]
  if (!f) return ''
  // URL STABLE (pas de cache-buster) : Telegram met l'image en cache et la
  // reutilise au lieu de la re-telecharger a chaque envoi.
  return IMG_BASE + encodeURIComponent(f)
}

type Slot = 'morning' | 'midday' | 'evening'
const SLOT_HOOK: Record<Slot, string> = {
  morning: '⏰ Crypto Morning:',
  midday: '🌞 Crypto Midday:',
  evening: '🌆 Crypto Evening:',
}
const SLOT_HOOK_FR: Record<Slot, string> = {
  morning: '⏰ Crypto Matin',
  midday: '🌞 Crypto Midi',
  evening: '🌆 Crypto Soir',
}

// -- Réseau ----------------------------------------------------
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

// -- Étape A : recherche grounded (Google Search) --------------
// Renvoie les FAITS bruts trouvés, ou '' si tous les modèles échouent.
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

// -- Étape B : mise en forme / vérif (3.5-flash-lite, repli 3.1 ; sans grounding) --
async function formatCall(prompt: string, temperature = 0.4): Promise<string> {
  // 2 tours : chaque tour essaie 3.5 puis 3.1 ; si tout échoue (429/rate limit),
  // on attend ~7 s (le quota RPM retombe) et on refait un tour.
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

// -- Journal anti-doublon (daily_news_log) ---------------------
// sinceHours: fenêtre glissante (ex. 36h) pour l'anti-doublon ; sans argument,
// on garde la JOURNÉE civile (utilisé par le récap du soir).
async function fetchTodayTopics(sinceHours?: number): Promise<string[]> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return []
  try {
    const filter = (sinceHours && sinceHours > 0)
      ? 'created_at=gte.' + encodeURIComponent(new Date(Date.now() - sinceHours * 3600 * 1000).toISOString())
      : 'day=eq.' + new Date().toISOString().slice(0, 10)
    const res = await tfetch(
      url + '/rest/v1/daily_news_log?' + filter + '&slot=in.(morning,midday,evening)&select=summary&order=created_at',
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

// Copie EN -> owner uniquement (pour coller sur X). Plus de CTA/lien dans le
// message lui-meme (le lien t.me dans un post X provoque un shadowban) : le
// lien se met desormais EN COMMENTAIRE via les commandes /x… du bot.
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
// Copie owner en TEXTE seul + boutons (sans lien ; l'owner ajoute l'image).
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
const KIND_JOB: Record<string, string> = { morning: 'franc-gm', midday: 'franc-crypto-midi', evening: 'franc-news', night: 'franc-crypto-night' }

// -- Indice Fear & Greed (alternative.me) ----------------------
async function fetchFearGreed(): Promise<string> {
  try {
    const res = await tfetch('https://api.alternative.me/fng/?limit=1')
    if (!res.ok) return ''
    const d = await res.json()
    const row = d && d.data ? d.data[0] : null
    const v = Number(row && row.value)
    const cls = String((row && row.value_classification) || '').trim()
    if (!isFinite(v) || !cls) return ''
    return v + '/100 (' + cls + ')'
  } catch { return '' }
}

// Émoticône associée à l'état de l'indice (classification alternative.me).
const FNG_EMOJI: Record<string, string> = {
  'Extreme Fear': '😱',
  'Fear': '😨',
  'Neutral': '😐',
  'Greed': '🤑',
  'Extreme Greed': '🤩',
}
// Ligne prête à afficher pour le Crypto Evening : "Fear & Greed Index: 36 (Fear 😨)".
// L'état de l'indice est mis entre parenthèses à côté du chiffre, avec sa petite
// émoticône associée. '' si l'API est indisponible (on omet alors la ligne).
async function fetchFngPiece(): Promise<{ value: number; cls: string; emoji: string } | null> {
  try {
    const res = await tfetch('https://api.alternative.me/fng/?limit=1')
    if (!res.ok) return null
    const d = await res.json()
    const row = d && d.data ? d.data[0] : null
    const v = Number(row && row.value)
    const cls = String((row && row.value_classification) || '').trim()
    if (!isFinite(v) || !cls) return null
    return { value: v, cls, emoji: FNG_EMOJI[cls] || '😐' }
  } catch { return null }
}

// -- Découpe accroche / explication (sans regex) ---------------
function splitAccroche(s: string): string {
  const t = s.trim()
  if (t.indexOf(NL) >= 0) return t
  const dot = t.indexOf('. ')
  if (dot > 0 && dot < t.length - 2) return t.slice(0, dot + 1) + NL + NL + t.slice(dot + 2)
  return t
}

// == ACTU CRYPTO (morning / midday / evening) ==================
function searchPromptNews(coveredToday: string[]): string {
  const dedup = coveredToday.length
    ? NL + 'ALREADY COVERED IN THE LAST 36 HOURS (below). Strongly PREFER a genuinely DIFFERENT SUBJECT (different event/company/institution, not the same one from another angle). You may revisit one of these subjects ONLY if there is a SIGNIFICANT, GENUINELY NEW development on it since it was covered — otherwise do NOT repeat it. Example: if an SEC/regulation story is listed, avoid more SEC/regulation news unless something genuinely new just happened.' + NL + coveredToday.map((s) => '- ' + s).join(NL) + NL
    : ''
  return [
    'You are a crypto news researcher for the $FRANC community.',
    'Use Google Search to find the SINGLE most impactful crypto news of the LAST 24 HOURS, from reputable crypto/finance outlets (major market moves, big regulation, ETFs, major hacks/security, big adoption or institutional moves, key macro affecting crypto). Judge by IMPORTANCE and IMPACT.',
    dedup,
    'Report the VERIFIED FACTS you found: what happened, key figures/names/dates, why it matters for crypto, and the outlet name(s). 4 to 7 short factual lines, no styling.',
    'If you truly cannot find any real crypto news, reply with exactly: NONE',
  ].join(NL)
}

// Format structuré (comme World Roost) : marqueurs → HTML. EN + FR indépendants.
function cryptoNewsPrompt(facts: string, lang: 'English' | 'French'): string {
  return [
    'You are Francis the rooster — a sharp but reliable crypto news anchor. Using ONLY the verified facts below, craft ONE clean, easy-to-read crypto news item IN ' + lang.toUpperCase() + '.',
    'FACTS:', '---', facts, '---',
    'Output EXACTLY these marker lines (nothing before or after, no title):',
    'THEME: <emoji> <1 to 3 word category, e.g. Regulation, ETFs, Bitcoin, Security, Adoption>',
    'HEAD: <ONE short, punchy headline sentence>',
    'SUMMARY: <exactly 1 to 2 SHORT factual sentences — the essential only. Keep it light and easy to read>',
    "INSIGHT: <1 to 2 SHORT sentences — Francis' level-headed takeaway. NO hype, NO 'moon/pump/buy/sell', NO financial advice>",
    'RULES:',
    '- NO bullet points. 100% factual and neutral.',
    '- Base everything ONLY on the facts. NEVER invent numbers, names or outcomes.',
    '- Keep the markers EXACTLY: THEME:, HEAD:, SUMMARY:, INSIGHT:. Write the values in ' + lang.toUpperCase() + '.',
    '- If the facts are empty or NONE, output only: NONE',
    'Output ONLY the marker lines.',
  ].join(NL)
}
type CNews = { theme: string; head: string; summary: string; insight: string }
function parseCryptoNews(s: string): CNews {
  const out: CNews = { theme: '', head: '', summary: '', insight: '' }
  for (const raw of (s || '').split(NL)) {
    const line = raw.trim()
    if (/^THEME\s*:/i.test(line)) out.theme = line.replace(/^THEME\s*:/i, '').trim()
    else if (/^HEAD\s*:/i.test(line)) out.head = line.replace(/^HEAD\s*:/i, '').trim()
    else if (/^SUMMARY\s*:/i.test(line)) out.summary = line.replace(/^SUMMARY\s*:/i, '').trim()
    else if (/^INSIGHT\s*:/i.test(line)) out.insight = line.replace(/^INSIGHT\s*:/i, '').trim()
  }
  return out
}
// Libellés FIGÉS : 📌 In Brief / En bref · signature 🐓 Francis' Take / Le mot de Francis.
function buildCryptoNews(title: string, lang: 'en' | 'fr', p: CNews): string {
  const sec = lang === 'fr' ? 'En bref' : 'In Brief'
  const sig = lang === 'fr' ? 'Le mot de Francis' : "Francis' Take"
  const parts: string[] = ['<b>' + esc(title) + '</b>']
  if (p.theme) parts.push('', '<b>' + esc(p.theme) + '</b>')
  if (p.head) parts.push('🚨 ' + esc(p.head))
  if (p.summary) parts.push('', '📌 <b>' + sec + '</b>', esc(p.summary))
  if (p.insight) parts.push('', '🐓 <b>' + sig + '</b>', esc(p.insight))
  return parts.join(NL)
}

async function generateNews(slot: Slot): Promise<{ ok: boolean; en: string; fr: string; logText: string; reason: string }> {
  const coveredToday = await fetchTodayTopics(36)   // anti-doublon sur 36h glissantes
  const facts = await groundedSearch(searchPromptNews(coveredToday))
  if (!facts || facts.toUpperCase().indexOf('NONE') === 0) return { ok: false, en: '', fr: '', logText: '', reason: 'étape A: pas d actu (facts=' + facts.slice(0, 60) + ')' }
  const enS = await formatCall(cryptoNewsPrompt(facts, 'English'))   // séquentiel (évite les 429 en rafale)
  const frS = await formatCall(cryptoNewsPrompt(facts, 'French'))
  const enP = parseCryptoNews(enS)
  const frP = parseCryptoNews(frS)
  if (!enP.head && !enP.summary && !frP.head && !frP.summary) return { ok: false, en: '', fr: '', logText: '', reason: 'étape B: structure vide' }
  const enData = (enP.head || enP.summary) ? enP : frP
  const frData = (frP.head || frP.summary) ? frP : enP
  const stripColon = (x: string) => x.replace(/\s*:\s*$/, '')
  const en = buildCryptoNews(stripColon(SLOT_HOOK[slot]), 'en', enData)
  const fr = buildCryptoNews(SLOT_HOOK_FR[slot], 'fr', frData)
  const logText = (enData.theme ? enData.theme + ' — ' : '') + enData.head
  return { ok: true, en, fr, logText, reason: '' }
}

// == CRYPTO EVENING (laius marches + crypto, puis % en direct) ==
// Les POURCENTAGES viennent directement des APIs (Yahoo / CoinGecko) et
// sont formates en dur : jamais generes par l'IA (zero hallucination sur
// les chiffres). Seul le "laius" (le pourquoi) passe par l'IA grounded.

// Signe + couleur pour un pourcentage (ex. +0.8% -> "🟢 +0.8%").
function fmtPct(p: number): string {
  const s = (p >= 0 ? '+' : '') + p.toFixed(1) + '%'
  return (p >= 0 ? '🟢 ' : '🔴 ') + s
}

// -- Grandes places boursieres mondiales (Yahoo Finance) --------
interface IdxDef { sym: string; label: string; flag: string }
const STOCK_INDICES: IdxDef[] = [
  { sym: '%5EGSPC', label: 'S&P 500', flag: '🇺🇸' },        // Wall Street (NYSE)
  { sym: '%5EIXIC', label: 'Nasdaq', flag: '🇺🇸' },         // Nasdaq
  { sym: '%5ESTOXX50E', label: 'Euro Stoxx 50', flag: '🇪🇺' }, // Euronext / zone euro
  { sym: '%5EN225', label: 'Nikkei 225', flag: '🇯🇵' },     // Tokyo
  { sym: '000001.SS', label: 'Shanghai', flag: '🇨🇳' },     // Shanghai
  { sym: '%5EFCHI', label: 'CAC 40', flag: '🇫🇷' },         // Paris
]
async function fetchIndexPct(def: IdxDef): Promise<string | null> {
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + def.sym + '?range=1d&interval=1d'
    const res = await tfetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 8000)
    if (!res.ok) return null
    const d = await res.json()
    const meta = (d && d.chart && d.chart.result && d.chart.result[0]) ? d.chart.result[0].meta : null
    if (!meta) return null
    const price = Number(meta.regularMarketPrice)
    const prev = Number(meta.chartPreviousClose ?? meta.previousClose)
    if (!isFinite(price) || !isFinite(prev) || prev === 0) return null
    return def.flag + ' ' + def.label + ' ' + fmtPct((price - prev) / prev * 100)
  } catch { return null }
}
async function fetchStockLines(): Promise<{ lines: string[]; weekend: boolean }> {
  const rows = await Promise.all(STOCK_INDICES.map(fetchIndexPct))
  const lines = rows.filter((x): x is string => Boolean(x))
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', weekday: 'short' }).format(new Date())
  const weekend = (wd === 'Sat' || wd === 'Sun')
  return { lines, weekend }
}

// -- Liste FIXE de 6 cryptos (CoinGecko, variation 24h) ---------
// Liste choisie a la main (pas le top marketcap) pour EXCLURE les
// stablecoins, dont la variation ~0% ne fait pas serieux. "GRAM" =
// libelle demande par le owner, donnees = Toncoin (the-open-network).
interface CoinDef { id: string; sym: string }
const CRYPTO_LIST: CoinDef[] = [
  { id: 'bitcoin', sym: 'BTC' },
  { id: 'ethereum', sym: 'ETH' },
  { id: 'binancecoin', sym: 'BNB' },
  { id: 'ripple', sym: 'XRP' },
  { id: 'solana', sym: 'SOL' },
  { id: 'the-open-network', sym: 'GRAM' },
]
async function fetchCryptoLines(): Promise<string[]> {
  // Clé CoinGecko + retry : sans clé le endpoint était rate-limité (429) et le
  // Top 6 disparaissait silencieusement du Crypto Evening.
  const key = Deno.env.get('COINGECKO_API_KEY')
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (key) headers['x-cg-demo-api-key'] = key
  const ids = CRYPTO_LIST.map((c) => c.id).join(',')
  const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=' + ids + '&price_change_percentage=24h'
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await tfetch(url, { headers }, 12000)
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500)); continue }
      if (!res.ok) { await new Promise((r) => setTimeout(r, 800)); continue }
      const rows = await res.json()
      if (!Array.isArray(rows) || !rows.length) continue
      const pctById: Record<string, number> = {}
      for (const r of rows) { if (r && r.id) pctById[String(r.id)] = Number(r.price_change_percentage_24h) }
      // On garde NOTRE ordre (BTC, ETH, BNB, XRP, SOL, GRAM) et on saute
      // proprement toute crypto dont la variation n'a pas ete recuperee.
      const lines = CRYPTO_LIST.map((c) => {
        const p = pctById[c.id]
        if (!isFinite(p)) return ''
        return '• ' + c.sym + ' ' + fmtPct(p)
      }).filter(Boolean)
      if (lines.length) return lines
    } catch { await new Promise((r) => setTimeout(r, 800)) }
  }
  return []
}

// -- Laius du soir : POURQUOI ca monte/baisse (grounded) --------
function searchPromptEveningMood(): string {
  return [
    'You are a markets analyst. Use Google Search to explain the mood of financial markets and crypto over the LAST 24 HOURS.',
    'Cover BOTH: (1) traditional markets (major stock indices in the US, Europe and Asia) and (2) crypto (Bitcoin, Ethereum and the overall crypto market).',
    'Explain WHY they are up or down today: name the CONCRETE drivers (the Fed / interest rates, inflation data, jobs, earnings season, a major geopolitical event, ETF flows, a big crypto-specific event, etc.).',
    'Report the VERIFIED FACTS in 3 to 6 short factual lines, naming the drivers and the direction of the moves. No styling.',
    'If you truly cannot tell, reply with exactly: NONE',
  ].join(NL)
}
function formatPromptEveningBlurb(facts: string): string {
  return [
    'You are Francis the rooster, mascot of the $FRANC community.',
    'Below are VERIFIED FACTS about today market and crypto mood (already researched):',
    '---', facts, '---',
    'Write a SHORT "laius": 2 to 4 sentences IN ENGLISH explaining, simply and clearly, why classic markets AND crypto are up or down today. Connect the two.',
    '',
    'HARD RULES:',
    '- 500 CHARACTERS MAXIMUM.',
    '- Plain text, no title, no hook, no bullet, no emoji. Begin directly with the explanation.',
    '- Base it ONLY on the facts above. NEVER invent numbers, names or events. Stay factual and NEUTRAL.',
    '- NO financial advice, never say "moon/pump/buy/sell".',
    '- If the facts say NONE or are empty, reply with exactly: NONE',
    '',
    'Output ONLY the laius text (or NONE), nothing else.',
  ].join(NL)
}

// Assemble le Crypto Evening (HTML) dans une langue donnée. Données (Top 6,
// indices, valeur F&G) = langue-neutre ; seuls les libellés + le laius changent.
function buildEvening(lang: 'en' | 'fr', fng: { value: number; cls: string; emoji: string } | null,
  cryptoLines: string[], stock: { lines: string[]; weekend: boolean }, blurb: string): string {
  const fr = lang === 'fr'
  const L = fr ? {
    title: 'Crypto Evening', top6: 'Top 6 Cryptos (24h)', markets: 'Marchés mondiaux',
    when: stock.weekend ? 'clôture de vendredi' : 'en temps réel', snap: 'Aperçu du marché', fng: 'Indice Fear &amp; Greed',
  } : {
    title: 'Crypto Evening', top6: 'Top 6 Cryptos (24h)', markets: 'Global Markets',
    when: stock.weekend ? 'Friday close' : 'right now', snap: 'Market Snapshot', fng: 'Fear &amp; Greed Index',
  }
  const parts: string[] = ['🏙️ <b>' + L.title + '</b>']
  if (fng) parts.push('', fng.emoji + ' <b>' + L.fng + ': ' + fng.value + ' — ' + esc(fng.cls) + '</b>')
  if (cryptoLines.length) parts.push('', '🪙 <b>' + L.top6 + '</b>', ...cryptoLines)
  if (stock.lines.length) parts.push('', '📈 <b>' + L.markets + '</b> <i>(' + L.when + ')</i>', ...stock.lines)
  if (blurb) parts.push('', '📊 <b>' + L.snap + '</b>', esc(blurb))
  return parts.join(NL)
}
async function generateEvening(): Promise<{ ok: boolean; en: string; fr: string; reason: string; logText: string }> {
  const [stock, cryptoLines, fng] = await Promise.all([fetchStockLines(), fetchCryptoLines(), fetchFngPiece()])
  const facts = await groundedSearch(searchPromptEveningMood())
  let blurbEn = ''
  if (facts && facts.toUpperCase().indexOf('NONE') !== 0) {
    const b = await formatCall(formatPromptEveningBlurb(facts))
    if (b && b.toUpperCase().indexOf('NONE') !== 0) blurbEn = b.trim()
  }
  if (!blurbEn && !stock.lines.length && !cryptoLines.length) return { ok: false, en: '', fr: '', reason: 'evening: ni laius ni donnees marche', logText: '' }
  const blurbFr = blurbEn ? await translatePiece(blurbEn) : ''
  const en = buildEvening('en', fng, cryptoLines, stock, blurbEn)
  const fr = buildEvening('fr', fng, cryptoLines, stock, blurbFr)
  return { ok: true, en, fr, reason: '', logText: blurbEn || 'Markets & crypto mood update this evening.' }
}

// == CRYPTO NIGHT (récap du jour) ==============================
const NIGHT_INTRO = "The day's essential crypto, wrapped up 👇"

function searchPromptMacro(): string {
  return [
    'You are a markets researcher. Use Google Search to find the SINGLE biggest market-moving MACRO or GEOPOLITICAL event of the LAST 24 HOURS (the Fed, interest rates, inflation, the US dollar, jobs, major geopolitics) that best explains today crypto/market action.',
    'Report the key facts in 1 to 3 short factual lines (what, where, why it moves markets). Name the country if relevant.',
    'If there is genuinely no major macro event, reply with exactly: NONE',
  ].join(NL)
}

function nightPrompt(lang: 'English' | 'French', topics: string[], macroFacts: string): string {
  const newsBlock = topics.length ? topics.map((n, i) => (i + 1) + '. ' + n).join(NL) : '(none)'
  const macro = (macroFacts && macroFacts.toUpperCase().indexOf('NONE') !== 0) ? macroFacts : '(none)'
  return [
    'You are Francis the rooster, mascot of the $FRANC community. Write the end-of-day crypto recap IN ' + lang.toUpperCase() + ', for an international audience.',
    '',
    'A) Crypto stories $FRANC published today (chronological):',
    newsBlock,
    '',
    'B) Biggest macro / geopolitical event today (researched):',
    macro,
    '',
    'Produce a STRUCTURED recap using EXACTLY this marker format (nothing before, no title):',
    'SENTIMENT: <market mood in 2-4 words, e.g. "Risk-off">',
    'MOOD: <ONE short sentence explaining the mood>',
    'SECTION: <emoji> <short theme title> :: <bullet sentence> :: <bullet sentence> :: <bullet sentence>',
    'SECTION: <emoji> <short theme title> :: <bullet> :: <bullet>',
    '',
    'RULES:',
    '- GROUP the day stories into 2 to 4 thematic SECTION lines (e.g. a security incident, "Markets", "Macro"). Each SECTION = one emoji + a short title, then 2 to 3 short bullet sentences separated by " :: ".',
    '- Base everything ONLY on the material above (A and B). NEVER invent. If B is (none), do NOT add a Macro section.',
    '- Each bullet is ONE short factual sentence. No financial advice, never "moon/pump/buy/sell".',
    '- Keep the markers EXACTLY: "SENTIMENT:", "MOOD:", "SECTION:" and the " :: " separators. One SECTION per line.',
    '',
    'Output ONLY these marker lines.',
  ].join(NL)
}
type NightData = { sentiment: string; mood: string; sections: { emoji: string; title: string; bullets: string[] }[] }
function parseNight(s: string): NightData {
  const out: NightData = { sentiment: '', mood: '', sections: [] }
  for (const raw of (s || '').split(NL)) {
    const line = raw.trim()
    if (/^SENTIMENT\s*:/i.test(line)) out.sentiment = line.replace(/^SENTIMENT\s*:/i, '').trim()
    else if (/^MOOD\s*:/i.test(line)) out.mood = line.replace(/^MOOD\s*:/i, '').trim()
    else if (/^SECTION\s*:/i.test(line)) {
      const segs = line.replace(/^SECTION\s*:/i, '').split('::').map((x) => x.trim()).filter(Boolean)
      if (!segs.length) continue
      const head = segs[0]; const sp = head.indexOf(' ')
      const emoji = sp > 0 ? head.slice(0, sp) : '•'
      const title = sp > 0 ? head.slice(sp + 1).trim() : head
      if (title) out.sections.push({ emoji, title, bullets: segs.slice(1) })
    }
  }
  return out
}
const NIGHT_SEP = '—'.repeat(10)
function buildNight(lang: 'en' | 'fr', fng: { value: number; cls: string; emoji: string } | null, p: NightData): string {
  const fr = lang === 'fr'
  const L = fr
    ? { title: 'Crypto Night', sentiment: 'Sentiment du marché', fng: 'Indice Fear &amp; Greed', highlights: 'Points clés du jour', recap: "Voilà le récap crypto du jour. À demain !", cautious: 'Prudence' }
    : { title: 'Crypto Night', sentiment: 'Market Sentiment', fng: 'Fear &amp; Greed Index', highlights: "Today's Highlights", recap: "That's today's crypto recap. See you tomorrow!", cautious: 'Cautious' }
  const parts: string[] = ['🌙 <b>' + L.title + '</b>']
  parts.push('', '📈 <b>' + L.sentiment + '</b>')
  if (fng) parts.push(fng.emoji + ' ' + L.fng + ': ' + fng.value + '/100 (' + esc(fng.cls.toUpperCase()) + ')')
  if (p.sentiment || p.mood) {
    parts.push('', '⚠️ <b>' + esc(p.sentiment || L.cautious) + '</b>')
    if (p.mood) parts.push(esc(p.mood))
  }
  parts.push('', NIGHT_SEP, '📋 <b>' + L.highlights + '</b>')
  for (const sec of p.sections) parts.push('', esc(sec.emoji) + ' <b>' + esc(sec.title) + '</b>', ...sec.bullets.map((b) => '• ' + esc(b)))
  parts.push('', NIGHT_SEP, '🐔 <b>' + esc(L.recap) + '</b>')
  return parts.join(NL)
}
async function generateNight(): Promise<{ ok: boolean; en: string; fr: string; reason: string; logText: string }> {
  const [topics, fng] = await Promise.all([fetchTodayTopics(), fetchFngPiece()])
  const macroFacts = await groundedSearch(searchPromptMacro())
  const enStruct = await formatCall(nightPrompt('English', topics, macroFacts))   // séquentiel (évite les 429 en rafale)
  const frStruct = await formatCall(nightPrompt('French', topics, macroFacts))
  const enP = parseNight(enStruct)
  const frP = parseNight(frStruct)
  if (!enP.sections.length && !enP.mood) return { ok: false, en: '', fr: '', reason: 'night: structure vide (out=' + (enStruct || '').slice(0, 60) + ')', logText: '' }
  const en = buildNight('en', fng, enP)
  const fr = buildNight('fr', fng, frP.sections.length ? frP : enP)
  return { ok: true, en, fr, reason: '', logText: enP.mood || 'Crypto recap of the day.' }
}

// -- Traduction FR (3.5-flash-lite, repli 3.1) -----------------
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
    if (same / lines.length > 0.5) return false   // contenu resté en anglais
  }
  return true
}
// Traduction fiable : essaie chaque modèle (3.5-lite puis 3.1-lite) et renvoie la
// PREMIÈRE sortie réellement traduite ; à défaut, la meilleure disponible.
async function translateReliable(prompt: string, src: string, temperature = 0.3): Promise<string> {
  let best = ''
  for (let attempt = 0; attempt < 2; attempt++) {
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
    if (attempt === 0) await new Promise((r) => setTimeout(r, 7000))
  }
  return best
}
function esc(s: string): string { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
function stripTags(s: string): string { return (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') }
// Traduit un COURT texte (laius / puce) en français fiable ; renvoie la source si échec.
async function translatePiece(text: string): Promise<string> {
  if (!text) return ''
  const prompt = 'Translate this short text into natural, fluent French. Keep tickers ($X), numbers, %, prices and proper names unchanged. Translate EVERYTHING else. Output ONLY the French translation.' + NL + NL + text
  const out = await translateReliable(prompt, text, 0.3)
  return translationLooksValid(text, out) ? out : text
}
async function translateToFrench(text: string): Promise<string> {
  const prompt = [
    'Translate the following Telegram message into natural, fluent FRENCH for a French-speaking community.',
    'RULES:',
    '- Keep ALL emojis exactly where they are, and keep the same line breaks / layout.',
    '- Do NOT translate or alter: "$FRANC", ticker symbols, numbers, %, prices, URLs, coin/person/product names.',
    '- Keep the whole "Fear & Greed Index" line UNCHANGED, in English, including the sentiment word in parentheses (Fear, Greed, Neutral, Extreme Fear, Extreme Greed) and its emoji. Do NOT translate it.',
    '- Translate the leading section title too (e.g. "⏰ Crypto Morning:" -> "⏰ Crypto Matin :").',
    '- Translate the ENTIRE body into French (all sentences and descriptions), not just the labels. Nothing meaningful should stay in English (except the items listed above).',
    '- Natural French, no robotic tone. Output ONLY the translated message, nothing else.',
    '',
    'MESSAGE:',
    text,
  ].join(NL)
  return await translateReliable(prompt, text, 0.3)
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
// Poste dans la langue par défaut du groupe + bouton, et pré-enregistre les DEUX
// versions pour la bascule instantanée. imgUrl='' -> message texte. html=true ->
// parse_mode HTML (gras) + mémorisé pour que la bascule FR reste en gras.
async function postI18n(token: string, chatId: number, threadId: number, imgUrl: string, defaultLang: 'en' | 'fr', en: string, fr: string, html = false): Promise<void> {
  const text = (defaultLang === 'fr') ? fr : en
  const base: any = { chat_id: chatId, disable_web_page_preview: true, reply_markup: NLANG_BTN }
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

// -- Point d'entrée --------------------------------------------
Deno.serve(async (req: Request) => {
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('forbidden', { status: 403 })

  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  const botToken = Deno.env.get('BOT_TOKEN')
  const chatId = Number(Deno.env.get('FACT_CHAT_ID') ?? '-1003842240104')
  if (!geminiKey || !botToken) return new Response('missing config', { status: 500 })

  let kind: 'morning' | 'midday' | 'evening' | 'night' = 'morning'
  let dryRun = false
  let ownerOnly = false   // n'envoie QUE la copie owner (pour X), sans poster dans les groupes
  try {
    const body = await req.json()
    if (body && (body.kind === 'midday' || body.kind === 'midi')) kind = 'midday'
    else if (body && body.kind === 'evening') kind = 'evening'
    else if (body && body.kind === 'night') kind = 'night'
    else if (body && (body.kind === 'morning' || body.kind === 'gm')) kind = 'morning'
    if (body && body.dryRun === true) dryRun = true
    if (body && body.ownerOnly === true) ownerOnly = true
  } catch { /* corps vide -> morning */ }

  const gen = () => (kind === 'night')
    ? generateNight()
    : (kind === 'evening') ? generateEvening() : generateNews(kind as Slot)

  if (dryRun) {
    const r: any = await gen()
    const en = r.en || r.text || ''
    return new Response(JSON.stringify({ kind, ok: r.ok, reason: r.reason, length: en.length, en, fr: r.fr }, null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const bg = (async () => {
    try {
      const result: any = await gen()
      if (!result.ok) { console.error('daily-crypto[' + kind + '] échec:', result.reason); return }
      // Toutes les rubriques (morning / midday / evening / night) = format
      // STRUCTURÉ HTML (EN + FR déjà construits, jamais de balise traduite).
      const structured = true
      const en = result.en, frText = result.fr
      // Mode "ownerOnly" : uniquement la copie owner (pour X), AUCUN post groupe.
      if (ownerOnly) { await dmOwnerCopy(botToken, stripTags(en)); console.log('daily-crypto[' + kind + '] ownerOnly envoyé'); return }
      const imgUrl = imageUrlFor(kind)
      // EN (défaut) -> The Chicken Coop, Crypto Coop — bouton 🇬🇧/🇫🇷 pré-enregistré.
      await postI18n(botToken, chatId, CRYPTO_THREAD_EN, imgUrl, 'en', en, frText, structured)
      // Le soir on ne journalise QUE le laius (repris par le recap Night).
      if (kind !== 'night') await logDailyTopic(kind, result.logText || stripTags(en))
      // Copie EN -> owner (pour X) pour le Crypto Evening (18h55) ET le Crypto Night (20h45).
      if (kind === 'evening' || kind === 'night') await dmOwnerCopy(botToken, stripTags(en))
      await markSent(KIND_JOB[kind] || ('crypto-' + kind))
      console.log('daily-crypto[' + kind + '] posté:', (result.logText || stripTags(en)).slice(0, 80))
    } catch (e) { console.error('daily-crypto[' + kind + '] bg exception:', String(e)) }
  })()
  ;(globalThis as any).EdgeRuntime?.waitUntil?.(bg)
  return new Response('accepted', { status: 202 })
})
