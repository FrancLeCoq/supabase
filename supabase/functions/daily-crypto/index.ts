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
//    B) MISE EN FORME + vérif critères - gemini-3.1-flash-lite (500 RPD) :
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
//  puis traduction FR -> " Le Poulailler " Crypto Cocorico (43).
//
//  Sécurité : header x-cron-secret == CRON_SECRET.
// ================================================================

const NL = String.fromCharCode(10)

// -- Modèles ---------------------------------------------------
// Étape A (recherche grounded) : on tente le 1er, repli sur le 2e si 429.
const SEARCH_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash']
// Étape B (mise en forme / vérif / traduction) : quota large, pas de grounding.
const FORMAT_MODEL = 'gemini-3.1-flash-lite'
const AI_TIMEOUT_MS = 40000

// -- Telegram : groupes & topics -------------------------------
const FR_CHAT_ID = -1004352289820   // " Le Poulailler " (francophone)
const FR_THREAD_CRYPTO = 43         // topic FR " Crypto Cocorico "
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
  const v = new Date().toISOString().slice(0, 10) // cache-buster quotidien
  return IMG_BASE + encodeURIComponent(f) + '?v=' + v
}

type Slot = 'morning' | 'midday' | 'evening'
const SLOT_HOOK: Record<Slot, string> = {
  morning: '⏰ Crypto Morning:',
  midday: '🌞 Crypto Midday:',
  evening: '🌆 Crypto Evening:',
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

// -- Étape B : mise en forme / vérif (3.1-flash-lite, sans grounding) --
async function formatCall(prompt: string, temperature = 0.4): Promise<string> {
  try {
    const res = await tfetch(geminiUrl(FORMAT_MODEL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature } }),
    }, 25000)
    if (!res.ok) { console.error('formatCall HTTP', res.status); return '' }
    return extractText(await res.json())
  } catch (e) { console.error('formatCall exception', String(e)); return '' }
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

// Copie EN + CTA -> owner uniquement (pour coller sur X). Ligne vide entre
// le recap et l'invitation : "aere et pas fondu dans le message".
const OWNER_DM_ID = 6593812300
const CTA_CRYPTO = "⚡ Don't miss any crypto news." + NL + '🐔 Join the Chicken Coop :' + NL + '👉 T.me/LeCoqFrancis'
async function dmOwnerCopy(token: string, enText: string, cta: string): Promise<void> {
  try {
    await tfetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: OWNER_DM_ID, text: enText + NL + NL + cta, disable_web_page_preview: true }),
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

function formatPromptNews(facts: string): string {
  return [
    'You are Francis the rooster, mascot of the $FRANC community memecoin.',
    'Below are VERIFIED FACTS about today top crypto story (already researched):',
    '---',
    facts,
    '---',
    'Write the final Telegram message summarizing and vulgarizing it IN ENGLISH so anyone understands - clear, simple, no jargon.',
    '',
    'FORMAT - TWO blocks separated by ONE BLANK LINE:',
    '(1) a SHORT, punchy headline sentence (one line);',
    '(2) a blank line, then ONE or TWO sentences that explain it simply.',
    '',
    'HARD RULES:',
    '- 260 CHARACTERS MAXIMUM (a short channel title is prepended automatically, so leave room).',
    '- Do NOT write any title, hook, label or prefix. Begin directly with the headline sentence.',
    '- Base it ONLY on the facts above. NEVER invent details, numbers, names or outcomes.',
    '- Stay 100% factual and NEUTRAL. NO financial advice, no price predictions, never say "moon/pump/buy/sell".',
    '- Do not mention $FRANC unless the facts genuinely do. At most ONE emoji.',
    '- If the facts say NONE or are empty, reply with exactly: NONE',
    '',
    'Output ONLY the final English message (or NONE), nothing else.',
  ].join(NL)
}

