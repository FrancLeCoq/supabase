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

  let category = '', subject = '', owner = 0
  try {
    const body = await req.json()
    category = String((body && body.category) || '').toLowerCase()
    subject = String((body && body.subject) || '').trim()
    owner = Number((body && body.owner) || 0)
  } catch { /* corps invalide */ }

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
        '🇬🇧 <b>The Chicken Coop</b>\n' + en + '\n\n' +
        '🇫🇷 <b>Le Poulailler</b>\n' + fr + '\n\n' +
        'Publier dans les deux groupes ?'
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
