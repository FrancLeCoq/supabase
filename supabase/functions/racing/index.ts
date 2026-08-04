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
//    B) MISE EN FORME finale : gemini-3.5-flash-lite (repli 3.1-flash-lite) —
//       The Chicken Coop, EN par defaut + bouton « Translate in French ».
//       (FR pre-enregistre, meme mecanique que les daily).
//
//  Diffusion : The Chicken Coop, topic "Cocorico Racing" (1631).
//
//  Securite : header x-cron-secret == CRON_SECRET.
// ================================================================

import { renderStandingsPng, parseStandings, isStandingLine, fontCount, type StKind } from './standings-image.ts'

const NL = String.fromCharCode(10)

// Recherche grounded : 2.5-flash en primaire (le moins charge par
// l'auto : ~5/j vs ~6/j pour le lite), repli sur 2.5-flash-lite.
const SEARCH_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']
// Mise en forme/traduction : Gemini 3.5 Flash-Lite, repli 3.1 Flash-Lite si quota.
const FORMAT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
const AI_TIMEOUT_MS = 40000

// Telegram
const COOP_CHAT_ID = Number(Deno.env.get('FACT_CHAT_ID') ?? '-1003842240104') // The Chicken Coop (EN)
// F1 et MotoGP ont désormais leur propre topic dans The Chicken Coop.
const F1_THREAD = 1631        // t.me/LeCoqFrancis/1631
const MOTOGP_THREAD = 2259    // t.me/LeCoqFrancis/2259
const racingThread = (isF1: boolean) => (isF1 ? F1_THREAD : MOTOGP_THREAD)
const OWNER_ID = 6593812300         // DM du owner en cas d'echec
// Le lien "rejoins le poulailler" n'est PLUS collé dans la copie owner (le lien
// t.me dans un post X provoque un shadowban) : il se met en commentaire du post
// via les commandes /xf1 et /xmotogp du bot.

// -- Reseau + Gemini -------------------------------------------
async function tfetch(input: string, init: RequestInit = {}, ms = 10000): Promise<Response> {
  return await globalThis.fetch(input, { ...init, signal: AbortSignal.timeout(ms) })
}

