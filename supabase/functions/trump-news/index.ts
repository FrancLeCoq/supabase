// ================================================================
//  trump-news — recopie les posts ORIGINAUX de Donald Trump
//  (Truth Social) dans Telegram, via l'archiveur public trumpstruth.org.
//
//  SOURCE : https://trumpstruth.org/feed (RSS, texte + IDs). Les MÉDIAS
//  ne sont pas dans le flux : on lit la page du post pour récupérer les
//  fichiers ré-hébergés sur truth-archive…linodeobjects.com (joignables
//  depuis Supabase ET Telegram, pas de Cloudflare).
//
//  RÈGLES :
//   • posts ORIGINAUX uniquement (on saute les reposts "RT").
//   • anti-flood : seuls les posts des WINDOW_MIN dernières minutes.
//   • anti-doublon : verrou DB par ID de post (claim_reply_slot).
//   • EN (texte+média) -> The Chicken Coop (topic 2115)
//
//  Polling : pg_cron toutes les ~3 min (Truth Social/trumpstruth ne
//  poussent pas de webhook -> on interroge).
//
//  Sécurité : header x-cron-secret == CRON_SECRET.
// ================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

const NL = String.fromCharCode(10)
// Traduction : Gemini 3.5 Flash-Lite, repli 3.1 Flash-Lite si quota.
const FORMAT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
const FEED = 'https://trumpstruth.org/feed'
const COOP_CHAT = -1003842240104, COOP_THREAD = 2115   // The Chicken Coop (EN)
const POUL_CHAT = -1004352289820, POUL_THREAD = 519    // Le Poulailler (FR)
const WINDOW_MIN = 20                                  // cron 15 min + 5 min de marge (le verrou évite les doublons)
const DEDUP_TTL = 7 * 24 * 3600                        // verrou anti-doublon (7 j)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

async function tfetch(url: string, init: RequestInit = {}, ms = 15000): Promise<Response> {
  return await globalThis.fetch(url, { ...init, signal: AbortSignal.timeout(ms) })
}

// -- Parsing XML/HTML SANS regex (repris de daily-hot) ---------
function between(s: string, open: string, close: string): string {
  const i = s.indexOf(open); if (i < 0) return ''
  const j = s.indexOf(close, i + open.length); if (j < 0) return ''
  return s.slice(i + open.length, j)
}
function decodeEntities(s: string): string {
  let out = s.split('<![CDATA[').join('').split(']]>').join('')
  out = out.split('&apos;').join("'").split('&#39;').join("'")
    .split('&quot;').join('"').split('&nbsp;').join(' ').split('&amp;').join('&')
  let res = ''; let k = 0
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
  // Conserve les sauts de ligne : </p> et <br> -> retour à la ligne.
  let t = s.split('</p>').join('\n').split('<br/>').join('\n').split('<br>').join('\n').split('<br />').join('\n')
  let out = ''; let depth = 0
  for (const ch of t) {
    if (ch === '<') depth++
    else if (ch === '>') { if (depth > 0) depth-- }
    else if (depth === 0) out += ch
  }
  return out
}
function cleanText(s: string): string {
  let t = decodeEntities(stripTags(decodeEntities(s)))
  // compacte les lignes vides multiples, trim
  t = t.split('\r').join('')
  while (t.indexOf('\n\n\n') >= 0) t = t.split('\n\n\n').join('\n\n')
  return t.trim()
}

// -- Anti-doublon partagé (réutilise claim_reply_slot) ---------
async function claimSlot(sb: any, key: string, ttl: number): Promise<boolean> {
  try {
    const { data, error } = await sb.rpc('claim_reply_slot', { p_chat_key: key, p_window_seconds: ttl })
    if (error) { console.error('claim_reply_slot:', error.message); return true }
    return data === true
  } catch (e) { console.error('claim_reply_slot ex:', String(e)); return true }
}

