// ════════════════════════════════════════════════════════════════
//  daily-crypto — briefs crypto de Francis le coq (Telegram).
//
//  Brique ISOLÉE issue du découpage de « daily-fact ». Si elle plante,
//  le reste (World, Hot, Q&A du bot, jeux…) continue de tourner.
//
//  SOURCE : Gemini 2.5 Flash + Google Search grounding (l'IA cherche
//  elle-même la meilleure actu du moment — plus de flux RSS à parser).
//  Le grounding Search gratuit n'existe QUE sur gemini-2.5-flash
//  (quota 1 500/j) ; ce modèle est aussi plafonné à 20 requêtes/jour,
//  donc 1 seul appel grounded par rubrique (pas de sur-retry).
//
//  Créneaux (déclenchés par pg_cron, corps {"kind":"..."}):
//    • morning 05:00 UTC   ⏰ Crypto Morning
//    • midday  12:00 UTC   🌞 Crypto Midday
//    • evening 19:00 UTC   🌆 Crypto Evening
//    • night   20:30 UTC   🌙 Crypto Night (récap du jour)
//
//  Diffusion : EN d'abord → « The Chicken Coop » Crypto Coop (1490),
//  puis traduction FR → « Le Poulailler » Crypto Cocorico (43).
//
//  Sécurité : header x-cron-secret == CRON_SECRET.
// ════════════════════════════════════════════════════════════════

const NL = String.fromCharCode(10)

// ── Modèles ───────────────────────────────────────────────────
const GROUND_MODEL = 'gemini-2.5-flash'      // SEUL modèle avec grounding Search gratuit
const TRANSLATE_MODEL = 'gemini-3.1-flash-lite' // traductions FR (haut quota, pas de grounding)
const AI_TIMEOUT_MS = 40000

// ── Telegram : groupes & topics ───────────────────────────────
const FR_CHAT_ID = -1004352289820   // « Le Poulailler » (francophone)
const FR_THREAD_CRYPTO = 43         // topic FR « Crypto Cocorico »
const CRYPTO_THREAD_EN = 1490       // topic EN « Crypto Coop »

// ── Bandeaux (bucket public "assets") ─────────────────────────
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

// ── Réseau ────────────────────────────────────────────────────
async function tfetch(input: string, init: RequestInit = {}, ms = 10000): Promise<Response> {
  return await globalThis.fetch(input, { ...init, signal: AbortSignal.timeout(ms) })
}

// ── Journal anti-doublon (daily_news_log) ─────────────────────
async function fetchTodayTopics(): Promise<string[]> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return []
  try {
    const today = new Date().toISOString().slice(0, 10)
    const res = await tfetch(
      url + '/rest/v1/daily_news_log?day=eq.' + today + '&slot=in.(morning,midday,evening)&select=summary&order=created_at',
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

// ── Gemini AVEC grounding Google Search ───────────────────────
async function groundedCall(prompt: string): Promise<string> {
  const key = Deno.env.get('GEMINI_API_KEY') || ''
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GROUND_MODEL + ':generateContent?key=' + key
  const res = await tfetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.6 },
    }),
  }, AI_TIMEOUT_MS)
  if (!res.ok) throw new Error('grounded HTTP ' + res.status + ' ' + (await res.text()).slice(0, 160))
  const data = await res.json()
  const cand = data && data.candidates ? data.candidates[0] : null
  const parts = cand && cand.content && cand.content.parts ? cand.content.parts : []
  return parts.map((p: any) => (p && p.text) ? p.text : '').join('').trim()
}