// Bouton 🇬🇧/🇫🇷 pré-enregistré (bascule instantanée via news_i18n, sans IA).
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
// Échappe le texte IA puis convertit les **titres** en gras HTML (sûr : on
// échappe d'abord & < >, puis on injecte les balises depuis les marqueurs).
function toHtmlBold(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
}
// Retire d'éventuelles balises HTML (copie owner en texte brut).
function stripTags(s: string): string {
  return (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}
// Titres des news (**...**) pour l'anti-redondance.
function extractNewsTitles(s: string): string[] {
  const out: string[] = []; const re = /\*\*(.+?)\*\*/g; let m: RegExpExecArray | null
  while ((m = re.exec(s || '')) && out.length < 2) out.push(m[1].trim())
  return out
}
function esc(s: string): string { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

// -- News format STRUCTURÉ (1 seule news, la plus percutante) ----------------
// L'IA renvoie des MARQUEURS (jamais de HTML) → on génère EN et FR séparément
// puis on habille en HTML (titre / thème / 🚨 accroche / 📌 section / puces / 🐓 signature).
function racingNewsPrompt(sportLong: string, facts: string, lang: 'English' | 'French'): string {
  return [
    'You are Francis the rooster — a sharp but reliable ' + sportLong + ' reporter. Using ONLY the verified facts below, craft ONE clean, easy-to-read news item IN ' + lang.toUpperCase() + ' — the SINGLE most impactful story.',
    'FACTS:', '---', facts, '---',
    'Output EXACTLY these marker lines (nothing before or after, no title):',
    'THEME: <emoji> <1 to 3 word category, e.g. Driver Market, Contract, Injury, Team News, Controversy>',
    'HEAD: <ONE short, punchy headline sentence>',
    'SUMMARY: <exactly 1 to 2 SHORT sentences — the essential only. Keep it light and easy to read>',
    "INSIGHT: <1 to 2 SHORT punchy sentences — Francis' level-headed takeaway. NO hype, NO 'stay tuned'>",
    'RULES:',
    '- NO bullet points. Keep it tight and airy.',
    '- Base everything ONLY on the facts. NEVER invent names, teams, numbers or results.',
    '- Keep the markers EXACTLY: THEME:, HEAD:, SUMMARY:, INSIGHT:. Write the values in ' + lang.toUpperCase() + '.',
    '- If the facts are empty or NONE, output only: NONE',
    'Output ONLY the marker lines.',
  ].join(NL)
}
type RNews = { theme: string; head: string; summary: string; bullets: string[]; insight: string }
function parseRacingNews(s: string): RNews {
  const out: RNews = { theme: '', head: '', summary: '', bullets: [], insight: '' }
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
function buildRacingNews(sportShort: string, sportEmoji: string, lang: 'en' | 'fr', p: RNews): string {
  const sec = lang === 'fr' ? 'En bref' : 'In Brief'
  const sig = lang === 'fr' ? 'Le mot de Francis' : "Francis' Take"
  const parts: string[] = ['<b>' + esc(sportEmoji + ' ' + sportShort + ' Paddock Buzz') + '</b>']
  if (p.theme) parts.push('', '<b>' + esc(p.theme) + '</b>')
  if (p.head) parts.push('🚨 ' + esc(p.head))
  if (p.summary) parts.push('', '📌 <b>' + sec + '</b>', esc(p.summary))
  if (p.insight) parts.push('', '🐓 <b>' + sig + '</b>', esc(p.insight))
  return parts.join(NL)
}
// En-tête par rubrique. /we et /news ont un en-tête dédié ; le reste garde
// « <emoji> <Sport> — <hook> ». (news = HTML, gras/italique dans l'en-tête.)
function raceHeader(type: RType, lang: 'en' | 'fr', sportShort: string, sportEmoji: string): string {
  if (type === 'we') return sportEmoji + ' ' + sportShort + ' | ' + (lang === 'en' ? 'Next Race' : 'Prochaine course') + ' 🏁'
  if (type === 'news') return sportEmoji + ' <b>' + sportShort.toUpperCase() + ' PADDOCK BUZZ</b> 🏁' + NL
    + '🎙️ <i>' + (lang === 'en' ? 'Latest news &amp; rumors from the paddock' : 'Dernières infos &amp; rumeurs du paddock') + '</i>'
  return sportEmoji + ' ' + sportShort + ' — ' + (lang === 'en' ? HOOK_EN[type] : HOOK_FR[type])
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
  // 2 tours : 3.5 puis 3.1 ; si tout échoue (429/rate limit), pause ~7 s et on refait.
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const model of FORMAT_MODELS) {
      try {
        const res = await tfetch(geminiUrl(model), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 2048 } }),
        }, 25000)
        if (res.status === 429) { console.warn('racing formatCall 429 ' + model + ' (tour ' + (attempt + 1) + ')'); continue }
        if (!res.ok) { console.error('racing formatCall HTTP', res.status, model); continue }
        const out = extractText(await res.json())
        if (out) return out
      } catch (e) { console.error('racing formatCall exception', model, String(e)) }
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 7000))
  }
  return ''
}

// -- Config des commandes --------------------------------------
// type de rubrique -> prompt de recherche (EN) + consigne de mise en
// forme + hooks EN/FR. {S} = 'F1' ou 'MotoGP', {SPORT} = nom long.
type RType = 'essais' | 'qualifs' | 'qualifssprint' | 'sprint' | 'course' | 'we' | 'news' | 'constructeurs'

