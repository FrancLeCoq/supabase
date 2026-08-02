// ================================================================
//  daily-pump - le "Cocorico Pump" de Francis le coq.
//  Brique ISOLEE du decoupage daily-fact.
//
//  Repere le plus gros gagnant 24h du Top 500 (CoinGecko), decrit sa
//  chaine et son projet (faits CoinGecko), et EXPLIQUE le pump via
//  Google Search grounding (news + posts X) -> la ligne "Catalyst"
//  peut signaler une manip (dump+pump, wash trading...) si les
//  donnees/chatter le suggerent. Termine par les market caps $FRANC.
//
//  Pipeline : Chain/Project -> gemini-3.5-flash-lite (repli 3.1 ; faits CoinGecko) ;
//  Catalyst -> grounding sur gemini-2.5-flash-lite (fallback 2.5-flash).
//
//  2 creneaux/jour (pg_cron, corps {}):  08:30 et 15:30 UTC.
//  Diffusion : EN -> Crypto Coop (1490), FR -> Crypto Cocorico (43).
//
//  Securite : header x-cron-secret == CRON_SECRET.
// ================================================================

const NL = String.fromCharCode(10)
const SEARCH_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash']
// Mise en forme/traduction : Gemini 3.5 Flash-Lite, repli 3.1 Flash-Lite si quota.
const FORMAT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
const AI_TIMEOUT_MS = 40000

const CRYPTO_THREAD_EN = 1490

const FRANC_MINT_SOL = 'AacckLUizxHFpSGdcN9ppEfv2UCbdqZspEhHeR8Gpump'
const FRANC_TON_MASTER = 'EQBMR3POM1sdShe7QoSVt6DDauoor4QOK4HsN7eBdoi5lrn6'

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
          generationConfig: { temperature: 0.4 },
        }),
      }, AI_TIMEOUT_MS)
      if (res.status === 429) { console.warn('groundedSearch 429 sur ' + model + ', repli'); continue }
      if (!res.ok) { console.error('groundedSearch HTTP', res.status, model); continue }
      const out = extractText(await res.json())
      if (out) return out
    } catch (e) { console.error('groundedSearch exception', model, String(e)) }
  }
  return ''
}
async function formatCall(prompt: string, temperature = 0.4): Promise<string> {
  for (const model of FORMAT_MODELS) {
    try {
      const res = await tfetch(geminiUrl(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature, maxOutputTokens: 2048 } }),
      }, 25000)
      if (res.status === 429) { console.warn('formatCall 429 ' + model); continue }
      if (!res.ok) { console.error('formatCall HTTP', res.status, model); continue }
      const out = extractText(await res.json())
      if (out) return out
    } catch (e) { console.error('formatCall exception', model, String(e)) }
  }
  return ''
}

// -- Market caps -----------------------------------------------
function fmtUsd(n: number): string {
  if (!isFinite(n) || n <= 0) return 'n/a'
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K'
  return '$' + n.toFixed(0)
}
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
    const rates = await rRates.json()
    const jetton = await rJetton.json()
    const price = Number(rates && rates.rates && rates.rates[FRANC_TON_MASTER] && rates.rates[FRANC_TON_MASTER].prices && rates.rates[FRANC_TON_MASTER].prices.USD)
    const decimals = Number(jetton && jetton.metadata && jetton.metadata.decimals != null ? jetton.metadata.decimals : 9)
    const supply = Number(jetton && jetton.total_supply) / Math.pow(10, decimals)
    if (!isFinite(price) || price <= 0 || !isFinite(supply) || supply <= 0) return null
    return price * supply
  } catch { return null }
}
async function francMc(): Promise<{ ton: number; sol: number }> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const rows: Record<string, { mc: number; auto: boolean }> = {}
  try {
    const res = await tfetch(url + '/rest/v1/franc_market?select=chain,market_cap_usd,auto',
      { headers: { apikey: key || '', Authorization: 'Bearer ' + (key || '') } })
    if (res.ok) { for (const r of await res.json()) rows[r.chain] = { mc: Number(r.market_cap_usd) || 0, auto: !!r.auto } }
  } catch { /* table injoignable -> valeurs par defaut */ }
  const mcFor = async (chain: 'ton' | 'sol'): Promise<number> => {
    const row = rows[chain]
    if (row && !row.auto) return row.mc
    const live = chain === 'sol' ? await solMarketCap() : await tonMarketCap()
    return (live && live > 0) ? live : ((row && row.mc) || 1300)
  }
  const [ton, sol] = await Promise.all([mcFor('ton'), mcFor('sol')])
  return { ton, sol }
}