// ── Gemini SANS grounding : traduction FR ─────────────────────
async function translateToFrench(text: string): Promise<string> {
  const key = Deno.env.get('GEMINI_API_KEY') || ''
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + TRANSLATE_MODEL + ':generateContent?key=' + key
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
  try {
    const res = await tfetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3 } }),
    }, 25000)
    if (!res.ok) { console.error('translateToFrench HTTP', res.status); return '' }
    const data = await res.json()
    const cand = data && data.candidates ? data.candidates[0] : null
    const parts = cand && cand.content && cand.content.parts ? cand.content.parts : []
    return parts.map((p: any) => (p && p.text) ? p.text : '').join('').trim()
  } catch (e) { console.error('translateToFrench exception:', String(e)); return '' }
}

// ── Indice Fear & Greed (alternative.me) ──────────────────────
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

// ── Prompts d'actu (grounded) — mêmes règles éditoriales + limites ──
function newsPrompt(slot: Slot, coveredToday: string[]): string {
  const dedup = coveredToday.length
    ? NL + 'ALREADY COVERED EARLIER TODAY (do NOT pick the same story or topic again; choose a genuinely DIFFERENT high-impact one):' + NL + coveredToday.map((s) => '- ' + s).join(NL) + NL
    : ''
  return [
    'You are Francis the rooster, mascot of the $FRANC community memecoin.',
    'Use Google Search to find the crypto news of the LAST 24 HOURS. Rely only on reputable crypto/finance outlets.',
    '',
    'YOUR TASK:',
    '1. SELECT the SINGLE news with the STRONGEST IMPACT for crypto investors and the broader crypto ecosystem (major market moves, big regulation, ETFs, major hacks/security, big adoption or institutional moves, key macro affecting crypto). Judge PURELY by IMPORTANCE and IMPACT. Cover EXACTLY ONE story - never mention, tease, or append a second one.',
    dedup + '2. Summarize and vulgarize it IN ENGLISH so anyone can understand it - clear, simple, no jargon.',
    '3. Keep it to 260 CHARACTERS MAXIMUM (hard limit - a short channel title is prepended automatically, so leave room).',
    '',
    'FORMAT - write your answer in TWO blocks separated by ONE BLANK LINE:',
    '(1) a SHORT, punchy headline sentence (one line);',
    '(2) a blank line, then ONE or TWO sentences that explain it simply.',
    '',
    'STYLE:',
    '- Do NOT write any title, hook, label or prefix. Begin DIRECTLY with the headline sentence - the channel title is added automatically.',
    '- Plain, clear English. Friendly and light, with a tiny rooster touch if it fits - but the NEWS and clarity come first.',
    '- At most ONE emoji in the whole text.',
    '',
    'STRICT RULES:',
    '- Base your summary ONLY on what you actually found via search. NEVER invent details, numbers, names, or outcomes.',
    '- Stay 100% factual and NEUTRAL. Any political/geopolitical/conflict topic: report plainly, take NO side, focus on the crypto/market angle.',
    '- NO financial advice, no price predictions, never say "moon/pump/buy/sell".',
    '- Do not mention $FRANC unless the news genuinely does.',
    '- If you truly cannot find any real crypto news, reply with exactly: NONE',
    '',
    'Output ONLY the final English message (or NONE), nothing else.',
  ].join(NL)
}

// Sépare l'accroche de l'explication par une ligne vide, sans regex.
function splitAccroche(s: string): string {
  const t = s.trim()
  if (t.indexOf(NL + NL) >= 0 || t.indexOf(NL) >= 0) return t
  const dot = t.indexOf('. ')
  if (dot > 0 && dot < t.length - 2) return t.slice(0, dot + 1) + NL + NL + t.slice(dot + 2)
  return t
}

async function generateNews(slot: Slot): Promise<{ ok: boolean; text: string; reason: string }> {
  const coveredToday = await fetchTodayTopics()
  try {
    const raw = await groundedCall(newsPrompt(slot, coveredToday))
    if (!raw) return { ok: false, text: '', reason: 'réponse vide' }
    if (raw.toUpperCase() === 'NONE') return { ok: false, text: '', reason: 'aucune actu pertinente (NONE)' }
    return { ok: true, text: SLOT_HOOK[slot] + NL + NL + splitAccroche(raw), reason: '' }
  } catch (e) {
    return { ok: false, text: '', reason: String(e) }
  }
}

