// ================================================================
//  daily-fact-dyk - le "Did you know?" quotidien de Francis le coq.
//  Brique ISOLEE du decoupage daily-fact.
//
//  PAS de source externe : message creatif genere par Gemini
//  (gemini-3.5-flash, repli gemini-3.1-flash-lite ; PAS de grounding).
//  Rotation cote serveur d'un ANGLE + un SUJET pour varier chaque jour.
//
//  Creneau (pg_cron, corps {}):  08:30 UTC.
//  Diffusion : rubrique phare visible de TOUS -> General (racine du
//  forum, pas de thread) des DEUX groupes. EN puis traduction FR.
//  Limite : 280 caracteres.
//
//  Securite : header x-cron-secret == CRON_SECRET.
// ================================================================

const NL = String.fromCharCode(10)
const GEN_MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite']
const FR_CHAT_ID = -1004352289820

const DID_YOU_KNOW_PROMPT = `You write ONE short, punchy "Did you know?" message for the Telegram community of $FRANC, a fun community memecoin built around Francis the rooster. You have lots of freedom in the HOOK (how you start) - BUT every single message MUST end on a clever, NATURAL link to $FRANC or the $FRANC universe. That tie-in is the whole point: an interesting fact that does NOT connect back to $FRANC is a FAILURE.

ABOUT $FRANC (stay accurate, invent nothing about $FRANC itself):
- A community memecoin built around Francis the rooster - a whole fun "rooster universe".
- Real content: a growing collection of in-app mini-games - the flagship Tamagotchi (you raise Francis the rooster and can even chat with him via Telegram), plus EggClicker, FrancRun, Sudoku, Mastermind, Motus, Ormuz, more coming.
- Lives on two chains: Solana and TON (runs right inside Telegram).
- All the mini-games are FREE to play, right inside Telegram. (Holding a little $FRANC unlocks some EXTRA features, but you NEVER need $FRANC just to play.)

GAME MENTION RULE (IMPORTANT):
- When you mention a game (based on today's topic), make it clear it is FREE and that it's playable on Telegram. NEVER say or imply that you need $FRANC to play — that is wrong. Do NOT bring up the holder/unlock detail; simply invite people to enjoy the free game on Telegram.

NUMBERS & DATES:
- You MAY use dates, figures, or fun stats about REAL-WORLD topics to make it richer and more credible.
- BUT never invent numbers about $FRANC itself (no made-up price, supply, holder count, sales, or dates). For $FRANC, stay qualitative.
- If you are not reasonably sure of a real-world figure, keep it vague ("decades ago", "a global hit") rather than stating a precise wrong number.

HOW TO WRITE IT:
- Tone: proud, warm, a little cheeky - Francis the rooster voice. Informative but fun, never corporate.
- Structure: an interesting hook (the fact), a smooth bridge, land on $FRANC / Francis in a positive way.
- Length: 2 to 3 lively sentences, 280 CHARACTERS MAXIMUM (hard limit). At most ONE rooster emoji.
- English only. Start with "Did you know?" (or a tight variant).

STRICT RULES:
- Never invent facts or numbers about $FRANC itself. Real-world figures are okay but keep them plausible; when unsure, stay vague.
- Never promise gains, never give price predictions or financial advice, never say "moon/pump/100x".
- Never name, compare to, or bash other coins/projects/communities.
- Keep it appropriate for a public, mixed-audience group.

Output ONLY the message text, nothing else.`

