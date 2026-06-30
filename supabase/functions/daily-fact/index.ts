// ════════════════════════════════════════════════════════════════
//  daily-fact — messages quotidiens de Francis le coq dans
//  "The Chicken Coop" (Telegram). Appelée par pg_cron :
//    • 06h UTC → "☀️ Crypto morning" : brief crypto (source decrypt.co)
//    • 13h UTC → "Did you know?" sur $FRANC
//    • 19h UTC → "🌙 Crypto night"   : brief crypto (source journalducoin.com)
//
//  Les briefs crypto synthétisent en 300 caractères max le meilleur des
//  6 dernières news. Les sources sont VOLONTAIREMENT différentes matin/soir
//  pour diversifier l'information (decrypt.co en anglais, Journal du Coin
//  en français — traduit en anglais à la volée).
//
//  Sécurité : protégée par un secret partagé (CRON_SECRET) — seul
//  un appel portant le bon secret déclenche un post.
// ════════════════════════════════════════════════════════════════

const DID_YOU_KNOW_PROMPT = `You write ONE short, punchy "Did you know?" message for the Telegram community of $FRANC, a fun community memecoin built around Francis the rooster. Every message ends up connected to $FRANC — but you have lots of freedom in HOW you get there.

ABOUT $FRANC (stay accurate, invent nothing about $FRANC itself):
- A community memecoin built around Francis the rooster — a whole fun "rooster universe".
- Real content: a growing collection of in-app mini-games — the flagship Tamagotchi (you raise Francis the rooster and can even chat with him via Telegram), plus EggClicker, FrancRun, Sudoku, Mastermind, Motus, Ormuz, more coming.
- Lives on two chains: Solana and TON (runs right inside Telegram).
- Holding a tiny bit of $FRANC unlocks all the games.

NUMBERS & DATES:
- You MAY use dates, figures, or fun stats about REAL-WORLD topics (game history, gaming culture, tech) to make it richer and more credible.
- BUT never invent numbers about $FRANC itself (no made-up price, supply, holder count, sales, or dates for $FRANC). For $FRANC, stay qualitative.
- If you're not reasonably sure of a real-world figure, keep it vague ("decades ago", "a global hit") rather than stating a precise wrong number.

HOW TO WRITE IT:
- Tone: proud, warm, a little cheeky — Francis the rooster's voice. Informative but fun, never corporate.
- Structure: an interesting hook (the fact) → a smooth bridge → land on $FRANC / Francis in a positive way.
- Length: 2 to 3 lively sentences, 300 CHARACTERS MAXIMUM (hard limit — be concise). At most ONE rooster emoji (🐓).
- English only. Start with "Did you know?" (or a tight variant).

GOOD EXAMPLES (match this spirit, don't copy verbatim, and DON'T always pick the same game):
- "Did you know the first Tamagotchi hit pockets back in the 90s and became a worldwide craze? Francis brought the idea into 2026 — now you raise your rooster AND actually chat with him right on Telegram. 🐓"
- "Did you know Mastermind, the little code-breaking game, has entertained puzzle lovers for decades? Francis added it to the coop so you can crack codes and have fun with the flock."
- "Did you know roosters greet the sunrise before almost any other farm animal? Fittingly, Francis never sleeps either — there's always a game waiting in the coop. 🐓"
- "Did you know Motus, the word-guessing classic, has been a beloved French game for years? Francis serves it up in the coop for everyone to enjoy."

STRICT RULES:
- Never invent facts or numbers about $FRANC itself. Real-world figures are okay but keep them plausible; when unsure, stay vague.
- Never promise gains, never give price predictions or financial advice, never say "moon/pump/100x".
- Never name, compare to, or bash other coins/projects/communities.
- Keep it appropriate for a public, mixed-audience group.

Output ONLY the message text, nothing else.`

// ── Variété forcée du "Did you know?" ─────────────────────────
// On tire au sort, CÔTÉ SERVEUR, un angle + un sujet à chaque appel,
// pour éviter que le modèle retombe toujours sur le même jeu (ex:
// EggClicker). Le directive est injecté dans le prompt.
const FACT_ANGLES = [
  'Take a real-world fact about the ORIGIN/HISTORY of a game genre, then bridge to Francis\'s version.',
  'Take a fun fact about a classic game (board/word/arcade/puzzle), then "Francis brings it to the coop / modernized it".',
  'Take a rooster / barnyard / nature fact, then a playful bridge to Francis and the coop.',
  'Take a general crypto or tech fact, then bridge to why $FRANC\'s two-chain (Solana + TON) + in-Telegram approach is cool.',
  'Highlight the "$FRANC universe" itself: the community, the rooster world, or the sheer VARIETY of games (not one single game).',
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
]

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function buildFactPrompt(): string {
  const angle = pick(FACT_ANGLES)
  const topic = pick(FACT_TOPICS)
  return DID_YOU_KNOW_PROMPT + `

FOR THIS MESSAGE ONLY (rotate every time — do NOT default to EggClicker or repeat yesterday):
- Use this ANGLE: ${angle}
- If you mention a specific $FRANC game or feature, center it on: ${topic}
- Make it feel fresh and different from a typical message.`
}

