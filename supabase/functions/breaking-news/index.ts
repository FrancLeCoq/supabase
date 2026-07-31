// ================================================================
//  breaking-news — « Breaking news » perso de Francis (à la demande).
//
//  Déclenchée par bot-handler quand le OWNER tape /f1 /motogp /worldroost
//  /crypto puis donne un SUJET. Cette fonction :
//    A) cherche/vérifie le sujet sur le web (Gemini grounded, 2.5) ;
//    B) rédige une BREAKING NEWS en ANGLAIS à partir du sujet + des faits
//       trouvés. Si RIEN n'est trouvé (ex. potin X fourni avec sa source),
//       elle met en forme UNIQUEMENT à partir de ce que le owner a écrit,
//       en l'annonçant clairement comme rumeur/non confirmé ;
//    C) traduit en FRANÇAIS ;
//    D) enregistre le brouillon dans breaking_pending et envoie au owner un
//       APERÇU EN+FR avec deux boutons ✅ Publier / ❌ Annuler.
//
//  La PUBLICATION dans les deux groupes est faite par bot-handler au clic
//  sur ✅ (callback bn_pub), à partir du brouillon stocké.
//
//  Sécurité : header x-cron-secret == CRON_SECRET.
// ================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const NL = String.fromCharCode(10)
const SEARCH_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']
const FORMAT_MODEL = 'gemini-3.1-flash-lite'
const AI_TIMEOUT_MS = 40000

// Catégories : emoji + libellé (les topics/groupes de publication vivent dans
// bot-handler, qui poste après validation).
const CAT: Record<string, { emoji: string; label: string }> = {
  f1: { emoji: '🏎️', label: 'F1' },
  motogp: { emoji: '🏍️', label: 'MotoGP' },
  worldroost: { emoji: '🌍', label: 'World Roost' },
  crypto: { emoji: '⚡', label: 'Crypto' },
  x: { emoji: '📤', label: 'X' },   // annonce prête à publier sur X (Twitter)
  xtrend: { emoji: '🔥', label: 'X Trend' },   // post viral sur une tendance X (hors $FRANC)
}

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
async function groundedSearch(prompt: string): Promise<string> {
  for (const model of SEARCH_MODELS) {
    try {
      const res = await tfetch(geminiUrl(model), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.3 } }),
      }, AI_TIMEOUT_MS)
      if (res.status === 429) { console.warn('breaking groundedSearch 429 ' + model); continue }
      if (!res.ok) { console.error('breaking groundedSearch HTTP', res.status, model); continue }
      const out = extractText(await res.json())
      if (out) return out
    } catch (e) { console.error('breaking groundedSearch exception', model, String(e)) }
  }
  return ''
}
async function formatCall(prompt: string, temperature = 0.4): Promise<string> {
  try {
    const res = await tfetch(geminiUrl(FORMAT_MODEL), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature } }),
    }, 25000)
    if (!res.ok) { console.error('breaking formatCall HTTP', res.status); return '' }
    return extractText(await res.json())
  } catch (e) { console.error('breaking formatCall exception', String(e)); return '' }
}

// Recherche : vérifier/enrichir le sujet donné par le owner.
function searchPrompt(label: string, subject: string): string {
  return [
    'You are a news researcher. Use Google Search to VERIFY and ENRICH the following ' + label + ' topic provided by an editor.',
    'TOPIC: "' + subject + '"',
    'Report the VERIFIED FACTS you can actually find (who/what/when/where, key figures, and the outlet/source names). 3 to 6 short factual lines, no styling.',
    'If you genuinely find NOTHING credible online about it, reply with exactly: NONE',
  ].join(NL)
}

// Mise en forme de la breaking news EN. Si facts == NONE, on s'appuie
// UNIQUEMENT sur ce que le owner a écrit, en le présentant comme rumeur.
function formatPrompt(label: string, subject: string, facts: string): string {
  const hasFacts = facts && facts.toUpperCase().indexOf('NONE') !== 0
  const factsBlock = hasFacts ? facts : '(no online confirmation found)'
  return [
    'You are Francis the rooster, a witty but reliable news reporter for a Telegram community. Write a BREAKING NEWS post IN ENGLISH about this ' + label + ' topic.',
    '',
    'EDITOR TOPIC (what the owner wants covered, may include a source):',
    subject,
    '',
    'VERIFIED FACTS FOUND ONLINE:',
    '---', factsBlock, '---',
    '',
    hasFacts
      ? 'Write it as a confirmed breaking news, based ONLY on the verified facts + the editor topic. Do not invent anything beyond them.'
      : 'Nothing was confirmed online, so treat the editor topic as an UNCONFIRMED RUMOUR: write it clearly as a rumour/buzz (e.g. "Rumour has it…", "Unconfirmed:"), and if the editor gave a source, cite it. Do NOT present it as confirmed fact and invent nothing.',
    '',
    'FORMAT:',
    '- 2 to 4 short punchy sentences. Max ~500 characters. Plain text.',
    '- Do NOT add any title/hook/emoji header (a "🚨 BREAKING" header is added automatically).',
    '- Neutral and factual. NO financial advice, no "moon/pump/buy/sell".',
    '',
    'Output ONLY the breaking-news text, nothing else.',
  ].join(NL)
}

