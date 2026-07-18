// ================================================================
//  racing - "Cocorico Racing" (F1 + MotoGP), a la demande.
//
//  Brique ISOLEE. Declenchee par bot-handler quand le OWNER tape une
//  commande /F1xxx ou /GPxxx. Jamais automatique (les courses ne sont
//  pas regulieres) -> aucun cron, absente du rapport de 23h.
//
//  PIPELINE (memes principes que les daily) :
//    A) RECHERCHE grounded (Google Search), en ANGLAIS, sur le modele
//       2.5 LE MOINS SOLLICITE par l'automatique : gemini-2.5-flash
//       (fallback gemini-2.5-flash-lite). 1 seul appel 2.5 par commande.
//    B) MISE EN FORME finale : gemini-3.1-flash-lite (quota large) —
//       une version ANGLAISE (The Chicken Coop) et une FRANCAISE
//       (Le Poulailler), a partir des MEMES faits.
//
//  Diffusion : EN -> The Chicken Coop, topic "Cocorico Racing" (1631) ;
//              FR -> Le Poulailler, topic "Cocorico Racing" (147).
//
//  Securite : header x-cron-secret == CRON_SECRET.
// ================================================================

const NL = String.fromCharCode(10)

// Recherche grounded : 2.5-flash en primaire (le moins charge par
// l'auto : ~5/j vs ~6/j pour le lite), repli sur 2.5-flash-lite.
const SEARCH_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']
const FORMAT_MODEL = 'gemini-3.1-flash-lite'
const AI_TIMEOUT_MS = 40000

// Telegram
const COOP_CHAT_ID = Number(Deno.env.get('FACT_CHAT_ID') ?? '-1003842240104') // The Chicken Coop (EN)
const RACING_THREAD_EN = 1631
const FR_CHAT_ID = -1004352289820   // Le Poulailler
const RACING_THREAD_FR = 147
const OWNER_ID = 6593812300         // DM du owner en cas d'echec
// CTA ajoutee UNIQUEMENT dans la copie owner (pour coller sur X), jamais dans le post Telegram.
const CTA_F1 = "🏎️Don't miss any F1 news." + NL + '🏁 Join the Chicken Coop :' + NL + '👉 T.me/LeCoqFrancis'
const CTA_MOTOGP = "🏍️Don't miss any MotoGP news." + NL + '🏁 Join the Chicken Coop :' + NL + '👉 T.me/LeCoqFrancis'

// -- Reseau + Gemini -------------------------------------------
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.3 },
        }),
      }, AI_TIMEOUT_MS)
      if (res.status === 429) { console.warn('racing groundedSearch 429 sur ' + model + ', repli'); continue }
      if (!res.ok) { console.error('racing groundedSearch HTTP', res.status, model); continue }
      const out = extractText(await res.json())
      if (out) return out
    } catch (e) { console.error('racing groundedSearch exception', model, String(e)) }
  }
  return ''
}
async function formatCall(prompt: string): Promise<string> {
  try {
    const res = await tfetch(geminiUrl(FORMAT_MODEL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3 } }),
    }, 25000)
    if (!res.ok) { console.error('racing formatCall HTTP', res.status); return '' }
    return extractText(await res.json())
  } catch (e) { console.error('racing formatCall exception', String(e)); return '' }
}

// -- Config des commandes --------------------------------------
// type de rubrique -> prompt de recherche (EN) + consigne de mise en
// forme + hooks EN/FR. {S} = 'F1' ou 'MotoGP', {SPORT} = nom long.
type RType = 'essais' | 'qualifs' | 'qualifssprint' | 'sprint' | 'course' | 'we' | 'news'