// -- Coin gagnant + detail (CoinGecko) -------------------------
interface Coin { id: string; name: string; symbol: string; rank: number; change: number; change7d: number; change30d: number }
// kind 'pump' -> plus gros GAGNANT 24h ; 'dump' -> plus grosse PERTE 24h.
async function fetchTopMover(kind: 'pump' | 'dump'): Promise<{ coin: Coin | null; reason: string }> {
  const key = Deno.env.get('COINGECKO_API_KEY')
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (key) headers['x-cg-demo-api-key'] = key
  const coins: Coin[] = []
  for (const page of [1, 2]) {
    const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=' + page + '&price_change_percentage=24h,7d,30d'
    const res = await tfetch(url, { headers })
    if (!res.ok) return { coin: null, reason: 'CoinGecko HTTP ' + res.status }
    const arr = await res.json()
    if (!Array.isArray(arr)) return { coin: null, reason: 'CoinGecko: reponse inattendue' }
    for (const c of arr) {
      const change = Number(c && (c.price_change_percentage_24h_in_currency != null ? c.price_change_percentage_24h_in_currency : c.price_change_percentage_24h))
      const change7d = Number(c && c.price_change_percentage_7d_in_currency)
      const change30d = Number(c && c.price_change_percentage_30d_in_currency)
      const rank = Number(c && c.market_cap_rank)
      if (!isFinite(change) || !rank || rank > 500) continue
      if (kind === 'pump' && change > 500) continue     // anomalie de pump (donnee aberrante)
      if (kind === 'dump' && change < -95) continue      // quasi-mort / delisting -> on ignore
      coins.push({ id: String((c && c.id) || ''), name: String((c && c.name) || ''), symbol: String((c && c.symbol) || '').toUpperCase(), rank, change, change7d, change30d })
    }
  }
  if (coins.length === 0) return { coin: null, reason: 'aucune donnee exploitable' }
  coins.sort((a, b) => kind === 'dump' ? a.change - b.change : b.change - a.change)
  return { coin: coins[0], reason: '' }
}
interface CoinDetail { chain: string; description: string; categories: string }
async function fetchCoinDetail(id: string): Promise<CoinDetail> {
  const empty: CoinDetail = { chain: '', description: '', categories: '' }
  if (!id) return empty
  try {
    const key = Deno.env.get('COINGECKO_API_KEY')
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (key) headers['x-cg-demo-api-key'] = key
    const url = 'https://api.coingecko.com/api/v3/coins/' + id + '?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false'
    const res = await tfetch(url, { headers })
    if (!res.ok) return empty
    const d = await res.json()
    const platform = d && d.asset_platform_id
    const chain = (platform && typeof platform === 'string') ? platform.split('-').join(' ') : ''
    const descr = String((d && d.description && d.description.en) || '').split('<').join(' ').split('>').join(' ').slice(0, 600)
    const categories = (d && Array.isArray(d.categories)) ? d.categories.filter(Boolean).slice(0, 4).join(', ') : ''
    return { chain, description: descr, categories }
  } catch { return empty }
}