// -- Médias : lus sur la page du post -------------------------
async function fetchMedia(statusUrl: string): Promise<string[]> {
  try {
    const res = await tfetch(statusUrl, { headers: { 'User-Agent': UA } })
    if (!res.ok) return []
    const html = await res.text()
    const collect = (re: RegExp): string[] => {
      const found = html.match(re) || []
      const seen = new Set<string>(); const out: string[] = []
      for (const u of found) { if (!seen.has(u)) { seen.add(u); out.push(u) } }
      return out
    }
    // 1) motif historique (truth-archive .../attachments/...)
    let out = collect(/https:\/\/truth-archive[^"'\s)]+\/attachments\/[^"'\s)]+\.(?:png|jpe?g|mp4|gif|webp)/gi)
    // 2) repli : autres hôtes média Truth Social (linodeobjects / CDN), en
    //    excluant les avatars et en-têtes de profil (pas des médias du post).
    if (out.length === 0) {
      out = collect(/https:\/\/[^"'\s)]*(?:linodeobjects\.com|static-assets-\d+\.truthsocial\.com|media\.truthsocial\.com)[^"'\s)]*\.(?:png|jpe?g|mp4|gif|webp)(?:\?[^"'\s)]*)?/gi)
        .filter((u) => !/\/(avatars|headers|site_uploads)\//i.test(u))
    }
    return out.slice(0, 10)   // Telegram : 10 médias max par album
  } catch { return [] }
}

// -- Traduction FR (gemini) -----------------------------------
async function translateFR(text: string): Promise<string> {
  const key = Deno.env.get('GEMINI_API_KEY') || ''
  if (!key || !text) return ''
  const prompt = [
    'Translate this Truth Social post by Donald Trump into natural, faithful FRENCH.',
    'Keep the same line breaks. Do NOT add any commentary, header or quotes. Keep proper names, @handles, URLs and numbers as-is.',
    'Output ONLY the French translation.',
    '', text,
  ].join(NL)
  for (const model of FORMAT_MODELS) {
    try {
      const res = await tfetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + key, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 2048 } }),
      }, 25000)
      if (res.status === 429 || !res.ok) continue
      const data = await res.json()
      const parts = data?.candidates?.[0]?.content?.parts ?? []
      const out = parts.map((p: any) => (p && p.text) ? p.text : '').join('').trim()
      if (out) return out
    } catch { /* modèle suivant */ }
  }
  return ''
}

// -- Telegram --------------------------------------------------
// En-tête daté, dans la langue du groupe (heure de Paris). Le Coop (EN) reçoit
// un format anglais/US (The Chicken Coop).
function headerEN(t: number): string {
  const d = new Date(t)
  const date = d.toLocaleDateString('en-US', { timeZone: 'Europe/Paris' })
  const time = d.toLocaleTimeString('en-US', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })
  return `🇺🇸 <b>Original post by Donald J. Trump on Truth Social</b> — ${date} at ${time} 👇`
}
function headerFR(t: number): string {
  const d = new Date(t)
  const date = d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })
  const time = d.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })
  return `🇺🇸 <b>Post original de Donald J. Trump sur Truth Social</b> le ${date} à ${time} 👇`
}
function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

async function tgCall(method: string, body: any): Promise<boolean> {
  const token = Deno.env.get('BOT_TOKEN')
  try {
    const res = await tfetch('https://api.telegram.org/bot' + token + '/' + method, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!data || !data.ok) { console.error(method, JSON.stringify(data).slice(0, 200)); return false }
    return true
  } catch (e) { console.error(method, 'ex', String(e)); return false }
}
const isVideo = (u: string) => /\.(mp4|gif)(\?|$)/i.test(u)
// Réessaie une fois : au 1er envoi Telegram récupère le média « à froid » et
// peut échouer (timeout CDN) ; au 2e il est en cache -> ça passe.
async function tgSend(method: string, body: any): Promise<boolean> {
  if (await tgCall(method, body)) return true
  await new Promise((r) => setTimeout(r, 1800))
  return await tgCall(method, body)
}