function searchPrompt(sportLong: string, type: RType, covered: string[] = []): string {
  const base = 'Use Google Search to find accurate, up-to-date facts. Report ONLY verified facts, in English, as raw notes (no styling). If you genuinely cannot find the information, reply with exactly: NONE.' + NL + NL
  const q: Record<RType, string> = {
    essais: 'Find the results and highlights of the most recent ' + sportLong + ' FREE PRACTICE sessions of the current or upcoming race weekend (usually held on Friday). Who was fastest, notable lap times, incidents, surprises, weather.',
    qualifs: 'Find the QUALIFYING results that set the grid for the MAIN Grand Prix (the standard qualifying, usually Saturday) of the most recent ' + sportLong + ' race weekend. Give the FULL qualifying classification in order (position, driver/rider name + team, and pole time or gaps), plus key highlights (surprises, crashes, penalties). Do NOT report the sprint qualifying/shootout here.',
    qualifssprint: 'Find the SPRINT QUALIFYING results (the session that sets the grid for the SPRINT race - in F1 called Sprint Shootout / Sprint Qualifying) of the most recent ' + sportLong + ' sprint race weekend. Give the FULL classification in order (position, driver/rider name + team, and time or gaps), plus key highlights. If this race weekend has NO sprint format, reply with exactly: NONE.',
    sprint: 'Find the results of the most recent ' + sportLong + ' SPRINT race. Give the winner, the podium, and the finishing order (top positions with name + team), plus key highlights and incidents.',
    course: 'Find the results of the most recent ' + sportLong + ' main RACE (Grand Prix). Give the winner, the podium, and the finishing order (top positions with name + team), plus key highlights and incidents.',
    we: 'TWO things about ' + sportLong + '. (1) The NEXT upcoming race weekend: the Grand Prix name and circuit/location (city, country), and the FULL session schedule for each day (practice, qualifying, sprint if any, race) with their start times, converted to UTC. (2) The CURRENT ' + sportLong + ' World Drivers/Riders Championship standings AS OF TODAY: the FULL classification IN ORDER with, for EACH entry, the position, the driver/rider FULL name (first + last), their team/constructor NAME, and their points total. Label this section STANDINGS and keep every position.',
    news: 'Find the SINGLE freshest and MOST IMPACTFUL ' + sportLong + ' paddock story from the LAST 48 HOURS (driver/rider move, contract, big team news, controversy, injury). Pick ONLY the one strongest story and report its verified facts: who, what, when, key numbers, why it matters.',
    constructeurs: 'Find the CURRENT ' + sportLong + " Constructors'/Manufacturers' Championship standings AS OF TODAY: the FULL classification IN ORDER with, for EACH constructor/team, the position, the constructor/team NAME, their points total, AND the names of that team's TWO regular race drivers/riders (for a manufacturer, its two leading works riders). Give each driver/rider as first-name INITIAL + last name. Label this STANDINGS and keep every position.",
  }
  let extra = ''
  if (type === 'news' && covered.length) {
    extra = NL + NL + 'ALREADY POSTED in the last few days — do NOT repeat these, find DIFFERENT and NEWER items:' + NL + covered.map((c) => '- ' + c).join(NL)
  }
  return base + q[type] + extra
}
// Anti-redondance /news : on garde les 10 derniers titres/sujets par sport.
function racingNewsSlot(isF1: boolean): string { return isF1 ? 'racing_f1_news' : 'racing_gp_news' }
async function fetchRecentRacingNews(isF1: boolean): Promise<string[]> {
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return []
  try {
    const res = await tfetch(url + '/rest/v1/daily_news_log?slot=eq.' + racingNewsSlot(isF1) + '&select=summary&order=created_at.desc&limit=10',
      { headers: { apikey: key, Authorization: 'Bearer ' + key } })
    if (!res.ok) return []
    const rows = await res.json()
    return (Array.isArray(rows) ? rows : []).map((r: any) => String((r && r.summary) || '')).filter(Boolean)
  } catch { return [] }
}
async function logRacingNews(isF1: boolean, summary: string): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key || !summary) return
  try {
    await tfetch(url + '/rest/v1/daily_news_log', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ day: new Date().toISOString().slice(0, 10), slot: racingNewsSlot(isF1), summary: summary.slice(0, 300) }),
    })
  } catch { /* best-effort */ }
}

