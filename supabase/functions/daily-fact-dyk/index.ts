// ================================================================
//  daily-fact-dyk - le "Cocorico Fact" quotidien de Francis le coq
//  (ex-"Did you know?"). Une brique de lore + le bloc Daily $FRANC.
//  Brique ISOLEE du decoupage daily-fact.
//
//  PAS de source externe : message creatif genere par Gemini
//  (gemini-3.5-flash-lite, repli gemini-3.1-flash-lite ; PAS de grounding).
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
// Génération/traduction : Gemini 3.5 Flash-Lite, repli 3.1 Flash-Lite si quota.
const GEN_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']

// Cocorico Fact — chaque post est une petite BRIQUE du lore Francis.
// La rubrique n'est PLUS limitée aux faits insolites : histoire de France,
// culture du coq, gaming, crypto, tech… chacun mène naturellement à $FRANC.
const COCORICO_FACT_PROMPT = `You write ONE "Cocorico Fact" for the Telegram community of $FRANC — a fun community memecoin built around Francis the rooster. Each post is a small BRICK of the Francis lore: an interesting real-world story that ends by tying naturally into Francis / the $FRANC universe. A fact that does NOT land on Francis / $FRANC is a FAILURE.

ABOUT $FRANC (stay accurate, invent nothing about $FRANC itself):
- A community memecoin built around Francis the rooster — a whole fun "rooster universe".
- Real content: a growing collection of FREE in-app mini-games (Tamagotchi where you raise Francis and chat with him, EggClicker, FrancRun, Sudoku, Mastermind, Motus, Ormuz, more coming).
- Lives on two chains: Solana and TON, and runs right inside Telegram.
- All mini-games are FREE to play inside Telegram. NEVER imply you need $FRANC to play.

NUMBERS & DATES:
- You MAY use real dates/figures about REAL-WORLD topics to make it richer and credible.
- NEVER invent numbers about $FRANC itself (no price, supply, holders, dates). Stay qualitative for $FRANC.
- If unsure of a real-world figure, keep it vague ("decades ago", "a global hit") rather than a precise wrong number.

STRICT RULES:
- Never promise gains, never give price predictions or financial advice, never say "moon/pump/100x".
- Never name, compare to, or bash other coins/projects/communities.
- Keep it appropriate for a public, mixed-audience group. Proud, warm, a little cheeky — Francis the rooster voice.`

// Catégories tournantes (l'emoji de tête reflète le thème du jour).
const FACT_CATEGORIES: { emoji: string; theme: string }[] = [
  { emoji: '🇫🇷', theme: 'a piece of FRENCH HISTORY or a famous French invention/landmark (e.g. "The Eiffel Tower was supposed to be temporary…")' },
  { emoji: '🐓', theme: "ROOSTER CULTURE — why the rooster is France's symbol, the Gallic rooster, its symbolism of courage, pride and resilience" },
  { emoji: '🎮', theme: 'GAMING HISTORY (e.g. "The first video game was created in 1958…", the origin of a classic game genre)' },
  { emoji: '💎', theme: 'CRYPTO history/culture (e.g. "The first NFT was created before most people knew blockchain existed…", an early crypto milestone)' },
  { emoji: '🤖', theme: 'TECH history (e.g. "The first AI chatbot appeared in the 1960s…", an early tech breakthrough)' },
]