// ── Briefs crypto (matin & soir) ──────────────────────────────
// Sources dissociées pour diversifier l'info.
type Slot = 'morning' | 'night'

interface NewsSource {
  hook: string
  feed: string
  name: string
  // Note de langue injectée dans le prompt (decrypt = EN, JDC = FR).
  langNote: string
}

const NEWS_SOURCES: Record<Slot, NewsSource> = {
  morning: {
    hook: '☀️ Crypto morning:',
    feed: 'https://decrypt.co/feed',
    name: 'Decrypt (decrypt.co)',
    langNote: 'The headlines/summaries are in English.',
  },
  night: {
    hook: '🌙 Crypto night:',
    feed: 'https://journalducoin.com/feed/',
    name: 'Journal du Coin (journalducoin.com)',
    langNote: 'The headlines/summaries are in FRENCH — translate and explain them in clear, simple English.',
  },
}

function newsPrompt(src: NewsSource): string {
  return `You are Francis the rooster, mascot of the $FRANC community memecoin. Below are the 6 LATEST crypto news items from ${src.name}, each with a short summary. ${src.langNote}

YOUR TASK:
1. From these 6 items, SYNTHESIZE the best — the most important and interesting for a general crypto audience (big market moves, major regulation, major adoption, big macro/geopolitical events impacting crypto, major hacks, big project news). Lead with the single biggest story; you MAY briefly add a second one if it genuinely matters and still fits the limit.
2. Summarize and vulgarize it IN ENGLISH so anyone can understand it — clear, simple, no jargon. (Translate from French if needed.)
3. Keep it to 300 CHARACTERS MAXIMUM (this is a hard limit — count characters, be concise).

STYLE:
- Start with exactly this hook: "${src.hook}" then the news.
- Plain, clear English. Friendly and light, with a tiny rooster touch if it fits naturally — but the NEWS and clarity come first, not jokes.
- At most ONE extra emoji besides the hook.

STRICT RULES:
- Base your summary ONLY on the headlines/summaries provided below. NEVER invent details, numbers, names, or outcomes not present in the source.
- Stay 100% factual and NEUTRAL. For any political, geopolitical, or conflict-related topic: report it plainly, take NO side, no opinion, no dramatization, focus on the crypto/market angle.
- NO financial advice, no price predictions, never say "moon/pump/buy/sell".
- Do not mention $FRANC unless a headline genuinely does (this is real news, not a $FRANC ad).
- If none of the items below look like real news (empty/irrelevant), reply with exactly: NONE

Output ONLY the final English message (or NONE), nothing else.

LATEST HEADLINES:
`
}

function stripHtml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&laquo;|&raquo;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Récupère les 6 articles les PLUS RÉCENTS d'un flux RSS : titre + résumé.
async function fetchLatestNews(feed: string): Promise<{ items: string[]; reason: string }> {
  try {
    const res = await fetch(feed, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
      }
    })
    if (!res.ok) return { items: [], reason: `RSS HTTP ${res.status}` }
    const xml = await res.text()
    const rawItems = xml.split('<item>').slice(1).map(s => s.split('</item>')[0])
    if (rawItems.length === 0) return { items: [], reason: 'aucun <item> dans le flux' }

    // Flux RSS = ordre anté-chronologique → on prend simplement les 6 premiers.
    const picked: string[] = []
    for (const it of rawItems) {
      if (picked.length >= 6) break
      const title = stripHtml((it.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1])
      const descr = stripHtml((it.match(/<description>([\s\S]*?)<\/description>/) || [, ''])[1]).slice(0, 300)
      if (title) picked.push(`- ${title}${descr ? ` — ${descr}` : ''}`)
    }

    if (picked.length === 0) return { items: [], reason: 'aucun titre exploitable dans le flux' }
    return { items: picked, reason: '' }
  } catch (e) {
    return { items: [], reason: 'exception RSS: ' + String(e) }
  }
}

async function generateNews(apiKey: string, slot: Slot): Promise<{ ok: boolean; text: string; reason: string }> {
  const src = NEWS_SOURCES[slot]
  const feed = await fetchLatestNews(src.feed)
  if (feed.items.length === 0) return { ok: false, text: '', reason: `[${src.name}] ${feed.reason}` }

  const model = 'gemini-3.1-flash-lite'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const prompt = newsPrompt(src) + feed.items.join('\n')

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 250, temperature: 0.6 }
        })
      })
      if (!res.ok) { console.error('generateNews HTTP', res.status, (await res.text()).slice(0, 200)); continue }
      const data = await res.json()
      const out = (data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join(' ') || '').trim()
      if (!out) continue
      if (out.toUpperCase() === 'NONE') return { ok: false, text: '', reason: 'Gemini: aucune actu pertinente (NONE)' }
      if (looksTruncated(out)) { console.log(`generateNews tentative ${attempt + 1}: tronqué`); continue }
      return { ok: true, text: out, reason: '' }
    } catch (e) {
      console.error('generateNews exception:', String(e))
    }
  }
  return { ok: false, text: '', reason: '3 tentatives échouées' }
}