function searchPrompt(sportLong: string, type: RType): string {
  const base = 'Use Google Search to find accurate, up-to-date facts. Report ONLY verified facts, in English, as raw notes (no styling). If you genuinely cannot find the information, reply with exactly: NONE.' + NL + NL
  const q: Record<RType, string> = {
    essais: 'Find the results and highlights of the most recent ' + sportLong + ' FREE PRACTICE sessions of the current or upcoming race weekend (usually held on Friday). Who was fastest, notable lap times, incidents, surprises, weather.',
    qualifs: 'Find the QUALIFYING results that set the grid for the MAIN Grand Prix (the standard qualifying, usually Saturday) of the most recent ' + sportLong + ' race weekend. Give the FULL qualifying classification in order (position, driver/rider name + team, and pole time or gaps), plus key highlights (surprises, crashes, penalties). Do NOT report the sprint qualifying/shootout here.',
    qualifssprint: 'Find the SPRINT QUALIFYING results (the session that sets the grid for the SPRINT race - in F1 called Sprint Shootout / Sprint Qualifying) of the most recent ' + sportLong + ' sprint race weekend. Give the FULL classification in order (position, driver/rider name + team, and time or gaps), plus key highlights. If this race weekend has NO sprint format, reply with exactly: NONE.',
    sprint: 'Find the results of the most recent ' + sportLong + ' SPRINT race. Give the winner, the podium, and the finishing order (top positions with name + team), plus key highlights and incidents.',
    course: 'Find the results of the most recent ' + sportLong + ' main RACE (Grand Prix). Give the winner, the podium, and the finishing order (top positions with name + team), plus key highlights and incidents.',
    we: 'TWO things about ' + sportLong + '. (1) The NEXT upcoming race weekend: the Grand Prix name and circuit/location (city, country), and the FULL session schedule for each day (practice, qualifying, sprint if any, race) with their start times, converted to UTC. (2) The CURRENT ' + sportLong + ' World Drivers/Riders Championship standings AS OF TODAY: the FULL classification IN ORDER with, for EACH entry, the position, the driver/rider FULL name (first + last), their team/constructor NAME, and their points total. Label this section STANDINGS and keep every position.',
    news: 'Find the freshest ' + sportLong + ' paddock news, rumours and gossip from the LAST 48 HOURS (driver/rider moves, contracts, team news, controversies, injuries). Juicy but factual.',
  }
  return base + q[type]
}

function formatPrompt(lang: 'English' | 'French', sportShort: string, type: RType, facts: string): string {
  // Meme modele de classement pour F1 et MotoGP : pilote - ecurie - points.
  // (Telegram n'affiche pas de vrais logos dans un message texte.)
  const standingsFmt = '<rank emoji> <First Last> - <Team> - <points> pts'
  const task: Record<RType, string> = {
    essais: 'Write a punchy summary of the PRACTICE highlights. HARD LIMIT: 280 characters. Lead with the standout fact (fastest driver/rider + key moment). No standings.',
    qualifs: 'Write TWO blocks: (1) a short punchy preamble, MAX 280 CHARACTERS, with the key highlights and who took pole; then a blank line; then (2) the FULL qualifying classification, ONE line per position, each line STARTING with the position as keycap number emojis, like "1️⃣ Name (Team) - time/gap", then "2️⃣ ...", "3️⃣ ...". Use 🔟 for tenth; for positions above ten combine digit emojis (e.g. 1️⃣1️⃣, 1️⃣2️⃣). Never write "P1"/"P2".',
    qualifssprint: 'Write TWO blocks: (1) a short punchy preamble, MAX 280 CHARACTERS, with the key highlights and who took sprint pole; then a blank line; then (2) the FULL sprint qualifying classification, ONE line per position, each line STARTING with the position as keycap number emojis, like "1️⃣ Name (Team) - time/gap", then "2️⃣ ...". Use 🔟 for tenth; above ten combine digit emojis (e.g. 1️⃣1️⃣). Never write "P1"/"P2".',
    sprint: 'Write TWO blocks: (1) a short preamble, MAX 280 CHARACTERS, with the highlights and the winner; then a blank line; then (2) the finishing order, ONE line per position, each line STARTING with the position as keycap number emojis, like "1️⃣ Name (Team)", then "2️⃣ ...". Use 🔟 for tenth; above ten combine digit emojis (e.g. 1️⃣1️⃣). Never write "P1"/"P2".',
    course: 'Write TWO blocks: (1) a short preamble, MAX 280 CHARACTERS, with the race highlights and the winner; then a blank line; then (2) the finishing order, ONE line per position, each line STARTING with the position as keycap number emojis, like "1️⃣ Name (Team)", then "2️⃣ ...". Use 🔟 for tenth; above ten combine digit emojis (e.g. 1️⃣1️⃣). Never write "P1"/"P2".',
    we: 'Write the upcoming ' + sportShort + ' race weekend, THEN the current world standings. STRUCTURE: '
      + '(1) First line: the Grand Prix name + circuit + location. '
      + '(2) The schedule, ONE line per session, each line STARTING with "👉 " then formatted "👉 Day HH:MM UTC - Session" (all times UTC). '
      + '(3) A blank line, then a header line exactly "🏆 World Championship". '
      + '(4) Then the FULL current standings from the facts, ONE line per driver/rider IN ORDER, each line STARTING with the position as keycap number emojis (1️⃣ 2️⃣ 3️⃣ …, 🔟 for tenth, and combine digits above ten e.g. 1️⃣1️⃣, 1️⃣2️⃣), formatted EXACTLY like this: "' + standingsFmt + '". '
      + 'Keep the exact order, names, teams and points from the facts. Make it clear this is ' + sportShort + '. NO 280-character limit here.',
    news: 'Write the freshest paddock news as 3 to 5 short punchy bullet points. Each bullet MUST start with "👉 " and be a single sentence. Separate EACH bullet with a BLANK LINE (an empty line between bullets, so they are airy and never glued together). Keep it factual. Max ~600 characters.',
  }
  return [
    'You are Francis the rooster, a witty motorsport reporter for a Telegram community.',
    'Below are VERIFIED FACTS (already researched) about ' + sportShort + ':',
    '---',
    facts,
    '---',
    'Write the final Telegram message IN ' + lang.toUpperCase() + '.',
    task[type],
    '',
    'RULES:',
    '- Base it ONLY on the facts above. NEVER invent names, positions, times or results.',
    '- Do NOT add any title or hook (a header is added automatically). No markdown, plain text.',
    '- Keep driver/rider and team names, numbers and times exactly as in the facts.',
    '- If the facts are NONE or clearly insufficient, reply with exactly: NONE',
    '',
    'Output ONLY the final message (or NONE).',
  ].join(NL)
}

