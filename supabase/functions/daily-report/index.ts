// ================================================================
//  daily-report - rapport quotidien prive de Francis le coq.
//
//  Chaque jour a 23h (heure de Paris, gere ete/hiver automatiquement),
//  envoie en DM (chat 6593812300) l'etat d'envoi des messages automatises,
//  en 3 tableaux : Crypto, World, Hot.
//
//  Source : RPC public.automation_report_today() qui lit la table
//  public.automation_sent : une ligne y est ecrite par chaque fonction
//  UNIQUEMENT apres une publication Telegram reussie. Un message est
//  marque OK (✅) s'il a ete REELLEMENT envoye aujourd hui.
//
//  Declenchement (pg_cron) : 21:00 ET 22:00 UTC. La fonction n'envoie
//  QUE si l'heure de Paris est 23 -> exactement un envoi/jour toute
//  l'annee (21:00 UTC en ete, 22:00 UTC en hiver = 23h Paris).
//
//  Securite : header x-cron-secret == CRON_SECRET.
// ================================================================

const NL = String.fromCharCode(10)
const REPORT_CHAT_ID = 6593812300

// Libelles = heure de PARIS (figee toute l'annee). Le tri se fait sur ces 5
// premiers caracteres "HH:MM". Les cles = job_key ecrits dans automation_sent.
interface Group { title: string; items: [string, string][] }
const GROUPS: Group[] = [
  {
    title: '🌍 World',
    items: [
      ['world-morning', '07:00 Réveil Info'],
      ['world-eco', '10:40 Cocorico Éco'],
      ['world-midday', '13:25 Actu Midi'],
      ['world-tech', '16:10 Cocorico Tech'],
      ['world-evening', '18:00 Le Monde ce Soir'],
      ['world-night', "21:40 L'actu du Jour en Bref"],
    ],
  },
  {
    title: '🇫🇷 French Coop',
    items: [
      ['fr-morning', '11:35 Le Coq de Midi'],
      ['fr-eu', '15:15 Le Cocorico Express'],
      ['fr-evening', '19:50 Le Cocorico du Soir'],
    ],
  },
  {
    title: '🪙 Crypto',
    items: [
      ['franc-gm', '07:55 Morning'],
      ['daily-fact-pump-morning', '09:45 Dump'],
      ['franc-crypto-midi', '12:30 Midday'],
      ['daily-fact-pump', '17:05 Pump'],
      ['franc-news', '18:55 Evening'],
      ['franc-crypto-night', '20:45 Night'],
    ],
  },
  {
    title: '🌶️ Hot',
    items: [
      ['hot-morning', '10:10 Hot matin'],
      ['hot-midday', '13:10 Hot midi'],
      ['hot-evening', '20:10 Hot soir'],
    ],
  },
  {
    title: '🇺🇸 Trump',
    items: [
      ['trump-morning-brief', '06:05 Morning Brief'],
      ['trump-evening-brief', '18:05 Evening Brief'],
    ],
  },
  {
    title: '🐓 General',
    items: [
      ['franc-gm-joke', '08:50 GM + blague'],
      ['franc-did-you-know-1', '14:20 Cocorico Fact'],
      ['franc-gn', '22:30 GN'],
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
    // Tri chronologique par l'heure en tête de label ("HH:MM ...") pour la lisibilité.
    const items = g.items.slice().sort((a, b) => a[1].slice(0, 5).localeCompare(b[1].slice(0, 5)))
    for (const [job, label] of items) {
      total++
      const ok = has(job)
      if (ok) okCount++
      lines.push((ok ? '✅ ' : '❌ ') + label)
    }
    lines.push('')
  }
  lines.push(okCount + '/' + total + ' messages envoyes')
  if (okCount < total) lines.push('(❌ = message NON envoye aujourd hui - a verifier)')
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