const FACT_ANGLES = [
  "Take a real-world fact about the ORIGIN/HISTORY of a game genre, then bridge to the Francis version.",
  'Take a fun fact about a classic game (board/word/arcade/puzzle), then "Francis brings it to the coop / modernized it".',
  "Take a rooster / barnyard / nature fact, then a playful bridge to Francis and the coop.",
  "Take a fact about the GALLIC ROOSTER (le coq gaulois), France national symbol and its history, then bridge to Francis the rooster and $FRANC.",
  "Take a general crypto or tech fact, then bridge to why the $FRANC two-chain (Solana + TON) + in-Telegram approach is cool.",
  'Skip the outside fact: spotlight the "$FRANC universe" directly - a game we built, a $FRANC Telegram feature, the community, or the sheer VARIETY of games.',
]
const FACT_TOPICS = [
  'the Tamagotchi where you raise Francis and chat with him on Telegram',
  'EggClicker',
  'FrancRun',
  'Sudoku in the coop',
  'Mastermind in the coop',
  'Motus (the word-guessing game) in the coop',
  'Ormuz in the coop',
  'the fact that $FRANC lives on BOTH Solana and TON',
  'the fact that everything runs right inside Telegram',
  'the whole variety of mini-games as a collection (do NOT center on a single game)',
  'the Francis-the-rooster universe and community vibe',
  'roosters / barnyard / dawn nature facts bridged to Francis',
  'the Gallic rooster (le coq gaulois), national symbol of France, tied to Francis',
  'a specific $FRANC Telegram feature (chatting with Francis, or the fact every mini-game is free to play right inside Telegram)',
]

function pick<T>(arr: T[]): T {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return arr[buf[0] % arr.length]
}
function buildFactPrompt(): string {
  const angle = pick(FACT_ANGLES)
  const topic = pick(FACT_TOPICS)
  return DID_YOU_KNOW_PROMPT + NL + NL +
    'FOR THIS MESSAGE ONLY (rotate every time - do NOT default to EggClicker or repeat yesterday):' + NL +
    '- Use this ANGLE: ' + angle + NL +
    '- If you mention a specific $FRANC game or feature, center it on: ' + topic + NL +
    '- MANDATORY: whatever the angle, finish on a clever, NATURAL link to $FRANC or the $FRANC universe.' + NL +
    '- Make it feel fresh and different from a typical message.'
}

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
  return parts.map((p: any) => (p && p.text) ? p.text : '').join(' ').trim()
}

async function generateFact(): Promise<{ ok: boolean; text: string; reason: string }> {
  const prompt = buildFactPrompt()
  let lastReason = 'aucune reponse'
  for (const model of GEN_MODELS) {
    try {
      const res = await tfetch(geminiUrl(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 1.1 } }),
      }, 30000)
      if (!res.ok) { lastReason = 'HTTP ' + res.status + ' (' + model + ')'; console.error('generateFact', lastReason); continue }
      const out = extractText(await res.json())
      if (out) return { ok: true, text: out, reason: '' }
      lastReason = 'reponse vide (' + model + ')'
    } catch (e) { lastReason = 'exception: ' + String(e); console.error('generateFact', lastReason) }
  }
  return { ok: false, text: '', reason: lastReason }
}

async function translateToFrench(text: string): Promise<string> {
  const prompt = [
    'Translate the following Telegram message into natural, fluent FRENCH for a French-speaking community.',
    'RULES:',
    '- Keep ALL emojis exactly where they are, and keep the same line breaks / layout.',
    '- Do NOT translate or alter: "$FRANC", ticker symbols, numbers, %, prices, URLs, coin/person/product/game names.',
    '- "Did you know?" -> "Le saviez-vous ?".',
    '- Natural French, no robotic tone. Output ONLY the translated message, nothing else.',
    '',
    'MESSAGE:',
    text,
  ].join(NL)
  try {
    const res = await tfetch(geminiUrl('gemini-3.1-flash-lite'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3 } }),
    }, 25000)
    if (!res.ok) { console.error('translateToFrench HTTP', res.status); return '' }
    return extractText(await res.json())
  } catch (e) { console.error('translateToFrench exception', String(e)); return '' }
}