// -- Catalyst grounded + Chain/Project -------------------------
async function groundedCatalyst(coin: Coin, kind: 'pump' | 'dump'): Promise<string> {
  const dir = kind === 'dump' ? 'down' : 'up'
  const suspicious = kind === 'dump'
    ? 'a sell-off, a large token unlock, an exploit/hack, bad news, delisting, or a coordinated dump'
    : 'a coordinated pump, wash trading, dump-and-pump, or an unexplained spike with no fundamental news'
  const pct = (n: number) => isFinite(n) ? ((n >= 0 ? '+' : '') + n.toFixed(0) + '%') : 'n/a'
  const trend = 'Price action: ' + pct(coin.change) + ' (24h), ' + pct(coin.change7d) + ' (7d), ' + pct(coin.change30d) + ' (30d).'
  const prompt = [
    coin.name + ' ($' + coin.symbol + ') — ' + trend,
    'Use Google Search (recent news AND X / Twitter posts) to find the MOST LIKELY reason for the 24h ' + (kind === 'dump' ? 'drop' : 'move') + ', ANALYSED IN CONTEXT of the 7d and 30d trend (think like a market analyst, the way CoinMarketCap AI would).',
    'Reasoning to apply:',
    '- If it rose strongly over 7d/30d and is now pulling back, frame it as a healthy correction / profit-taking after a rally (NOT necessarily bad news).',
    '- If today just extends an existing down/up trend, say so.',
    '- If there is a real specific catalyst (token unlock, hack/exploit, listing/delisting, partnership, big news), state it — that takes priority.',
    '- If the chatter/data points to artificial or suspicious activity (' + suspicious + '), say so plainly and neutrally.',
    'Write ONE single line (max ~130 characters): the reason IN CONTEXT only — NO "Catalyst:" label, no emoji, no quotes.',
    'Stay factual and neutral. No hype, no price predictions, no financial advice, never say "buy/sell/moon".',
    'If nothing credible explains it, output EXACTLY: Broad market momentum, no single clear catalyst.',
    'Output ONLY that one line.',
  ].join(NL)
  let out = await groundedSearch(prompt)
  out = (out || '').split(NL)[0].trim()
  if (!out) return 'Broad market momentum, no single clear catalyst.'
  // Phrase COMPLÈTE : si trop long, on coupe à la dernière phrase terminée
  // (jamais au milieu d'un mot / d'une phrase).
  if (out.length > 220) {
    const cut = out.slice(0, 220)
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
    out = (end > 60 ? cut.slice(0, end + 1) : cut).trim()
  }
  return out
}
// Description COURTE du projet (une clause, sans label ni emoji).
async function projectClause(coin: Coin, detail: CoinDetail): Promise<string> {
  const facts = [
    'Coin: ' + coin.name + ' (' + coin.symbol + ')',
    'Categories: ' + (detail.categories || 'n/a'),
    'Official description: ' + (detail.description || 'n/a'),
  ].join(NL)
  const prompt = [
    'From the VERIFIED FACTS below (from CoinGecko), write ONE single CONCRETE short clause (max ~120 characters) describing what the project does — real sector / use-case, be specific, not vague. NO label, no emoji, no quotes.',
    'RULES: base it ONLY on the facts. NEVER invent. If description is n/a, keep it short and general. Output ONLY that one clause.',
    '',
    'VERIFIED FACTS:',
    facts,
  ].join(NL)
  const out = (await formatCall(prompt) || '').split(NL)[0].trim()
  return out || 'A top-500 crypto project.'
}

