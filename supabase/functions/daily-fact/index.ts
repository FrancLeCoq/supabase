// ════════════════════════════════════════════════════════════════
//  daily-fact — messages quotidiens de Francis le coq dans
//  "The Chicken Coop" (Telegram). Appelée par pg_cron :
//    • 06h UTC → "☀️ Crypto morning" : brief crypto du matin
//    • 13h UTC → "Did you know?" sur $FRANC
//    • 19h UTC → "🌙 Crypto night"   : brief crypto du soir
//
//  Les briefs crypto (morning & night) synthétisent en 300 caractères
//  max le meilleur des 6 dernières news du flux Decrypt (decrypt.co).
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

VARIETY IS KEY — rotate the angle every day so it never feels repetitive. Pick ONE of these styles (vary daily):
1. A real-world fact about the ORIGIN/HISTORY of a game genre, then link to Francis's version. (e.g. the original Tamagotchi from the 90s → Francis reinvented it as a 2026 version you chat with on Telegram.)
2. A fun fact about a classic game (Sudoku, Mastermind, word games like Motus, snake, clickers...) → then "Francis brings it to the coop / modernized it".
3. A rooster / barnyard / nature fact → playful bridge to Francis and the coop.
4. A general crypto or tech fact → bridge to why $FRANC's two-chain + Telegram approach is cool.
5. A pure "$FRANC universe" highlight (community, the rooster world, the variety of games).

NUMBERS & DATES:
- You MAY use dates, figures, or fun stats about REAL-WORLD topics (game history, gaming culture, tech) to make it richer and more credible.
- BUT never invent numbers about $FRANC itself (no made-up price, supply, holder count, sales, or dates for $FRANC). For $FRANC, stay qualitative.
- If you're not reasonably sure of a real-world figure, keep it vague ("decades ago", "a global hit") rather than stating a precise wrong number.

HOW TO WRITE IT:
- Tone: proud, warm, a little cheeky — Francis the rooster's voice. Informative but fun, never corporate.
- Structure: an interesting hook (the fact) → a smooth bridge → land on $FRANC / Francis in a positive way.
- Length: 2 to 3 lively sentences, 300 CHARACTERS MAXIMUM (hard limit — be concise). At most ONE rooster emoji (🐓).
- English only. Start with "Did you know?" (or a tight variant).

GOOD EXAMPLES (match this spirit and VARIETY, don't copy verbatim):
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

// Brief crypto (matin & soir). Le hook ("☀️ Crypto morning:" ou
// "🌙 Crypto night:") est injecté selon le créneau.
function newsPrompt(hook: string): string {
  return `You are Francis the rooster, mascot of the $FRANC community memecoin. Below are the 6 LATEST crypto news items from Decrypt (decrypt.co), each with a short summary.

YOUR TASK:
1. From these 6 items, SYNTHESIZE the best — the most important and interesting for a general crypto audience (big market moves, major regulation, major adoption, big macro/geopolitical events impacting crypto, major hacks, big project news). Lead with the single biggest story; you MAY briefly add a second one if it genuinely matters and still fits the limit.
2. Summarize and vulgarize it IN ENGLISH so anyone can understand it — clear, simple, no jargon.
3. Keep it to 300 CHARACTERS MAXIMUM (this is a hard limit — count characters, be concise).

STYLE:
- Start with exactly this hook: "${hook}" then the news.
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

const NEWS_HOOKS: Record<'morning' | 'night', string> = {
  morning: '☀️ Crypto morning:',
  night: '🌙 Crypto night:',
}

// ── Lecture du flux RSS Decrypt ───────────────────────────────
// Récupère les 6 articles les PLUS RÉCENTS : titre + résumé.
const DECRYPT_FEED = 'https://decrypt.co/feed'

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

async function fetchLatestNews(): Promise<{ items: string[]; reason: string }> {
  try {
    const res = await fetch(DECRYPT_FEED, {
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

async function generateNews(apiKey: string, slot: 'morning' | 'night'): Promise<{ ok: boolean; text: string; reason: string }> {
  const feed = await fetchLatestNews()
  if (feed.items.length === 0) return { ok: false, text: '', reason: feed.reason }

  const model = 'gemini-3.1-flash-lite'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const prompt = newsPrompt(NEWS_HOOKS[slot]) + feed.items.join('\n')

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
  const prompt = DID_YOU_KNOW_PROMPT
  let lastTry = ''
  let lastReason = 'aucune réponse de Gemini'
  // On tente jusqu'à 5 fois : si Gemini glisse une vraie stat, on régénère.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 250, temperature: 1.0 }
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
  //   "morning" (alias "gm")   → brief "☀️ Crypto morning"
  //   "night"   (alias "news") → brief "🌙 Crypto night"
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
    // On renvoie le diagnostic pour pouvoir déboguer via le test SQL.
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
