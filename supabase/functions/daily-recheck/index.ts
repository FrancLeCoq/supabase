// ══════════════════════════════════════════════════════════════
//  daily-recheck — Edge Function Supabase
//  Declenchee par pg_cron une fois par jour (secret x-recheck-secret).
//
//  NOUVELLE REGLE (acces Spicy GRATUIT) : l'acces au groupe prive Spicy
//  n'est PLUS lie a la detention de $FRANC. Il est reserve aux MEMBRES de
//  "The Chicken Coop" 🇬🇧 OU du "Poulailler" 🇫🇷.
//
//  Pour chaque membre suivi du groupe Spicy :
//    * s'il est TOUJOURS membre de Coop OU Poulailler -> on garde
//    * sinon -> kick (ban+unban) + DM expliquant la raison + bouton pour
//      revenir gratuitement (relance ?start=spicy). Admins ignores.
//
//  On ne kicke JAMAIS si on ne peut pas confirmer (echec API) : par securite
//  on garde le membre.
//
//  Securite : header x-recheck-secret == RECHECK_SECRET.
// ══════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ⚠️ Doit correspondre EXACTEMENT au HOLDERS_GROUP_ID du bot-handler
// (le vrai groupe prive Spicy ou le bot cree les invitations et suit les
//  arrivees). Un mauvais ID = le bot bannit dans le vide.
const SPICY_GROUP_ID = -1003962771717        // groupe prive Spicy (t.me/+H-Yq…)
const CHICKEN_COOP = -1003842240104          // The Chicken Coop (EN)
const POULAILLER_FR = -1004352289820         // Le Poulailler (FR)
const SPICY_DEEPLINK = 'https://t.me/FrancisLeCoqBot?start=spicy'
const OWNER_ID = '6593812300'

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

// Statut d'un membre dans un chat, ou null si l'appel echoue (indetermine).
async function memberStatus(token: string, chatId: number, userId: number): Promise<string | null> {
  const r = await tg(token, 'getChatMember', { chat_id: chatId, user_id: userId })
  if (!r || r.ok !== true || !r.result) return null
  return String(r.result.status || '')
}
function isIn(status: string | null): boolean {
  return status === 'member' || status === 'administrator' || status === 'creator' || status === 'restricted'
}

// Kick "soft" : ban puis unban -> le membre sort mais peut re-rejoindre
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
      `Tu as été retiré de l'espace Spicy car tu n'es plus membre de <b>The Chicken Coop</b> 🇬🇧 ni du <b>Poulailler</b> 🇫🇷.\n` +
      `C'est <b>gratuit</b> : rejoins l'un des deux groupes puis reclique ci-dessous pour revenir. 🐓\n\n` +
      `🔞 <b>Spicy access paused</b>\n` +
      `You were removed from the Spicy space because you're no longer a member of <b>The Chicken Coop</b> 🇬🇧 or <b>Le Poulailler</b> 🇫🇷.\n` +
      `It's <b>free</b>: join one of the two groups, then tap below to come back.`,
    reply_markup: { inline_keyboard: [[{ text: '🔞 Revenir dans Spicy / Come back', url: SPICY_DEEPLINK }]] },
  })
}

// ── Handler ─────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const secret = req.headers.get('x-recheck-secret')
  if (secret !== Deno.env.get('RECHECK_SECRET')) return new Response('forbidden', { status: 403 })

  const token = Deno.env.get('BOT_TOKEN')!
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: members, error } = await supabase
    .from('group_members')
    .select('telegram_id, username, name')
    .eq('status', 'member')
  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 })

  let checked = 0, kept = 0, kicked = 0, skippedAdmin = 0, unknown = 0, failed = 0
  const failures: string[] = []
  const now = new Date().toISOString()

  for (const m of members ?? []) {
    checked++
    const uid = m.telegram_id as number

    // Toujours membre de Coop OU Poulailler ?
    const coop = await memberStatus(token, CHICKEN_COOP, uid)
    const poul = await memberStatus(token, POULAILLER_FR, uid)

    if (isIn(coop) || isIn(poul)) {
      kept++
      await supabase.from('group_members').update({ last_checked: now }).eq('telegram_id', uid)
      continue
    }
    // Indetermine (un appel a echoue) -> on NE kicke PAS, on garde par securite.
    if (coop === null || poul === null) {
      unknown++
      await supabase.from('group_members').update({ last_checked: now }).eq('telegram_id', uid)
      continue
    }

    // Confirme non-membre des deux. On ne kicke pas un admin/createur du Spicy.
    const spicy = await memberStatus(token, SPICY_GROUP_ID, uid)
    if (spicy === 'administrator' || spicy === 'creator') {
      skippedAdmin++
      await supabase.from('group_members').update({ last_checked: now }).eq('telegram_id', uid)
      continue
    }
    if (spicy === 'left' || spicy === 'kicked') {
      await supabase.from('group_members').update({ status: 'kicked', last_checked: now }).eq('telegram_id', uid)
      continue
    }

    const res = await kickMember(token, uid)
    if (res.ok) {
      await dmKicked(token, uid)
      await supabase.from('group_members').update({ status: 'kicked', last_checked: now }).eq('telegram_id', uid)
      kicked++
    } else {
      failed++
      failures.push(`${m.username || uid}: ${res.error}`)
      await supabase.from('group_members').update({ last_checked: now }).eq('telegram_id', uid)
    }
  }

  const report = `🔁 <b>Recheck Spicy quotidien</b>\n\n` +
    `👥 Vérifiés : ${checked}\n✅ Gardés : ${kept}\n👢 Expulsés : ${kicked}\n` +
    `🛡 Admins ignorés : ${skippedAdmin}\n❔ Indéterminés (gardés) : ${unknown}` +
    (failed ? `\n⚠️ Échecs kick : ${failed}\n${failures.slice(0, 10).join('\n')}` : '')
  await tg(token, 'sendMessage', { chat_id: OWNER_ID, text: report, parse_mode: 'HTML' })

  return new Response(JSON.stringify({ ok: true, checked, kept, kicked, skippedAdmin, unknown, failed }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