const HOOK_EN: Record<RType, string> = {
  essais: 'Practice highlights', qualifs: 'Qualifying', qualifssprint: 'Sprint Qualifying',
  sprint: 'Sprint race', course: 'Race', we: 'Next race weekend', news: 'Paddock buzz 🏁 :',
}
const HOOK_FR: Record<RType, string> = {
  essais: 'Essais : temps forts', qualifs: 'Qualifications', qualifssprint: 'Qualifs Sprint',
  sprint: 'Course Sprint', course: 'Course', we: 'Prochain week-end', news: 'Potins du paddock 🏁 :',
}

// -- Telegram --------------------------------------------------
// Renvoie le message_id publie (0 si echec) pour pouvoir l'epingler.
async function post(token: string, chatId: number, text: string, threadId: number, replyMarkup?: any): Promise<number> {
  try {
    const body: any = { chat_id: chatId, text, disable_web_page_preview: true }
    if (threadId) body.message_thread_id = threadId
    if (replyMarkup) body.reply_markup = replyMarkup
    const res = await tfetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!data || !data.ok) { console.error('racing post:', JSON.stringify(data).slice(0, 200)); return 0 }
    return Number(data.result && data.result.message_id) || 0
  } catch (e) { console.error('racing post exception', String(e)); return 0 }
}
// Boutons sous la copie owner : 📋 Copier (copy_text natif, si <=256 car) +
// 📤 Publier sur X (ouvre X avec le texte deja pre-rempli).
function xShareKeyboard(fullText: string) {
  const xBtn = { text: '📤 Publier sur X', url: 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(fullText) }
  const row = (fullText.length <= 256)
    ? [{ text: '📋 Copier', copy_text: { text: fullText } }, xBtn]
    : [xBtn]
  return { inline_keyboard: [row] }
}
// Copie owner (F1/MotoGP) avec boutons Copier + Publier sur X.
async function dmOwnerCopy(token: string, fullText: string): Promise<void> {
  try { await post(token, OWNER_ID, fullText, 0, xShareKeyboard(fullText)) } catch { /* ignore */ }
}
// Epingle un message (sans notification bruyante) - utilise pour /F1we /GPwe.
async function pinMessage(token: string, chatId: number, messageId: number): Promise<void> {
  if (!messageId) return
  try {
    const res = await tfetch('https://api.telegram.org/bot' + token + '/pinChatMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, disable_notification: true }),
    })
    const data = await res.json()
    if (!data || !data.ok) console.error('racing pin:', JSON.stringify(data).slice(0, 200))
  } catch (e) { console.error('racing pin exception', String(e)) }
}
async function dmOwner(token: string, text: string) {
  try { await post(token, OWNER_ID, text, 0) } catch { /* ignore */ }
}

