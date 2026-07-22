// ================================================================
//  daily-hot - rubrique "Hot" (actu industrie du divertissement adulte)
//  de Francis le coq. Brique ISOLEE du decoupage daily-fact.
//
//  SOURCES : flux RSS (PAS de grounding : sujet non couvert par Google
//  Search grounding), selon le creneau :
//    * matin (hot-morning) + soir (hot-evening) -> XBIZ (frais, plusieurs/j)
//    * midi  (hot-midday)                       -> adultfyi.com (variete)
//  Les flux sont TRIES par date (adultfyi n'est pas chronologique : post
//  epingle en tete). Image : XBIZ <image>, adultfyi <media:thumbnail>/
//  <enclosure> (repli texte si sendPhoto refuse le format).
//  Selection + redaction par gemini-3.1-flash-lite. Parsing SANS regex.
//
//  3 creneaux/jour (pg_cron, corps {"slot":"hot-morning|hot-midday|hot-evening"}).
//  Anti-doublon GLISSANT sur 72h, TOUTES sources confondues (filtre
//  deterministe sur le TITRE source, pas le message reformule),
//  AVEC la photo de l'article. Ton taquin mais SOBRE (rien d'explicite).
//
//  Diffusion : EN d'abord -> "The Chicken Coop" Hot (1488),
//  puis traduction FR -> "Le Poulailler" Hot (33). Limite 240 caracteres.
//
//  Securite : header x-cron-secret == CRON_SECRET.
// ================================================================

const NL = String.fromCharCode(10)
const TAB = String.fromCharCode(9)
const FORMAT_MODEL = 'gemini-3.1-flash-lite'