function pick<T>(arr: T[]): T {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return arr[buf[0] % arr.length]
}
function buildFactPrompt(): string {
  const cat = pick(FACT_CATEGORIES)
  return COCORICO_FACT_PROMPT + NL + NL +
    "TODAY'S CATEGORY (rotate — feel fresh, do NOT repeat yesterday): " + cat.theme + NL + NL +
    'Output ONLY these marker lines IN ENGLISH (nothing before or after, no title, no market cap — those are added automatically):' + NL +
    'THEME: ' + cat.emoji + ' <1 to 3 word category, e.g. French History, Rooster Culture, Gaming, Crypto, Tech>' + NL +
    'HOOK: <ONE short, punchy fact/opening sentence>' + NL +
    'STORY: <exactly 1 to 2 SHORT sentences of lore that end by tying naturally into Francis / the $FRANC universe (play free inside Telegram, build your legacy)>' + NL +
    'RULES: keep it short and dynamic. Keep the markers EXACTLY: THEME:, HOOK:, STORY:. NO bullet points.'
}
type FactData = { theme: string; hook: string; story: string }
function parseFact(s: string): FactData {
  const out: FactData = { theme: '', hook: '', story: '' }
  for (const raw of (s || '').split(NL)) {
    const line = raw.trim()
    if (/^THEME\s*:/i.test(line)) out.theme = line.replace(/^THEME\s*:/i, '').trim()
    else if (/^HOOK\s*:/i.test(line)) out.hook = line.replace(/^HOOK\s*:/i, '').trim()
    else if (/^STORY\s*:/i.test(line)) out.story = line.replace(/^STORY\s*:/i, '').trim()
  }
  return out
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
function esc(s: string): string { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
function stripTags(s: string): string { return (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') }
function fmtUsd(n: number): string {
  if (!isFinite(n) || n <= 0) return '$0'
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
  return '$' + Math.round(n)
}

// -- Market cap $FRANC (TON + SOL) + variation 24h --------------
// MC courant : table franc_market. Variation : snapshot quotidien dans
// franc_mc_snap (créée par toi en SQL). Sans snapshot, on affiche la MC
// sans % (auto-cicatrisant : le % apparaît dès que la table existe).
// Market cap $FRANC EN DIRECT (mêmes sources que daily-pump). La table
// franc_market ne stocke qu'une valeur (souvent périmée) : on la respecte
// seulement si auto=false (valeur figée manuelle), sinon on calcule en direct.
const FRANC_MINT_SOL = 'AacckLUizxHFpSGdcN9ppEfv2UCbdqZspEhHeR8Gpump'
const FRANC_TON_MASTER = 'EQBMR3POM1sdShe7QoSVt6DDauoor4QOK4HsN7eBdoi5lrn6'
async function dexMarketCap(addr: string, chainId: string): Promise<number | null> {
  try {
    const res = await tfetch('https://api.dexscreener.com/latest/dex/tokens/' + addr)
    if (!res.ok) return null
    const data = await res.json()
    const pairs = (data && data.pairs ? data.pairs : []).filter((p: any) => p && p.chainId === chainId)
    if (pairs.length === 0) return null
    pairs.sort((a: any, b: any) => ((b && b.liquidity && b.liquidity.usd) || 0) - ((a && a.liquidity && a.liquidity.usd) || 0))
    const mc = Number(pairs[0].marketCap != null ? pairs[0].marketCap : pairs[0].fdv)
    return isFinite(mc) && mc > 0 ? mc : null
  } catch { return null }
}
async function solMarketCap(): Promise<number | null> {
  try {
    const res = await tfetch('https://frontend-api-v3.pump.fun/coins/' + FRANC_MINT_SOL)
    if (!res.ok) return null
    const d = await res.json()
    const mc = Number(d && d.usd_market_cap)
    return isFinite(mc) && mc > 0 ? mc : null
  } catch { return null }
}
async function tonMarketCap(): Promise<number | null> {
  const dex = await dexMarketCap(FRANC_TON_MASTER, 'ton')
  if (dex) return dex
  try {
    const [rRates, rJetton] = await Promise.all([
      tfetch('https://tonapi.io/v2/rates?tokens=' + FRANC_TON_MASTER + '&currencies=usd'),
      tfetch('https://tonapi.io/v2/jettons/' + FRANC_TON_MASTER),
    ])
    if (!rRates.ok || !rJetton.ok) return null
    const rates = await rRates.json(); const jetton = await rJetton.json()
    const price = Number(rates?.rates?.[FRANC_TON_MASTER]?.prices?.USD)
    const decimals = Number(jetton?.metadata?.decimals != null ? jetton.metadata.decimals : 9)
    const supply = Number(jetton?.total_supply) / Math.pow(10, decimals)
    if (!isFinite(price) || price <= 0 || !isFinite(supply) || supply <= 0) return null
    return price * supply
  } catch { return null }
}
async function francDaily(): Promise<{ ton: number; sol: number; tonPct: number | null; solPct: number | null }> {
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const H = { apikey: key || '', Authorization: 'Bearer ' + (key || '') }
  const rows: Record<string, { mc: number; auto: boolean }> = {}
  try {
    const r = await tfetch(url + '/rest/v1/franc_market?select=chain,market_cap_usd,auto', { headers: H })
    if (r.ok) for (const row of await r.json()) rows[String(row.chain)] = { mc: Number(row.market_cap_usd) || 0, auto: !!row.auto }
  } catch { /* défaut plus bas */ }
  const mcFor = async (chain: 'ton' | 'sol', fallback: number): Promise<number> => {
    const row = rows[chain]
    if (row && !row.auto) return row.mc                       // valeur figée manuelle
    const live = chain === 'sol' ? await solMarketCap() : await tonMarketCap()
    return (live && live > 0) ? live : ((row && row.mc) || fallback)
  }
  const [ton, sol] = await Promise.all([mcFor('ton', 1300), mcFor('sol', 2400)])
  const prev: Record<string, number> = {}
  try {
    const r = await tfetch(url + '/rest/v1/franc_mc_snap?select=chain,mc', { headers: H })
    if (r.ok) for (const row of await r.json()) prev[String(row.chain)] = Number(row.mc) || 0
  } catch { /* pas de snapshot -> pas de % */ }
  const pct = (c: number, p: number): number | null => (p > 0 && c > 0) ? ((c - p) / p) * 100 : null
  const tonPct = pct(ton, prev.ton || 0), solPct = pct(sol, prev.sol || 0)
  // Met à jour le snapshot pour le calcul de demain (best-effort).
  try {
    await tfetch(url + '/rest/v1/franc_mc_snap', {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ chain: 'ton', mc: ton, at: new Date().toISOString() }, { chain: 'sol', mc: sol, at: new Date().toISOString() }]),
    })
  } catch { /* best-effort */ }
  return { ton, sol, tonPct, solPct }
}
function dailyFrancBlock(lang: 'en' | 'fr', d: { ton: number; sol: number; tonPct: number | null; solPct: number | null }): string {
  const fr = lang === 'fr'
  const mcLabel = fr ? 'Capitalisation' : 'Market Cap'
  const closing = fr ? 'Chaque jour, un pas de plus.' : 'Every day, one step closer.'
  const pctStr = (p: number | null) => (p == null) ? '' : ' (' + (p >= 0 ? '+' : '') + p.toFixed(1) + '%)'
  return [
    '━━━━━━━━━━━━━━',
    '',
    '🐓 <b>Daily $FRANC</b>',
    '',
    '📊 <b>' + mcLabel + '</b>',
    '🟦 TON : ' + fmtUsd(d.ton) + pctStr(d.tonPct),
    '🟩 SOL : ' + fmtUsd(d.sol) + pctStr(d.solPct),
    '',
    closing,
  ].join(NL)
}
// Assemble le post final : en-tête court/dynamique (thème + accroche + 📌 histoire)
// + bloc Daily $FRANC. Libellés figés comme les autres rubriques.
function buildCocoricoFact(lang: 'en' | 'fr', p: { theme: string; hook: string; story: string }, d: { ton: number; sol: number; tonPct: number | null; solPct: number | null }): string {
  const storyLabel = lang === 'fr' ? "L'histoire" : 'The Story'
  const parts: string[] = ['🐓 <b>Cocorico Fact</b>']
  if (p.theme) parts.push('', '<b>' + esc(p.theme) + '</b>')
  if (p.hook) parts.push(esc(p.hook))
  if (p.story) parts.push('', '📌 <b>' + storyLabel + '</b>', esc(p.story))
  parts.push('', dailyFrancBlock(lang, d))
  return parts.join(NL)
}
// Traduit N champs courts en un seul appel (séparateur non traduisible).
async function translateFields(fields: string[]): Promise<string[]> {
  const SEP = ' @@@ '
  const out = await translateToFrench(fields.join(SEP))
  const parts = out.split('@@@').map((s) => s.trim())
  return parts.length === fields.length ? parts : fields   // repli EN si découpe ratée
}

async function generateFact(): Promise<{ ok: boolean; text: string; reason: string }> {
  const prompt = buildFactPrompt()
  let lastReason = 'aucune reponse'
  for (const model of GEN_MODELS) {
    try {
      const res = await tfetch(geminiUrl(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 1.1, maxOutputTokens: 2048 } }),
      }, 30000)
      if (!res.ok) { lastReason = 'HTTP ' + res.status + ' (' + model + ')'; console.error('generateFact', lastReason); continue }
      const out = extractText(await res.json())
      if (out) return { ok: true, text: out, reason: '' }
      lastReason = 'reponse vide (' + model + ')'
    } catch (e) { lastReason = 'exception: ' + String(e); console.error('generateFact', lastReason) }
  }
  return { ok: false, text: '', reason: lastReason }
}

