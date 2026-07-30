// Module issu du decoupage de bot-handler (logique identique, code deplace).
import { WALLET_URL } from './menus.ts'
import { sendMessage } from './telegram.ts'

export const STARS_PRICE    = 100   // ⭐ pour débloquer tout l'univers

export const CASHBACK_STARS = 50    // ⭐ d'équivalent $FRANC remboursés ensuite

// Crée un lien de facture Telegram Stars (XTR) directement depuis le bot.
// Retourne l'URL d'invoice, ou null en cas d'échec.

export async function createStarsInvoice(token: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Francis Le Coq — Full Unlock',
        description: `Unlock the whole Francis universe forever + receive ${CASHBACK_STARS} ⭐ worth of $FRANC cashback.`,
        payload: `cb||`,            // chaîne/adresse vides → réclamées via /cashback après paiement
        currency: 'XTR',
        prices: [{ label: 'Full Unlock', amount: STARS_PRICE }]
      })
    })
    const data = await res.json()
    if (!data.ok) { console.error('createInvoiceLink failed:', JSON.stringify(data)); return null }
    return data.result as string
  } catch (e) {
    console.error('createStarsInvoice error:', String(e))
    return null
  }
}

// Envoie le message "Cashback / déblocage Stars" avec le bouton de paiement in-bot.

export async function sendCashbackOffer(token: string, chatId: number, isFR: boolean, supabase?: any, telegramId?: string) {
  // Si déjà débloqué via ⭐ → pas de re-déblocage possible (1 fois à vie).
  if (supabase && telegramId) {
    try {
      const { data: w } = await supabase.from('wallets')
        .select('stars_unlocked').eq('telegram_id', telegramId).single()
      if (w?.stars_unlocked) {
        await sendMessage(token, chatId,
          isFR
            ? `✅ <b>Tu as déjà tout débloqué via ⭐ !</b>\n\nPas besoin de redébloquer — ton accès est à vie. 🐓\n\n💡 Tu peux connecter ton wallet pour voir ton solde $FRANC en permanence dans les jeux.`
            : `✅ <b>You've already unlocked everything with ⭐!</b>\n\nNo need to unlock again — your access is for life. 🐓\n\n💡 You can connect your wallet to always see your $FRANC balance across the games.`,
          { reply_markup: { inline_keyboard: [[
            { text: '🔗 Wallet', url: WALLET_URL }
          ]]}}
        )
        return
      }
    } catch(_) { /* pas de ligne encore → on continue vers l'offre */ }
  }

  const link = await createStarsInvoice(token)
  const txt = isFR
    ? `🔓 <b>Débloque tout l'univers Francis — 100⭐</b>\n\n` +
      `Paye une fois avec des Telegram Stars et accède à vie à tout :\n` +
      `• Écrire dans The Chicken Coop\n• Tous les bonus de jeu\n• Modes Holders\n\n` +
      `🎁 En retour, tu reçois <b>50⭐ d'équivalent $FRANC</b> en cashback.\n` +
      `Après le paiement, le bot te demandera ton adresse pour t'envoyer le cashback (ou tape <code>/cashback TON_ADRESSE</code>).`
    : `🔓 <b>Unlock the whole Francis universe — 100⭐</b>\n\n` +
      `Pay once with Telegram Stars for lifetime access to everything:\n` +
      `• Write in The Chicken Coop\n• All game bonuses\n• Holder modes\n\n` +
      `🎁 In return you get <b>50⭐ worth of $FRANC</b> as cashback.\n` +
      `After payment, the bot will ask for your address to send the cashback (or type <code>/cashback YOUR_ADDRESS</code>).`
  if (!link) {
    await sendMessage(token, chatId,
      isFR ? `❌ Impossible de créer la facture pour l'instant. Réessaie plus tard.`
           : `❌ Couldn't create the invoice right now. Please try again later.`)
    return
  }
  await sendMessage(token, chatId, txt, {
    reply_markup: { inline_keyboard: [[
      { text: isFR ? '⭐ Payer 100⭐' : '⭐ Pay 100⭐', url: link }
    ]]}
  })
}

