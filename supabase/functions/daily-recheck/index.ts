// ══════════════════════════════════════════════════════════════
//  daily-recheck — Edge Function Supabase (accès Golden Rooster).
//
//  RÈGLE : l'accès au groupe privé Spicy (« Golden Rooster ») est GRATUIT
//  mais réservé aux MEMBRES de « The Chicken Coop » 🇬🇧 OU du
//  « Poulailler » 🇫🇷. Depuis que le groupe est référencé publiquement, on
//  laisse un SURSIS aux nouveaux arrivants au lieu d'expulser sèchement
//  (Telegram interdit au bot d'écrire en 1er à qui n'a pas lancé le bot, donc
//   on ne peut pas prévenir chacun en DM → on prévient dans le groupe).
//
//  DEUX PASSAGES (pg_cron, corps {"mode":"..."}) :
//    • mode "remind"  — 12:00 UTC : marque les non-conformes (échéance =
//        aujourd'hui + GRACE_DAYS à 14h UTC) et poste UN rappel public dans
//        « Golden Rooster » listant qui sera contrôlé aujourd'hui / demain.
//        N'EXPULSE PERSONNE.
//    • mode "enforce" — 14:00 UTC : expulse ceux dont l'échéance est passée
//        et toujours non-membres, puis envoie le rapport au owner (avec la
//        « prévision d'expulsion demain »). C'est le mode par défaut.
//
//  On ne kicke JAMAIS si on ne peut pas confirmer (échec API) : par sécurité
//  on garde le membre (statut « indéterminé »).
//
//  Sécurité : header x-recheck-secret == RECHECK_SECRET
//             OU x-cron-secret == CRON_SECRET (pour les crons vault).
// ══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ⚠️ Doit correspondre EXACTEMENT au HOLDERS_GROUP_ID du bot-handler
// (le vrai groupe privé Spicy / « Golden Rooster »).
const SPICY_GROUP_ID = -1003962771717        // groupe privé Spicy = Golden Rooster
const CHICKEN_COOP = -1003842240104          // The Chicken Coop (EN)
const POULAILLER_FR = -1004352289820         // Le Poulailler (FR)
const SPICY_DEEPLINK = 'https://t.me/FrancisLeCoqBot?start=spicy'
const OWNER_ID = '6593812300'

// Liens publics des deux groupes « passerelle ».
const COOP_URL = 't.me/LeCoqFrancis'         // The Chicken Coop 🇺🇸
const POUL_URL = 't.me/FrancisLeCoq'         // Le Poulailler 🇫🇷

// Sursis (en jours) laissé à un membre non conforme avant expulsion.
// L'échéance tombe toujours à 14h UTC (jour du repérage + GRACE_DAYS).
const GRACE_DAYS = 2

// Bouton de traduction EN/FR (drapeaux) — géré par le callback 'trhot' du
// bot-handler, qui bascule la langue du message en place.
const TR_BUTTON = { inline_keyboard: [[
  { text: '🇬🇧 EN', callback_data: 'trhot' },
  { text: '🇫🇷 FR', callback_data: 'trhot' },
]] }

// ── Telegram helpers ────────────────────────────────────────────
async function tg(token: string, method: string, body: Record<string, any>) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return await res.json()
  } catch (e) { console.error('tg error', method, e); return null }
}

// Statut d'un membre dans un chat, ou null si l'appel échoue (indéterminé).
async function memberStatus(token: string, chatId: number, userId: number): Promise<string | null> {
  const r = await tg(token, 'getChatMember', { chat_id: chatId, user_id: userId })
  if (!r || r.ok !== true || !r.result) return null
  return String(r.result.status || '')
}
function isIn(status: string | null): boolean {
  return status === 'member' || status === 'administrator' || status === 'creator' || status === 'restricted'
}

// Kick « soft » : ban puis unban → le membre sort mais peut re-rejoindre
// (gratuitement) s'il redevient membre de Coop/Poulailler.
async function kickMember(token: string, userId: number): Promise<{ ok: boolean; error?: string }> {
  const ban = await tg(token, 'banChatMember', { chat_id: SPICY_GROUP_ID, user_id: userId })
  if (!ban?.ok) { console.error('banChatMember failed', userId, JSON.stringify(ban)); return { ok: false, error: ban?.description || 'ban failed' } }
  await tg(token, 'unbanChatMember', { chat_id: SPICY_GROUP_ID, user_id: userId, only_if_banned: true })
  return { ok: true }
}