// ── Crypto Night : récap du jour (grounded pour la macro) ─────
const NIGHT_INTRO = "The day's essential crypto, wrapped up 👇"
async function generateNight(): Promise<{ ok: boolean; text: string; reason: string }> {
  const [news, fng] = await Promise.all([fetchTodayTopics(), fetchFearGreed()])
  const newsBlock = news.length ? news.map((n, i) => (i + 1) + '. ' + n).join(NL) : '(none)'
  const fngValue = fng || 'n/a'
  const prompt = [
    'You are Francis the rooster, mascot of the $FRANC community memecoin. Write the end-of-day "Crypto Night" wrap. Audience is INTERNATIONAL.',
    '',
    'A) The crypto stories $FRANC published today, in chronological order:',
    newsBlock,
    '',
    'B) Use Google Search to find the SINGLE biggest market-moving MACRO/GEOPOLITICAL event of the last 24h (the Fed, rates, inflation, the dollar, major geopolitics) that best explains today crypto action.',
    '',
    'C) Crypto Fear & Greed Index today: ' + fngValue,
    '',
    'Write the wrap EXACTLY in this structure, nothing before the first 👉 line:',
    '👉 <one-sentence recap of story 1>',
    '👉 <one-sentence recap of story 2>',
    '👉 <one-sentence recap of story 3>',
    '',
    '🌍 <ONE line naming the single biggest macro/geopolitical event from B, connected to the market. If there is genuinely none, OMIT this entire line.>',
    '',
    '📉 Sentiment: <risk-on or risk-off in a few words> - Fear & Greed: ' + fngValue,
    '',
    'RULES:',
    '- Write ONE 👉 bullet PER story in A, in the SAME order. Fewer stories = fewer bullets.',
    '- INTERNATIONAL AUDIENCE: if a story concerns a specific country (especially France), NAME the country explicitly.',
    '- 500 CHARACTERS MAXIMUM total. Keep every line to a single tight sentence.',
    '- Base A only on the material given; base B/🌍 only on what you actually find via search. NEVER invent.',
    '- Neutral and factual. NO financial advice, never say "moon/pump/buy/sell".',
    '- Keep the 👉 (and 🌍 if used) and 📉 markers exactly, with a blank line before 📉. Reproduce the Fear & Greed value exactly. No title line.',
    '',
    'Output ONLY the wrap, nothing else.',
  ].join(NL)
  try {
    const out = await groundedCall(prompt)
    if (out && out.indexOf('👉') >= 0) {
      return { ok: true, text: '🌙 Crypto Night:' + NL + NL + NIGHT_INTRO + NL + out, reason: '' }
    }
    return { ok: false, text: '', reason: 'format inattendu' }
  } catch (e) {
    return { ok: false, text: '', reason: String(e) }
  }
}

// ── Telegram ──────────────────────────────────────────────────
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

// ── Point d'entrée ────────────────────────────────────────────
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

  const gen = () => (kind === 'night') ? generateNight() : generateNews(kind as Slot)

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
      if (kind !== 'night') await logDailyTopic(kind, result.text)
      // 2) TRADUCTION FR -> Le Poulailler, Crypto Cocorico (43)
      const fr = await translateToFrench(result.text)
      if (fr) await sendWithBanner(botToken, FR_CHAT_ID, imgUrl, fr, FR_THREAD_CRYPTO)
      else console.error('daily-crypto[' + kind + ']: traduction FR vide')
      console.log('daily-crypto[' + kind + '] posté:', result.text.slice(0, 80))
    } catch (e) { console.error('daily-crypto[' + kind + '] bg exception:', String(e)) }
  })()
  ;(globalThis as any).EdgeRuntime?.waitUntil?.(bg)
  return new Response('accepted', { status: 202 })
})