async function generateNews(slot: Slot): Promise<{ ok: boolean; text: string; reason: string }> {
  const coveredToday = await fetchTodayTopics(36)   // anti-doublon sur 36h glissantes
  const facts = await groundedSearch(searchPromptNews(coveredToday))
  if (!facts || facts.toUpperCase().indexOf('NONE') === 0) return { ok: false, text: '', reason: 'étape A: pas d actu (facts=' + facts.slice(0, 60) + ')' }
  const msg = await formatCall(formatPromptNews(facts))
  if (!msg) return { ok: false, text: '', reason: 'étape B: mise en forme vide' }
  if (msg.toUpperCase().indexOf('NONE') === 0) return { ok: false, text: '', reason: 'étape B: NONE' }
  return { ok: true, text: SLOT_HOOK[slot] + NL + NL + splitAccroche(msg), reason: '' }
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
    return def.flag + ' ' + def.label + ': ' + fmtPct((price - prev) / prev * 100)
  } catch { return null }
}
async function fetchStockBlock(): Promise<string> {
  const rows = await Promise.all(STOCK_INDICES.map(fetchIndexPct))
  const lines = rows.filter((x): x is string => Boolean(x))
  if (!lines.length) return ''   // toutes les recuperations ont echoue -> on omet le bloc
  return '📊 World stock markets right now:' + NL + lines.join(NL)
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
async function fetchCryptoBlock(): Promise<string> {
  try {
    const ids = CRYPTO_LIST.map((c) => c.id).join(',')
    const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=' + ids + '&price_change_percentage=24h'
    const res = await tfetch(url, {}, 8000)
    if (!res.ok) return ''
    const rows = await res.json()
    if (!Array.isArray(rows) || !rows.length) return ''
    const pctById: Record<string, number> = {}
    for (const r of rows) { if (r && r.id) pctById[String(r.id)] = Number(r.price_change_percentage_24h) }
    // On garde NOTRE ordre (BTC, ETH, BNB, XRP, SOL, GRAM) et on saute
    // proprement toute crypto dont la variation n'a pas ete recuperee.
    const lines = CRYPTO_LIST.map((c) => {
      const p = pctById[c.id]
      if (!isFinite(p)) return ''
      return '• ' + c.sym + ': ' + fmtPct(p)
    }).filter(Boolean)
    if (!lines.length) return ''
    return '🪙 Top 6 crypto (24h):' + NL + lines.join(NL)
  } catch { return '' }
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

async function generateEvening(): Promise<{ ok: boolean; text: string; reason: string; logText?: string }> {
  const [stockBlock, cryptoBlock] = await Promise.all([fetchStockBlock(), fetchCryptoBlock()])
  const facts = await groundedSearch(searchPromptEveningMood())
  let blurb = ''
  if (facts && facts.toUpperCase().indexOf('NONE') !== 0) {
    const b = await formatCall(formatPromptEveningBlurb(facts))
    if (b && b.toUpperCase().indexOf('NONE') !== 0) blurb = b.trim()
  }
  if (!blurb && !stockBlock && !cryptoBlock) return { ok: false, text: '', reason: 'evening: ni laius ni donnees marche' }
  // Ordre voulu : les DONNEES d'abord (cryptos puis bourses), le laius A LA FIN.
  const parts: string[] = [SLOT_HOOK.evening]
  if (cryptoBlock) parts.push('', cryptoBlock)
  if (stockBlock) parts.push('', stockBlock)
  if (blurb) parts.push('', blurb)
  // On ne JOURNALISE que le laius : le recap Crypto Night le reprend tel quel.
  const logText = blurb || 'Markets & crypto mood update this evening.'
  return { ok: true, text: parts.join(NL), reason: '', logText }
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

function formatPromptNight(topics: string[], macroFacts: string, fng: string): string {
  const newsBlock = topics.length ? topics.map((n, i) => (i + 1) + '. ' + n).join(NL) : '(none)'
  const macro = (macroFacts && macroFacts.toUpperCase().indexOf('NONE') !== 0) ? macroFacts : '(none)'
  return [
    'You are Francis the rooster, mascot of the $FRANC community memecoin. Write the end-of-day "Crypto Night" wrap. Audience is INTERNATIONAL.',
    '',
    'A) The crypto stories $FRANC published today, in chronological order:',
    newsBlock,
    '',
    'B) Biggest macro/geopolitical event today (researched):',
    macro,
    '',
    'C) Crypto Fear & Greed Index today: ' + fng,
    '',
    'Write the wrap EXACTLY in this structure, nothing before the first 👉 line:',
    '👉 <one-sentence recap of story 1>',
    '👉 <one-sentence recap of story 2>',
    '👉 <one-sentence recap of story 3>',
    '',
    '🌍 <ONE line naming the single biggest macro/geopolitical event from B, connected to the market. If B is (none), OMIT this entire line.>',
    '',
    '📉 Sentiment: <risk-on or risk-off in a few words> - Fear & Greed: ' + fng,
    '',
    'RULES:',
    '- Write ONE 👉 bullet PER story in A, in the SAME order. Fewer stories = fewer bullets.',
    '- If a story concerns a specific country (especially France), NAME the country explicitly.',
    '- 500 CHARACTERS MAXIMUM total. One tight sentence per line.',
    '- Base everything ONLY on the material above. NEVER invent. NO financial advice, never say "moon/pump/buy/sell".',
    '- Keep the 👉 (and 🌍 if used) and 📉 markers exactly, with a blank line before 📉. Reproduce the Fear & Greed value exactly. No title line.',
    '',
    'Output ONLY the wrap, nothing else.',
  ].join(NL)
}

async function generateNight(): Promise<{ ok: boolean; text: string; reason: string }> {
  const [topics, fng] = await Promise.all([fetchTodayTopics(), fetchFearGreed()])
  const fngValue = fng || 'n/a'
  const macroFacts = await groundedSearch(searchPromptMacro())
  const out = await formatCall(formatPromptNight(topics, macroFacts, fngValue))
  if (out && out.indexOf('👉') >= 0) {
    return { ok: true, text: '🌙 Crypto Night:' + NL + NL + NIGHT_INTRO + NL + out, reason: '' }
  }
  return { ok: false, text: '', reason: 'format inattendu (out=' + out.slice(0, 60) + ')' }
}

// -- Traduction FR (3.1-flash-lite) ----------------------------
async function translateToFrench(text: string): Promise<string> {
  const prompt = [
    'Translate the following Telegram message into natural, fluent FRENCH for a French-speaking community.',
    'RULES:',
    '- Keep ALL emojis exactly where they are, and keep the same line breaks / layout.',
    '- Do NOT translate or alter: "$FRANC", ticker symbols, numbers, %, prices, URLs, coin/person/product names.',
    '- Translate the leading section title too (e.g. "⏰ Crypto Morning:" -> "⏰ Crypto Matin :").',
    '- Natural French, no robotic tone. Output ONLY the translated message, nothing else.',
    '',
    'MESSAGE:',
    text,
  ].join(NL)
  return await formatCall(prompt, 0.3)
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
  try {
    const body = await req.json()
    if (body && (body.kind === 'midday' || body.kind === 'midi')) kind = 'midday'
    else if (body && body.kind === 'evening') kind = 'evening'
    else if (body && body.kind === 'night') kind = 'night'
    else if (body && (body.kind === 'morning' || body.kind === 'gm')) kind = 'morning'
    if (body && body.dryRun === true) dryRun = true
  } catch { /* corps vide -> morning */ }

  const gen = () => (kind === 'night')
    ? generateNight()
    : (kind === 'evening') ? generateEvening() : generateNews(kind as Slot)

  if (dryRun) {
    const r = await gen()
    return new Response(JSON.stringify({ kind, ok: r.ok, reason: r.reason, length: r.text.length, text: r.text }, null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const bg = (async () => {
    try {
      const result = await gen()
      if (!result.ok) { console.error('daily-crypto[' + kind + '] échec:', result.reason); return }
      const imgUrl = imageUrlFor(kind)
      // 1) ANGLAIS (source) -> The Chicken Coop, Crypto Coop (1490)
      await sendWithBanner(botToken, chatId, imgUrl, result.text, CRYPTO_THREAD_EN)
      // Le soir on ne journalise QUE le laius (repris par le recap Night).
      if (kind !== 'night') await logDailyTopic(kind, (result as any).logText || result.text)
      // Recap Crypto Night (20h45) : copie EN + CTA -> owner (pour X).
      if (kind === 'night') await dmOwnerCopy(botToken, result.text, CTA_CRYPTO)
      // 2) TRADUCTION FR -> Le Poulailler, Crypto Cocorico (43)
      const fr = await translateToFrench(result.text)
      if (fr) await sendWithBanner(botToken, FR_CHAT_ID, imgUrl, fr, FR_THREAD_CRYPTO)
      else console.error('daily-crypto[' + kind + ']: traduction FR vide')
      await markSent(KIND_JOB[kind] || ('crypto-' + kind))
      console.log('daily-crypto[' + kind + '] posté:', result.text.slice(0, 80))
    } catch (e) { console.error('daily-crypto[' + kind + '] bg exception:', String(e)) }
  })()
  ;(globalThis as any).EdgeRuntime?.waitUntil?.(bg)
  return new Response('accepted', { status: 202 })
})