// -- Mise en forme HTML (nouveau format Cocorico Pump/Dump) ----
function esc(s: string): string { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
function capWords(s: string): string { return (s || '').split(' ').map((w) => w ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(' ') }
function buildPump(lang: 'en' | 'fr', kind: 'pump' | 'dump', coin: Coin, chainName: string, project: string, catalyst: string, franc: { ton: number; sol: number }): string {
  const fr = lang === 'fr'
  const L = fr ? {
    gainer: kind === 'dump' ? 'Plus forte baisse du Top 500 — 24h' : 'Plus forte hausse du Top 500 — 24h',
    token: 'Token', symbol: 'Symbole', chain: 'Chaîne', project: 'Projet', catalyst: 'Catalyseur',
    about: 'Et $FRANC dans tout ça ?', waking: 'Le coq se réveille… 👀🔥', eco: 'Écosystème $FRANC',
    story: "L'histoire ne fait que commencer.", coming: 'Cocorico arrive.',
  } : {
    gainer: kind === 'dump' ? 'Top 500 Biggest Loser — Last 24h' : 'Top 500 Biggest Gainer — Last 24h',
    token: 'Token', symbol: 'Symbol', chain: 'Chain', project: 'Project', catalyst: 'Catalyst',
    about: 'And what about $FRANC?', waking: 'The rooster is waking up… 👀🔥', eco: '$FRANC Ecosystem',
    story: 'The story is only beginning.', coming: 'Cocorico is coming.',
  }
  const headTitle = kind === 'dump' ? 'COCORICO DUMP 📉' : 'COCORICO PUMP 🚀'
  const pct = (coin.change >= 0 ? '+' : '') + coin.change.toFixed(1) + '%'
  const moveEmoji = kind === 'dump' ? '🔻' : '📈'
  return [
    '🐓 <b>' + headTitle + '</b>',
    '📊 <b>' + L.gainer + '</b>',
    '',
    '🔥 <b>$' + esc(coin.symbol) + ' ' + pct + ' ' + moveEmoji + '</b>',
    '',
    '🪙 <b>' + L.token + ':</b> ' + esc(coin.name),
    '🔷 <b>' + L.symbol + ':</b> $' + esc(coin.symbol),
    '⛓️ <b>' + L.chain + ':</b> ' + esc(chainName),
    '',
    '🧩 <b>' + L.project + ':</b>',
    esc(project),
    '',
    '🚀 <b>' + L.catalyst + ':</b>',
    esc(catalyst),
    '',
    '🐓 <b>' + L.about + '</b>',
    '',
    L.waking,
    '',
    '🚀 <b>' + L.eco + ':</b>',
    '🟦 TON: ' + fmtUsd(franc.ton) + ' MC',
    '🟩 SOL: ' + fmtUsd(franc.sol) + ' MC',
    '',
    L.story,
    '🐓 <b>' + L.coming + '</b>',
  ].join(NL)
}

async function generateMove(kind: 'pump' | 'dump'): Promise<{ ok: boolean; en: string; fr: string; logText: string; reason: string }> {
  const { coin, reason } = await fetchTopMover(kind)
  if (!coin) return { ok: false, en: '', fr: '', logText: '', reason: '[Cocorico ' + (kind === 'dump' ? 'Dump' : 'Pump') + '] ' + reason }
  const detail = await fetchCoinDetail(coin.id)
  const [projectEn, catalystEn, franc] = await Promise.all([projectClause(coin, detail), groundedCatalyst(coin, kind), francMc()])
  // On ne traduit QUE les deux textes dynamiques (projet + catalyseur) ; les
  // libellés sont des gabarits bilingues fixes → jamais de mélange EN/FR.
  const [projectFr, catalystFr] = await Promise.all([translatePiece(projectEn), translatePiece(catalystEn)])
  const chainEn = detail.chain ? capWords(detail.chain) : 'its own native blockchain'
  const chainFr = detail.chain ? capWords(detail.chain) : 'blockchain native'
  const en = buildPump('en', kind, coin, chainEn, projectEn, catalystEn, franc)
  const fr = buildPump('fr', kind, coin, chainFr, projectFr, catalystFr, franc)
  return { ok: true, en, fr, logText: coin.name + ' — ' + catalystEn, reason: '' }
}

// Vrai si `out` est une traduction PLAUSIBLE de `src` : ni vide, ni tronquée
// (< 40 %), ni un écho, ni SOUS-TRADUITE (trop de lignes restées identiques).
function translationLooksValid(src: string, out: string): boolean {
  if (!out) return false
  const norm = (s: string) => s.toLowerCase().replace(/[^a-zà-ÿ]/gi, '')
  const ns = norm(src), no = norm(out)
  if (no.length < ns.length * 0.4) return false
  const lines = src.split(NL).map((l) => l.trim()).filter((l) => norm(l).length >= 12)
  if (lines.length >= 3) {
    const outSet = new Set(out.split(NL).map((l) => l.trim()))
    let same = 0; for (const l of lines) if (outSet.has(l)) same++
    if (same / lines.length > 0.5) return false   // contenu resté en anglais
  }
  return true
}
// Traduction fiable : essaie chaque modèle (3.5-lite puis 3.1-lite) et renvoie la
// PREMIÈRE sortie réellement traduite ; à défaut, la meilleure disponible.
async function translateReliable(prompt: string, src: string, temperature = 0.3): Promise<string> {
  let best = ''
  for (const model of FORMAT_MODELS) {
    try {
      const res = await tfetch(geminiUrl(model), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature, maxOutputTokens: 2048 } }),
      }, 25000)
      if (!res.ok) continue
      const out = extractText(await res.json())
      if (out && out.length > best.length) best = out
      if (translationLooksValid(src, out)) return out
    } catch (e) { console.error('translateReliable', model, String(e)) }
  }
  return best
}
// Traduit un COURT texte (clause projet / catalyseur) en français fiable.
async function translatePiece(text: string): Promise<string> {
  if (!text) return ''
  const prompt = 'Translate this short crypto text into natural, fluent French. Keep tickers ($X), numbers, %, and proper names unchanged. Translate EVERYTHING else. Output ONLY the French translation, nothing else.' + NL + NL + text
  const out = await translateReliable(prompt, text, 0.3)
  return translationLooksValid(text, out) ? out : text
}
// Retire d'éventuelles balises HTML (copie owner en texte brut).
function stripTags(s: string): string {
  return (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

// -- Telegram + bandeau ----------------------------------------
const IMG_BASE = 'https://mubqtnqulpyehkgubhnh.supabase.co/storage/v1/object/public/assets/'
function imageUrl(kind: 'pump' | 'dump'): string {
  // URL STABLE (pas de cache-buster) : Telegram reutilise l'image en cache.
  const file = kind === 'dump' ? 'Cocorico Dump.png' : 'Cocorico Pump.png'
  return IMG_BASE + encodeURIComponent(file)
}
async function postToGroup(token: string, chatId: number, text: string, threadId = 0): Promise<void> {
  const body: any = { chat_id: chatId, text, disable_web_page_preview: true }
  if (threadId) body.message_thread_id = threadId
  const res = await tfetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) console.error('postToGroup HTTP', res.status, (await res.text()).slice(0, 160))
}
async function postPhoto(token: string, chatId: number, photoUrl: string, caption: string, threadId = 0): Promise<boolean> {
  try {
    const body: any = { chat_id: chatId, photo: photoUrl, caption }
    if (threadId) body.message_thread_id = threadId
    const res = await tfetch('https://api.telegram.org/bot' + token + '/sendPhoto', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!data || !data.ok) { console.error('postPhoto:', JSON.stringify(data).slice(0, 160)); return false }
    return true
  } catch (e) { console.error('postPhoto exception', String(e)); return false }
}
async function sendWithBanner(token: string, chatId: number, text: string, threadId: number, kind: 'pump' | 'dump'): Promise<void> {
  const ok = await postPhoto(token, chatId, imageUrl(kind), text, threadId)
  if (!ok) await postToGroup(token, chatId, text, threadId)
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
async function postI18n(token: string, chatId: number, threadId: number, imgUrl: string, defaultLang: 'en' | 'fr', en: string, fr: string, html = false): Promise<void> {
  const text = (defaultLang === 'fr') ? fr : en
  const base: any = { chat_id: chatId, disable_web_page_preview: true, reply_markup: NLANG_BTN }
  if (html) base.parse_mode = 'HTML'
  if (threadId) base.message_thread_id = threadId
  let messageId = 0
  if (imgUrl) {
    try { const r = await tfetch('https://api.telegram.org/bot' + token + '/sendPhoto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, photo: imgUrl, caption: text }) }); const d = await r.json(); if (d && d.ok) messageId = Number(d.result?.message_id) || 0 } catch (e) { console.error('postI18n photo', String(e)) }
  }
  if (!messageId) {
    try { const r = await tfetch('https://api.telegram.org/bot' + token + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, text }) }); const d = await r.json(); if (d && d.ok) messageId = Number(d.result?.message_id) || 0 } catch (e) { console.error('postI18n text', String(e)) }
  }
  await storeI18n(chatId, messageId, en, fr, html)
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

// -- Copie owner (pour X) : message EN SEUL (sans lien : le lien t.me dans un
//    post X provoque un shadowban -> il se met en commentaire via /x… du bot).
const OWNER_DM_ID = 6593812300
// Boutons sous la copie owner : 📋 Copier (copy_text natif Telegram, limite
// 256 car -> seulement si ca rentre) + 📤 Publier sur X (ouvre X avec le
// texte DEJA pre-rempli, l'owner n'a plus qu'a publier).
function xShareKeyboard(fullText: string) {
  const xBtn = { text: '📤 Publier sur X', url: 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(fullText) }
  const row = (fullText.length <= 256)
    ? [{ text: '📋 Copier', copy_text: { text: fullText } }, xBtn]
    : [xBtn]
  return { inline_keyboard: [row] }
}
// Copie owner en TEXTE seul + boutons (l'owner ajoute l'image depuis sa bibliothèque).
async function dmOwnerCopy(token: string, enText: string): Promise<void> {
  try {
    await tfetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: OWNER_DM_ID, text: enText, disable_web_page_preview: true, reply_markup: xShareKeyboard(enText) }),
    })
  } catch (e) { console.error('dmOwnerCopy:', String(e)) }
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
  let slot = 'daily-fact-pump'   // le cron passe {"slot":"daily-fact-pump-morning|daily-fact-pump"}
  let kind: 'pump' | 'dump' = 'pump'   // matin = dump, après-midi = pump
  try {
    const body = await req.json()
    if (body && body.dryRun === true) dryRun = true
    if (body && typeof body.slot === 'string') slot = body.slot
    if (body && body.kind === 'dump') kind = 'dump'
  } catch { /* ok */ }

  if (dryRun) {
    const r = await generateMove(kind)
    return new Response(JSON.stringify({ kind, ok: r.ok, reason: r.reason, length: r.en.length, en: r.en, fr: r.fr }, null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const bg = (async () => {
    try {
      const result = await generateMove(kind)
      if (!result.ok) { console.error('daily-pump echec:', result.reason); return }
      const img = imageUrl(kind)
      // EN (défaut) -> Crypto Coop, en HTML (gras). FR pré-enregistré (bouton 🇬🇧/🇫🇷).
      await postI18n(botToken, chatId, CRYPTO_THREAD_EN, img, 'en', result.en, result.fr, true)
      await dmOwnerCopy(botToken, stripTags(result.en))   // copie EN (texte brut) -> owner (pour X)
      await markSent(slot)
      console.log('daily-pump poste:', result.logText.slice(0, 80))
    } catch (e) { console.error('daily-pump bg exception:', String(e)) }
  })()
  ;(globalThis as any).EdgeRuntime?.waitUntil?.(bg)
  return new Response('accepted', { status: 202 })
})