function formatPrompt(lang: 'English' | 'French', sportShort: string, type: RType, facts: string): string {
  // Meme modele de classement pour F1 et MotoGP : pilote - ecurie - points.
  // (Telegram n'affiche pas de vrais logos dans un message texte.)
  const standingsFmt = '<rank emoji> <first-name initial>. <Last name>, <Team> - <points>p'
  // Les points doivent s'afficher en entiers : "208p" et jamais "208.00p".
  const task: Record<RType, string> = {
    essais: 'Write a punchy summary of the PRACTICE highlights. HARD LIMIT: 280 characters. Lead with the standout fact (fastest driver/rider + key moment). No standings.',
    qualifs: 'Write TWO blocks: (1) a short punchy preamble, MAX 280 CHARACTERS, with the key highlights and who took pole; then a blank line; then (2) the FULL qualifying classification, ONE line per position, each line STARTING with the position as keycap number emojis, like "1️⃣ Name (Team) - time/gap", then "2️⃣ ...", "3️⃣ ...". Use 🔟 for tenth; for positions above ten combine digit emojis (e.g. 1️⃣1️⃣, 1️⃣2️⃣). Never write "P1"/"P2".',
    qualifssprint: 'Write TWO blocks: (1) a short punchy preamble, MAX 280 CHARACTERS, with the key highlights and who took sprint pole; then a blank line; then (2) the FULL sprint qualifying classification, ONE line per position, each line STARTING with the position as keycap number emojis, like "1️⃣ Name (Team) - time/gap", then "2️⃣ ...". Use 🔟 for tenth; above ten combine digit emojis (e.g. 1️⃣1️⃣). Never write "P1"/"P2".',
    sprint: 'Write TWO blocks: (1) a short preamble, MAX 280 CHARACTERS, with the highlights and the winner; then a blank line; then (2) the finishing order, ONE line per position, each line STARTING with the position as keycap number emojis, like "1️⃣ Name (Team)", then "2️⃣ ...". Use 🔟 for tenth; above ten combine digit emojis (e.g. 1️⃣1️⃣). Never write "P1"/"P2".',
    course: 'Write TWO blocks: (1) a short preamble, MAX 280 CHARACTERS, with the race highlights and the winner; then a blank line; then (2) the finishing order, ONE line per position, each line STARTING with the position as keycap number emojis, like "1️⃣ Name (Team)", then "2️⃣ ...". Use 🔟 for tenth; above ten combine digit emojis (e.g. 1️⃣1️⃣). Never write "P1"/"P2".',
    we: 'Write the upcoming ' + sportShort + ' race weekend, THEN the current world standings. Plain text, follow this STRUCTURE EXACTLY: '
      + '(1) A line "📍 <circuit name> <country FLAG emoji>" (one space after the pin, e.g. "📍 Silverstone Circuit 🇬🇧"). '
      + '(2) The next line "🏆 <Grand Prix name>" (e.g. "🏆 Great Britain GP" / "🏆 GP de Grande-Bretagne"). '
      + '(3) A blank line. '
      + '(4) The schedule GROUPED BY DAY, in chronological order. For EACH day that has sessions: first a line "📅 <Weekday> • <day number> <Month>" (e.g. "📅 Friday • 9 August" / "📅 Vendredi • 9 août"), then directly below it ONE line per session formatted "🕐 <HH:MM> UTC — <Session name>" using 24-hour UTC times (e.g. "🕐 08:45 UTC — FP1"). IMPORTANT: the MAIN RACE session line (and only it) MUST start with "🏁" instead of "🕐" (e.g. "🏁 12:00 UTC — Race"). Separate each day block from the next with ONE blank line. '
      + '(5) A blank line, then a header line exactly "🏆 World Championship". '
      + '(6) Then the FULL current standings from the facts, ONE line per driver/rider IN ORDER, each line STARTING with the position as keycap number emojis (1️⃣ 2️⃣ 3️⃣ …, 🔟 for tenth, and combine digits above ten e.g. 1️⃣1️⃣, 1️⃣2️⃣), formatted EXACTLY like this: "' + standingsFmt + '". For the driver/rider name use ONLY the first-name INITIAL + "." + the FULL last name (e.g. "K. Antonelli", "L. Hamilton"). '
      + 'Keep the exact order, teams and points from the facts. Write the points as WHOLE INTEGERS with NO decimals and NO trailing ".0"/".00" (e.g. "208p", never "208.00p"; "87p", never "87.0p"). Shorten these team names: "Racing Bulls" -> "Racing B.", "Aston Martin" -> "Aston M.", "Red Bull" -> "Red B.". NO 280-character limit here.',
    news: 'Write EXACTLY the 2 freshest, most important paddock news items (MAXIMUM 2, never more). For EACH item write TWO lines: (line 1) ONE relevant emoji + a space + a SHORT punchy title wrapped in **double asterisks** (e.g. "🩹 **Bezzecchi back on track**"); (line 2) a 1 to 2 sentence factual paragraph. Separate the two items with ONE blank line. Do NOT use bullet points. Do NOT add any header or closing line (both are added automatically). Keep it factual. ~450 characters total.',
    constructeurs: "Write ONLY the constructors' standings, with NO preamble and NO extra text. ONE line per constructor IN ORDER, each line STARTING with the position as keycap number emojis (1️⃣ 2️⃣ 3️⃣ …, 🔟 for tenth, and combine digits above ten e.g. 1️⃣1️⃣), formatted EXACTLY like this: \"<rank emoji> <Constructor/Team> - <points>p | <Driver1> & <Driver2>\". Use the driver/rider first-name INITIAL + \".\" + full last name (e.g. \"1️⃣ McLaren - 512p | L. Norris & O. Piastri\"). Write the points as WHOLE INTEGERS with no decimals. Shorten these team names: \"Racing Bulls\" -> \"Racing B.\", \"Aston Martin\" -> \"Aston M.\", \"Red Bull\" -> \"Red B.\". Keep the exact order and points from the facts. NO 280-character limit.",
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
  constructeurs: "Constructors' Championship",
}
const HOOK_FR: Record<RType, string> = {
  essais: 'Essais : temps forts', qualifs: 'Qualifications', qualifssprint: 'Qualifs Sprint',
  sprint: 'Course Sprint', course: 'Course', we: 'Prochain week-end', news: 'Potins du paddock 🏁 :',
  constructeurs: 'Classement constructeurs',
}

// -- Telegram --------------------------------------------------
// Renvoie le message_id publie (0 si echec) pour pouvoir l'epingler.
async function post(token: string, chatId: number, text: string, threadId: number, replyMarkup?: any, html = false): Promise<number> {
  try {
    const body: any = { chat_id: chatId, text, disable_web_page_preview: true }
    if (threadId) body.message_thread_id = threadId
    if (html) body.parse_mode = 'HTML'
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
// Envoi d'une image PNG (classement) via sendPhoto (multipart). Best-effort.
async function sendPhotoBytes(token: string, chatId: number, png: Uint8Array, threadId: number, caption?: string, replyMarkup?: any): Promise<number> {
  try {
    const form = new FormData()
    form.append('chat_id', String(chatId))
    if (threadId) form.append('message_thread_id', String(threadId))
    form.append('photo', new Blob([png], { type: 'image/png' }), 'standings.png')
    if (caption) form.append('caption', caption)   // texte brut (comme les posts racing)
    if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup))
    const res = await tfetch('https://api.telegram.org/bot' + token + '/sendPhoto', { method: 'POST', body: form }, 20000)
    const data = await res.json()
    if (!data || !data.ok) { console.error('racing sendPhoto:', JSON.stringify(data).slice(0, 200)); return 0 }
    return Number(data.result && data.result.message_id) || 0
  } catch (e) { console.error('racing sendPhoto exception', String(e)); return 0 }
}
// Upload du PNG vers un bucket public (pour le bouton « Enreg. Classement »).
let bucketReady: Promise<void> | null = null
function ensureBucket(base: string, key: string): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      try {
        await tfetch(base + '/storage/v1/bucket', {
          method: 'POST', headers: { Authorization: 'Bearer ' + key, apikey: key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'classements', name: 'classements', public: true }),
        }, 10000)
      } catch (_) { /* existe déjà / ignore */ }
    })()
  }
  return bucketReady
}
async function uploadPng(png: Uint8Array): Promise<string> {
  const base = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!base || !key) return ''
  try {
    await ensureBucket(base, key)
    const path = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.png'
    const up = await tfetch(base + '/storage/v1/object/classements/' + path, {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, apikey: key, 'Content-Type': 'image/png', 'x-upsert': 'true' }, body: png,
    }, 15000)
    if (up.ok) return base + '/storage/v1/object/public/classements/' + path
    console.error('uploadPng', up.status, (await up.text()).slice(0, 140))
  } catch (e) { console.error('uploadPng exc', String(e)) }
  return ''
}
// DM au owner : le PNG du classement + 2 boutons côte à côte
// [📥 Enreg. Classement] (ouvre le PNG public → appui long = sauvegarde galerie)
// [📤 Publier sur X] (texte pré-rempli ; l'image s'ajoute manuellement).
async function ownerClassementDM(token: string, png: Uint8Array, caption: string, xText: string): Promise<void> {
  try {
    const url = await uploadPng(png)
    const publier = { text: '📤 Publier sur X', url: 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(xText) }
    const row = url ? [{ text: '📥 Enreg. Classement', url }, publier] : [publier]
    await sendPhotoBytes(token, OWNER_ID, png, 0, caption, { inline_keyboard: [row] })
  } catch (e) { console.error('ownerClassementDM', String(e)) }
}

