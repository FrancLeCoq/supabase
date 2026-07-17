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
//  Pipeline : Chain/Project -> gemini-3.1-flash-lite (faits CoinGecko) ;
//  Catalyst -> grounding sur gemini-2.5-flash-lite (fallback 2.5-flash).
//
//  2 creneaux/jour (pg_cron, corps {}):  08:30 et 15:30 UTC.
//  Diffusion : EN -> Crypto Coop (1490), FR -> Crypto Cocorico (43).
//
//  Securite : header x-cron-secret == CRON_SECRET.
// ================================================================

const NL = String.fromCharCode(10)
const SEARCH_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash']
const FORMAT_MODEL = 'gemini-3.1-flash-lite'
const AI_TIMEOUT_MS = 40000

const FR_CHAT_ID = -1004352289820
const FR_THREAD_CRYPTO = 43
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
  try {
    const res = await tfetch(geminiUrl(FORMAT_MODEL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature } }),
    }, 25000)
    if (!res.ok) { console.error('formatCall HTTP', res.status); return '' }
    return extractText(await res.json())
  } catch (e) { console.error('formatCall exception', String(e)); return '' }
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
async function francMcBlock(): Promise<string> {
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
  return '$FRANC on TON: ' + fmtUsd(ton) + NL + '$FRANC on SOL: ' + fmtUsd(sol) + NL + NL + 'Big potential, just the beginning of the story 🚀'
}