// -- Telegram + bandeau ----------------------------------------
const IMG_BASE = 'https://mubqtnqulpyehkgubhnh.supabase.co/storage/v1/object/public/assets/'
function imageUrl(): string {
  const v = new Date().toISOString().slice(0, 10)
  return IMG_BASE + encodeURIComponent('Did you know.png') + '?v=' + v
}
async function postToGroup(token: string, chatId: number, text: string): Promise<void> {
  const res = await tfetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  })
  if (!res.ok) console.error('postToGroup HTTP', res.status, (await res.text()).slice(0, 160))
}
async function postPhoto(token: string, chatId: number, photoUrl: string, caption: string): Promise<boolean> {
  try {
    const res = await tfetch('https://api.telegram.org/bot' + token + '/sendPhoto', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption }),
    })
    const data = await res.json()
    if (!data || !data.ok) { console.error('postPhoto:', JSON.stringify(data).slice(0, 160)); return false }
    return true
  } catch (e) { console.error('postPhoto exception', String(e)); return false }
}
async function sendWithBanner(token: string, chatId: number, text: string): Promise<void> {
  const ok = await postPhoto(token, chatId, imageUrl(), text)
  if (!ok) await postToGroup(token, chatId, text)
}

// Copie owner (pour X) : message EN + CTA "rejoins le poulailler".
const OWNER_DM_ID = 6593812300
const CTA_CRYPTO = "⚡ Don't miss any crypto news." + NL + "🐔 Join the Chicken Coop :" + NL + "👉 T.me/LeCoqFrancis"
// Boutons sous la copie owner : 📋 Copier (copy_text natif, si <=256 car) +
// 📤 Publier sur X (ouvre X avec le texte deja pre-rempli).
function xShareKeyboard(fullText: string) {
  const xBtn = { text: '📤 Publier sur X', url: 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(fullText) }
  const row = (fullText.length <= 256)
    ? [{ text: '📋 Copier', copy_text: { text: fullText } }, xBtn]
    : [xBtn]
  return { inline_keyboard: [row] }
}
// Avec imgUrl : PHOTO + légende (l'owner a l'image pour l'attacher sur X ;
// X ne permet pas de pré-attacher un média via le bouton). Légende <=1024 car,
// sinon repli texte. Boutons Copier / Publier sur X dans les 2 cas.
async function dmOwnerCopy(token: string, enText: string, cta: string, imgUrl = ''): Promise<void> {
  const fullText = enText + NL + NL + cta
  const kb = xShareKeyboard(fullText)
  try {
    if (imgUrl && fullText.length <= 1024) {
      const res = await tfetch('https://api.telegram.org/bot' + token + '/sendPhoto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: OWNER_DM_ID, photo: imgUrl, caption: fullText, reply_markup: kb }),
      })
      const data = await res.json()
      if (data && data.ok) return
    }
    await tfetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: OWNER_DM_ID, text: fullText, disable_web_page_preview: true, reply_markup: kb }),
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

// -- Point d'entree --------------------------------------------
Deno.serve(async (req: Request) => {
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('forbidden', { status: 403 })
  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  const botToken = Deno.env.get('BOT_TOKEN')
  const chatId = Number(Deno.env.get('FACT_CHAT_ID') ?? '-1003842240104')
  if (!geminiKey || !botToken) return new Response('missing config', { status: 500 })

  let dryRun = false
  try { const body = await req.json(); if (body && body.dryRun === true) dryRun = true } catch { /* ok */ }

  if (dryRun) {
    const r = await generateFact()
    return new Response(JSON.stringify({ ok: r.ok, reason: r.reason, length: r.text.length, text: r.text }, null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const bg = (async () => {
    try {
      const result = await generateFact()
      if (!result.ok) { console.error('daily-fact-dyk echec:', result.reason); return }
      await sendWithBanner(botToken, chatId, result.text)            // The Chicken Coop - General
      const fr = await translateToFrench(result.text)
      if (fr) await sendWithBanner(botToken, FR_CHAT_ID, fr)         // Le Poulailler - General
      else console.error('daily-fact-dyk: traduction FR vide')
      await dmOwnerCopy(botToken, result.text, CTA_CRYPTO, imageUrl())  // copie EN + CTA + banniere -> owner (pour X)
      await markSent('franc-did-you-know-1')
      console.log('daily-fact-dyk poste:', result.text.slice(0, 80))
    } catch (e) { console.error('daily-fact-dyk bg exception:', String(e)) }
  })()
  ;(globalThis as any).EdgeRuntime?.waitUntil?.(bg)
  return new Response('accepted', { status: 202 })
})
