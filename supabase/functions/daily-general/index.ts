// ================================================================
//  daily-general - messages "fun" de Francis le coq (Telegram).
//
//  Brique ISOLEE : si elle plante, Crypto/World/Hot/bot continuent.
//  Deux creneaux, corps {"kind":"..."} :
//    * gm_joke  07:30 Paris  -> GM du coq, registre alterne chaque jour :
//                               basse-cour / jeux / ecosysteme $FRANC
//    * gn       20:15 Paris  -> GN du coq, message leger & fun
//
//  Chaque message est genere NATIVEMENT dans chaque langue (pas une
//  traduction) pour que la blague reste drole : gemini-3.5-flash-lite (repli 3.1)
//  (500 RPD, pas de grounding = tres peu de quota).
//
//  Diffusion : dans LES DEUX groupes, topic "General" (sans thread) :
//    The Chicken Coop (General), EN + bouton « Translate in French ».
//
//  Securite : header x-cron-secret == CRON_SECRET.
// ================================================================

const NL = String.fromCharCode(10)

// Génération/mise en forme : Gemini 3.5 Flash-Lite, repli 3.1 Flash-Lite si quota.
const FORMAT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']

function geminiUrl(model: string): string {
  const key = Deno.env.get('GEMINI_API_KEY') || ''
  return 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + key
}

async function tfetch(input: string, init: RequestInit = {}, ms = 10000): Promise<Response> {
  return await globalThis.fetch(input, { ...init, signal: AbortSignal.timeout(ms) })
}

function extractText(data: any): string {
  const cand = data && data.candidates ? data.candidates[0] : null
  const parts = cand && cand.content && cand.content.parts ? cand.content.parts : []
  return parts.map((p: any) => (p && p.text) ? p.text : '').join('').trim()
}

// Un appel de generation (temperature elevee pour varier chaque jour).
async function generate(prompt: string): Promise<string> {
  for (const model of FORMAT_MODELS) {
    try {
      const res = await tfetch(geminiUrl(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 1.0 } }),
      }, 20000)
      if (res.status === 429) { console.warn('daily-general generate 429 ' + model); continue }
      if (!res.ok) { console.error('daily-general generate HTTP', res.status, model); continue }
      const out = extractText(await res.json())
      if (out) return out
    } catch (e) { console.error('daily-general generate exception', model, String(e)) }
  }
  return ''
}

// -- Prompts par langue ----------------------------------------
// Le GM du matin ALTERNE sur 3 registres (rotation quotidienne, fuseau Paris),
// pour ne plus faire une blague basse-cour tous les jours :
//   farmyard  -> blague/jeu de mots basse-cour (l'historique)
//   games     -> blague sur les jeux OU invitation a lancer une partie pour se detendre
//   ecosystem -> petit mot chaleureux sur l'ecosysteme/communaute $FRANC (jamais de prix)
type GmTheme = 'farmyard' | 'games' | 'ecosystem'
function pickGmTheme(): GmTheme {
  const parisDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
  const dayNum = Math.floor(Date.parse(parisDay + 'T00:00:00Z') / 86400000)
  const themes: GmTheme[] = ['farmyard', 'games', 'ecosystem']
  return themes[((dayNum % 3) + 3) % 3]
}

function gmPrompt(lang: 'English' | 'French', theme: GmTheme): string {
  const themeLine =
    theme === 'games'
      ? 'THEME TODAY — GAMES: either a light, clean joke/pun about gaming, OR a friendly nudge to play one of the community mini-games to relax or pass the time (e.g. "stuck on your commute? sneak in a quick game to kill time"). Playful, never pushy.'
      : theme === 'ecosystem'
      ? 'THEME TODAY — $FRANC ECOSYSTEM: a short, upbeat word about the $FRANC community & universe (the rooster world, the free mini-games, being part of the coop, the good vibes). Warm and encouraging. ABSOLUTELY NO price talk, no numbers, no "moon/pump", no financial advice — only community spirit.'
      : 'THEME TODAY — FARMYARD: include ONE original, clean farmyard / rooster / hen JOKE or pun (light and funny, family-friendly).'
  return [
    'You are Francis, a witty rooster mascot of a friendly crypto community on Telegram.',
    'Write a short, warm GOOD MORNING message for the group, IN ' + lang.toUpperCase() + '.',
    themeLine,
    'RULES:',
    '- 2 to 4 short lines, MAX 320 characters total.',
    '- Playful and cheerful. 1 to 3 emojis maximum.',
    '- No hashtags, no links. No price talk, no financial advice, never say "moon/pump".',
    '- Output ONLY the message, nothing else.',
  ].join(NL)
}

