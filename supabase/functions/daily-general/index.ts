// ================================================================
//  daily-general - messages "fun" de Francis le coq (Telegram).
//
//  Brique ISOLEE : si elle plante, Crypto/World/Hot/bot continuent.
//  Deux creneaux, corps {"kind":"..."} :
//    * gm_joke  07:30 Paris  -> GM du coq + blague de basse-cour
//    * gn       20:15 Paris  -> GN du coq, message leger & fun
//
//  Chaque message est genere NATIVEMENT dans chaque langue (pas une
//  traduction) pour que la blague reste drole : gemini-3.1-flash-lite
//  (500 RPD, pas de grounding = tres peu de quota).
//
//  Diffusion : dans LES DEUX groupes, topic "General" (sans thread) :
//    EN -> The Chicken Coop   FR -> Le Poulailler
//
//  Securite : header x-cron-secret == CRON_SECRET.
// ================================================================

const NL = String.fromCharCode(10)

const FORMAT_MODEL = 'gemini-3.1-flash-lite'
const FR_CHAT_ID = -1004352289820   // Le Poulailler (francophone)

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
  try {
    const res = await tfetch(geminiUrl(FORMAT_MODEL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 1.0 } }),
    }, 20000)
    if (!res.ok) { console.error('daily-general generate HTTP', res.status); return '' }
    return extractText(await res.json())
  } catch (e) { console.error('daily-general generate exception', String(e)); return '' }
}

// -- Prompts par langue ----------------------------------------
function gmPrompt(lang: 'English' | 'French'): string {
  return [
    'You are Francis, a witty rooster mascot of a friendly crypto community on Telegram.',
    'Write a short, warm GOOD MORNING message for the group, IN ' + lang.toUpperCase() + '.',
    'It MUST include ONE original, clean farmyard / rooster / hen JOKE or pun (light and funny, family-friendly).',
    'RULES:',
    '- 2 to 4 short lines, MAX 320 characters total.',
    '- Playful and cheerful. 1 to 3 emojis maximum.',
    '- No hashtags, no links, no financial talk, no "$FRANC" price talk.',
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

  const promptFor = (lang: 'English' | 'French') => (kind === 'gn') ? gnPrompt(lang) : gmPrompt(lang)

  if (dryRun) {
    const en = await generate(promptFor('English'))
    const fr = await generate(promptFor('French'))
    return new Response(JSON.stringify({ kind, en, fr }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const bg = (async () => {
    try {
      // EN -> The Chicken Coop (General)
      const en = await generate(promptFor('English'))
      if (en) await postToGroup(botToken, enChatId, en)
      else console.error('daily-general[' + kind + '] EN vide')
      // FR -> Le Poulailler (General)
      const fr = await generate(promptFor('French'))
      if (fr) await postToGroup(botToken, FR_CHAT_ID, fr)
      else console.error('daily-general[' + kind + '] FR vide')
      await markSent(kind === 'gn' ? 'franc-gn' : 'franc-gm-joke')
      console.log('daily-general[' + kind + '] poste')
    } catch (e) { console.error('daily-general[' + kind + '] bg exception', String(e)) }
  })()
  ;(globalThis as any).EdgeRuntime?.waitUntil?.(bg)
  return new Response('accepted', { status: 202 })
})