// -- Coin gagnant + detail (CoinGecko) -------------------------
interface Coin { id: string; name: string; symbol: string; rank: number; change: number }
// kind 'pump' -> plus gros GAGNANT 24h ; 'dump' -> plus grosse PERTE 24h.
async function fetchTopMover(kind: 'pump' | 'dump'): Promise<{ coin: Coin | null; reason: string }> {
  const key = Deno.env.get('COINGECKO_API_KEY')
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (key) headers['x-cg-demo-api-key'] = key
  const coins: Coin[] = []
  for (const page of [1, 2]) {
    const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=' + page + '&price_change_percentage=24h'
    const res = await tfetch(url, { headers })
    if (!res.ok) return { coin: null, reason: 'CoinGecko HTTP ' + res.status }
    const arr = await res.json()
    if (!Array.isArray(arr)) return { coin: null, reason: 'CoinGecko: reponse inattendue' }
    for (const c of arr) {
      const change = Number(c && (c.price_change_percentage_24h_in_currency != null ? c.price_change_percentage_24h_in_currency : c.price_change_percentage_24h))
      const rank = Number(c && c.market_cap_rank)
      if (!isFinite(change) || !rank || rank > 500) continue
      if (kind === 'pump' && change > 500) continue     // anomalie de pump (donnee aberrante)
      if (kind === 'dump' && change < -95) continue      // quasi-mort / delisting -> on ignore
      coins.push({ id: String((c && c.id) || ''), name: String((c && c.name) || ''), symbol: String((c && c.symbol) || '').toUpperCase(), rank, change })
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
  const prompt = [
    coin.name + ' ($' + coin.symbol + ') is ' + dir + ' about ' + Math.abs(coin.change).toFixed(0) + '% over the last 24h.',
    'Use Google Search (recent news AND X / Twitter posts) to find the MOST LIKELY reason for this ' + (kind === 'dump' ? 'drop' : 'move') + '.',
    'Write ONE single line (max ~120 characters), the reason only - NO "Catalyst:" label, no emoji, no quotes.',
    'RULES:',
    '- Base it on what people/outlets are actually saying right now.',
    '- If the chatter/data points to artificial or suspicious activity (' + suspicious + '), say so plainly and neutrally.',
    '- Stay factual and neutral. No hype, no price predictions, no financial advice, never say "buy/sell/moon".',
    '- If nothing credible explains it, output EXACTLY: Broad market momentum, no single clear catalyst.',
    'Output ONLY that one line.',
  ].join(NL)
  let out = await groundedSearch(prompt)
  out = (out || '').split(NL)[0].trim()
  if (!out) return 'Broad market momentum, no single clear catalyst.'
  if (out.length > 160) out = out.slice(0, 157).trim() + '...'
  return out
}
async function chainProject(coin: Coin, detail: CoinDetail): Promise<string> {
  const facts = [
    'Coin: ' + coin.name + ' (' + coin.symbol + ')',
    'Issuing blockchain / platform: ' + (detail.chain || 'not listed (likely runs on its OWN native blockchain)'),
    'Categories: ' + (detail.categories || 'n/a'),
    'Official description: ' + (detail.description || 'n/a'),
  ].join(NL)
  const prompt = [
    'From the VERIFIED FACTS below (from CoinGecko), write EXACTLY these 2 lines, each max ~100 characters, nothing else:',
    '⛓️ Chain: <the blockchain this coin runs on; if platform is "not listed", say it runs on its own native blockchain>',
    '🧩 Project: <one CONCRETE short clause on what the project does - real sector/use-case, be specific, not vague>',
    '',
    'RULES: base it ONLY on the facts. NEVER invent. If description is n/a, keep Project short and general. Output ONLY the 2 lines.',
    '',
    'VERIFIED FACTS:',
    facts,
  ].join(NL)
  const out = await formatCall(prompt)
  if (out && out.indexOf('Chain') >= 0) return out.trim()
  return '⛓️ Chain: Established crypto asset' + NL + '🧩 Project: A top-500 crypto project'
}

async function generateMove(kind: 'pump' | 'dump'): Promise<{ ok: boolean; text: string; reason: string }> {
  const { coin, reason } = await fetchTopMover(kind)
  if (!coin) return { ok: false, text: '', reason: '[Cocorico ' + (kind === 'dump' ? 'Dump' : 'Pump') + '] ' + reason }
  const detail = await fetchCoinDetail(coin.id)
  const [cp, catalyst, franc] = await Promise.all([chainProject(coin, detail), groundedCatalyst(coin, kind), francMcBlock()])
  const descriptif = cp + NL + '🚀 Catalyst: ' + catalyst
  const pct = (coin.change >= 0 ? '+' : '') + coin.change.toFixed(1) + '%'
  const header = kind === 'dump' ? '🐓 Cocorico Dump 📉' : '🐓 Cocorico Pump 🚀'
  const line = kind === 'dump' ? 'Biggest loser in the Top 500 on the last 24h:' : 'Biggest gainer in the Top 500 on the last 24h:'
  const arrow = kind === 'dump' ? '🔻' : '📈'
  const text = header + NL + NL +
    line + NL +
    coin.name + ' ($' + coin.symbol + ') ' + pct + ' ' + arrow + NL + NL +
    descriptif + NL + NL +
    'And $FRANC?' + NL + 'Its cocorico is coming. 🐓🚀' + NL + NL +
    franc
  return { ok: true, text, reason: '' }
}

async function translateToFrench(text: string): Promise<string> {
  const prompt = [
    'Translate the following Telegram message into natural, fluent FRENCH for a French-speaking community.',
    'RULES:',
    '- Keep ALL emojis exactly where they are, and keep the same line breaks / layout.',
    '- Do NOT translate or alter: "$FRANC", ticker symbols, numbers, %, prices, URLs, coin/person/product names.',
    '- Keep "Cocorico Pump" and "Cocorico Dump" as is. Translate the labels "Chain/Project/Catalyst" to "Chaine/Projet/Catalyseur".',
    '- Natural French. Output ONLY the translated message, nothing else.',
    '',
    'MESSAGE:',
    text,
  ].join(NL)
  return await formatCall(prompt, 0.3)
}

// -- Telegram + bandeau ----------------------------------------
const IMG_BASE = 'https://mubqtnqulpyehkgubhnh.supabase.co/storage/v1/object/public/assets/'
function imageUrl(kind: 'pump' | 'dump'): string {
  const v = new Date().toISOString().slice(0, 10)
  const file = kind === 'dump' ? 'Cocorico Dump.png' : 'Cocorico Pump.png'
  return IMG_BASE + encodeURIComponent(file) + '?v=' + v
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

// -- Copie owner (pour X) : message EN + CTA "rejoins le poulailler" --------
const OWNER_DM_ID = 6593812300
const CTA_CRYPTO = "⚡ Don't miss any crypto news." + NL + "🐔 Join the Chicken Coop :" + NL + "👉 T.me/LeCoqFrancis"
async function dmOwnerCopy(token: string, enText: string, cta: string): Promise<void> {
  try {
    await tfetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: OWNER_DM_ID, text: enText + NL + NL + cta, disable_web_page_preview: true }),
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
    return new Response(JSON.stringify({ kind, ok: r.ok, reason: r.reason, length: r.text.length, text: r.text }, null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const bg = (async () => {
    try {
      const result = await generateMove(kind)
      if (!result.ok) { console.error('daily-pump echec:', result.reason); return }
      await sendWithBanner(botToken, chatId, result.text, CRYPTO_THREAD_EN, kind)     // EN -> Crypto Coop
      const fr = await translateToFrench(result.text)
      if (fr) await sendWithBanner(botToken, FR_CHAT_ID, fr, FR_THREAD_CRYPTO, kind)   // FR -> Crypto Cocorico
      else console.error('daily-pump: traduction FR vide')
      await dmOwnerCopy(botToken, result.text, CTA_CRYPTO)   // copie EN + CTA -> owner (pour X)
      await markSent(slot)
      console.log('daily-pump poste:', result.text.slice(0, 80))
    } catch (e) { console.error('daily-pump bg exception:', String(e)) }
  })()
  ;(globalThis as any).EdgeRuntime?.waitUntil?.(bg)
  return new Response('accepted', { status: 202 })
})
