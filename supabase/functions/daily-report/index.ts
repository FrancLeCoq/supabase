// ================================================================
//  daily-report - rapport quotidien prive de Francis le coq.
//
//  Chaque jour a 23h (heure de Paris, gere ete/hiver automatiquement),
//  envoie en DM (chat 6593812300) l'etat d'envoi des messages automatises,
//  en 3 tableaux : Crypto, World, Hot.
//
//  Source : RPC public.automation_report_today() qui lit l'historique
//  cron (cron.job_run_details) + le journal daily_news_log du jour.
//  Un message est marque OK si son cron s'est declenche avec succes.
//
//  Declenchement (pg_cron) : 21:00 ET 22:00 UTC. La fonction n'envoie
//  QUE si l'heure de Paris est 23 -> exactement un envoi/jour toute
//  l'annee (21:00 UTC en ete, 22:00 UTC en hiver = 23h Paris).
//
//  Securite : header x-cron-secret == CRON_SECRET.
// ================================================================

const NL = String.fromCharCode(10)
const REPORT_CHAT_ID = 6593812300

interface Group { title: string; items: [string, string][] }
const GROUPS: Group[] = [
  {
    title: '🪙 Crypto',
    items: [
      ['franc-gm', '05:00 Morning'],
      ['franc-crypto-midi', '12:00 Midday'],
      ['franc-news', '19:00 Evening'],
      ['franc-crypto-night', '20:30 Night'],
      ['daily-fact-pump-morning', '08:30 Pump'],
      ['daily-fact-pump', '15:30 Pump'],
      ['franc-did-you-know-1', '08:30 Did you know?'],
    ],
  },
  {
    title: '🌍 World',
    items: [
      ['world-morning', '05:10 Réveil Info'],
      ['world-eco', '08:40 Cocorico Éco'],
      ['world-midday', '12:10 Actu Midi'],
      ['world-tech', '15:40 Cocorico Tech'],
      ['world-evening', '19:10 Grand Brief'],
      ['world-night', '20:40 Bilan du Soir'],
    ],
  },
  {
    title: '🌶️ Hot',
    items: [
      ['hot-morning', '08:00 Hot matin'],
      ['hot-evening', '20:00 Hot soir'],
    ],
  },
]

async function tfetch(input: string, init: RequestInit = {}, ms = 15000): Promise<Response> {
  return await globalThis.fetch(input, { ...init, signal: AbortSignal.timeout(ms) })
}

function parisHour(): number {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }).format(new Date())
  return parseInt(s, 10)
}

async function fetchStatus(): Promise<{ day: string; crons: string[] } | null> {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return null
  try {
    const res = await tfetch(url + '/rest/v1/rpc/automation_report_today', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!res.ok) { console.error('fetchStatus HTTP', res.status); return null }
    const data = await res.json()
    const crons = (data && Array.isArray(data.crons)) ? data.crons.map((x: any) => String(x)) : []
    const day = String((data && data.day) || new Date().toISOString().slice(0, 10))
    return { day, crons }
  } catch (e) { console.error('fetchStatus exception', String(e)); return null }
}

function buildReport(day: string, crons: string[]): string {
  const has = (job: string) => crons.indexOf(job) >= 0
  let total = 0
  let okCount = 0
  const lines: string[] = ['📊 Rapport Francis - ' + day, '']
  for (const g of GROUPS) {
    lines.push(g.title)
    for (const [job, label] of g.items) {
      total++
      const ok = has(job)
      if (ok) okCount++
      lines.push((ok ? '✅ ' : '❌ ') + label)
    }
    lines.push('')
  }
  lines.push(okCount + '/' + total + ' messages declenches')
  if (okCount < total) lines.push('(❌ = cron non declenche aujourd hui - a verifier)')
  return lines.join(NL)
}

async function sendDM(token: string, text: string): Promise<boolean> {
  try {
    const res = await tfetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: REPORT_CHAT_ID, text, disable_web_page_preview: true }),
    })
    const data = await res.json()
    if (!data || !data.ok) { console.error('sendDM:', JSON.stringify(data).slice(0, 200)); return false }
    return true
  } catch (e) { console.error('sendDM exception', String(e)); return false }
}

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('forbidden', { status: 403 })
  const botToken = Deno.env.get('BOT_TOKEN')
  if (!botToken) return new Response('missing config', { status: 500 })

  let force = false
  let dryRun = false
  try { const body = await req.json(); if (body && body.force === true) force = true; if (body && body.dryRun === true) dryRun = true } catch { /* ok */ }

  const h = parisHour()
  if (!force && !dryRun && h !== 23) {
    return new Response(JSON.stringify({ skipped: true, parisHour: h }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const status = await fetchStatus()
  if (!status) return new Response('status unavailable', { status: 500 })
  const text = buildReport(status.day, status.crons)

  if (dryRun) {
    return new Response(JSON.stringify({ parisHour: h, text }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const ok = await sendDM(botToken, text)
  return new Response(JSON.stringify({ sent: ok, parisHour: h }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
