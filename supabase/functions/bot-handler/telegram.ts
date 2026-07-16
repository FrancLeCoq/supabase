// Module issu du decoupage de bot-handler (logique identique, code deplace).
import { BUY_FRANC_SOL_URL, BUY_FRANC_TON_URL } from './menus.ts'

export const FRANC_CA_SOL = 'AacckLUizxHFpSGdcN9ppEfv2UCbdqZspEhHeR8Gpump'

export const FRANC_CA_TON = 'EQBMR3POM1sdShe7QoSVt6DDauoor4QOK4HsN7eBdoi5lrn6'

export const CHICKEN_COOP = -1003842240104
// « Le Poulailler » — groupe francophone (forum à topics). Francis y répond en français.

export const POULAILLER_FR = -1004352289820

// Topics (message_thread_id) de chaque rubrique, par groupe.
export const FR_TOPIC = { coop: 1, games: 29, wallet: 31, hotwings: 33, cryptocoop: 43, worldroost: 45 }
export const EN_TOPIC = { coop: 1, games: 1300, wallet: 405, hotwings: 1488, cryptocoop: 1490, worldroost: 1489 }
// Recopie un message de setup dans un topic d'un groupe, puis l'épingle.
// ⚠️ Le topic « General » (racine du forum) a l'id 1 : Telegram REFUSE message_thread_id=1
// ("message thread not found") → pour le General on N'ENVOIE PAS de thread_id.
// (C'est pour ça que /setupchickencoop, dirigé vers le topic 1, ne partait pas alors que
//  /setupwallet (31) et /setupgames (29), de vrais topics, fonctionnaient.)

export async function mirrorFrSetup(token: string, threadId: number, text: string, inline_keyboard: any[]) {
  try {
    const extra: Record<string, any> = { reply_markup: { inline_keyboard } }
    if (threadId && threadId > 1) extra.message_thread_id = threadId
    const sent = await sendMessage(token, POULAILLER_FR, text, extra)
    if (sent?.message_id) await pinMessage(token, POULAILLER_FR, sent.message_id)
  } catch (e) { console.error('mirrorFrSetup:', String(e)) }
}

// Symétrique côté anglais : publie la version EN dans The Chicken Coop, puis l'épingle.
export async function mirrorEnSetup(token: string, threadId: number, text: string, inline_keyboard: any[]) {
  try {
    const extra: Record<string, any> = { reply_markup: { inline_keyboard } }
    if (threadId && threadId > 1) extra.message_thread_id = threadId
    const sent = await sendMessage(token, CHICKEN_COOP, text, extra)
    if (sent?.message_id) await pinMessage(token, CHICKEN_COOP, sent.message_id)
  } catch (e) { console.error('mirrorEnSetup:', String(e)) }
}

export const ROOSTER_CHANNEL_ID = -1003975108886   // Rooster channel (annonces) → pont vers The Chicken Coop / General

export const HOLDERS_GROUP_ID  = -1003962771717

export const OWNER_ID     = '6593812300'

export const CASHBACK_NOTIFY_ID = OWNER_ID   // notifs de cashback → ton compte perso


export async function sendMessage(token: string, chatId: number, text: string, extra: Record<string,any> = {}) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra })
    })
    const data = await res.json()
    return data?.result
  } catch(_) { return null }
}

// ── Lien d'invitation à usage unique vers le groupe privé holders ──
// 1 seule personne, expire dans 15 min. Le partage ne sert à rien.
// Nécessite que le bot ait le droit "Invite Users via Link" dans le groupe.

export async function createOneTimeInvite(token: string, chatId: number): Promise<string | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/createChatInviteLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        member_limit: 1,
        expire_date: Math.floor(Date.now()/1000) + 900,
        name: 'holder-access'
      })
    })
    const data = await res.json()
    return data?.ok ? data.result.invite_link : null
  } catch { return null }
}

// ── Détection d'une demande de CA (adresse du contrat) ────────
// Prudent en français : on évite de matcher "ça". "CA" en MAJUSCULES,
// "contract/contrat", "token address" et les tournures "le/du/ton ca".
export function isCaRequest(raw: string): boolean {
  if (/\bca\b/i.test(raw || '')) return true   // "CA", "ca", "the ca", "le ca", "send me the ca"…
  const t = (raw || '').toLowerCase()
  return t.includes('contract') || t.includes('contrat') || t.includes('smart contract')
    || t.includes('token address') || t.includes('adresse du token') || t.includes('adresse token')
}

// Ancien CA de TEST diffusé au lancement, désormais PÉRIMÉ. Si quelqu'un le
// mentionne, on le prévient et on redonne les bonnes adresses.
export const OLD_TEST_CA = 'A5daStchQDABqVvdVBdy98vubEYxjxVpFPkQuicQpump'
export function mentionsOldTestCa(raw: string): boolean {
  return /a5dastchqdabq/i.test(raw || '')
}