// Vrai si `out` est une traduction PLAUSIBLE de `src` (ni vide, ni tronquée, ni écho).
function translationLooksValid(src: string, out: string): boolean {
  if (!out) return false
  const norm = (s: string) => s.toLowerCase().replace(/[^a-zà-ÿ]/gi, '')
  const ns = norm(src), no = norm(out)
  if (no.length < ns.length * 0.4) return false
  if (ns.length >= 20 && no.slice(0, 30) === ns.slice(0, 30)) return false   // écho
  return true
}
async function translateToFrench(text: string): Promise<string> {
  const prompt = [
    'Translate the following Telegram message into natural, fluent FRENCH for a French-speaking community.',
    'RULES:',
    '- Keep ALL emojis exactly where they are, and keep the same line breaks / layout.',
    '- Do NOT translate or alter: "$FRANC", ticker symbols, numbers, %, prices, URLs, coin/person/product/game names.',
    '- "Did you know?" -> "Le saviez-vous ?".',
    '- Translate the ENTIRE message into French (every sentence). Nothing meaningful should stay in English.',
    '- Natural French, no robotic tone. Output ONLY the translated message, nothing else.',
    '',
    'MESSAGE:',
    text,
  ].join(NL)
  // Essaie chaque modèle et renvoie la 1re sortie réellement traduite ; sinon la meilleure.
  let best = ''
  for (const model of GEN_MODELS) {
    try {
      const res = await tfetch(geminiUrl(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 2048 } }),
      }, 25000)
      if (res.status === 429) { console.warn('translateToFrench 429 ' + model); continue }
      if (!res.ok) { console.error('translateToFrench HTTP', res.status, model); continue }
      const out = extractText(await res.json())
      if (out && out.length > best.length) best = out
      if (translationLooksValid(text, out)) return out
    } catch (e) { console.error('translateToFrench exception', model, String(e)) }
  }
  return best
}