// Sessions dont le classement s'affiche en PNG (et disparaît du texte).
const IMG_CFG: Partial<Record<RType, { kind: StKind; subtitle: string }>> = {
  we: { kind: 'we', subtitle: 'World Championship' },
  course: { kind: 'course', subtitle: 'Race classification' },
  sprint: { kind: 'course', subtitle: 'Sprint classification' },
  qualifs: { kind: 'course', subtitle: 'Qualifying' },
  qualifssprint: { kind: 'course', subtitle: 'Sprint qualifying' },
}
// Retire le bloc classement du texte (lignes en keycap + en-tête « 🏆 … »).
// Le classement ne vit plus que dans le PNG (langue-neutre, pas de traduction).
function stripStandings(text: string): string {
  const kept = (text || '').split(NL).filter((l) => {
    const t = l.trim()
    if (isStandingLine(l)) return false
    // On retire l'en-tête du classement (mais PAS la ligne « 🏆 <Nom du GP> »).
    if (/world championship/i.test(t) || /championnat du monde/i.test(t)) return false
    return true
  })
  return kept.join(NL).replace(/\n{3,}/g, NL + NL).trim()
}
// /F1constructeurs /GPconstructeurs : classement constructeurs en PNG UNIQUEMENT.
// Posté sur Cocorico Racing + DM au owner avec boutons Enreg./Publier sur X.
async function runConstructors(token: string, isF1: boolean, sportShort: string, sportEmoji: string): Promise<void> {
  const sportLong = isF1 ? 'Formula 1' : 'MotoGP'
  const facts = await groundedSearch(searchPrompt(sportLong, 'constructeurs'))
  if (!facts || facts.toUpperCase().indexOf('NONE') === 0) {
    await dmOwner(token, '🏆 Classement constructeurs ' + sportShort + ' : aucune donnée trouvée pour le moment. Réessaie plus tard.')
    return
  }
  const list = shortenTeams(await formatCall(formatPrompt('English', sportShort, 'constructeurs', facts)))
  if (!list || list.toUpperCase().indexOf('NONE') === 0) {
    await dmOwner(token, '🏆 Classement constructeurs ' + sportShort + ' : mise en forme impossible (réessaie).')
    return
  }
  const png = await renderStandingsPng(list, 'constructors', isF1, sportShort, "Constructors' Championship")
  if (!png || png.length === 0) {
    await dmOwner(token, '🏆 Classement constructeurs ' + sportShort + ' : image indisponible pour le moment (réessaie).')
    return
  }
  const caption = sportEmoji + ' ' + sportShort + ' — Classement constructeurs 🏆'
  // 1) Cocorico Racing : le PNG (image uniquement, avec un titre en légende).
  await sendPhotoBytes(token, COOP_CHAT_ID, png, racingThread(isF1), caption)
  // 2) DM owner : le même PNG + [📥 Enreg. Classement | 📤 Publier sur X].
  const tag = isF1 ? '#F1 #Formula1' : '#MotoGP'
  const xText = sportEmoji + ' ' + sportShort + " Constructors' Championship 🏁" + NL + NL + tag
  await ownerClassementDM(token, png, caption, xText)
}