async function dmKicked(token: string, userId: number) {
  await tg(token, 'sendMessage', {
    chat_id: userId,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    text:
      `🔞 <b>Accès Spicy suspendu</b>\n` +
      `Tu as été retiré de « Golden Rooster » car tu n'es plus membre de <b>The Chicken Coop</b> 🇬🇧 ni du <b>Poulailler</b> 🇫🇷.\n` +
      `C'est <b>gratuit</b> : rejoins l'un des deux groupes puis reclique ci-dessous pour revenir. 🐓\n\n` +
      `🔞 <b>Spicy access paused</b>\n` +
      `You were removed from "Golden Rooster" because you're no longer a member of <b>The Chicken Coop</b> 🇬🇧 or <b>Le Poulailler</b> 🇫🇷.\n` +
      `It's <b>free</b>: join one of the two groups, then tap below to come back.`,
    reply_markup: { inline_keyboard: [[{ text: '🔞 Revenir dans Spicy / Come back', url: SPICY_DEEPLINK }]] },
  })
}

// ── Utilitaires dates / mentions ───────────────────────────────
// Échéance d'expulsion à partir de maintenant : jour + GRACE_DAYS, à 14h UTC.
function deadlineFromNow(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + GRACE_DAYS)
  d.setUTCHours(14, 0, 0, 0)
  return d.toISOString()
}
function ymd(d: Date): string { return d.toISOString().slice(0, 10) }
function escapeHtml(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
// Mention cliquable : @username si dispo, sinon lien tg://user (ping l'ID).
function mention(m: any): string {
  if (m && m.username) return '@' + m.username
  const nm = escapeHtml((m && m.name) || 'member')
  return `<a href="tg://user?id=${m.telegram_id}">${nm}</a>`
}

// Membre encore présent (member/admin/restricted) dans Coop OU Poulailler ?
// Renvoie 'in' | 'out' | 'unknown' (unknown = un appel API a échoué).
async function compliance(token: string, uid: number): Promise<'in' | 'out' | 'unknown'> {
  const coop = await memberStatus(token, CHICKEN_COOP, uid)
  const poul = await memberStatus(token, POULAILLER_FR, uid)
  if (isIn(coop) || isIn(poul)) return 'in'
  if (coop === null || poul === null) return 'unknown'
  return 'out'
}

// Construit le corps du rappel public à partir des deux cohortes.
// Un bloc « aujourd'hui » / « demain » n'apparaît QUE s'il contient au moins un
// membre (l'appelant, lui, n'envoie rien si les deux cohortes sont vides).
function buildReminderText(todayCohort: any[], tomorrowCohort: any[]): string {
  const line = (m: any) => '👉 ' + mention(m)
  let text =
    `🐓 <b>Golden Rooster — Vérification d'adhésion</b>\n\n` +
    `Avant d'accéder à Golden Rooster, assurez-vous d'avoir rejoint au préalable The Chicken Coop (EN) ou Le Poulailler (FR).\n\n` +
    `🇺🇸 <b>The Chicken Coop</b>\n👉 ${COOP_URL}\n\n` +
    `🇫🇷 <b>Le Poulailler</b>\n👉 ${POUL_URL}\n\n` +
    `🔒 Notre bot vérifie automatiquement votre adhésion à The Chicken Coop (ou Le Poulailler) afin de maintenir votre accès à Golden Rooster.`
  if (todayCohort.length) {
    text += `\n\n⚠️ Les membres suivants perdront leur accès <b>aujourd'hui à 14:00 UTC</b> s'ils n'ont pas rejoint l'un des deux groupes avant cette échéance :\n` + todayCohort.map(line).join('\n')
  }
  if (tomorrowCohort.length) {
    text += `\n\n⚠️ Les membres suivants perdront leur accès <b>demain à 14:00 UTC</b> s'ils n'ont pas rejoint l'un des deux groupes avant cette échéance :\n` + tomorrowCohort.map(line).join('\n')
  }
  text += `\n\n🐓 Rejoignez dès maintenant l'univers de Francis Le Coq et conservez votre accès à Golden Rooster.`
  return text
}

// ── Mode "remind" (12:00 UTC) : marque + rappel public, sans expulser ──
// test=true : envoie un APERÇU (données fictives) au OWNER en DM, sans toucher
// au groupe ni à la base — juste pour visualiser le rendu.
async function runRemind(token: string, supabase: any, test = false): Promise<Response> {
  if (test) {
    const s = (u: string | null, n: string, id: number) => ({ username: u, name: n, telegram_id: id })
    const today = [s('john_doe', 'John', 111), s(null, 'Marie', 222)]
    const tomorrow = [s('paul_x', 'Paul', 333)]
    await tg(token, 'sendMessage', {
      chat_id: Number(OWNER_ID),
      text: '🧪 <i>Aperçu du rappel Golden Rooster (données fictives, non posté dans le groupe) :</i>\n\n' + buildReminderText(today, tomorrow),
      parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: TR_BUTTON,
    })
    return new Response(JSON.stringify({ ok: true, mode: 'remind', test: true }), { headers: { 'Content-Type': 'application/json' } })
  }
  const { data: members, error } = await supabase
    .from('group_members')
    .select('telegram_id, username, name, grace_until')
    .eq('status', 'member')
  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 })

  const now = new Date()
  const todayYmd = ymd(now)
  const tomorrowYmd = ymd(new Date(now.getTime() + 86400000))
  const nowIso = now.toISOString()
  const todayCohort: any[] = []      // échéance == aujourd'hui → contrôle à 14h aujourd'hui
  const tomorrowCohort: any[] = []   // échéance == demain

  for (const m of members ?? []) {
    const uid = m.telegram_id as number
    const c = await compliance(token, uid)
    if (c === 'in') {
      // Redevenu conforme → on efface l'échéance.
      if (m.grace_until) await supabase.from('group_members').update({ grace_until: null, last_checked: nowIso }).eq('telegram_id', uid)
      else await supabase.from('group_members').update({ last_checked: nowIso }).eq('telegram_id', uid)
      continue
    }
    if (c === 'unknown') { await supabase.from('group_members').update({ last_checked: nowIso }).eq('telegram_id', uid); continue }
    // Non conforme : on pose une échéance si absente (repérage initial).
    let g = m.grace_until as string | null
    if (!g) {
      g = deadlineFromNow()
      await supabase.from('group_members').update({ grace_until: g, last_checked: nowIso }).eq('telegram_id', uid)
    } else {
      await supabase.from('group_members').update({ last_checked: nowIso }).eq('telegram_id', uid)
    }
    const gYmd = g.slice(0, 10)
    if (gYmd === todayYmd) todayCohort.push(m)
    else if (gYmd === tomorrowYmd) tomorrowCohort.push(m)
    // échéance plus lointaine (repéré aujourd'hui) → pas encore listé publiquement
  }

  // On ne poste le rappel QUE s'il y a au moins un membre à prévenir.
  let posted = false
  if (todayCohort.length || tomorrowCohort.length) {
    const sent = await tg(token, 'sendMessage', {
      chat_id: SPICY_GROUP_ID, text: buildReminderText(todayCohort, tomorrowCohort), parse_mode: 'HTML',
      disable_web_page_preview: true, reply_markup: TR_BUTTON,
    })
    posted = !!(sent && sent.ok)
  }

  return new Response(JSON.stringify({ ok: true, mode: 'remind', today: todayCohort.length, tomorrow: tomorrowCohort.length, posted }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

// ── Mode "enforce" (14:00 UTC) : expulse les échéances passées + rapport ──
async function runEnforce(token: string, supabase: any): Promise<Response> {
  const { data: members, error } = await supabase
    .from('group_members')
    .select('telegram_id, username, name, grace_until')
    .eq('status', 'member')
  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 })

  let checked = 0, kept = 0, kicked = 0, skippedAdmin = 0, unknown = 0, failed = 0, pending = 0
  const failures: string[] = []
  const forecast: any[] = []   // « prévision d'expulsion demain »
  const now = new Date()
  const nowIso = now.toISOString()
  const tomorrowYmd = ymd(new Date(now.getTime() + 86400000))

  for (const m of members ?? []) {
    checked++
    const uid = m.telegram_id as number
    const c = await compliance(token, uid)

    if (c === 'in') {
      kept++
      await supabase.from('group_members').update({ grace_until: null, last_checked: nowIso }).eq('telegram_id', uid)
      continue
    }
    if (c === 'unknown') { unknown++; await supabase.from('group_members').update({ last_checked: nowIso }).eq('telegram_id', uid); continue }

    // Non conforme confirmé. On n'expulse pas un admin/créateur du Spicy.
    const spicy = await memberStatus(token, SPICY_GROUP_ID, uid)
    if (spicy === 'administrator' || spicy === 'creator') { skippedAdmin++; await supabase.from('group_members').update({ last_checked: nowIso }).eq('telegram_id', uid); continue }
    if (spicy === 'left' || spicy === 'kicked') { await supabase.from('group_members').update({ status: 'kicked', grace_until: null, last_checked: nowIso }).eq('telegram_id', uid); continue }

    // Échéance : posée si absente (sécurité si le "remind" n'a pas tourné).
    let g = m.grace_until as string | null
    if (!g) {
      g = deadlineFromNow()
      await supabase.from('group_members').update({ grace_until: g, last_checked: nowIso }).eq('telegram_id', uid)
      pending++
      if (g.slice(0, 10) === tomorrowYmd) forecast.push(m)
      continue
    }
    // Encore dans le sursis → on ne touche pas, on prévoit.
    if (new Date(g).getTime() > now.getTime()) {
      pending++
      if (g.slice(0, 10) === tomorrowYmd) forecast.push(m)
      await supabase.from('group_members').update({ last_checked: nowIso }).eq('telegram_id', uid)
      continue
    }

    // Échéance dépassée → expulsion.
    const res = await kickMember(token, uid)
    if (res.ok) {
      await dmKicked(token, uid)
      await supabase.from('group_members').update({ status: 'kicked', grace_until: null, last_checked: nowIso }).eq('telegram_id', uid)
      kicked++
    } else {
      failed++
      failures.push(`${m.username || uid}: ${res.error}`)
      await supabase.from('group_members').update({ last_checked: nowIso }).eq('telegram_id', uid)
    }
  }

  const forecastLine = forecast.length
    ? `\n🔮 Prévision d'expulsion demain : ${forecast.length}\n` + forecast.slice(0, 15).map(mention).join('\n')
    : `\n🔮 Prévision d'expulsion demain : 0`
  const report = `🔁 <b>Recheck Spicy quotidien</b>\n\n` +
    `👥 Vérifiés : ${checked}\n✅ Gardés : ${kept}\n👢 Expulsés : ${kicked}\n` +
    `🛡 Admins ignorés : ${skippedAdmin}\n❔ Indéterminés (gardés) : ${unknown}\n` +
    `⏳ En sursis : ${pending}` +
    forecastLine +
    (failed ? `\n\n⚠️ Échecs kick : ${failed}\n${failures.slice(0, 10).join('\n')}` : '')
  await tg(token, 'sendMessage', { chat_id: OWNER_ID, text: report, parse_mode: 'HTML', disable_web_page_preview: true })

  return new Response(JSON.stringify({ ok: true, mode: 'enforce', checked, kept, kicked, skippedAdmin, unknown, pending, failed }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

// ── Handler ─────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const okRecheck = req.headers.get('x-recheck-secret') === Deno.env.get('RECHECK_SECRET')
  const okCron = req.headers.get('x-cron-secret') === Deno.env.get('CRON_SECRET')
  if (!okRecheck && !okCron) return new Response('forbidden', { status: 403 })

  const token = Deno.env.get('BOT_TOKEN')!
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let mode = 'enforce'
  let test = false
  try {
    const body = await req.json()
    if (body && body.mode === 'remind') mode = 'remind'
    if (body && body.test === true) test = true
  } catch { /* corps vide → enforce (rétro-compatible) */ }

  return mode === 'remind' ? await runRemind(token, supabase, test) : await runEnforce(token, supabase)
})