// Bouton de traduction FR pré-enregistré (bascule instantanée via nlang).
const NLANG_BTN = { inline_keyboard: [[{ text: 'Translate in French 🇫🇷', callback_data: 'nlang:fr' }]] }
// Envoie et renvoie le message_id (0 si échec), pour attacher le toggle i18n.
async function tgGet(method: string, body: any): Promise<number> {
  const token = Deno.env.get('BOT_TOKEN')
  try {
    const res = await tfetch('https://api.telegram.org/bot' + token + '/' + method, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!data || !data.ok) { console.error(method, JSON.stringify(data).slice(0, 200)); return 0 }
    return Number(data.result && data.result.message_id) || 0
  } catch (e) { console.error(method, 'ex', String(e)); return 0 }
}
async function tgGetRetry(method: string, body: any): Promise<number> {
  const id = await tgGet(method, body); if (id) return id
  await new Promise((r) => setTimeout(r, 1800))
  return await tgGet(method, body)
}
// Mémorise EN + FR pour la bascule 🇬🇧/🇫🇷 (nlang lit {en, fr, html}).
async function storeI18n(sb: any, chat: number, msgId: number, en: string, fr: string): Promise<void> {
  if (!msgId) return
  try { await sb.from('news_i18n').upsert({ chat_id: chat, message_id: msgId, en, fr, html: true }) } catch (e) { console.error('storeI18n', String(e)) }
}

// Poste 1 tweet Trump : header + texte + média(s), avec bouton « Translate in
// French 🇫🇷 ». `link` = filet si un post n'a NI texte NI média (en-tête + lien
// source, jamais de « 👇 » orphelin).
async function postPost(sb: any, chat: number, thread: number, headerEn: string, headerFr: string, text: string, media: string[], link = ''): Promise<boolean> {
  const tail = (h: string) => text ? (h + '\n\n' + esc(text)) : (media.length === 0 && link ? (h + '\n\n👉 ' + esc(link)) : h)
  const enText = tail(headerEn)
  let frBody = ''
  if (text) { const t = await translateFR(text); frBody = t || text }   // repli : texte original
  const frText = frBody ? (headerFr + '\n\n' + esc(frBody)) : (media.length === 0 && link ? (headerFr + '\n\n👉 ' + esc(link)) : headerFr)
  const enCap = enText.slice(0, 1024)
  const capTooLong = enText.length > 1024

  // Message texte seul (bouton + i18n dessus).
  const postTextMsg = async (preview: boolean): Promise<number> => {
    const id = await tgGet('sendMessage', { chat_id: chat, message_thread_id: thread, text: enText, parse_mode: 'HTML', disable_web_page_preview: !preview, reply_markup: NLANG_BTN })
    await storeI18n(sb, chat, id, enText, frText)
    return id
  }

  if (media.length === 0) return !!(await postTextMsg(true))

  // 1 seul média, légende qui tient : bouton sur la légende (toggle = caption).
  if (media.length === 1 && !capTooLong) {
    const m = media[0]; const method = isVideo(m) ? 'sendVideo' : 'sendPhoto'; const key = isVideo(m) ? 'video' : 'photo'
    const id = await tgGetRetry(method, { chat_id: chat, message_thread_id: thread, [key]: m, caption: enCap, parse_mode: 'HTML', reply_markup: NLANG_BTN })
    if (id) { await storeI18n(sb, chat, id, enText, frText); return true }
    return !!(await postTextMsg(false))   // média KO -> repli texte + bouton
  }

  // Album OU texte trop long : bouton sur un message TEXTE, médias sans légende.
  const tid = await postTextMsg(false)
  if (media.length === 1) {
    const m = media[0]; const method = isVideo(m) ? 'sendVideo' : 'sendPhoto'; const key = isVideo(m) ? 'video' : 'photo'
    await tgSend(method, { chat_id: chat, message_thread_id: thread, [key]: m })
  } else {
    await tgSend('sendMediaGroup', { chat_id: chat, message_thread_id: thread, media: media.map((m) => ({ type: isVideo(m) ? 'video' : 'photo', media: m })) })
  }
  return !!tid
}