// Raccourcit les noms d'écuries trop longs (garanti, en plus de la consigne IA).
function shortenTeams(s: string): string {
  return (s || '').split('Racing Bulls').join('Racing B.').split('Aston Martin').join('Aston M.').split('Red Bull').join('Red B.')
    // Points en entiers : "208.00p" / "87.0 p" -> "208p" / "87p".
    .replace(/(\d+)\.\d+(\s*p\b)/g, '$1$2')
}

// -- Coeur : recherche + EN + FR + publication -----------------
async function runCommand(token: string, command: string): Promise<void> {
  const isF1 = command.startsWith('f1')
  const sportShort = isF1 ? 'F1' : 'MotoGP'
  const sportLong = isF1 ? 'Formula 1' : 'MotoGP'
  const sportEmoji = isF1 ? '🏎️' : '🏍️'   // petite F1 / petite moto en tete du titre
  const type = command.replace('f1', '').replace('gp', '') as RType

  // Classement constructeurs : flux dédié (PNG only + DM owner « Publier sur X »).
  if (type === 'constructeurs') { await runConstructors(token, isF1, sportShort, sportEmoji); return }

  // /news : on récupère les 10 derniers sujets déjà postés pour éviter la redite.
  const coveredNews = type === 'news' ? await fetchRecentRacingNews(isF1) : []
  const facts = await groundedSearch(searchPrompt(sportLong, type, coveredNews))
  if (!facts || facts.toUpperCase().indexOf('NONE') === 0) {
    await dmOwner(token, '🏁 /' + command + ' : aucune info trouvee pour le moment (course pas encore courue ou pas de donnees). Reessaie plus tard.')
    return
  }

  // /news : UNE seule news, format STRUCTURÉ (EN défaut + bouton 🇫🇷). Anti-redite 10.
  if (type === 'news') {
    const enS = await formatCall(racingNewsPrompt(sportLong, facts, 'English'))   // séquentiel (évite les 429 en rafale)
    const frS = await formatCall(racingNewsPrompt(sportLong, facts, 'French'))
    const enP = parseRacingNews(enS)
    const frP = parseRacingNews(frS)
    if (!enP.head && !enP.summary && !frP.head && !frP.summary) {
      await dmOwner(token, '🏁 /' + command + ' : mise en forme impossible (reessaie).')
      return
    }
    const enData = (enP.head || enP.summary) ? enP : frP
    const frData = (frP.head || frP.summary) ? frP : enP
    const enMsg = buildRacingNews(sportShort, sportEmoji, 'en', enData)
    const frMsg = buildRacingNews(sportShort, sportEmoji, 'fr', frData)
    const idEn = await post(token, COOP_CHAT_ID, enMsg, racingThread(isF1), NLANG_BTN, true)
    if (idEn) await storeI18n(COOP_CHAT_ID, idEn, enMsg, frMsg, true)
    await dmOwnerCopy(token, stripTags(enMsg))
    await logRacingNews(isF1, (enData.theme ? enData.theme + ' — ' : '') + enData.head)
    return
  }

  // Le programme du week-end (/F1we /GPwe) est epingle dans chaque groupe.
  const doPin = type === 'we'
  // (L'en-tête /we et /news est géré par raceHeader ; plus de suffixe manuel.)
  // Une ligne vide entre l'en-tête et le corps pour toutes les rubriques.
  const headSep = NL + NL

  // The Chicken Coop (Cocorico Racing, 1631) : EN par défaut + bouton 🇬🇧/🇫🇷.
  // Poulailler supprimé : la version FR reste accessible via le bouton.
  const enFull = shortenTeams(await formatCall(formatPrompt('English', sportShort, type, facts)))
  const frFull = shortenTeams(await formatCall(formatPrompt('French', sportShort, type, facts)))
  const enOk = enFull && enFull.toUpperCase().indexOf('NONE') !== 0
  const frOk = frFull && frFull.toUpperCase().indexOf('NONE') !== 0
  // Pour les sessions à classement : le classement sort du texte (il ne vit plus
  // qu'en PNG) ; on ne garde que le préambule. Sinon on affiche le texte tel quel.
  const cfg = IMG_CFG[type]
  const enDisp = cfg ? stripStandings(enFull) : enFull
  const frDisp = cfg ? stripStandings(frFull) : frFull
  if (enOk) {
    // /news : HTML (titres en gras) + phrase de clôture ; sinon texte brut.
    const useHtml = type === 'news'
    const clEn = useHtml ? (NL + NL + '🏁 More paddock updates coming soon...') : ''
    const clFr = useHtml ? (NL + NL + "🏁 D'autres infos du paddock arrivent bientôt...") : ''
    const enBody = useHtml ? toHtmlBold(enDisp) : enDisp
    const frBody = useHtml ? toHtmlBold(frDisp) : frDisp
    const enMsg = raceHeader(type, 'en', sportShort, sportEmoji) + headSep + enBody + clEn
    const frMsg = raceHeader(type, 'fr', sportShort, sportEmoji) + headSep + frBody + clFr
    // Rendu du classement en PNG (le cas échéant).
    const png = cfg ? await renderStandingsPng(enFull, cfg.kind, isF1, sportShort, cfg.subtitle) : null
    if (png && png.length > 0 && enMsg.length <= 1000) {
      // POST UNIQUE : image + préambule en légende + bouton FR ; épinglé si /we.
      // (Le classement ne vit qu'en PNG ; la légende porte le préambule + toggle.)
      const idEn = await sendPhotoBytes(token, COOP_CHAT_ID, png, racingThread(isF1), enMsg, NLANG_BTN)
      if (doPin) await pinMessage(token, COOP_CHAT_ID, idEn)
      if (idEn) await storeI18n(COOP_CHAT_ID, idEn, enMsg, frOk ? frMsg : enMsg)
      // DM owner : PNG + [📥 Enreg. Classement | 📤 Publier sur X].
      await ownerClassementDM(token, png, enMsg, enMsg)
    } else {
      // Repli / texte seul (dont /news). HTML pour /news, épinglé si /we.
      const idEn = await post(token, COOP_CHAT_ID, enMsg, racingThread(isF1), NLANG_BTN, useHtml)
      if (doPin) await pinMessage(token, COOP_CHAT_ID, idEn)
      if (idEn) await storeI18n(COOP_CHAT_ID, idEn, enMsg, frOk ? frMsg : enMsg, useHtml)
      if (png && png.length > 0) { await sendPhotoBytes(token, COOP_CHAT_ID, png, racingThread(isF1)); await ownerClassementDM(token, png, enMsg, enMsg) }
      else await dmOwnerCopy(token, useHtml ? stripTags(enMsg) : enMsg)
    }
    // /news : on journalise les titres pour l'anti-redondance (4 derniers).
    if (type === 'news') { for (const t of extractNewsTitles(enFull)) await logRacingNews(isF1, t) }
  } else { console.error('racing[' + command + '] EN vide/NONE') }

  if (!enOk && !frOk) {
    await dmOwner(token, '🏁 /' + command + ' : mise en forme impossible (reessaie).')
  }
}

