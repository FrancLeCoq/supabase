// Module issu du decoupage de bot-handler (logique identique, code deplace).
import { WALLET_URL } from './menus.ts'

export const FRANC_MINT   = 'AacckLUizxHFpSGdcN9ppEfv2UCbdqZspEhHeR8Gpump'
// ── Adresses de contrat $FRANC (affichées sur demande "CA") ──

export const SOLANA_RPC   = 'https://api.mainnet-beta.solana.com'

export async function getFrancBalance(wallet: string): Promise<number> {
  try {
    const res = await fetch(SOLANA_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getTokenAccountsByOwner',
        params: [wallet, { mint: FRANC_MINT }, { encoding: 'jsonParsed' }]
      })
    })
    const data = await res.json()
    const accounts = data?.result?.value ?? []
    if (!accounts.length) return 0
    return accounts[0].account.data.parsed.info.tokenAmount.uiAmount ?? 0
  } catch { return 0 }
}


export function isValidSolana(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr.trim())
}


export function isValidTon(addr: string): boolean {
  return /^(UQ|EQ)[A-Za-z0-9_-]{46}$/.test(addr.trim())
}

// Préférence de langue ('fr' | 'en'), défaut 'en'

export async function getLang(supabase: any, telegramId: string): Promise<string> {
  try {
    const { data } = await supabase.from('wallets').select('lang').eq('telegram_id', telegramId).single()
    return (data?.lang === 'fr') ? 'fr' : 'en'
  } catch { return 'en' }
}

export async function setLang(supabase: any, telegramId: string, lang: string) {
  try {
    // Tente d'abord un UPDATE ciblé (ne touche que la colonne lang)
    const { data, error } = await supabase
      .from('wallets')
      .update({ lang })
      .eq('telegram_id', telegramId)
      .select('telegram_id')
    if (error) { console.error('setLang update error:', error.message); return }
    // Aucune ligne mise à jour → l'utilisateur n'a pas encore de ligne wallet
    if (!data || data.length === 0) {
      const { error: insErr } = await supabase
        .from('wallets')
        .insert({ telegram_id: telegramId, lang })
      if (insErr) console.error('setLang insert error:', insErr.message)
    }
  } catch (e) { console.error('setLang exception:', String(e)) }
}

// ══════════════════════════════════════════════════════════════
//  FRANCIS IA — réponse conversationnelle via Google Gemini Flash
//  Répond à chaque message du groupe, avec un anti-flood en mémoire
//  (au plus 1 réponse toutes les 5 min). Réponse "à froid" : on
//  n'envoie QUE le system prompt + le message courant. Gemini ne lit
//  rien d'autre (pas l'historique, pas tes conversations perso).
//
//  ⚠️ TOUT ce que Francis sait du projet est ci-dessous : c'est sa
//     SEULE source de connaissance. Mets à jour ce texte au fil du
//     temps (nouveaux jeux, étapes, liens) pour qu'il reste juste.
// ══════════════════════════════════════════════════════════════

export async function getAccess(supabase: any, telegramId: string) {
  const { data: row } = await supabase
    .from('wallets')
    .select('wallet_address, franc_balance, has_franc, ton_address, ton_balance, has_franc_ton, stars_unlocked')
    .eq('telegram_id', telegramId).single()

  if (!row) {
    return { unlocked: false, reason: null as string|null, balance: 0, walletLinked: false, row: null }
  }
  const hasSol   = row.has_franc ?? false
  const hasTon   = row.has_franc_ton ?? false
  const hasStars = row.stars_unlocked ?? false

  let unlocked = false, reason: string|null = null, balance = 0
  if (hasSol)        { unlocked = true; reason = 'solana'; balance = row.franc_balance ?? 0 }
  else if (hasTon)   { unlocked = true; reason = 'ton';    balance = row.ton_balance ?? 0 }
  else if (hasStars) { unlocked = true; reason = 'stars';  balance = 0 }

  const walletLinked = !!(row.wallet_address || row.ton_address)
  return { unlocked, reason, balance, walletLinked, row }
}

// Construit un bloc de statut homogène pour les messages du bot

export function statusText(access: any, isFR: boolean = false): string {
  const tr = (fr: string, en: string) => isFR ? fr : en
  if (!access.row) {
    return tr(
      `❌ Aucun wallet lié.\n\nUtilise /connect ou <a href="${WALLET_URL}">ouvre la page wallet</a>.`,
      `❌ No wallet linked.\n\nUse /connect or <a href="${WALLET_URL}">open the wallet page</a>.`
    )
  }
  if (access.unlocked && access.reason === 'stars') {
    return tr(
      `📊 <b>Ton statut</b>\n\n⭐ <b>Débloqué avec des Stars</b>\nAccès permanent à tout l'univers Francis.\n\n• Écrire dans The Chicken Coop ✅\n• Bonus de jeu ✅`,
      `📊 <b>Your Status</b>\n\n⭐ <b>Unlocked with Stars</b>\nPermanent access to the whole Francis universe.\n\n• Write in The Chicken Coop ✅\n• Game bonuses ✅`
    )
  }
  if (access.unlocked) {
    const sym  = access.reason === 'ton' ? '💎' : '◎'
    const addr = access.reason === 'ton' ? access.row.ton_address : access.row.wallet_address
    const short = addr ? addr.slice(0,6)+'...'+addr.slice(-4) : ''
    return tr(
      `📊 <b>Ton statut</b>\n\n👛 <code>${short}</code> ${sym}\n💰 Solde $FRANC : <b>${Number(access.balance).toLocaleString()}</b>\n\n✅ <b>$FRANC détecté !</b>\n• Écrire dans The Chicken Coop ✅\n• Bonus de jeu ✅`,
      `📊 <b>Your Status</b>\n\n👛 <code>${short}</code> ${sym}\n💰 $FRANC balance: <b>${Number(access.balance).toLocaleString()}</b>\n\n✅ <b>$FRANC detected!</b>\n• Write in The Chicken Coop ✅\n• Game bonuses ✅`
    )
  }
  // wallet lié mais pas de $FRANC
  const addr  = access.row.wallet_address || access.row.ton_address || ''
  const short = addr ? addr.slice(0,6)+'...'+addr.slice(-4) : ''
  return tr(
    `📊 <b>Ton statut</b>\n\n👛 <code>${short}</code>\n💰 Solde $FRANC : <b>0</b>\n\n❌ Aucun $FRANC trouvé.\nAchète du $FRANC pour tout débloquer !`,
    `📊 <b>Your Status</b>\n\n👛 <code>${short}</code>\n💰 $FRANC balance: <b>0</b>\n\n❌ No $FRANC found.\nBuy $FRANC to unlock all access!`
  )
}