// -- Coeur : recherche + EN + FR + publication -----------------
async function runCommand(token: string, command: string): Promise<void> {
  const isF1 = command.startsWith('f1')
  const sportShort = isF1 ? 'F1' : 'MotoGP'
  const sportLong = isF1 ? 'Formula 1' : 'MotoGP'
  const sportEmoji = isF1 ? '🏎️' : '🏍️'   // petite F1 / petite moto en tete du titre
  const type = command.replace('f1', '').replace('gp', '') as RType

  const facts = await groundedSearch(searchPrompt(sportLong, type))
  if (!facts || facts.toUpperCase().indexOf('NONE') === 0) {
    await dmOwner(token, '🏁 /' + command + ' : aucune info trouvee pour le moment (course pas encore courue ou pas de donnees). Reessaie plus tard.')
    return
  }

  // Le programme du week-end (/F1we /GPwe) est epingle dans chaque groupe.
  const doPin = type === 'we'

  // EN -> The Chicken Coop (1631)
  const en = await formatCall(formatPrompt('English', sportShort, type, facts))
  if (en && en.toUpperCase().indexOf('NONE') !== 0) {
    const enMsg = sportEmoji + ' ' + sportShort + ' — ' + HOOK_EN[type] + NL + NL + en
    const idEn = await post(token, COOP_CHAT_ID, enMsg, RACING_THREAD_EN)
    if (doPin) await pinMessage(token, COOP_CHAT_ID, idEn)
    // Copie EN + CTA -> owner (pour coller sur X), avec boutons Copier + Publier sur X.
    // CTA jamais dans le post Telegram.
    await dmOwnerCopy(token, enMsg + NL + NL + (isF1 ? CTA_F1 : CTA_MOTOGP))
  } else { console.error('racing[' + command + '] EN vide/NONE') }

  // FR -> Le Poulailler (147)
  const fr = await formatCall(formatPrompt('French', sportShort, type, facts))
  if (fr && fr.toUpperCase().indexOf('NONE') !== 0) {
    const idFr = await post(token, FR_CHAT_ID, sportEmoji + ' ' + sportShort + ' — ' + HOOK_FR[type] + NL + NL + fr, RACING_THREAD_FR)
    if (doPin) await pinMessage(token, FR_CHAT_ID, idFr)
  } else { console.error('racing[' + command + '] FR vide/NONE') }

  if ((!en || en.toUpperCase().indexOf('NONE') === 0) && (!fr || fr.toUpperCase().indexOf('NONE') === 0)) {
    await dmOwner(token, '🏁 /' + command + ' : mise en forme impossible (reessaie).')
  }
}

// -- Point d'entree --------------------------------------------
const VALID = new Set([
  'f1essais', 'gpessais',
  'f1qualifs', 'gpqualifs', 'f1qualifssprint', 'gpqualifssprint',
  'f1sprint', 'gpsprint', 'f1course', 'gpcourse',
  'f1we', 'gpwe', 'f1news', 'gpnews',
])

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('forbidden', { status: 403 })
  const token = Deno.env.get('BOT_TOKEN')
  if (!token) return new Response('missing config', { status: 500 })

  let command = ''
  let dryRun = false
  try {
    const body = await req.json()
    command = String((body && body.command) || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    if (body && body.dryRun === true) dryRun = true
  } catch { /* corps invalide */ }

  if (!VALID.has(command)) return new Response(JSON.stringify({ error: 'unknown command', command }), { status: 400, headers: { 'Content-Type': 'application/json' } })

  if (dryRun) {
    const isF1 = command.startsWith('f1')
    const sportLong = isF1 ? 'Formula 1' : 'MotoGP'
    const sportShort = isF1 ? 'F1' : 'MotoGP'
    const type = command.replace('f1', '').replace('gp', '') as RType
    const facts = await groundedSearch(searchPrompt(sportLong, type))
    const en = facts ? await formatCall(formatPrompt('English', sportShort, type, facts)) : ''
    const fr = facts ? await formatCall(formatPrompt('French', sportShort, type, facts)) : ''
    return new Response(JSON.stringify({ command, factsLen: facts.length, en, fr }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const bg = runCommand(token, command).catch((e) => console.error('racing bg exception', String(e)))
  ;(globalThis as any).EdgeRuntime?.waitUntil?.(bg)
  return new Response('accepted', { status: 202 })
})