// Annonce prête pour X (Twitter) : format court, percutant, sans lien t.me
// (un lien t.me dans le post provoque un shadowban → le CTA se met en commentaire).
function xPrompt(subject: string, facts: string): string {
  const hasFacts = facts && facts.toUpperCase().indexOf('NONE') !== 0
  return [
    'You are Francis the rooster, voice of the $FRANC community memecoin on X (Twitter). Write ONE ready-to-post X announcement about this news from our universe.',
    '',
    'ANNOUNCEMENT TOPIC (from the owner):',
    subject,
    '',
    'CONTEXT FOUND ONLINE:',
    '---', hasFacts ? facts : '(nothing extra found — rely on the topic above)', '---',
    '',
    'RULES:',
    '- ONE single post, 280 CHARACTERS MAXIMUM (hard limit).',
    '- Punchy, exciting, on-brand for a fun rooster memecoin community. English.',
    '- 1 to 3 relevant hashtags at the end (e.g. #FRANC #Solana #crypto). Keep $FRANC if relevant.',
    '- A couple of emojis max. NO markdown.',
    '- NEVER include a t.me link or any URL (the link goes in a separate comment).',
    '- Base it on the topic; do not invent hard facts (numbers, dates) that are not given.',
    '',
    'Output ONLY the X post text, nothing else.',
  ].join(NL)
}
// Clavier « Publier sur X » (+ Copier si assez court) sous l'aperçu owner.
function xShareKeyboard(text: string) {
  const xBtn = { text: '📤 Publier sur X', url: 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) }
  const row = (text.length <= 256) ? [{ text: '📋 Copier', copy_text: { text } }, xBtn] : [xBtn]
  return { inline_keyboard: [row] }
}

// Repli IA (grounded) si la récupération directe échoue.
function trendsSearchPrompt(): string {
  return [
    'Use Google Search to find the CURRENT top worldwide trending topics on X (formerly Twitter) RIGHT NOW (today).',
    'Check live trend aggregators such as rattibha.com/trends, getdaytrends.com and trends24.in (worldwide).',
    'Return ONLY the 10 BIGGEST worldwide trends, most important first, ONE per line, each as its short trend name or hashtag (e.g. "#SuperBowl" or "Taylor Swift"). No numbering, no extra words. Exactly 10 lines.',
  ].join(NL)
}

// ── Récupération LIVE des tendances X ─────────────────────────
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
function htmlDecodeBasic(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
}
const TREND_NOISE = /^(home|trends?|login|log in|sign in|sign up|menu|about|privacy|terms|contact|english|worldwide|world|more|search|next|previous|back|rattibha|twitter|x|top|new|help|settings|language)$/i
// Libellés/rubriques de la page à écarter (sous-chaînes).
const TREND_NOISE_SUB = /(twitter trends|trending now|worldwide trends|see all|show more|read more|view all|sign in|log in)/i
function pushTrend(out: string[], seen: Set<string>, t: string) {
  t = htmlDecodeBasic(t).trim()
  if (t.length < 2 || t.length > 50) return
  if (TREND_NOISE.test(t) || TREND_NOISE_SUB.test(t)) return
  const k = t.toLowerCase()
  if (seen.has(k)) return
  seen.add(k); out.push(t)
}
// en.rattibha.com/trends (source demandée). Extrait les objets tendance
// embarqués (Next data "name":"…") + les hashtags visibles.
async function fromRattibha(): Promise<string[]> {
  try {
    const res = await tfetch('https://en.rattibha.com/trends', { headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html' } }, 15000)
    if (!res.ok) return []
    const html = await res.text()
    const out: string[] = []; const seen = new Set<string>()
    let m: RegExpExecArray | null
    const reName = /"name"\s*:\s*"([^"]{2,50})"/g
    while ((m = reName.exec(html)) && out.length < 20) pushTrend(out, seen, m[1])
    const reTag = /#[A-Za-z0-9_]{2,40}/g
    while ((m = reTag.exec(html)) && out.length < 25) pushTrend(out, seen, m[0])
    return out
  } catch { return [] }
}
// trends24.in (SSR fiable) — repli live si rattibha ne renvoie rien d'exploitable.
async function fromTrends24(): Promise<string[]> {
  try {
    const res = await tfetch('https://trends24.in/', { headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html' } }, 15000)
    if (!res.ok) return []
    const html = await res.text()
    const i = html.indexOf('trend-card__list')
    const seg = i >= 0 ? html.slice(i, i + 14000) : html
    const out: string[] = []; const seen = new Set<string>()
    let m: RegExpExecArray | null
    const re = /<a\b[^>]*>([^<]{2,60})<\/a>/g
    while ((m = re.exec(seg)) && out.length < 20) pushTrend(out, seen, m[1])
    return out
  } catch { return [] }
}
// Renvoie jusqu'à 10 tendances live + la source utilisée.
async function fetchTrends(): Promise<{ trends: string[]; source: string }> {
  const rat = await fromRattibha()
  if (rat.length >= 6) return { trends: rat.slice(0, 10), source: 'rattibha' }
  const t24 = await fromTrends24()
  if (t24.length >= 6) return { trends: t24.slice(0, 10), source: 'trends24' }
  const raw = await groundedSearch(trendsSearchPrompt())
  const gs = (raw || '').split(NL).map((t) => t.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, '').trim()).filter(Boolean).slice(0, 10)
  const best = rat.length >= t24.length ? rat : t24
  if (best.length) return { trends: best.slice(0, 10), source: best === rat ? 'rattibha' : 'trends24' }
  return { trends: gs, source: 'grounded' }
}
// Clavier sous le post viral : Copier + Publier sur X + lien Rattibha (tendances).
function xtrendKeyboard(text: string) {
  const xBtn = { text: '📤 Publier sur X', url: 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) }
  const top = (text.length <= 256) ? [{ text: '📋 Copier', copy_text: { text } }, xBtn] : [xBtn]
  return { inline_keyboard: [top, [{ text: '🔎 Voir les tendances (Rattibha)', url: 'https://en.rattibha.com/trends' }]] }
}