// -- Point d'entree --------------------------------------------
const VALID = new Set([
  'f1essais', 'gpessais',
  'f1qualifs', 'gpqualifs', 'f1qualifssprint', 'gpqualifssprint',
  'f1sprint', 'gpsprint', 'f1course', 'gpcourse',
  'f1we', 'gpwe', 'f1news', 'gpnews',
  'f1constructeurs', 'gpconstructeurs',
])

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('forbidden', { status: 403 })
  const token = Deno.env.get('BOT_TOKEN')
  if (!token) return new Response('missing config', { status: 500 })

  let command = ''
  let dryRun = false
  let imgProbe = false
  let probeEn = ''
  let modelPing = ''
  let genTest: any = null
  try {
    const body = await req.json()
    command = String((body && body.command) || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    if (body && body.dryRun === true) dryRun = true
    if (body && body.imgProbe === true) { imgProbe = true; probeEn = String((body && body.en) || '') }
    if (body && body.modelPing) modelPing = String(body.modelPing)
    if (body && body.genTest) genTest = body.genTest
  } catch { /* corps invalide */ }

  // Diagnostic : vérifie qu'un ID de modèle Gemini répond bien (200 vs 404).
  if (modelPing) {
    try {
      const res = await tfetch(geminiUrl(modelPing), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 1 } }),
      }, 20000)
      return new Response(JSON.stringify({ model: modelPing, status: res.status, ok: res.ok }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    } catch (e) { return new Response(JSON.stringify({ model: modelPing, error: String(e) }), { status: 200, headers: { 'Content-Type': 'application/json' } }) }
  }

  // Diagnostic génération : teste un prompt sur un modèle, renvoie finishReason +
  // longueur + tête/queue du texte. thinkingBudget optionnel (pour tester si on
  // peut désactiver le "thinking" qui tronque parfois la sortie).
  if (genTest && genTest.model && genTest.prompt) {
    try {
      const gc: any = { temperature: 0.3 }
      if (genTest.maxOutputTokens !== 'none') gc.maxOutputTokens = genTest.maxOutputTokens || 2048
      if (genTest.thinkingBudget !== undefined) gc.thinkingConfig = { thinkingBudget: genTest.thinkingBudget }
      const res = await tfetch(geminiUrl(genTest.model), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: genTest.prompt }] }], generationConfig: gc }),
      }, 30000)
      const raw = await res.text()
      let out = ''; let finish = ''
      try { const d = JSON.parse(raw); const c = d?.candidates?.[0]; finish = c?.finishReason || ''; out = (c?.content?.parts || []).map((p: any) => p?.text || '').join('') } catch { /* raw */ }
      return new Response(JSON.stringify({ status: res.status, finishReason: finish, len: out.length, head: out.slice(0, 160), tail: out.slice(-160), rawHead: res.ok ? '' : raw.slice(0, 300) }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
    } catch (e) { return new Response(JSON.stringify({ error: String(e) }), { status: 200, headers: { 'Content-Type': 'application/json' } }) }
  }

  // Probe image : rend le PNG à partir d'un texte EN fourni (0 appel Gemini)
  // et renvoie un diagnostic. Sert à valider le rendu sans publier.
  if (imgProbe) {
    const isF1 = command.startsWith('f1')
    const sportShort = isF1 ? 'F1' : 'MotoGP'
    const type = (command.replace('f1', '').replace('gp', '') || 'we') as RType
    const kind: StKind = type === 'constructeurs' ? 'constructors' : (type === 'course' ? 'course' : 'we')
    const subtitle = kind === 'we' ? 'World Championship' : kind === 'constructors' ? "Constructors' Championship" : 'Race classification'
    const rows = parseStandings(probeEn, kind)
    const png = await renderStandingsPng(probeEn, kind, isF1, sportShort, subtitle)
    const url = png ? await uploadPng(png) : ''
    const faces = await fontCount()
    return new Response(JSON.stringify({ isF1, kind, rowsParsed: rows.length, pngBytes: png ? png.length : 0, fontFaces: faces, url }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  if (!VALID.has(command)) return new Response(JSON.stringify({ error: 'unknown command', command }), { status: 400, headers: { 'Content-Type': 'application/json' } })

  if (dryRun) {
    const isF1 = command.startsWith('f1')
    const sportLong = isF1 ? 'Formula 1' : 'MotoGP'
    const sportShort = isF1 ? 'F1' : 'MotoGP'
    const type = command.replace('f1', '').replace('gp', '') as RType
    const facts = await groundedSearch(searchPrompt(sportLong, type))
    const en = facts ? shortenTeams(await formatCall(formatPrompt('English', sportShort, type, facts))) : ''
    const fr = facts ? shortenTeams(await formatCall(formatPrompt('French', sportShort, type, facts))) : ''
    return new Response(JSON.stringify({ command, factsLen: facts.length, en, fr }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const bg = runCommand(token, command).catch((e) => console.error('racing bg exception', String(e)))
  ;(globalThis as any).EdgeRuntime?.waitUntil?.(bg)
  return new Response('accepted', { status: 202 })
})