// Détecte un message visiblement coupé/inachevé → on régénère.
// Volontairement permissif : on ne rejette QUE les coupures évidentes
// (termine par "..." ou par une lettre/chiffre sans aucune ponctuation
//  ni emoji de clôture). Tout le reste passe.
function looksTruncated(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (/(\.\.\.|…)$/.test(t)) return true            // points de suspension = coupé
  const last = t.slice(-1)
  // OK si finit par une ponctuation de fin OU par un emoji/symbole
  // (donc on ne rejette QUE si ça finit par une lettre ou un chiffre brut)
  if (/[A-Za-zÀ-ÿ0-9]$/.test(last)) return true
  return false
}

async function generateFact(apiKey: string): Promise<{ ok: boolean; text: string; reason: string }> {
  const model = 'gemini-3.1-flash-lite'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  // Nouveau prompt aléatoire (angle + sujet) à CHAQUE appel.
  const prompt = buildFactPrompt()
  let lastTry = ''
  let lastReason = 'aucune réponse de Gemini'
  // On tente jusqu'à 5 fois (en cas de vide / troncature).
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 250, temperature: 1.1 }
        })
      })
      if (!res.ok) {
        lastReason = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
        console.error('generateFact', lastReason)
        continue
      }
      const data = await res.json()
      const finish = data?.candidates?.[0]?.finishReason || ''
      const out = (data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join(' ') || '').trim()
      lastTry = out
      if (!out) { lastReason = `réponse vide (finishReason=${finish})` }
      else if (looksTruncated(out)) { lastReason = `rejeté: semble tronqué (finishReason=${finish})` }
      else return { ok: true, text: out, reason: '' }
      console.log(`generateFact tentative ${attempt + 1} — ${lastReason}`)
    } catch (e) {
      lastReason = 'exception: ' + String(e)
      console.error('generateFact', lastReason)
    }
  }
  return { ok: false, text: lastTry, reason: lastReason }  // 5 échecs
}

async function postToGroup(token: string, chatId: number, text: string) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
  })
  if (!res.ok) console.error('postToGroup HTTP', res.status, (await res.text()).slice(0, 200))
}

Deno.serve(async (req: Request) => {
  // ── Garde : seul un appel avec le bon secret est accepté ──
  const secret = Deno.env.get('CRON_SECRET')
  const provided = req.headers.get('x-cron-secret')
  if (!secret || provided !== secret) {
    return new Response('forbidden', { status: 403 })
  }

  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  const botToken  = Deno.env.get('BOT_TOKEN')
  const chatId    = Number(Deno.env.get('FACT_CHAT_ID') ?? '-1003842240104')
  if (!geminiKey || !botToken) {
    console.error('daily-fact: secret manquant (GEMINI_API_KEY ou BOT_TOKEN)')
    return new Response('missing config', { status: 500 })
  }

  // Type de message :
  //   "morning" (alias "gm")   → brief "☀️ Crypto morning" (decrypt.co)
  //   "night"   (alias "news") → brief "🌙 Crypto night"   (journalducoin.com)
  //   sinon                    → "Did you know?" (fact)
  // dryRun:true → génère et renvoie le texte SANS poster (pour tester).
  let kind: 'fact' | 'morning' | 'night' = 'fact'
  let dryRun = false
  try {
    const body = await req.json()
    if (body?.kind === 'morning' || body?.kind === 'gm') kind = 'morning'
    else if (body?.kind === 'night' || body?.kind === 'news') kind = 'night'
    if (body?.dryRun === true) dryRun = true
  } catch (_) { /* body vide ou non-JSON → on garde "fact" */ }

  const result = (kind === 'morning' || kind === 'night')
    ? await generateNews(geminiKey, kind)
    : await generateFact(geminiKey)
  if (!result.ok) {
    console.error(`daily-fact[${kind}]: échec —`, result.reason, '| dernière tentative:', result.text.slice(0, 200))
    return new Response(JSON.stringify({
      status: 'no message',
      kind,
      reason: result.reason,
      lastTry: result.text.slice(0, 300)
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  if (dryRun) {
    console.log(`daily-fact[${kind}] dryRun:`, result.text.slice(0, 80))
    return new Response(JSON.stringify({
      status: 'dry-run',
      kind,
      length: result.text.length,
      text: result.text
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  await postToGroup(botToken, chatId, result.text)
  console.log(`daily-fact[${kind}] posté:`, result.text.slice(0, 80))
  return new Response('ok')
})