// Post viral/fun sur une tendance X — SANS rapport avec $FRANC (pure visibilité).
function xtrendPrompt(trend: string, facts: string): string {
  const hasFacts = facts && facts.toUpperCase().indexOf('NONE') !== 0
  return [
    'You are a witty, culturally-aware social media writer. Write ONE viral, fun, highly shareable X (Twitter) post riding this CURRENT trend.',
    '',
    'TREND: ' + trend,
    '',
    'CONTEXT FOUND ONLINE:',
    '---', hasFacts ? facts : '(rely on general knowledge of this trend)', '---',
    '',
    'RULES:',
    '- ONE single post, 280 CHARACTERS MAXIMUM (hard limit).',
    '- Genuinely funny/relatable/clever — the kind of post that gets likes & reposts. English.',
    '- Ride the trend naturally. End with the trend hashtag + maybe 1 extra relevant hashtag.',
    '- This is PURELY for visibility — do NOT mention $FRANC, crypto, Francis, roosters, or any brand. No promotion.',
    '- A couple of emojis max. No markdown, no links.',
    '- Keep it light and safe-for-work; avoid anything hateful, political-partisan or defamatory.',
    '',
    'Output ONLY the X post text, nothing else.',
  ].join(NL)
}

async function translateToFrench(text: string): Promise<string> {
  const prompt = [
    'Translate the following Telegram breaking-news message into natural, fluent FRENCH.',
    '- Keep ALL emojis and the same layout.',
    '- Do NOT translate proper names, tickers, URLs or numbers.',
    '- Output ONLY the translated message, nothing else.',
    '', 'MESSAGE:', text,
  ].join(NL)
  return await formatCall(prompt, 0.3)
}