// Récupère le post original le PLUS RÉCENT (sans filtre de fenêtre) — pour testOne.
async function latestOriginal(): Promise<TPost | null> {
  const res = await tfetch(FEED, { headers: { 'User-Agent': UA } })
  if (!res.ok) return null
  const xml = await res.text()
  const raw = xml.split('<item>').slice(1).map((s) => s.split('</item>')[0])
  const isRepost = (d: string) => /RT:\s*https?:\/\//i.test(d) || d.indexOf('quote-inline') >= 0
  let best: TPost | null = null
  for (const it of raw) {
    const link = between(it, '<link>', '</link>').trim()
    const descr = between(it, '<description>', '</description>')
    const oid = between(it, '<truth:originalId>', '</truth:originalId>').trim()
    const pub = between(it, '<pubDate>', '</pubDate>').trim()
    if (!oid || !link || isRepost(descr)) continue
    const t = pub ? new Date(pub).getTime() : 0
    if (!best || t > best.t) best = { link, oid, text: cleanText(descr), t }
  }
  return best
}

interface TPost { link: string; oid: string; text: string; t: number }

async function collectFresh(windowMin = WINDOW_MIN): Promise<{ posts: TPost[]; reason: string }> {
  const res = await tfetch(FEED, { headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/xml, text/xml' } })
  if (!res.ok) return { posts: [], reason: 'feed HTTP ' + res.status }
  const xml = await res.text()
  const raw = xml.split('<item>').slice(1).map((s) => s.split('</item>')[0])
  const now = Date.now()
  const WINDOW = windowMin * 60 * 1000
  const isRepost = (d: string) => /RT:\s*https?:\/\//i.test(d) || d.indexOf('quote-inline') >= 0
  const posts: TPost[] = []
  for (const it of raw) {
    const link = between(it, '<link>', '</link>').trim()
    const descr = between(it, '<description>', '</description>')
    const pub = between(it, '<pubDate>', '</pubDate>').trim()
    const oid = between(it, '<truth:originalId>', '</truth:originalId>').trim()
    if (!oid || !link) continue
    if (isRepost(descr)) continue                                  // posts originaux uniquement
    const t = pub ? new Date(pub).getTime() : 0
    if (!(t > 0 && (now - t) <= WINDOW && (now - t) >= -3600 * 1000)) continue   // récents uniquement
    posts.push({ link, oid, text: cleanText(descr), t })
  }
  posts.sort((a, b) => a.t - b.t)   // plus ancien d'abord (ordre chronologique)
  return { posts, reason: posts.length ? '' : 'aucun post récent' }
}

// ── Trump Morning Brief (6h05) : résumé des posts des dernières 24h, épinglé ──
async function geminiGen(prompt: string, temperature = 0.4): Promise<string> {
  const key = Deno.env.get('GEMINI_API_KEY') || ''
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const model of FORMAT_MODELS) {
      try {
        const res = await tfetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + key, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature, maxOutputTokens: 2048 } }),
        }, 25000)
        if (res.status === 429 || !res.ok) continue
        const data = await res.json()
        const parts = data?.candidates?.[0]?.content?.parts ?? []
        const out = parts.map((p: any) => (p && p.text) ? p.text : '').join('').trim()
        if (out) return out
      } catch (e) { console.error('geminiGen', model, String(e)) }
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 7000))
  }
  return ''
}
function briefPrompt(postsText: string, lang: 'English' | 'French'): string {
  return [
    "You are Francis the rooster. Summarize Donald Trump's original Truth Social posts of the LAST 24 HOURS into ONE clean morning brief IN " + lang.toUpperCase() + '.',
    "TRUMP'S POSTS (last 24h):", '---', postsText, '---',
    'Output EXACTLY these marker lines (nothing before or after, no title):',
    'TOPIC: <emoji> <short topic, 3 to 8 words>',
    '(repeat TOPIC for each distinct topic — 3 to 7 TOPIC lines total)',
    'SUMMARY: <one factual paragraph, 3 to 5 sentences, on what Trump focused on and the main themes>',
    'TAKE: <one short paragraph — Francis\' neutral, level-headed read of the last 24h. NO hype, NO partisan bias>',
    'RULES:',
    '- Base everything ONLY on the posts above. NEVER invent. Neutral and factual — this is politically sensitive, keep zero bias.',
    '- Keep the markers EXACTLY: TOPIC:, SUMMARY:, TAKE:. Write the values in ' + lang.toUpperCase() + '.',
    '- If there are no real posts, output only: NONE',
    'Output ONLY the marker lines.',
  ].join(NL)
}
type BriefData = { topics: string[]; summary: string; take: string }
function parseBrief(s: string): BriefData {
  const out: BriefData = { topics: [], summary: '', take: '' }
  for (const raw of (s || '').split(NL)) {
    const line = raw.trim()
    if (/^TOPIC\s*:/i.test(line)) { const t = line.replace(/^TOPIC\s*:/i, '').trim(); if (t) out.topics.push(t) }
    else if (/^SUMMARY\s*:/i.test(line)) out.summary = line.replace(/^SUMMARY\s*:/i, '').trim()
    else if (/^TAKE\s*:/i.test(line)) out.take = line.replace(/^TAKE\s*:/i, '').trim()
  }
  return out
}
function buildBrief(lang: 'en' | 'fr', p: BriefData): string {
  const fr = lang === 'fr'
  const L = fr
    ? { topics: 'Sujets abordés', brief: 'En bref', take: 'Le mot de Francis' }
    : { topics: 'Topics Covered', brief: 'In Brief', take: "Francis' Take" }
  const parts: string[] = ['🐓 <b>Trump Morning Brief</b>']
  if (p.topics.length) parts.push('', '🇺🇸 <b>' + L.topics + '</b>', ...p.topics.map((t) => '• ' + esc(t)))
  if (p.summary) parts.push('', '📌 <b>' + L.brief + '</b>', esc(p.summary))
  if (p.take) parts.push('', '🐓 <b>' + L.take + '</b>', esc(p.take))
  return parts.join(NL)
}
async function pinMsg(chat: number, msgId: number): Promise<void> {
  if (!msgId) return
  await tgCall('pinChatMessage', { chat_id: chat, message_id: msgId, disable_notification: true })
}
async function unpinMsg(chat: number, msgId: number): Promise<void> {
  if (!msgId) return
  await tgCall('unpinChatMessage', { chat_id: chat, message_id: msgId })
}
// Mémorise / relit l'ID du DERNIER brief épinglé (réutilise daily_news_log,
// slot dédié) → on dépingle celui d'hier avant d'épingler celui du jour.
async function lastBriefPinId(): Promise<number> {
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  try {
    const res = await tfetch(url + '/rest/v1/daily_news_log?slot=eq.trump_brief_pin&select=summary&order=created_at.desc&limit=1',
      { headers: { apikey: key || '', Authorization: 'Bearer ' + (key || '') } })
    if (!res.ok) return 0
    const rows = await res.json()
    return (Array.isArray(rows) && rows[0]) ? (Number(rows[0].summary) || 0) : 0
  } catch { return 0 }
}
async function storeBriefPinId(msgId: number): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  try {
    await tfetch(url + '/rest/v1/daily_news_log', {
      method: 'POST',
      headers: { apikey: key || '', Authorization: 'Bearer ' + (key || ''), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ day: new Date().toISOString().slice(0, 10), slot: 'trump_brief_pin', summary: String(msgId) }),
    })
  } catch { /* best-effort */ }
}
async function runBrief(sb: any): Promise<{ ok: boolean; reason: string }> {
  const { posts } = await collectFresh(24 * 60)   // dernières 24h
  if (!posts.length) return { ok: false, reason: 'aucun post Trump sur 24h' }
  const postsText = posts.map((p) => '- ' + p.text).filter((l) => l.length > 3).join(NL).slice(0, 6000)
  const enStruct = await geminiGen(briefPrompt(postsText, 'English'))
  if (!enStruct || enStruct.toUpperCase().indexOf('NONE') === 0) return { ok: false, reason: 'brief: gen EN vide/NONE' }
  const enP = parseBrief(enStruct)
  if (!enP.summary && !enP.topics.length) return { ok: false, reason: 'brief: structure EN vide' }
  const frStruct = await geminiGen(briefPrompt(postsText, 'French'))
  const frP = parseBrief(frStruct)
  const frData = (frP.summary || frP.topics.length) ? frP : enP
  const en = buildBrief('en', enP)
  const fr = buildBrief('fr', frData)
  const id = await tgGet('sendMessage', { chat_id: COOP_CHAT, message_thread_id: COOP_THREAD, text: en, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: NLANG_BTN })
  if (!id) return { ok: false, reason: 'brief: envoi Telegram KO' }
  await storeI18n(sb, COOP_CHAT, id, en, fr)
  // Épingle le brief du jour ; dépingle celui d'hier (le /setuptrump reste épinglé).
  const prevPin = await lastBriefPinId()
  if (prevPin && prevPin !== id) await unpinMsg(COOP_CHAT, prevPin)
  await pinMsg(COOP_CHAT, id)
  await storeBriefPinId(id)
  try {   // marque l'envoi réel pour le rapport 22h40
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
    await sb.from('automation_sent').upsert({ day, job_key: 'trump-morning-brief' }, { onConflict: 'day,job_key' })
  } catch { /* best-effort */ }
  return { ok: true, reason: '' }
}

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('forbidden', { status: 403 })
  const botToken = Deno.env.get('BOT_TOKEN')
  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  if (!botToken || !geminiKey) return new Response('missing config', { status: 500 })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let dryRun = false, testOne = false, brief = false
  try { const b = await req.json(); if (b && b.dryRun === true) dryRun = true; if (b && b.testOne === true) testOne = true; if (b && b.kind === 'brief') brief = true } catch { /* ok */ }

  // Trump Morning Brief (6h05, épinglé) : résumé des posts des dernières 24h.
  if (brief) {
    const bg = (async () => { try { const r = await runBrief(supabase); if (!r.ok) console.error('trump brief:', r.reason); else console.log('trump brief posté + épinglé') } catch (e) { console.error('trump brief ex:', String(e)) } })()
    ;(globalThis as any).EdgeRuntime?.waitUntil?.(bg)
    return new Response('accepted', { status: 202 })
  }

  if (dryRun) {
    const { posts, reason } = await collectFresh()
    const preview = posts.length ? { ...posts[posts.length - 1], media: await fetchMedia(posts[posts.length - 1].link) } : null
    return new Response(JSON.stringify({ count: posts.length, reason, preview }, null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  // Test de bout en bout : poste LE dernier post original dans les 2 topics.
  if (testOne) {
    const p = await latestOriginal()
    if (!p) return new Response(JSON.stringify({ error: 'aucun post original trouvé' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    const media = await fetchMedia(p.link)
    const coopOk = await postPost(supabase, COOP_CHAT, COOP_THREAD, headerEN(p.t), headerFR(p.t), p.text, media, p.link)
    // Poulailler supprimé : plus d'envoi FR.
    await claimSlot(supabase, 'trump:' + p.oid, DEDUP_TTL)   // évite un doublon par le cron
    return new Response(JSON.stringify({ oid: p.oid, mediaCount: media.length, coopOk, text: p.text.slice(0, 150) }, null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const bg = (async () => {
    try {
      const { posts, reason } = await collectFresh()
      if (posts.length === 0) { if (reason && reason !== 'aucun post récent') console.error('trump-news:', reason); return }
      for (const p of posts) {
        // Anti-doublon atomique : on ne poste qu'à la 1re prise du verrou.
        const first = await claimSlot(supabase, 'trump:' + p.oid, DEDUP_TTL)
        if (!first) continue
        const media = await fetchMedia(p.link)
        // EN par défaut + bouton 🇫🇷 -> The Chicken Coop.
        await postPost(supabase, COOP_CHAT, COOP_THREAD, headerEN(p.t), headerFR(p.t), p.text, media, p.link)
        console.log('trump-news poste', p.oid, 'media', media.length, p.text.slice(0, 60))
      }
    } catch (e) { console.error('trump-news bg ex:', String(e)) }
  })()
  ;(globalThis as any).EdgeRuntime?.waitUntil?.(bg)
  return new Response('accepted', { status: 202 })
})