function gnPrompt(lang: 'English' | 'French'): string {
  return [
    'You are Francis, a witty rooster mascot of a friendly crypto community on Telegram.',
    'Write a short, light and FUN GOOD NIGHT message for the group, IN ' + lang.toUpperCase() + '.',
    'RULES:',
    '- 2 to 3 short lines, MAX 300 characters total.',
    '- Cozy, warm, a touch of humor (a little rooster/hen wink is welcome).',
    '- 1 to 3 emojis maximum. No hashtags, no links, no financial talk.',
    '- Output ONLY the message, nothing else.',
  ].join(NL)
}

// -- Telegram (topic General = pas de message_thread_id) -------
async function postToGroup(token: string, chatId: number, text: string): Promise<void> {
  try {
    const res = await tfetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    })
    if (!res.ok) console.error('daily-general postToGroup HTTP', res.status, (await res.text()).slice(0, 160))
  } catch (e) { console.error('daily-general postToGroup exception', String(e)) }
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
// Poste (texte seul) dans la langue par défaut du groupe + bouton, et
// pré-enregistre les DEUX versions pour la bascule instantanée.
async function postI18n(token: string, chatId: number, defaultLang: 'en' | 'fr', en: string, fr: string): Promise<void> {
  const text = (defaultLang === 'fr') ? fr : en
  let messageId = 0
  try {
    const r = await tfetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true, reply_markup: NLANG_BTN }),
    })
    const d = await r.json(); if (d && d.ok) messageId = Number(d.result?.message_id) || 0
  } catch (e) { console.error('postI18n text', String(e)) }
  await storeI18n(chatId, messageId, en, fr)
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

// -- Point d'entree --------------------------------------------
Deno.serve(async (req: Request) => {
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('forbidden', { status: 403 })

  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  const botToken = Deno.env.get('BOT_TOKEN')
  const enChatId = Number(Deno.env.get('FACT_CHAT_ID') ?? '-1003842240104') // The Chicken Coop
  if (!geminiKey || !botToken) return new Response('missing config', { status: 500 })

  let kind: 'gm_joke' | 'gn' = 'gm_joke'
  let dryRun = false
  try {
    const body = await req.json()
    if (body && body.kind === 'gn') kind = 'gn'
    else if (body && body.kind === 'gm_joke') kind = 'gm_joke'
    if (body && body.dryRun === true) dryRun = true
  } catch { /* corps vide -> gm_joke */ }

  const gmTheme = pickGmTheme()   // meme registre pour EN et FR le meme jour
  const promptFor = (lang: 'English' | 'French') => (kind === 'gn') ? gnPrompt(lang) : gmPrompt(lang, gmTheme)

  if (dryRun) {
    const en = await generate(promptFor('English'))
    const fr = await generate(promptFor('French'))
    return new Response(JSON.stringify({ kind, en, fr }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const bg = (async () => {
    try {
      // Les deux versions sont générées avant de poster (bascule pré-enregistrée).
      const en = await generate(promptFor('English'))
      const fr = await generate(promptFor('French'))
      const enText = en || fr, frText = fr || en
      // EN (défaut) -> The Chicken Coop (General), bouton 🇬🇧/🇫🇷 pré-enregistré.
      // Poulailler supprimé : plus d'envoi FR séparé (FR via le bouton du Coop).
      if (enText) await postI18n(botToken, enChatId, 'en', enText, frText)
      else console.error('daily-general[' + kind + '] EN/FR vides')
      await markSent(kind === 'gn' ? 'franc-gn' : 'franc-gm-joke')
      console.log('daily-general[' + kind + '] poste')
    } catch (e) { console.error('daily-general[' + kind + '] bg exception', String(e)) }
  })()
  ;(globalThis as any).EdgeRuntime?.waitUntil?.(bg)
  return new Response('accepted', { status: 202 })
})