async function tg(token: string, method: string, body: Record<string, any>) {
  try {
    const res = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    return await res.json()
  } catch (e) { console.error('breaking tg', method, String(e)); return null }
}

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('forbidden', { status: 403 })
  const token = Deno.env.get('BOT_TOKEN')
  if (!token) return new Response('missing config', { status: 500 })

  let category = '', subject = '', owner = 0, action = '', debug = false
  try {
    const body = await req.json()
    category = String((body && body.category) || '').toLowerCase()
    subject = String((body && body.subject) || '').trim()
    owner = Number((body && body.owner) || 0)
    action = String((body && body.action) || '')
    debug = !!(body && body.debug)
  } catch { /* corps invalide */ }

  // /xtrend étape 1 : récupère les 10 tendances X mondiales (live) et propose des boutons.
  if (action === 'xtrend_list') {
    // Mode debug : renvoie directement source + tendances (pour vérifier la source).
    if (debug) { const r = await fetchTrends(); return new Response(JSON.stringify(r, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } }) }
    if (!owner) return new Response(JSON.stringify({ error: 'bad request' }), { status: 400 })
    const bg = (async () => {
      try {
        const { trends, source } = await fetchTrends()
        if (trends.length === 0) { await tg(token, 'sendMessage', { chat_id: owner, text: '🔥 X Trends — impossible de récupérer les tendances pour le moment. Réessaie dans un instant.' }); return }
        const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
        await supabase.from('xtrend_pending').upsert({ owner_id: owner, trends, created_at: new Date().toISOString() })
        const kb = trends.map((t, i) => [{ text: '🔥 ' + t.slice(0, 60), callback_data: 'xt:' + i }])
        kb.push([{ text: '🔎 Voir sur Rattibha', url: 'https://en.rattibha.com/trends' }])
        await tg(token, 'sendMessage', {
          chat_id: owner, parse_mode: 'HTML',
          text: `🔥 <b>Top 10 tendances X (monde)</b> <i>(${source})</i>\nChoisis-en une, je te rédige un post viral prêt à publier 👇`,
          reply_markup: { inline_keyboard: kb },
        })
      } catch (e) { console.error('xtrend_list', String(e)) }
    })()
    ;(globalThis as any).EdgeRuntime?.waitUntil?.(bg)
    return new Response('accepted', { status: 202 })
  }

  const cat = CAT[category]
  if (!cat || !subject || !owner) return new Response(JSON.stringify({ error: 'bad request' }), { status: 400 })

  const bg = (async () => {
    try {
      // Cas spécial « X » : une annonce prête à publier sur X, envoyée au owner
      // avec un bouton « Publier sur X ». Pas de traduction, pas de post groupe.
      if (category === 'x') {
        const facts = await groundedSearch(searchPrompt('news', subject))
        const post = await formatCall(xPrompt(subject, facts))
        if (!post || post.toUpperCase().indexOf('NONE') === 0) {
          await tg(token, 'sendMessage', { chat_id: owner, text: '📤 X — impossible de rédiger. Réessaie avec un sujet plus précis.' })
          return
        }
        await tg(token, 'sendMessage', {
          chat_id: owner,
          text: '📤 <b>Annonce prête pour X</b>\n\n' + post + '\n\n<i>Touche « Publier sur X » pour ouvrir X avec le texte pré-rempli.</i>',
          parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: xShareKeyboard(post),
        })
        return
      }

      // /xtrend étape 2 : post viral sur la tendance choisie (hors $FRANC),
      // envoyé au owner avec un bouton « Publier sur X ». Clé en main.
      if (category === 'xtrend') {
        const facts = await groundedSearch(searchPrompt('trending topic', subject))
        const post = await formatCall(xtrendPrompt(subject, facts))
        if (!post || post.toUpperCase().indexOf('NONE') === 0) {
          await tg(token, 'sendMessage', { chat_id: owner, text: '🔥 X Trend — impossible de rédiger. Réessaie ou choisis une autre tendance.' })
          return
        }
        await tg(token, 'sendMessage', {
          chat_id: owner,
          text: '🔥 <b>Post viral prêt pour X</b>\n<i>Tendance : ' + subject.replace(/</g, '&lt;') + '</i>\n\n' + post + '\n\n<i>Touche « Publier sur X » pour ouvrir X avec le texte pré-rempli.</i>',
          parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: xtrendKeyboard(post),
        })
        return
      }

      const facts = await groundedSearch(searchPrompt(cat.label, subject))
      const en = await formatCall(formatPrompt(cat.label, subject, facts))
      if (!en || en.toUpperCase().indexOf('NONE') === 0) {
        await tg(token, 'sendMessage', { chat_id: owner, text: '🚨 Breaking news — impossible de rédiger. Réessaie avec un sujet plus précis.' })
        return
      }
      const fr = await translateToFrench(en) || en

      const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      await supabase.from('breaking_pending').upsert(
        { owner_id: owner, category, subject, en, fr, created_at: new Date().toISOString() },
        { onConflict: 'owner_id' },
      )

      const preview =
        '🚨 <b>Breaking news — ' + cat.emoji + ' ' + cat.label + '</b>\n' +
        '<i>Sujet : ' + subject.replace(/</g, '&lt;') + '</i>\n\n' +
        '🇬🇧 <b>EN (par défaut)</b>\n' + en + '\n\n' +
        '🇫🇷 <b>FR (bouton « Translate »)</b>\n' + fr + '\n\n' +
        'Publier dans The Chicken Coop ?'
      await tg(token, 'sendMessage', {
        chat_id: owner, text: preview, parse_mode: 'HTML', disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[
          { text: '✅ Publier', callback_data: 'bn_pub' },
          { text: '❌ Annuler', callback_data: 'bn_cancel' },
        ]] },
      })
    } catch (e) { console.error('breaking bg exception', String(e)) }
  })()
  ;(globalThis as any).EdgeRuntime?.waitUntil?.(bg)
  return new Response('accepted', { status: 202 })
})