const FR_CHAT_ID = -1004352289820
const FR_THREAD_HOT = 33
const HOT_THREAD_EN = 1488
const GR_CHAT_ID = -1003962771717   // Golden Rooster (groupe spicy privé)
const GR_THREAD_HOT = 41
const HOT_HOOK_EN = '🌶️ Hot News:'
const HOT_HOOK_FR = '🌶️ Actu Hot :'
// Bouton "🌐 FR / EN" : traduction bascule gérée par bot-handler (callback 'trhot').
const TR_BUTTON = { inline_keyboard: [[{ text: '🌐 FR / EN', callback_data: 'trhot' }]] }

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
async function formatCall(prompt: string, temperature = 0.6): Promise<string> {
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

// -- Parsing XML/HTML SANS regex -------------------------------
function between(s: string, open: string, close: string): string {
  const i = s.indexOf(open)
  if (i < 0) return ''
  const j = s.indexOf(close, i + open.length)
  if (j < 0) return ''
  return s.slice(i + open.length, j)
}
function decodeEntities(s: string): string {
  let out = s.split('<![CDATA[').join('').split(']]>').join('')
  // entites nommees courantes
  out = out.split('&apos;').join("'").split('&#39;').join("'")
    .split('&quot;').join('"').split('&laquo;').join('"').split('&raquo;').join('"')
    .split('&nbsp;').join(' ').split('&amp;').join('&')
  // entites numeriques &#NNN; et &#xHHH; (scan manuel)
  let res = ''
  let k = 0
  while (k < out.length) {
    if (out[k] === '&' && out[k + 1] === '#') {
      const semi = out.indexOf(';', k)
      if (semi > 0 && semi - k <= 9) {
        const body = out.slice(k + 2, semi)
        const isHex = body[0] === 'x' || body[0] === 'X'
        const num = isHex ? parseInt(body.slice(1), 16) : parseInt(body, 10)
        if (isFinite(num) && num > 0) { res += String.fromCodePoint(num); k = semi + 1; continue }
      }
    }
    res += out[k]; k++
  }
  return res
}
function stripTags(s: string): string {
  let out = ''
  let depth = 0
  for (const ch of s) {
    if (ch === '<') depth++
    else if (ch === '>') { if (depth > 0) depth-- }
    else if (depth === 0) out += ch
  }
  return out
}
function collapseWs(s: string): string {
  let out = s.split(NL).join(' ').split(TAB).join(' ').split(String.fromCharCode(13)).join(' ')
  while (out.indexOf('  ') >= 0) out = out.split('  ').join(' ')
  return out.trim()
}
function clean(s: string): string {
  return collapseWs(decodeEntities(stripTags(decodeEntities(s))))
}

// -- Sources Hot : XBIZ (frais, plusieurs/jour) + adultfyi (variete midi) ----
// Image : XBIZ a une balise <image> propre ; adultfyi expose l'image via
// <media:thumbnail url="..."> (ou <enclosure url="...">).
function attrUrl(s: string, tag: string): string {
  const i = s.indexOf('<' + tag)
  if (i < 0) return ''
  const gt = s.indexOf('>', i)
  const seg = s.slice(i, gt < 0 ? i + 300 : gt)
  const ai = seg.indexOf('url="')
  if (ai < 0) return ''
  const st = ai + 5
  const en = seg.indexOf('"', st)
  return en < 0 ? '' : seg.slice(st, en)
}
interface HotSource { name: string; feed: string; windowH: number; imageOf: (it: string) => string }
const SOURCES: Record<'xbiz' | 'adultfyi', HotSource> = {
  xbiz: {
    name: 'XBIZ',
    feed: 'https://www.xbiz.com/rss/news/movies-stars.xml',
    windowH: 24,     // 24h : actu plus riche (l'anti-doublon 72h evite les repets)
    imageOf: (it) => clean(between(it, '<image>', '</image>')),
  },
  adultfyi: {
    name: 'adultfyi',
    feed: 'https://adultfyi.com/feed/',
    windowH: 96,     // cadence plus lente (~jours) -> fenetre elargie
    imageOf: (it) => attrUrl(it, 'media:thumbnail') || attrUrl(it, 'enclosure'),
  },
}

// -- Recuperation des items d'une source -----------------------
interface HotItem { title: string; descr: string; image: string }
async function fetchHotItems(src: HotSource): Promise<{ items: HotItem[]; reason: string }> {
  try {
    const res = await tfetch(src.feed, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      },
    })
    if (!res.ok) return { items: [], reason: src.name + ' RSS HTTP ' + res.status }
    const xml = await res.text()
    const rawItems = xml.split('<item>').slice(1).map((s) => s.split('</item>')[0])
    if (rawItems.length === 0) return { items: [], reason: 'aucun item dans le flux' }
    // On PARSE tout puis on TRIE par date decroissante : certains flux
    // (adultfyi) ne sont PAS chronologiques (post epingle en tete).
    const parsed = rawItems.map((it) => {
      const title = clean(between(it, '<title>', '</title>'))
      const descr = clean(between(it, '<description>', '</description>')).slice(0, 300)
      const image = src.imageOf(it)
      const pubStr = between(it, '<pubDate>', '</pubDate>').trim()
      const t = pubStr ? new Date(pubStr).getTime() : NaN
      return { title, descr, image, t: isFinite(t) ? t : 0 }
    }).filter((p) => p.title)
    parsed.sort((a, b) => b.t - a.t)   // plus recent d'abord
    const now = Date.now()
    const WINDOW = src.windowH * 3600 * 1000
    const strip = (p: { title: string; descr: string; image: string }): HotItem => ({ title: p.title, descr: p.descr, image: p.image })
    const recent = parsed.filter((p) => p.t > 0 && (now - p.t) <= WINDOW && (now - p.t) >= -3600 * 1000).slice(0, 15).map(strip)
    if (recent.length > 0) return { items: recent, reason: '' }
    const fallback = parsed.slice(0, 12).map(strip)   // les 12 plus recents (deja tries par date)
    if (fallback.length > 0) return { items: fallback, reason: '' }
    return { items: [], reason: 'aucun titre exploitable' }
  } catch (e) { return { items: [], reason: 'exception RSS: ' + String(e) } }
}

// -- Anti-doublon (slot hot) : fenetre GLISSANTE 72h, sur le TITRE source ----
async function fetchRecentHot(hours = 72): Promise<string[]> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return []
  try {
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString()
    const res = await tfetch(url + '/rest/v1/daily_news_log?created_at=gte.' + encodeURIComponent(since) + '&slot=eq.hot&select=summary&order=created_at',
      { headers: { apikey: key, Authorization: 'Bearer ' + key } })
    if (!res.ok) return []
    const rows = await res.json()
    return (Array.isArray(rows) ? rows : []).map((r: any) => String((r && r.summary) || '')).filter(Boolean)
  } catch { return [] }
}
// On journalise le TITRE de l'article XBIZ retenu (pas le message reformule) :
// c'est ce titre qui sert de cle d'unicite sur 72h.
async function logDailyTopic(summary: string): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return
  try {
    const today = new Date().toISOString().slice(0, 10)
    await tfetch(url + '/rest/v1/daily_news_log', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ day: today, slot: 'hot', summary }),
    })
  } catch { /* best-effort */ }
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