// "CA-related" (pour regrouper la salve) : demande de CA, ancien CA de test,
// ou un message qui n'est QU'une adresse Solana collée pour vérification.
export function isCaRelated(raw: string): boolean {
  const t = (raw || '').trim()
  return isCaRequest(t) || mentionsOldTestCa(t) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t)
}

// ── Réponse "CA" (Contract Address) — SOL + TON ───────────────
// Bilingue, adresses en clair (copiables d'un tap) + liens directs
// Pump.fun / Blum en texte ET en boutons. Payload réutilisable
// (chat classique, groupe avec topic, ou compte Business).
export function caPayload(isFR: boolean, oldCa = false): { text: string; inline_keyboard: any[] } {
  const warn = !oldCa ? '' : (isFR
    ? `⚠️ <b>Attention</b> : cette adresse était un simple TEST au lancement, elle n'est <b>plus d'actualité</b>. Voici les adresses officielles ACTUELLES 👇\n\n`
    : `⚠️ <b>Heads up</b>: that address was just a launch-time TEST and is <b>no longer valid</b>. Here are the CURRENT official addresses 👇\n\n`)
  const body = isFR
    ? `📑 <b>Adresses officielles du contrat $FRANC</b>\n\n` +
      `◎ <b>SOL :</b>\n<code>${FRANC_CA_SOL}</code>\n🔗 Pump.fun : ${BUY_FRANC_SOL_URL}\n\n` +
      `💎 <b>TON :</b>\n<code>${FRANC_CA_TON}</code>\n🔗 Blum : ${BUY_FRANC_TON_URL}\n\n` +
      `<i>Touche une adresse pour la copier. N'utilise QUE les adresses officielles ci-dessus. 🐓</i>`
    : `📑 <b>Official $FRANC contract addresses</b>\n\n` +
      `◎ <b>SOL:</b>\n<code>${FRANC_CA_SOL}</code>\n🔗 Pump.fun: ${BUY_FRANC_SOL_URL}\n\n` +
      `💎 <b>TON:</b>\n<code>${FRANC_CA_TON}</code>\n🔗 Blum: ${BUY_FRANC_TON_URL}\n\n` +
      `<i>Tap an address to copy it. Only ever use the official addresses above. 🐓</i>`
  return { text: warn + body, inline_keyboard: [[
    { text: '◎ $FRANC on SOL', url: BUY_FRANC_SOL_URL },
    { text: '💎 $FRANC on TON', url: BUY_FRANC_TON_URL },
  ]] }
}

export async function sendCA(token: string, chatId: number, isFR: boolean, threadId = 0, oldCa = false) {
  const cp = caPayload(isFR, oldCa)
  const extra: Record<string, any> = { reply_markup: { inline_keyboard: cp.inline_keyboard } }
  if (threadId) extra.message_thread_id = threadId
  await sendMessage(token, chatId, cp.text, extra)
}

// ── Réponse "No DM" — anti-scam + patience (EN d'abord, puis FR) ──

export async function sendNoDM(token: string, chatId: number, replyTo?: number) {
  const txt =
    `🚫 <b>No DM — talk here!</b>\n` +
    `For your safety, the team will <b>never</b> DM you first. Beware of impersonators. 🐓\n` +
    `The dev team's replies may take some time — thanks for your patience!\n\n` +
    `🚫 <b>No DM — parle ici !</b>\n` +
    `Pour ta sécurité, l'équipe ne contacte <b>jamais</b> personne en privé en premier. Méfie-toi des faux comptes. 🐓\n` +
    `Les réponses de l'équipe de développement peuvent prendre un certain temps — merci pour ta patience !`
  const extra: Record<string,any> = {}
  if (replyTo) extra.reply_to_message_id = replyTo
  await sendMessage(token, chatId, txt, extra)
}

// ── Stars : prix du déblocage complet (vit ICI, jamais côté client) ──

export async function pinMessage(token: string, chatId: number, messageId: number) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/pinChatMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, disable_notification: true })
    })
  } catch(_) {}
}


export async function deleteMessage(token: string, chatId: number, messageId: number) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId })
    })
  } catch(_) {}
}

// ── Modération par mots-clés (gratuit, pas d'IA) ──────────────
// Renvoie true si le message contient une insulte/dénigrement.
// ⚠️ Édite cette liste selon ta commu. Garde-la en minuscules.
// On matche le MOT ENTIER pour limiter les faux positifs
// (ex. "ass" ne doit pas matcher "passport" / "class").