// -- Telegram + bandeau ----------------------------------------
const IMG_BASE = 'https://mubqtnqulpyehkgubhnh.supabase.co/storage/v1/object/public/assets/'
function imageUrl(): string {
  // URL STABLE (pas de cache-buster) : Telegram reutilise l'image en cache.
  return IMG_BASE + encodeURIComponent('cocoricofact.png')
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

// ── Bascule de langue PRÉ-ENREGISTRÉE (bouton 🇬🇧/🇫🇷 instantané) ──
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
async function postI18n(token: string, chatId: number, imgUrl: string, defaultLang: 'en' | 'fr', en: string, fr: string, html = false): Promise<void> {
  const text = (defaultLang === 'fr') ? fr : en
  const base: any = { chat_id: chatId, disable_web_page_preview: true, reply_markup: NLANG_BTN }
  if (html) base.parse_mode = 'HTML'
  let messageId = 0
  if (imgUrl) {
    try { const r = await tfetch('https://api.telegram.org/bot' + token + '/sendPhoto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, photo: imgUrl, caption: text }) }); const d = await r.json(); if (d && d.ok) messageId = Number(d.result?.message_id) || 0 } catch (e) { console.error('postI18n photo', String(e)) }
  }
  if (!messageId) {
    try { const r = await tfetch('https://api.telegram.org/bot' + token + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, text }) }); const d = await r.json(); if (d && d.ok) messageId = Number(d.result?.message_id) || 0 } catch (e) { console.error('postI18n text', String(e)) }
  }
  await storeI18n(chatId, messageId, en, fr, html)
}

// Copie owner (pour X) : message EN SEUL, sans lien (le lien t.me dans un post
// X provoque un shadowban -> il se met en commentaire via /x… du bot).
const OWNER_DM_ID = 6593812300
// Boutons sous la copie owner : 📋 Copier (copy_text natif, si <=256 car) +
// 📤 Publier sur X (ouvre X avec le texte deja pre-rempli).
function xShareKeyboard(fullText: string) {
  const xBtn = { text: '📤 Publier sur X', url: 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(fullText) }
  const row = (fullText.length <= 256)
    ? [{ text: '📋 Copier', copy_text: { text: fullText } }, xBtn]
    : [xBtn]
  return { inline_keyboard: [row] }
}
// Copie owner en TEXTE seul + boutons (l'owner ajoute l'image lui-même).
async function dmOwnerCopy(token: string, enText: string): Promise<void> {
  try {
    await tfetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: OWNER_DM_ID, text: enText, disable_web_page_preview: true, reply_markup: xShareKeyboard(enText) }),
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
      const enData = parseFact(result.text)
      if (!enData.hook && !enData.story) { console.error('daily-fact-dyk: structure vide', result.text.slice(0, 80)); return }
      const [ftheme, fhook, fstory] = await translateFields([enData.theme, enData.hook, enData.story])
      const frData = { theme: ftheme, hook: fhook, story: fstory }
      const d = await francDaily()                                    // MC $FRANC TON+SOL (+ % si snapshot)
      const en = buildCocoricoFact('en', enData, d)
      const fr = buildCocoricoFact('fr', frData, d)
      const img = imageUrl()
      await postI18n(botToken, chatId, img, 'en', en, fr, true)        // EN (défaut) -> The Chicken Coop, General (bouton 🇬🇧/🇫🇷), HTML
      await dmOwnerCopy(botToken, stripTags(en))                       // copie EN -> owner (pour X, sans lien)
      await markSent('franc-did-you-know-1')
      console.log('daily-fact-dyk poste (Cocorico Fact):', (enData.hook || '').slice(0, 80))
    } catch (e) { console.error('daily-fact-dyk bg exception:', String(e)) }
  })()
  ;(globalThis as any).EdgeRuntime?.waitUntil?.(bg)
  return new Response('accepted', { status: 202 })
})