function splitAccroche(s: string): string {
  const t = s.trim()
  if (t.indexOf(NL) >= 0) return t
  const dot = t.indexOf('. ')
  if (dot > 0 && dot < t.length - 2) return t.slice(0, dot + 1) + NL + NL + t.slice(dot + 2)
  return t
}

// -- Generation (selection + redaction EN) ---------------------
async function generateHot(src: HotSource): Promise<{ ok: boolean; text: string; image: string; title: string; reason: string }> {
  const { items: allItems, reason } = await fetchHotItems(src)
  if (allItems.length === 0) return { ok: false, text: '', image: '', title: '', reason: '[' + src.name + '] ' + reason }
  const covered = await fetchRecentHot(72)   // anti-doublon 72h glissantes
  // Filtre DETERMINISTE : on retire les articles dont le titre a deja ete
  // publie sur 72h (comparaison insensible a la casse/espaces). Garde-fou
  // solide, sans dependre du jugement de l'IA. Si tout est deja couvert
  // (rare), on retombe sur la liste complete pour ne pas rester muet.
  const norm = (s: string) => collapseWs(s).toLowerCase()
  const coveredSet = new Set(covered.map(norm))
  const fresh = allItems.filter((it) => !coveredSet.has(norm(it.title)))
  const items = fresh.length ? fresh : allItems
  const dedup = covered.length
    ? NL + "ALREADY COVERED in the last 72h (below). Pick a genuinely DIFFERENT story: a DIFFERENT performer/studio/subject, NOT the same news from another angle or a follow-up on these." + NL + covered.map((s) => '- ' + s).join(NL) + NL
    : ''
  const list = items.map((it, i) => (i + 1) + '. ' + it.title + (it.descr ? ' - ' + it.descr : '')).join(NL)
  const prompt = [
    'You are Francis the rooster, a cheeky but classy anchor for the ADULT-ENTERTAINMENT-industry "Hot" corner of a Telegram community. Below are the freshest trade-news items from ' + src.name + ' (adult-industry trade press).',
    '',
    'YOUR TASK:',
    '1. Pick the SINGLE most interesting / "hottest" story for an adult-entertainment audience (new releases, performer news, launches, awards, notable industry moves).',
    dedup + '2. Summarize it IN ENGLISH: playful and flirty in tone, but keep it TASTEFUL and news-like - NO explicit sexual content, no crude words, appropriate for a public channel.',
    '3. HARD LIMIT: 240 CHARACTERS MAXIMUM for the message (a short title is prepended automatically, so leave room).',
    '',
    'OUTPUT FORMAT (STRICT):',
    '- LINE 1: ONLY the number of the item you picked (e.g. "3"). Nothing else on that line.',
    '- Then a blank line.',
    '- Then the message in TWO blocks: a short punchy headline sentence, a blank line, then ONE sentence that explains it.',
    '',
    'RULES:',
    '- Base it ONLY on the item you picked. NEVER invent facts, names or outcomes.',
    '- Tasteful, flirty-but-clean, at most ONE emoji. Do NOT write any title/label/prefix on the message itself.',
    '- If nothing usable, reply with exactly: NONE',
    '',
    'ITEMS:',
    list,
  ].join(NL)
  const raw = await formatCall(prompt, 0.7)
  if (!raw || raw.toUpperCase().indexOf('NONE') === 0) return { ok: false, text: '', image: '', reason: 'aucune actu (NONE)' }
  const nl = raw.indexOf(NL)
  const firstLine = (nl >= 0 ? raw.slice(0, nl) : raw).trim()
  let idx = parseInt(firstLine, 10) - 1
  let bodyRaw = nl >= 0 ? raw.slice(nl + 1).trim() : ''
  if (!(idx >= 0 && idx < items.length)) { idx = 0; if (!bodyRaw) bodyRaw = raw }
  if (!bodyRaw) return { ok: false, text: '', image: '', title: '', reason: 'corps vide' }
  return { ok: true, text: HOT_HOOK_EN + NL + NL + splitAccroche(bodyRaw), image: items[idx].image || '', title: items[idx].title, reason: '' }
}

async function translateToFrench(text: string): Promise<string> {
  const prompt = [
    'Translate the following Telegram message into natural, fluent FRENCH for a French-speaking community.',
    'RULES:',
    '- Keep ALL emojis exactly where they are, and keep the same line breaks / layout.',
    '- Keep it tasteful and news-like. Do NOT translate or alter proper names, URLs, numbers.',
    '- Natural French. Output ONLY the translated message, nothing else.',
    '',
    'MESSAGE:',
    text,
  ].join(NL)
  return await formatCall(prompt, 0.3)
}

// -- Telegram --------------------------------------------------
async function postToGroup(token: string, chatId: number, text: string, threadId = 0, replyMarkup: any = null): Promise<void> {
  const body: any = { chat_id: chatId, text, disable_web_page_preview: true }
  if (threadId) body.message_thread_id = threadId
  if (replyMarkup) body.reply_markup = replyMarkup
  const res = await tfetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) console.error('postToGroup HTTP', res.status, (await res.text()).slice(0, 160))
}
async function postPhotoToGroup(token: string, chatId: number, photoUrl: string, caption: string, threadId = 0, replyMarkup: any = null): Promise<boolean> {
  try {
    const body: any = { chat_id: chatId, photo: photoUrl, caption }
    if (threadId) body.message_thread_id = threadId
    if (replyMarkup) body.reply_markup = replyMarkup
    const res = await tfetch('https://api.telegram.org/bot' + token + '/sendPhoto', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!data || !data.ok) { console.error('postPhotoToGroup:', JSON.stringify(data).slice(0, 160)); return false }
    return true
  } catch (e) { console.error('postPhotoToGroup exception:', String(e)); return false }
}

// -- Point d'entree --------------------------------------------
Deno.serve(async (req: Request) => {
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('forbidden', { status: 403 })
  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  const botToken = Deno.env.get('BOT_TOKEN')
  const chatId = Number(Deno.env.get('FACT_CHAT_ID') ?? '-1003842240104')
  if (!geminiKey || !botToken) return new Response('missing config', { status: 500 })

  let dryRun = false
  let slot = 'hot-evening'   // le cron passe {"slot":"hot-morning|hot-midday|hot-evening"}
  try { const body = await req.json(); if (body && body.dryRun === true) dryRun = true; if (body && typeof body.slot === 'string') slot = body.slot } catch { /* ok */ }

  // Source selon le creneau : midi -> adultfyi (variete), matin/soir -> XBIZ.
  const src = (slot === 'hot-midday') ? SOURCES.adultfyi : SOURCES.xbiz

  if (dryRun) {
    const r = await generateHot(src)
    return new Response(JSON.stringify({ slot, source: src.name, ok: r.ok, reason: r.reason, image: r.image, length: r.text.length, text: r.text }, null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const bg = (async () => {
    try {
      const result = await generateHot(src)
      if (!result.ok) { console.error('daily-hot echec:', result.reason); return }
      const img = result.image
      // 1) ANGLAIS (source) -> Coop Hot (1488) ET Golden Rooster (41).
      //    Le bouton "🌐 FR / EN" n'est ajouté QUE dans le groupe privé
      //    (Golden Rooster) : la Coop est déjà en anglais, le bouton n'y sert pas.
      const sendEN = async (cid: number, tid: number, rm: any = null) => {
        if (img) { const ok = await postPhotoToGroup(botToken, cid, img, result.text, tid, rm); if (!ok) await postToGroup(botToken, cid, result.text, tid, rm) }
        else await postToGroup(botToken, cid, result.text, tid, rm)
      }
      await sendEN(chatId, HOT_THREAD_EN)                    // Coop : sans bouton
      await sendEN(GR_CHAT_ID, GR_THREAD_HOT, TR_BUTTON)     // Golden Rooster : avec bouton
      await logDailyTopic(result.title || result.text)   // titre source = cle d'unicite 72h
      // 2) TRADUCTION FR -> Poulailler Hot (33), SANS bouton (déjà en français)
      const frBody = result.text.split(NL + NL).slice(1).join(NL + NL)
      const fr = await translateToFrench(frBody)
      if (fr) {
        const frText = HOT_HOOK_FR + NL + NL + fr
        if (img) { const okFr = await postPhotoToGroup(botToken, FR_CHAT_ID, img, frText, FR_THREAD_HOT); if (!okFr) await postToGroup(botToken, FR_CHAT_ID, frText, FR_THREAD_HOT) }
        else await postToGroup(botToken, FR_CHAT_ID, frText, FR_THREAD_HOT)
      } else console.error('daily-hot: traduction FR vide')
      await markSent(slot)
      console.log('daily-hot poste:', result.text.slice(0, 80))
    } catch (e) { console.error('daily-hot bg exception:', String(e)) }
  })()
  ;(globalThis as any).EdgeRuntime?.waitUntil?.(bg)
  return new Response('accepted', { status: 202 })
})
