// ══════════════════════════════════════════════════════════════
//  bot-handler — Edge Function Supabase
//  @FrancisLeCoqBot — All messages in English
//  v2 — Accès harmonisé : Solana OU TON OU Stars (logique unifiée)
//        /disconnect non destructif (préserve la ligne + stars_unlocked)
// ══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

import { FRANCIS_COOLDOWN_MS, FRANCIS_DM_COOLDOWN_MS, FRANCIS_REPLY_DELAY_MS, askFrancisAI, fetchChatMemory, lastFrancisReplyByChat, saveChatMemory } from './francis-ai.ts'
import { BUY_FRANC_SOL_URL, BUY_FRANC_TON_URL, CASHBACK_DEEPLINK, CHICKEN_COOP_URL, EGGCLICKER_URL, FRANCRUN_URL, MASTERMIND_URL, MENU_DEEPLINK, MOTUS_URL, ORMUZ_URL, POULAILLER_URL, RULES_DEEPLINK, RULES_MENU_TEXT, SNAKE_URL, SUDOKU_URL, TAMAGOTCHI_URL, WALLET_URL, WORDSEARCH_URL, btnIs, buildGameRulesKeyboard, buildInlineMenu, buildKeyboard, buildRulesMenuKeyboard, gameByKey, isKeyboardButton } from './menus.ts'
import { getChatMemberStatus, isAbusive } from './moderation.ts'
import { sendCashbackOffer } from './payments.ts'
import { CASHBACK_NOTIFY_ID, CHICKEN_COOP, EN_TOPIC, FR_TOPIC, HOLDERS_GROUP_ID, OWNER_ID, POULAILLER_FR, ROOSTER_CHANNEL_ID, createOneTimeInvite, deleteMessage, mirrorEnSetup, mirrorFrSetup, pinMessage, sendCA, sendMessage, sendNoDM } from './telegram.ts'
import { getAccess, getFrancBalance, getLang, isValidSolana, isValidTon, setLang, statusText } from './wallet.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  try {
    const update = await req.json()

    // ══════════════════════════════════════════════════════════
    //  PONT CANAL → GROUPE — recopie les posts du Rooster channel
    //  dans l'onglet General de The Chicken Coop (copyMessage).
    //  Le canal reste l'annonce \"calme\" ; les bavards du groupe ne
    //  ratent rien. Nécessite que le bot soit admin du CANAL.
    //  Note : General = topic racine du forum → on N'ENVOIE PAS de
    //  message_thread_id (c'est le comportement par défaut = General).
    // ══════════════════════════════════════════════════════════
    if (update.channel_post) {
      const cp = update.channel_post
      if (cp.chat?.id === ROOSTER_CHANNEL_ID) {
        const token = Deno.env.get('BOT_TOKEN')!
        try {
          await fetch(`https://api.telegram.org/bot${token}/copyMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: CHICKEN_COOP,
              from_chat_id: ROOSTER_CHANNEL_ID,
              message_id: cp.message_id
              // pas de message_thread_id → publie dans General
            })
          })
        } catch (e) { console.error('channel bridge error:', String(e)) }
      }
      return new Response('ok')
    }

    // ── Suivi des membres du groupe holders (entrées/sorties) ──
    // Telegram ne liste pas les membres à un bot : on maintient notre
    // propre table group_members via cet événement, pour le recheck quotidien.
    if (update.chat_member) {
      const cm = update.chat_member
      if (cm.chat?.id === HOLDERS_GROUP_ID) {
        const token = Deno.env.get('BOT_TOKEN')!
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        )
        const u = cm.new_chat_member?.user
        const newStatus = cm.new_chat_member?.status
        if (u && !u.is_bot) {
          const isIn = newStatus === 'member' || newStatus === 'administrator' || newStatus === 'creator' || newStatus === 'restricted'
          if (isIn) {
            await supabase.from('group_members').upsert({
              telegram_id: u.id,
              username: u.username || null,
              name: [u.first_name, u.last_name].filter(Boolean).join(' ') || null,
              status: 'member'
            }, { onConflict: 'telegram_id' })
          } else {
            // left / kicked / banned
            await supabase.from('group_members')
              .update({ status: 'kicked' })
              .eq('telegram_id', u.id)
          }
        }
      }
      return new Response('ok')
    }

    // ── Pre-checkout : Telegram demande validation avant de débiter ──
    // Il FAUT répondre ok:true sous 10s, sinon le paiement échoue.
    if (update.pre_checkout_query) {
      const pcq   = update.pre_checkout_query
      const token = Deno.env.get('BOT_TOKEN')!
      await fetch(`https://api.telegram.org/bot${token}/answerPreCheckoutQuery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pre_checkout_query_id: pcq.id, ok: true })
      })
      return new Response('ok')
    }

    // ── Paiement réussi : débloque + crée la demande de cashback ──
    if (update.message?.successful_payment) {
      const sp     = update.message.successful_payment
      const payer  = update.message.from
      const token  = Deno.env.get('BOT_TOKEN')!
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )
      const payerId = String(payer.id)

      // payload = "cb|<chain>|<address>"  (address peut être vide)
      const parts    = (sp.invoice_payload || '').split('|')
      const chain    = parts[1] || 'ton'
      const address  = parts[2] || ''
      const chargeId = sp.telegram_payment_charge_id || null
      const starsPaid = sp.total_amount || 100
      const hasAddress = address.length > 0

      // 1) Débloque l'accès (Stars) — lié au compte Telegram
      try {
        await supabase.rpc('upsert_player', {
          p_telegram_id: payerId, p_name: payer.first_name || 'Player',
          p_username: payer.username ?? null, p_game_id: 'stars'
        })
      } catch(_) {}

      await supabase.from('wallets').upsert({
        telegram_id: payerId,
        stars_unlocked: true,
        stars_unlocked_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'telegram_id' })

      // 2) Enregistre la demande de cashback.
      //    - avec adresse  → status 'pending'   (à payer par toi)
      //    - sans adresse  → status 'unclaimed' (en attente de /cashback)
      let claimId: number | null = null
      try {
        // 1 cashback à vie : on ne crée une réclamation que si le joueur
        // n'en a AUCUNE (compatible avec l'index unique en base).
        const { data: prior } = await supabase.from('cashback_claims')
          .select('id, status').eq('telegram_id', payerId)
          .order('created_at', { ascending: false }).limit(1).single()

        if (prior) {
          // Réclamation déjà existante → on ne duplique jamais.
          claimId = prior.id
        } else {
          const { data: claim } = await supabase.from('cashback_claims').insert({
            telegram_id: payerId,
            username: payer.username ?? null,
            name: payer.first_name || 'Player',
            chain,
            payout_address: hasAddress ? address : null,
            stars_paid: starsPaid,
            cashback_stars: 50,
            telegram_charge_id: chargeId,
            status: hasAddress ? 'pending' : 'unclaimed'
          }).select('id').single()
          claimId = claim?.id ?? null
        }
      } catch(e) { console.error('cashback insert error:', String(e)) }

      // 3) Confirme à l'acheteur (message différent selon adresse fournie ou non)
      const confirmText = hasAddress
        ? `🎉 <b>Unlock successful!</b>\n\n` +
          `The whole Francis universe is now yours — forever. 🐓\n\n` +
          `💰 Your <b>50 ⭐ worth of $FRANC</b> cashback is queued and will be sent manually to your address shortly.\n\n` +
          `<i>Thanks for supporting Francis!</i>`
        : `🎉 <b>Unlock successful!</b>\n\n` +
          `The whole Francis universe is now yours — forever. 🐓\n\n` +
          `💰 <b>Want your 50 ⭐ cashback in $FRANC?</b>\n` +
          `Send your wallet address with the command:\n` +
          `<code>/cashback YOUR_ADDRESS</code>\n\n` +
          `⏭ Not ready? Type <code>/skip</code> — your cashback is saved and you can claim it anytime, even months later.\n\n` +
          `<i>(TON or Solana address accepted.)</i>`
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: payer.id, parse_mode: 'HTML', text: confirmText })
      })

      // 4) Te notifie UNIQUEMENT si une adresse est déjà fournie
      if (hasAddress) {
        const sym = chain === 'ton' ? '💎' : '◎'
        const uname = payer.username ? `@${payer.username}` : (payer.first_name || 'Player')
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: parseInt(CASHBACK_NOTIFY_ID), parse_mode: 'HTML',
            disable_web_page_preview: true,
            text: `💰 <b>NEW CASHBACK TO PAY</b> (#${claimId ?? '?'})\n\n` +
              `👤 ${uname}\n` +
              `${sym} <b>${chain.toUpperCase()}</b>\n` +
              `📬 <code>${address}</code>\n\n` +
              `⭐ Paid: ${starsPaid} · Cashback: <b>50 ⭐ worth of $FRANC</b>\n\n` +
              `<i>Send the $FRANC on ${chain.toUpperCase()}, then tap below.</i>`,
            reply_markup: claimId ? { inline_keyboard: [[
              { text: '✅ Mark as paid', callback_data: `cbpaid:${claimId}` }
            ]]} : undefined
          })
        })
      }

      return new Response('ok')
    }

    // ── Callback query (boutons inline) ──────────────────────
    if (update.callback_query) {
      const cb      = update.callback_query
      const cbUser  = cb.from
      const cbChat  = cb.message?.chat
      const cbToken = Deno.env.get('BOT_TOKEN')!
      const cbSupa  = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

      // Répond au callback pour supprimer le spinner Telegram
      await fetch(`https://api.telegram.org/bot${cbToken}/answerCallbackQuery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: cb.id })
      })

      if (cb.data === 'status') {
        const cbUserId = cbUser.id.toString()
        const access = await getAccess(cbSupa, cbUserId)
        const cbIsFR = await getLang(cbSupa, cbUserId) === 'fr'
        await fetch(`https://api.telegram.org/bot${cbToken}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: cbUser.id, parse_mode: 'HTML',
            text: statusText(access, cbIsFR)
          })
        })
      }

      if (cb.data === 'cashback') {
        const cbUserId = cbUser.id.toString()
        const cbIsFR = await getLang(cbSupa, cbUserId) === 'fr'
        await sendCashbackOffer(cbToken, cbUser.id, cbIsFR, cbSupa, cbUserId)
      }

      // ── Bouton inline "Only for Holders" (menu /start) ──
      if (cb.data === 'holders') {
        const userId = cbUser.id.toString()
        const token = cbToken
        const supabase = cbSupa
        const isFR = await getLang(cbSupa, userId) === 'fr'
        const tr = (fr: string, en: string) => isFR ? fr : en
        const access = await getAccess(supabase, userId)
      if (access.unlocked) {
        const sym = access.reason === 'stars' ? '⭐' : (access.reason === 'ton' ? '💎' : '◎')
        // ── Lien d'invitation à usage unique (15 min, 1 membre) ──
        const invite = await createOneTimeInvite(token, HOLDERS_GROUP_ID)
        if (!invite) {
          await sendMessage(token, parseInt(userId),
            tr(`⚠️ Impossible de générer ton accès pour le moment. Réessaie dans un instant 🐔`,
               `⚠️ Couldn't generate your access right now. Try again in a moment 🐔`))
          return new Response('ok')
        }
        await sendMessage(token, parseInt(userId),
          tr(
            `🔓 <b>Accès validé ${sym}</b>\n\nBienvenue dans le poulailler privé réservé aux holders 🐔\n\n⏳ Ton lien est <b>personnel</b>, valable <b>15 min</b> et <b>à usage unique</b>. Ne le partage pas — il ne marchera pour personne d'autre.`,
            `🔓 <b>Access granted ${sym}</b>\n\nWelcome to the private holders-only henhouse 🐔\n\n⏳ Your link is <b>personal</b>, valid for <b>15 min</b> and <b>single-use</b>. Don't share it — it won't work for anyone else.`
          ),
          { reply_markup: { inline_keyboard: [[
            { text: tr('🐔 Rejoindre le groupe privé', '🐔 Join the private group'), url: invite }
          ]] } }
        )
      } else {
        await sendMessage(token, parseInt(userId),
          tr(
            `🔒 <b>Réservé aux holders</b>\n\nCe groupe est réservé à ceux qui détiennent du <b>$FRANC</b> ou qui ont débloqué à vie avec des ⭐ Telegram.\n\nDeviens holder pour y accéder 👇`,
            `🔒 <b>Holders only</b>\n\nThis group is reserved for those who hold <b>$FRANC</b> or who unlocked for life with Telegram ⭐.\n\nBecome a holder to get access 👇`
          ),
          { reply_markup: { inline_keyboard: [
            [{ text: '🔗 Wallet', url: WALLET_URL }, { text: '🔓 Cashback⭐', url: CASHBACK_DEEPLINK }],
            [
              { text: '💰 $Franc on SOL', url: BUY_FRANC_SOL_URL },
              { text: '💰 $Franc on TON', url: BUY_FRANC_TON_URL }
            ]
          ] } }
        )
      }
      }

      // ── Boutons inline langue (menu /start) ──
      if (cb.data === 'lang_fr' || cb.data === 'lang_en') {
        const newLang = cb.data === 'lang_fr' ? 'fr' : 'en'
        await setLang(cbSupa, cbUser.id.toString(), newLang)
        await sendMessage(cbToken, cbUser.id,
          newLang === 'fr'
            ? `🇫🇷 <b>Langue réglée sur le français !</b>\n\nLes messages du bot s'afficheront en français.`
            : `🇬🇧 <b>Language set to English!</b>\n\nThe bot's messages will now be shown in English.`,
          { reply_markup: buildKeyboard(newLang === 'fr') })
      }

      if (cb.data === 'connectsol') {
        const cbUserId = cbUser.id.toString()
        const cbIsFR = await getLang(cbSupa, cbUserId) === 'fr'
        await cbSupa.from('pending_connects')
          .upsert({ telegram_id: cbUserId, created_at: new Date().toISOString() })
        await fetch(`https://api.telegram.org/bot${cbToken}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: cbUser.id, parse_mode: 'HTML', disable_web_page_preview: true,
            text: cbIsFR
              ? `🔗 <b>Connecte ton wallet Solana</b>\n\nLa détection de $FRANC est automatique, colle uniquement ton adresse publique Solana ici 👇\n\n<i>Exemple : 7xKXtg2CW87d...AsU</i>`
              : `🔗 <b>Connect your Solana wallet</b>\n\n$FRANC detection is automatic — just paste your public Solana address here 👇\n\n<i>Example: 7xKXtg2CW87d...AsU</i>`
          })
        })
      }

      if (cb.data === 'start') {
        const cbIsFR = await getLang(cbSupa, cbUser.id.toString()) === 'fr'
        await fetch(`https://api.telegram.org/bot${cbToken}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: cbUser.id, parse_mode: 'HTML',
            text: cbIsFR ? '🔄 Menu mis à jour 👇' : '🔄 Menu refreshed 👇',
            reply_markup: buildKeyboard(cbIsFR)
          })
        })
      }

      // ── Menu "Rules" : liste des jeux (navigation sur place) ──
      if (cb.data === 'rules_menu') {
        if (cb.message) {
          await fetch(`https://api.telegram.org/bot${cbToken}/editMessageText`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: cb.message.chat.id,
              message_id: cb.message.message_id,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
              text: RULES_MENU_TEXT,
              reply_markup: buildRulesMenuKeyboard()
            })
          })
        }
      }

      // ── Règles d'un jeu précis (Play + Retour aux règles) ──
      if (cb.data && cb.data.startsWith('rules_game_')) {
        const gameKey = cb.data.slice('rules_game_'.length)
        const game = gameByKey(gameKey)
        if (game && cb.message) {
          await fetch(`https://api.telegram.org/bot${cbToken}/editMessageText`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: cb.message.chat.id,
              message_id: cb.message.message_id,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
              text: game.rules,
              reply_markup: buildGameRulesKeyboard(game)
            })
          })
        }
      }

      // ── Bouton "✅ Mark as paid" sous une notif de cashback ──
      if (cb.data && cb.data.startsWith('cbpaid:')) {
        const claimId = cb.data.split(':')[1]
        // Seul le owner peut marquer payé
        if (String(cbUser.id) === OWNER_ID) {
          const { data: updated } = await cbSupa.from('cashback_claims')
            .update({ status: 'paid', paid_at: new Date().toISOString() })
            .eq('id', claimId).eq('status', 'pending')
            .select('payout_address, chain').single()

          if (cb.message) {
            const done = updated
              ? `\n\n✅ <b>PAID</b> — ${new Date().toISOString().slice(0,16).replace('T',' ')} UTC`
              : `\n\n⚠️ Already paid or not found.`
            await fetch(`https://api.telegram.org/bot${cbToken}/editMessageText`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: cb.message.chat.id,
                message_id: cb.message.message_id,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                text: (cb.message.text || 'Cashback') + done
              })
            })
          }
        }
      }
      return new Response('ok')
    }

    // ══════════════════════════════════════════════════════════
    //  TELEGRAM BUSINESS (mode "secrétaire") — le bot est connecté à
    //  un compte Business et répond aux DM reçus par ce compte. Ces
    //  updates ne sont PAS des update.message → gérés ici, en amont.
    // ══════════════════════════════════════════════════════════
    if (update.business_connection) {
      const bc = update.business_connection
      try {
        const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
        const canReply = (bc.rights && typeof bc.rights.can_reply === 'boolean')
          ? bc.rights.can_reply
          : (typeof bc.can_reply === 'boolean' ? bc.can_reply : true)
        await sb.from('business_connections').upsert({
          id: bc.id,
          owner_id: String(bc.user?.id ?? ''),
          is_enabled: bc.is_enabled !== false,
          can_reply: canReply,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' })
      } catch (e) { console.error('business_connection:', String(e)) }
      return new Response('ok')
    }

    if (update.business_message) {
      const bm = update.business_message
      if (!bm.from || bm.from.is_bot) return new Response('ok')
      const bText = (bm.text || '').trim()
      if (!bText || bText.startsWith('/')) return new Response('ok')
      const bToken = Deno.env.get('BOT_TOKEN')!
      const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const { data: conn } = await sb.from('business_connections')
        .select('owner_id, can_reply, is_enabled').eq('id', bm.business_connection_id).single()
      // Connexion inconnue / désactivée / sans droit de réponse → on ne répond pas.
      if (!conn || conn.is_enabled === false || conn.can_reply === false) return new Response('ok')
      // Anti-boucle : ne JAMAIS répondre aux messages du titulaire du compte
      // Business (ses propres messages ET les réponses déjà envoyées par Francis).
      if (conn.owner_id && String(bm.from.id) === conn.owner_id) return new Response('ok')
      const connId = bm.business_connection_id
      const bChat  = bm.chat.id
      // Anti-flood : au plus 1 réponse / FRANCIS_DM_COOLDOWN_MS par conversation.
      if ((Date.now() - (lastFrancisReplyByChat[bChat] || 0)) <= FRANCIS_DM_COOLDOWN_MS) return new Response('ok')
      lastFrancisReplyByChat[bChat] = Date.now()   // on arme tout de suite (les messages du burst suivant sont ignorés)
      const memKeyB = 'bm:' + bChat
      const bg = (async () => {
        try {
          const history = await fetchChatMemory(sb, memKeyB, 5)   // cohérence : 5 derniers messages
          const reply = await askFrancisAI(bText, 'en', 'dm', history)   // dm = bilingue auto + redirection par langue
          if (!reply) { lastFrancisReplyByChat[bChat] = 0; return }   // rien à dire → on relâche
          await new Promise((r) => setTimeout(r, FRANCIS_REPLY_DELAY_MS))  // ~1 min → plus naturel
          await fetch(`https://api.telegram.org/bot${bToken}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ business_connection_id: connId, chat_id: bChat, text: reply, parse_mode: 'HTML', disable_web_page_preview: true }),
          })
          await saveChatMemory(sb, memKeyB, 'user', bText)
          await saveChatMemory(sb, memKeyB, 'model', reply)
        } catch (e) { console.error('business_message bg:', String(e)) }
      })()
      try { (globalThis as any).EdgeRuntime?.waitUntil?.(bg) } catch (_) { /* best effort */ }
      return new Response('ok')
    }

    const msg = update.message
    if (!msg || !msg.from) return new Response('ok')

    const chatId    = msg.chat.id
    const userId    = msg.from.id.toString()
    const rawText   = (msg.text || '').trim()
    const text      = rawText.split('@')[0].toLowerCase()
    const userName  = msg.from.first_name || 'Player'
    const messageId = msg.message_id
    const threadId  = msg.message_thread_id

    if (msg.from.is_bot) return new Response('ok')

    const token    = Deno.env.get('BOT_TOKEN')!
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Préférence de langue : lue en privé ; en groupe, français pour « Le Poulailler »,
    // anglais pour « The Chicken Coop » (les réponses boutons/CA suivent la langue du groupe).
    const isFR = (msg.chat?.type === 'private')
      ? (await getLang(supabase, userId) === 'fr')
      : (chatId === POULAILLER_FR)
    const tr = (fr: string, en: string) => isFR ? fr : en

    // ══════════════════════════════════════════════════════════
    //  COCORICO RACING (F1 + MotoGP) — commandes OWNER, à la demande
    //  /F1essais /GPessais /F1qualifs /GPqualifs /F1sprint /GPsprint
    //  /F1course /GPcourse /F1we /GPwe /F1news /GPnews
    //  Délègue à la fonction isolée « racing » (recherche + EN + FR).
    // ══════════════════════════════════════════════════════════
    {
      const RACING_CMDS = ['/f1essais','/gpessais','/f1qualifs','/gpqualifs','/f1qualifssprint','/gpqualifssprint','/f1sprint','/gpsprint','/f1course','/gpcourse','/f1we','/gpwe','/f1news','/gpnews']
      if (RACING_CMDS.includes(text)) {
        if (userId !== OWNER_ID) return new Response('ok')   // owner uniquement
        const cronSecret = Deno.env.get('CRON_SECRET') || ''
        const trigger = fetch('https://mubqtnqulpyehkgubhnh.supabase.co/functions/v1/racing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronSecret },
          body: JSON.stringify({ command: text.slice(1) }),
        }).catch((e) => console.error('racing trigger:', String(e)))
        ;(globalThis as any).EdgeRuntime?.waitUntil?.(trigger)
        await sendMessage(token, chatId, tr(
          `🏁 C'est parti — je cherche et je publie dans <b>Cocorico Racing</b>…`,
          `🏁 On it — searching and posting to <b>Cocorico Racing</b>…`))
        return new Response('ok')
      }
    }

    // ══════════════════════════════════════════════════════════
    //  /enablesecretary (OWNER) — active le mode secrétaire Business :
    //  déclare les updates business au webhook. À lancer UNE fois, puis
    //  reconnecter le bot dans Réglages → Business → Chatbots.
    // ══════════════════════════════════════════════════════════
    if (text === '/enablesecretary') {
      if (userId !== OWNER_ID) return new Response('ok')
      const bToken = Deno.env.get('BOT_TOKEN')!
      try {
        const info = await (await fetch(`https://api.telegram.org/bot${bToken}/getWebhookInfo`)).json()
        const hookUrl = info?.result?.url
        if (!hookUrl) { await sendMessage(bToken, chatId, '❌ Webhook URL introuvable (getWebhookInfo).'); return new Response('ok') }
        const allowed = ['message','edited_message','callback_query','channel_post','business_connection','business_message','edited_business_message','deleted_business_messages']
        const res = await fetch(`https://api.telegram.org/bot${bToken}/setWebhook`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: hookUrl, allowed_updates: allowed, drop_pending_updates: false }),
        })
        const out = await res.json()
        await sendMessage(bToken, chatId, out?.ok
          ? "✅ Mode secrétaire activé (updates Business déclarés au webhook).\n\n👉 Dernière étape : Réglages Telegram → Business → Chatbots → déconnecte puis reconnecte @FrancisLeCoqBot (en lui laissant le droit de répondre). Ça enregistre la connexion, et Francis répondra ensuite aux DM reçus par ton compte Business."
          : ('❌ setWebhook a échoué : ' + JSON.stringify(out).slice(0, 250)))
      } catch (e) { await sendMessage(bToken, chatId, '❌ Erreur : ' + String(e)) }
      return new Response('ok')
    }

    // ══════════════════════════════════════════════════════════
    //  PAUSE / REPRISE de Francis IA dans les groupes
    //  À taper dans le bot en privé (réservé au owner) :
    //   /stopbotpoulailler · /playbotpoulailler
    //   /stopbotchickencoop · /playbotchickencoop
    //  Coupe / relance les réponses auto de Francis quand les
    //  membres discutent entre eux et n'ont pas besoin du bot.
    // ══════════════════════════════════════════════════════════
    if (text === '/stopbotpoulailler' || text === '/playbotpoulailler' ||
        text === '/stopbotchickencoop' || text === '/playbotchickencoop') {
      if (userId !== OWNER_ID) return new Response('ok')   // owner uniquement
      const target = text.includes('poulailler') ? POULAILLER_FR : CHICKEN_COOP
      const groupName = target === POULAILLER_FR ? 'Le Poulailler' : 'The Chicken Coop'
      const paused = text.startsWith('/stop')
      await supabase.from('bot_pause')
        .upsert({ chat_id: target, paused, updated_at: new Date().toISOString() }, { onConflict: 'chat_id' })
      await sendMessage(token, chatId,
        paused
          ? `⏸️ <b>Francis mis en pause</b> dans « ${groupName} ».\nIl n'enverra plus de réponses automatiques. Tape la commande /play… pour le réactiver.`
          : `▶️ <b>Francis réactivé</b> dans « ${groupName} ».\nIl répond de nouveau aux membres.`)
      return new Response('ok')
    }

    // ══════════════════════════════════════════════════════════
    //  CA — Adresse du contrat $FRANC (SOL + TON)
    //  Déclenché par /ca OU par détection de mots-clés dans le
    //  message (ca / contract / address / adresse), en privé
    //  comme en groupe.
    // ══════════════════════════════════════════════════════════
    {
      const isCaCommand = text === '/ca'
      const lower = rawText.toLowerCase().trim()
      // "contract" / "address" / "adresse" : mot entier, faux positifs rares.
      const strongKeyword = /(^|[^a-z])(contract|address|adresse)([^a-z]|$)/i.test(lower)
      // "ca" : strict — uniquement une vraie demande de contrat, pas le "ça" courant.
      //   ✅ "ca", "ca?", "ca?!", "ca pls", "ca svp", "franc ca", "ca please"
      //   ⬜ "ca va", "ca marche", "ca dépend"…
      const caStrict =
        /^ca[\s]*[?!.]*$/i.test(lower) ||                      // "ca", "ca?", "ca?!"
        /^ca\s+(pls|please|svp|stp|please\?|\?)/i.test(lower) || // "ca pls", "ca svp"
        /\bca\s*\?/i.test(lower)                                // "...franc ca?"
      if (isCaCommand || strongKeyword || caStrict) {
        await sendCA(token, chatId, isFR)
        return new Response('ok')
      }
    }

    // ══════════════════════════════════════════════════════════
    //  NO DM — réponse anti-scam quand on demande à parler en privé
    //  Déclenché par /nodm OU par détection de mots-clés
    //  (dm / mp / inbox / privé / private / message me…).
    // ══════════════════════════════════════════════════════════
    {
      const isNoDmCommand = text === '/nodm'
      const lower = rawText.toLowerCase().trim()
      // Mots-clés forts : peu de faux positifs.
      const dmStrong = /(^|[^a-z])(inbox|telegram me|message me|write to me|dm me|pm me)([^a-z]|$)/i.test(lower) ||
                       /\b(privé|prive|private)\b/i.test(lower)
      // "dm" / "dms" / "mp" : court → uniquement en contexte de demande.
      //   ✅ "dm?", "dms?", "dm me", "send me a dm", "go dm", "mp?", "en mp", "check ur dms"
      //   ⬜ "admin", "dmca", "mpc"… (mot collé)
      const dmShort = /(^|[^a-z])(dm|dms|mp)([^a-z]|$)/i.test(lower)
      if (isNoDmCommand || dmStrong || dmShort) {
        await sendNoDM(token, chatId, messageId)
        // Vanne de coq occasionnelle (~1 fois sur 3), en plus du
        // message anti-scam figé. Garde l'ambiance sans spammer.
        if (Math.random() < 0.34) {
          const quips = [
            `Why slide into DMs when we're all roosters here? 🐓`,
            `Aren't we better off right here in the coop? 🐔`,
            `No need to hide in DMs — the henhouse is right here! 🐓`,
            `DMs? Nah. Real roosters talk in the open. 🐔`,
            `Stay in the coop, friend — that's where the fun is! 🐓`
          ]
          const quip = quips[Math.floor(Math.random() * quips.length)]
          await sendMessage(token, chatId, quip, messageId ? { reply_to_message_id: messageId } : {})
        }
        return new Response('ok')
      }
    }

    // ══════════════════════════════════════════════════════════
    //  LANGUE — /fr et /en (préférence par utilisateur)
    // ══════════════════════════════════════════════════════════
    if (text === '/fr' || text === '/en' || btnIs(text, 'langFr') || btnIs(text, 'langEn')) {
      if (msg.chat?.type !== 'private') return new Response('ok')
      const newLang = (text === '/fr' || btnIs(text, 'langFr')) ? 'fr' : 'en'
      await setLang(supabase, userId, newLang)
      await sendMessage(token, parseInt(userId),
        newLang === 'fr'
          ? `🇫🇷 <b>Langue réglée sur le français !</b>\n\nLes messages du bot s'afficheront en français.`
          : `🇬🇧 <b>Language set to English!</b>\n\nThe bot's messages will now be shown in English.`,
        { reply_markup: buildKeyboard(newLang === 'fr') }
      )
      return new Response('ok')
    }

    // ══════════════════════════════════════════════════════════
    //  BOUTON "🔞 Only for Holders ou ⭐" — accès au groupe privé
    //  Donne un lien d'invitation à usage unique si holder (SOL/TON/Stars),
    //  sinon invite à le devenir. /holders fait la même chose (alias).
    // ══════════════════════════════════════════════════════════
    if (btnIs(text, 'holders') || text === '/holders') {
      if (msg.chat?.type !== 'private') return new Response('ok')
      const access = await getAccess(supabase, userId)
      if (access.unlocked) {
        const sym = access.reason === 'stars' ? '⭐' : (access.reason === 'ton' ? '💎' : '◎')
        // ── Lien d'invitation à usage unique (15 min, 1 membre) ──
        const invite = await createOneTimeInvite(token, HOLDERS_GROUP_ID)
        if (!invite) {
          await sendMessage(token, parseInt(userId),
            tr(`⚠️ Impossible de générer ton accès pour le moment. Réessaie dans un instant 🐔`,
               `⚠️ Couldn't generate your access right now. Try again in a moment 🐔`))
          return new Response('ok')
        }
        await sendMessage(token, parseInt(userId),
          tr(
            `🔓 <b>Accès validé ${sym}</b>\n\nBienvenue dans le poulailler privé réservé aux holders 🐔\n\n⏳ Ton lien est <b>personnel</b>, valable <b>15 min</b> et <b>à usage unique</b>. Ne le partage pas — il ne marchera pour personne d'autre.`,
            `🔓 <b>Access granted ${sym}</b>\n\nWelcome to the private holders-only henhouse 🐔\n\n⏳ Your link is <b>personal</b>, valid for <b>15 min</b> and <b>single-use</b>. Don't share it — it won't work for anyone else.`
          ),
          { reply_markup: { inline_keyboard: [[
            { text: tr('🐔 Rejoindre le groupe privé', '🐔 Join the private group'), url: invite }
          ]] } }
        )
      } else {
        await sendMessage(token, parseInt(userId),
          tr(
            `🔒 <b>Réservé aux holders</b>\n\nCe groupe est réservé à ceux qui détiennent du <b>$FRANC</b> ou qui ont débloqué à vie avec des ⭐ Telegram.\n\nDeviens holder pour y accéder 👇`,
            `🔒 <b>Holders only</b>\n\nThis group is reserved for those who hold <b>$FRANC</b> or who unlocked for life with Telegram ⭐.\n\nBecome a holder to get access 👇`
          ),
          { reply_markup: { inline_keyboard: [
            [{ text: '🔗 Wallet', url: WALLET_URL }, { text: '🔓 Cashback⭐', url: CASHBACK_DEEPLINK }],
            [
              { text: '💰 $Franc on SOL', url: BUY_FRANC_SOL_URL },
              { text: '💰 $Franc on TON', url: BUY_FRANC_TON_URL }
            ]
          ] } }
        )
      }
      return new Response('ok')
    }

    // ══════════════════════════════════════════════════════════
    //  CHICKEN COOP GROUP — accès unifié (Solana / TON / Stars)
    // ══════════════════════════════════════════════════════════
    // NB : les libellés de boutons du clavier (jeux, Coop, Poulailler…) sont EXCLUS
    // de ce bloc → ils filent vers leurs handlers plus bas (sinon ils étaient avalés
    // ici et « il ne se passait rien » quand on cliquait dans le groupe).
    if ((chatId === CHICKEN_COOP || chatId === POULAILLER_FR)
        && !text.startsWith('/setup')
        && !isKeyboardButton(text)) {

      const grpLang: 'en' | 'fr' = (chatId === POULAILLER_FR) ? 'fr' : 'en'

      // Owner toujours autorisé
      if (userId === OWNER_ID) return new Response('ok')

      // Si le message vient d'un canal lié (sender_chat) → ignore
      if (msg.sender_chat) return new Response('ok')

      // Vérifie le statut admin
      const status = await getChatMemberStatus(token, chatId, msg.from.id)
      console.log(`group msg: userId=${userId} status=${status}`)
      if (status === 'administrator' || status === 'creator') return new Response('ok')

      // ══════════════════════════════════════════════════════════
      //  ⏸️  GATING HOLDER EN ÉCRITURE — EN PAUSE
      //  Tout le monde peut écrire dans The Chicken Coop pour l'instant.
      //  On NE vérifie PLUS le statut holder à chaque message → on
      //  économise un appel getAccess() (donc des requêtes Supabase)
      //  sur CHAQUE message du groupe.
      //
      //  👉 POUR RÉACTIVER plus tard (groupe devenu gros) :
      //     décommente simplement le bloc ci-dessous.
      //     ⚠️ Le bot devra aussi avoir le droit "Delete messages".
      // ══════════════════════════════════════════════════════════
      /*
      // ── Accès unifié : holder SOL OU TON OU Stars ──
      const access = await getAccess(supabase, userId)
      console.log(`access check: userId=${userId} unlocked=${access.unlocked} reason=${access.reason}`)

      if (!access.unlocked) {
        await deleteMessage(token, chatId, messageId)
        try {
          await sendMessage(token, parseInt(userId),
            `✅ <b>Full access — Francis Universe 🐓</b>\n` +
            `• ✍️ Write messages in the group\n` +
            `• 🎮 10 lives & all bonuses unlocked in every game\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `⚠️ <b>Limited access</b>\n` +
            `• 👁 Read-only in the group — no messaging\n` +
            `• 🎮 1 life per game across all games\n\n` +
            `<b>To get full access to The Chicken Coop:</b>\n` +
            `1️⃣ Hold $FRANC on Solana or TON — or unlock with ⭐ Stars\n` +
            `2️⃣ Connect via the button below or type /connect`,
            { reply_markup: { inline_keyboard: [[
              { text: '🔗 Connect my wallet', url: WALLET_URL }],
              [{ text: '📊 My Status', callback_data: 'status' }]
            ]}}
          )
        } catch(_) {
          const mention = msg.from.username ? `@${msg.from.username}` : `<a href="tg://user?id=${userId}">${userName}</a>`
          await sendMessage(token, chatId,
            `🔒 ${mention} — This group is for $FRANC holders only. Use /connect`,
            threadId ? { message_thread_id: threadId } : {}
          )
        }
        return new Response('ok')
      }
      */

      // ── Modération légère : suppression des messages insultants ──
      // Liste de mots-clés (gratuit, pas d'IA). Nécessite que le bot
      // ait le droit "Delete messages" dans le groupe.
      if (isAbusive(rawText)) {
        await deleteMessage(token, chatId, messageId)
        return new Response('ok')
      }

      // ══════════════════════════════════════════════════════════
      //  🐓 FRANCIS IA — répond aux messages du groupe (Gemini Flash)
      //  Anti-flood : au plus 1 réponse toutes les 5 min (en mémoire,
      //  zéro Supabase). Réponse "à froid" via askFrancisAI().
      // ══════════════════════════════════════════════════════════
      {
        // On ne réagit qu'à de vrais messages texte (pas commandes, pas vide)
        const isPlainText = rawText.length > 0 && !rawText.startsWith('/')
        const cooledDown = (Date.now() - (lastFrancisReplyByChat[chatId] || 0)) > FRANCIS_COOLDOWN_MS
        if (isPlainText && cooledDown) {
          // Bot en pause pour ce groupe ? (piloté par /stopbot… /playbot… depuis le bot en privé)
          try {
            const { data: pauseRow } = await supabase.from('bot_pause').select('paused').eq('chat_id', chatId).single()
            if (pauseRow?.paused) return new Response('ok')
          } catch (_) { /* pas de ligne / table injoignable → on considère actif */ }
          // On arme le cooldown TOUT DE SUITE : la réponse part en tâche de
          // fond (après un délai), pour éviter qu'un 2e message reçu pendant
          // l'attente ne déclenche une réponse en double.
          lastFrancisReplyByChat[chatId] = Date.now()
          const bgMsgId = messageId
          const bgText = rawText
          const bgThread = threadId
          const bg = (async () => {
            const reply = await askFrancisAI(bgText, grpLang)
            if (!reply) { lastFrancisReplyByChat[chatId] = 0; return }  // rien à dire → on relâche le cooldown
            // Délai volontaire : Francis répond ~1 min après le message,
            // pour que l'échange paraisse naturel (pas instantané/robotique).
            await new Promise((r) => setTimeout(r, FRANCIS_REPLY_DELAY_MS))
            await sendMessage(token, chatId, reply,
              { reply_to_message_id: bgMsgId, ...(bgThread ? { message_thread_id: bgThread } : {}) })
          })()
          // Répond 200 immédiatement au webhook (sinon Telegram retente
          // l'update → doublons) tout en gardant l'isolate en vie pour la
          // tâche de fond.
          try { (globalThis as any).EdgeRuntime?.waitUntil?.(bg) } catch (_) { /* best effort */ }
        }
        return new Response('ok')
      }
    }

    // ══════════════════════════════════════════════════════════
    //  /setupW — Wallet Connect topic
    // ══════════════════════════════════════════════════════════
    if (text === '/setupwallet') {
      if (userId !== OWNER_ID) return new Response('ok')   // owner uniquement (tapé dans le bot)
      await deleteMessage(token, chatId, messageId)
      await mirrorEnSetup(token, EN_TOPIC.wallet,
        `🔗 <b>UNLOCK THE FULL EXPERIENCE</b>\n\n` +
        `Hold $FRANC on <b>Solana</b> or <b>TON</b> to unlock exclusive features across many games — plus a special 🌶️ spicy category. For free!\n\n` +
        `Or unlock everything with ⭐ Stars and get a generous cashback.\n\n` +
        `<i>$FRANC detection is automatic. Tap a button below to connect or unlock 👇</i>`,
        [
          [{ text: '🔗 Wallet', url: WALLET_URL }, { text: '🔓 Cashback⭐', url: CASHBACK_DEEPLINK }],
          [{ text: '💰 $Franc on SOL', url: BUY_FRANC_SOL_URL }, { text: '💰 $Franc on TON', url: BUY_FRANC_TON_URL }],
          [{ text: '📊 Check my status', callback_data: 'status' }],
          [{ text: '🐔 All games & rooster universe', url: MENU_DEEPLINK }]
        ]
      )
      // Version FR dans « Le Poulailler » (topic Wallet)
      await mirrorFrSetup(token, FR_TOPIC.wallet,
        `🔗 <b>DÉBLOQUE L'EXPÉRIENCE COMPLÈTE</b>\n\n` +
        `Détiens du $FRANC sur <b>Solana</b> ou <b>TON</b> pour débloquer des fonctionnalités exclusives dans de nombreux jeux — plus une catégorie 🌶️ épicée spéciale. Gratuitement !\n\n` +
        `Ou débloque tout avec des ⭐ Stars et reçois un généreux cashback.\n\n` +
        `<i>La détection du $FRANC est automatique. Touche un bouton ci-dessous pour te connecter ou débloquer 👇</i>`,
        [
          [{ text: '🔗 Wallet', url: WALLET_URL }, { text: '🔓 Cashback⭐', url: CASHBACK_DEEPLINK }],
          [{ text: '💰 $Franc sur SOL', url: BUY_FRANC_SOL_URL }, { text: '💰 $Franc sur TON', url: BUY_FRANC_TON_URL }],
          [{ text: '📊 Voir mon statut', callback_data: 'status' }],
          [{ text: '🐔 Tous les jeux & univers Francis', url: MENU_DEEPLINK }]
        ]
      )
      await sendMessage(token, chatId, tr('✅ Wallet publié et épinglé dans les deux groupes.', '✅ Wallet posted and pinned in both groups.'))
      return new Response('ok')
    }

    // ══════════════════════════════════════════════════════════
    //  /setupgames — message du topic "Games" (renvoie vers le bot)
    // ══════════════════════════════════════════════════════════
    if (text === '/setupgames') {
      if (userId !== OWNER_ID) return new Response('ok')   // owner uniquement (tapé dans le bot)
      await deleteMessage(token, chatId, messageId)
      await mirrorEnSetup(token, EN_TOPIC.games,
        `🎉 <b>Welcome to Francis' Games Universe</b>\n\n` +
        `🐓 <b>Tamagotchi</b> — Keep Francis alive\n` +
        `🔫 <b>FrancRun</b> — Run. Dodge. Score.\n` +
        `⛵ <b>Ormuz</b> — Survive the crossing\n` +
        `🥚 <b>EggClicker</b> — Grow your empire\n` +
        `🧩 <b>Sudoku</b> — Solve. Compete. Earn.\n` +
        `🎯 <b>Mastermind</b> — Crack the code\n` +
        `🟢 <b>Motus</b> — Guess the hidden word\n` +
        `🐍 <b>ChickenSnake</b> — Slither. Gobble. Grow.\n` +
        `🔍 <b>Words searches</b> — Spot. Circle. Score.`,
        [
          [{ text: '🐔 All games & Rooster Universe', url: MENU_DEEPLINK }],
          [{ text: '🐓 Tamagotchi', url: TAMAGOTCHI_URL }, { text: '🥚 EggClicker', url: EGGCLICKER_URL }],
          [{ text: '🔫 FrancRun', url: FRANCRUN_URL }, { text: '⛵ Ormuz', url: ORMUZ_URL }],
          [{ text: '🎯 Mastermind', url: MASTERMIND_URL }, { text: '🧩 Sudoku', url: SUDOKU_URL }],
          [{ text: '🟢 Motus', url: MOTUS_URL }, { text: '🐍 ChickenSnake', url: SNAKE_URL }],
          [{ text: '🔍 Words searches', url: WORDSEARCH_URL }],
          [{ text: '📜 Game Rules', url: RULES_DEEPLINK }]
        ]
      )
      // Version FR dans « Le Poulailler » (topic Jeux)
      await mirrorFrSetup(token, FR_TOPIC.games,
        `🎉 <b>Bienvenue dans l'univers des jeux de Francis</b>\n\n` +
        `🐓 <b>Tamagotchi</b> — Garde Francis en vie\n` +
        `🔫 <b>FrancRun</b> — Cours. Esquive. Score.\n` +
        `⛵ <b>Ormuz</b> — Survis à la traversée\n` +
        `🥚 <b>EggClicker</b> — Bâtis ton empire\n` +
        `🧩 <b>Sudoku</b> — Résous. Rivalise. Gagne.\n` +
        `🎯 <b>Mastermind</b> — Casse le code\n` +
        `🟢 <b>Motus</b> — Devine le mot caché\n` +
        `🐍 <b>ChickenSnake</b> — Rampe. Gobe. Grandis.\n` +
        `🔍 <b>Words searches</b> — Repère. Entoure. Score.`,
        [
          [{ text: '🐔 Tous les jeux & univers Francis', url: MENU_DEEPLINK }],
          [{ text: '🐓 Tamagotchi', url: TAMAGOTCHI_URL }, { text: '🥚 EggClicker', url: EGGCLICKER_URL }],
          [{ text: '🔫 FrancRun', url: FRANCRUN_URL }, { text: '⛵ Ormuz', url: ORMUZ_URL }],
          [{ text: '🎯 Mastermind', url: MASTERMIND_URL }, { text: '🧩 Sudoku', url: SUDOKU_URL }],
          [{ text: '🟢 Motus', url: MOTUS_URL }, { text: '🐍 ChickenSnake', url: SNAKE_URL }],
          [{ text: '🔍 Words searches', url: WORDSEARCH_URL }],
          [{ text: '📜 Règles des jeux', url: RULES_DEEPLINK }]
        ]
      )
      await sendMessage(token, chatId, tr('✅ Jeux publiés et épinglés dans les deux groupes.', '✅ Games posted and pinned in both groups.'))
      return new Response('ok')
    }

    if (text === '/setupchickencoop') {
      if (userId !== OWNER_ID) return new Response('ok')   // owner uniquement (tapé dans le bot)
      await deleteMessage(token, chatId, messageId)
      await mirrorEnSetup(token, EN_TOPIC.coop,
        `🐓 <b>Welcome to The Chicken Coop!</b>\n\n` +
        `The official home of <b>$FRANC by Francis the rooster</b> — a community memecoin with a whole universe of games. 🎮\n\n` +
        `Find your way around:\n` +
        `💰 <b>Crypto Coop</b> — non-stop crypto news, decoded\n` +
        `📰 <b>World Roost</b> — the world's biggest stories, every day\n` +
        `🔥 <b>Hot Wings</b> — the spiciest must-read headlines\n` +
        `🏁 <b>Cocorico Racing</b> — F1 & MotoGP highlights, race by race\n` +
        `🎮 <b>Games</b> — play all of Francis' mini-games\n` +
        `🌶️ <b>Backstage (Soon)</b> — the devs' spicy corner, coming soon\n` +
        `🔗 <b>Wallet</b> — connect & unlock the full experience\n\n` +
        `👉 <b>Everything is free — you just need to be a holder!</b>\n` +
        `💲 Hold just 1 $FRANC to unlock everything — it costs less than a cent!\n` +
        `💲 Not a holder yet? Unlock everything with ⭐ Stars and get $FRANC cashback!\n\n` +
        `Have fun, be kind, and enjoy the coop! 🐔\n` +
        `🌐 Group language: 🇬🇧`,
        [
          [{ text: '🐔 All games & Rooster Universe', url: MENU_DEEPLINK }],
          [{ text: '📜 Game Rules', url: RULES_DEEPLINK }, { text: '🔗 Wallet', url: WALLET_URL }],
          [{ text: '💰 $Franc on TON', url: BUY_FRANC_TON_URL }, { text: '💰 $Franc on SOL', url: BUY_FRANC_SOL_URL }]
        ]
      )
      // Version FR dans « Le Poulailler » (topic Accueil)
      await mirrorFrSetup(token, FR_TOPIC.coop,
        `🐓 <b>Bienvenue au Poulailler !</b>\n\n` +
        `La maison officielle de <b>$FRANC by Francis le coq</b> — un memecoin communautaire avec tout un univers de jeux. 🎮\n\n` +
        `Repère-toi facilement :\n` +
        `💰 <b>Crypto Cocorico</b> — l'actu crypto en continu, décryptée\n` +
        `📰 <b>Le Chant du Monde</b> — les grandes actus internationales, chaque jour\n` +
        `🔥 <b>Le Poulailler Interdit</b> — l'actu hot à ne pas manquer\n` +
        `🏁 <b>Cocorico Racing</b> — F1 & MotoGP, les temps forts course après course\n` +
        `🎮 <b>Jeux</b> — des mini-jeux uniques à l'effigie du coq\n` +
        `🔞 <b>Les Plumes Chaudes (bientôt)</b> — le contenu très hot des dev, à venir\n` +
        `🔗 <b>Portefeuille</b> — connecte-toi & débloque tout l'univers\n\n` +
        `👉 <b>Tout est gratuit — il suffit d'être holder !</b>\n` +
        `💲 Détiens seulement 1 $FRANC pour tout débloquer — moins d'un centime !\n` +
        `💲 Pas encore holder ? Débloque tout avec des ⭐ Stars et reçois du cashback $FRANC !\n\n` +
        `Amuse-toi, sois sympa, et profite du poulailler ! 🐔\n` +
        `🌐 Langue du groupe : 🇫🇷`,
        [
          [{ text: '🐔 Tous les jeux & univers Francis', url: MENU_DEEPLINK }],
          [{ text: '📜 Règles des jeux', url: RULES_DEEPLINK }, { text: '🔗 Wallet', url: WALLET_URL }],
          [{ text: '💰 $Franc sur TON', url: BUY_FRANC_TON_URL }, { text: '💰 $Franc sur SOL', url: BUY_FRANC_SOL_URL }]
        ]
      )
      await sendMessage(token, chatId, tr('✅ Chicken Coop publié et épinglé dans les deux groupes.', '✅ Chicken Coop posted and pinned in both groups.'))
      return new Response('ok')
    }

    // ══════════════════════════════════════════════════════════
    //  /setuphotwings — présentation du topic Hot (🌶️)
    // ══════════════════════════════════════════════════════════
    if (text === '/setuphotwings') {
      if (userId !== OWNER_ID) return new Response('ok')   // owner uniquement (tapé dans le bot)
      await deleteMessage(token, chatId, messageId)
      await mirrorEnSetup(token, EN_TOPIC.hotwings,
        `🌶️ <b>Hot Wings</b>\n\n` +
        `The spiciest corner of the coop: the must-read headlines from the adult-entertainment industry — new releases, performers, launches, awards and big moves. Playful and flirty, always tasteful. 🔥\n\n` +
        `🕒 <b>Posted every day (Paris time):</b>\n` +
        `👉 11:35 — Hot morning\n` +
        `👉 15:15 — Hot midday\n` +
        `👉 19:50 — Hot evening`,
        [[{ text: '🔗 Wallet', url: WALLET_URL }, { text: '🐔 Rooster Universe', url: MENU_DEEPLINK }]]
      )
      await mirrorFrSetup(token, FR_TOPIC.hotwings,
        `🌶️ <b>Le Poulailler Interdit</b>\n\n` +
        `Le coin le plus épicé du poulailler : l'actu à ne pas manquer de l'industrie du divertissement pour adultes — sorties, stars, lancements, récompenses et gros mouvements. Taquin et coquin, toujours avec classe. 🔥\n\n` +
        `🕒 <b>Diffusion chaque jour (heure de Paris) :</b>\n` +
        `👉 11:35 — Hot du matin\n` +
        `👉 15:15 — Hot du midi\n` +
        `👉 19:50 — Hot du soir`,
        [[{ text: '🔗 Wallet', url: WALLET_URL }, { text: '🐔 Univers Francis', url: MENU_DEEPLINK }]]
      )
      await sendMessage(token, chatId, tr('✅ Hot Wings publié et épinglé dans les deux groupes.', '✅ Hot Wings posted and pinned in both groups.'))
      return new Response('ok')
    }

    // ══════════════════════════════════════════════════════════
    //  /setupcryptocoop — présentation du topic Crypto (💰)
    // ══════════════════════════════════════════════════════════
    if (text === '/setupcryptocoop') {
      if (userId !== OWNER_ID) return new Response('ok')   // owner uniquement (tapé dans le bot)
      await deleteMessage(token, chatId, messageId)
      await mirrorEnSetup(token, EN_TOPIC.cryptocoop,
        `💰 <b>Crypto Coop</b>\n\n` +
        `Non-stop crypto news, decoded for everyone: the biggest market moves, regulation, ETFs, hacks and adoption — plus a daily "Cocorico Pump" spotlight on the top 24h gainer, and an end-of-day wrap. 🐓\n\n` +
        `🕒 <b>Posted every day (Paris time):</b>\n` +
        `👉 07:55 — GM / Morning\n` +
        `👉 09:45 — 🚀 Cocorico Pump\n` +
        `👉 12:30 — Midday\n` +
        `👉 17:05 — 🚀 Cocorico Pump\n` +
        `👉 18:55 — Evening\n` +
        `👉 20:45 — Night wrap`,
        [[{ text: '💰 $Franc on SOL', url: BUY_FRANC_SOL_URL }, { text: '💰 $Franc on TON', url: BUY_FRANC_TON_URL }]]
      )
      await mirrorFrSetup(token, FR_TOPIC.cryptocoop,
        `💰 <b>Crypto Cocorico</b>\n\n` +
        `L'actu crypto en continu, décryptée pour tous : les gros mouvements de marché, la régulation, les ETF, les hacks et l'adoption — plus un « Cocorico Pump » quotidien sur le plus gros gagnant 24h, et un récap de fin de journée. 🐓\n\n` +
        `🕒 <b>Diffusion chaque jour (heure de Paris) :</b>\n` +
        `👉 07:55 — GM / Matin\n` +
        `👉 09:45 — 🚀 Cocorico Pump\n` +
        `👉 12:30 — Midi\n` +
        `👉 17:05 — 🚀 Cocorico Pump\n` +
        `👉 18:55 — Soir\n` +
        `👉 20:45 — Récap du soir`,
        [[{ text: '💰 $Franc sur SOL', url: BUY_FRANC_SOL_URL }, { text: '💰 $Franc sur TON', url: BUY_FRANC_TON_URL }]]
      )
      await sendMessage(token, chatId, tr('✅ Crypto Coop publié et épinglé dans les deux groupes.', '✅ Crypto Coop posted and pinned in both groups.'))
      return new Response('ok')
    }

    // ══════════════════════════════════════════════════════════
    //  /setupworldroost — présentation du topic World (📰)
    // ══════════════════════════════════════════════════════════
    if (text === '/setupworldroost') {
      if (userId !== OWNER_ID) return new Response('ok')   // owner uniquement (tapé dans le bot)
      await deleteMessage(token, chatId, messageId)
      await mirrorEnSetup(token, EN_TOPIC.worldroost,
        `📰 <b>World Roost</b>\n\n` +
        `The world's biggest stories, every day, clear and to the point: geopolitics, economy, tech and the evening brief — so you never miss what matters. 🌍\n\n` +
        `🕒 <b>Posted every day (Paris time):</b>\n` +
        `👉 07:00 — Wake-up brief\n` +
        `👉 10:40 — Cocorico Eco\n` +
        `👉 13:25 — Midday news\n` +
        `👉 16:10 — Cocorico Tech\n` +
        `👉 18:00 — The World Tonight\n` +
        `👉 21:40 — The Day in Review`,
        [[{ text: '🔗 Wallet', url: WALLET_URL }, { text: '🐔 Rooster Universe', url: MENU_DEEPLINK }]]
      )
      await mirrorFrSetup(token, FR_TOPIC.worldroost,
        `📰 <b>Le Chant du Monde</b>\n\n` +
        `Les grandes actus internationales, chaque jour, claires et à l'essentiel : géopolitique, économie, tech et le brief du soir — pour ne rien rater de ce qui compte. 🌍\n\n` +
        `🕒 <b>Diffusion chaque jour (heure de Paris) :</b>\n` +
        `👉 07:00 — Réveil Info\n` +
        `👉 10:40 — Cocorico Éco\n` +
        `👉 13:25 — Actu Midi\n` +
        `👉 16:10 — Cocorico Tech\n` +
        `👉 18:00 — Le Monde ce Soir\n` +
        `👉 21:40 — L'actu du Jour en Bref`,
        [[{ text: '🔗 Wallet', url: WALLET_URL }, { text: '🐔 Univers Francis', url: MENU_DEEPLINK }]]
      )
      await sendMessage(token, chatId, tr('✅ World Roost publié et épinglé dans les deux groupes.', '✅ World Roost posted and pinned in both groups.'))
      return new Response('ok')
    }

    // ══════════════════════════════════════════════════════════
    //  BOT COMMANDS (private chat)
    // ══════════════════════════════════════════════════════════

    // Deep-link "?start=cashback" → ouvre directement l'offre Stars
    if (text === '/start cashback') {
      if (msg.chat?.type === 'private') {
        await sendCashbackOffer(token, chatId, isFR, supabase, userId)
        return new Response('ok')
      }
    }

    if (text === '/rules' || text === '/start rules' || btnIs(text, 'rules')) {
      await sendMessage(token, chatId, RULES_MENU_TEXT, {
        reply_markup: buildRulesMenuKeyboard()
      })
      return new Response('ok')
    }

    if (text === '/start' || text === '/start menu' || text === '/help' || text === '/play' || btnIs(text, 'refresh')) {
      // Accès unifié (Solana / TON / Stars) pour enrichir le message de bienvenue
      const access = await getAccess(supabase, userId)

      let welcomeText = tr(
        `🐓 <b>Francis Le Coq Bot</b>\n\n` +
        `Commandes disponibles :\n\n` +
        `🔗 /connectsolana — Lier ton wallet Solana\n` +
        `💎 /connecton — Connecter ton wallet TON (in-app)\n` +
        `⭐ /buystars — Débloquer via Stars (+ cashback)\n` +
        `🔓 /disconnect — Délier ton wallet\n` +
        `📊 /status     — Vérifier ton solde $FRANC\n` +
        `🇫🇷 /fr · 🇬🇧 /en — Changer de langue\n\n`,
        `🐓 <b>Francis Le Coq Bot</b>\n\n` +
        `Available commands:\n\n` +
        `🔗 /connectsolana — Link your Solana wallet\n` +
        `💎 /connecton — Connect your TON wallet (in-app)\n` +
        `⭐ /buystars — Unlock via Stars (+ cashback)\n` +
        `🔓 /disconnect — Unlink your wallet\n` +
        `📊 /status     — Check your $FRANC balance\n` +
        `🇫🇷 /fr · 🇬🇧 /en — Change language\n\n`
      )

      if (access.row) {
        // Rafraîchit le solde Solana si une adresse Solana est liée
        if (access.row.wallet_address) {
          const balance  = await getFrancBalance(access.row.wallet_address)
          const hasFranc = balance > 0
          await supabase.from('wallets').update({
            franc_balance: balance, has_franc: hasFranc,
            balance_checked_at: new Date().toISOString()
          }).eq('telegram_id', userId)
        }
        // Recalcule l'accès après rafraîchissement
        const fresh = await getAccess(supabase, userId)
        welcomeText += `━━━━━━━━━━━━━━━━━━━━\n` + statusText(fresh, isFR)
      } else {
        welcomeText += tr(
          `<i>Détiens du $FRANC pour :\n` +
          `• Écrire dans The Chicken Coop 🐔\n` +
          `• Obtenir 10 vies dans les jeux 🎮</i>`,
          `<i>Hold $FRANC to:\n` +
          `• Write in The Chicken Coop 🐔\n` +
          `• Get 10 lives in games 🎮</i>`
        )
      }

      await sendMessage(token, chatId, welcomeText, {
        reply_markup: buildInlineMenu(isFR)
      })
      // Install the persistent keyboard below the input bar
      await sendMessage(token, chatId, tr('💡 Utilise le menu ci-dessous pour naviguer 👇','💡 Use the menu below to navigate 👇'), {
        reply_markup: buildKeyboard(isFR)
      })
      return new Response('ok')
    }

    // ── Persistent keyboard button handlers ──────────────────
    if (btnIs(text, 'wordsearch')) {
      await sendMessage(token, chatId,
        tr(`🔍 <b>WORDS SEARCHES</b>\nSpot. Circle. Score. — retrouve tous les mots cachés dans la grille ! 🐔`,
           `🔍 <b>WORDS SEARCHES</b>\nSpot. Circle. Score. — find every hidden word in the grid! 🐔`),
        { reply_markup: { inline_keyboard: [
          [{ text: tr('🔍 Jouer aux Mots mêlés','🔍 Play Words searches'), url: WORDSEARCH_URL }]
        ]}}
      )
      return new Response('ok')
    }

    if (btnIs(text, 'snake')) {
      await sendMessage(token, chatId,
        tr(`🐍 <b>CHICKEN SNAKE</b>\nGuide le serpent, gobe les œufs et bats ton record ! 🐔`,
           `🐍 <b>CHICKEN SNAKE</b>\nGuide the snake, gobble the eggs and beat your high score! 🐔`),
        { reply_markup: { inline_keyboard: [
          [{ text: tr('🐍 Jouer à ChickenSnake','🐍 Play ChickenSnake'), url: SNAKE_URL }]
        ]}}
      )
      return new Response('ok')
    }

    if (btnIs(text, 'francrun')) {
      await sendMessage(token, chatId,
        tr(`🐓 <b>FRANC RUN</b>\nRamasse des œufs, esquive les ennemis, grimpe 11 niveaux !`,
           `🐓 <b>FRANC RUN</b>\nCollect eggs, dodge enemies, climb 11 levels!`),
        { reply_markup: { inline_keyboard: [
          [{ text: tr('🎮 Jouer à FrancRun','🎮 Play FrancRun'), url: FRANCRUN_URL }]
        ]}}
      )
      return new Response('ok')
    }

    if (btnIs(text, 'ormuz')) {
      await sendMessage(token, chatId,
        tr(`⛵ <b>ORMUZ</b>\nTraverse le détroit d'Ormuz — survis au chaos !`,
           `⛵ <b>ORMUZ</b>\nCross the Strait of Hormuz — survive the chaos!`),
        { reply_markup: { inline_keyboard: [
          [{ text: tr('⛵ Jouer à Ormuz','⛵ Play Ormuz'), url: ORMUZ_URL }]
        ]}}
      )
      return new Response('ok')
    }

    if (btnIs(text, 'eggclicker')) {
      await sendMessage(token, chatId,
        tr(`🥚 <b>EGG CLICKER</b>\nProduis des œufs, achète des bâtiments, bâtis ton empire !`,
           `🥚 <b>EGG CLICKER</b>\nProduce eggs, buy buildings, build a farming empire!`),
        { reply_markup: { inline_keyboard: [
          [{ text: tr('🥚 Jouer à EggClicker','🥚 Play EggClicker'), url: EGGCLICKER_URL }]
        ]}}
      )
      return new Response('ok')
    }

    if (btnIs(text, 'tamagotchi')) {
      await sendMessage(token, chatId,
        tr(`🐓 <b>TAMAGOTCHI</b>\nÉlève Francis le coq — nourris-le, joue avec lui, regarde-le évoluer !`,
           `🐓 <b>TAMAGOTCHI</b>\nRaise Francis the rooster — feed him, play with him, watch him evolve!`),
        { reply_markup: { inline_keyboard: [
          [{ text: tr('🎮 Jouer au Tamagotchi','🎮 Play Tamagotchi'), url: TAMAGOTCHI_URL }]
        ]}}
      )
      return new Response('ok')
    }

    if (btnIs(text, 'sudoku')) {
      await sendMessage(token, chatId,
        tr(`🧩 <b>SUDOKU</b>\nRésous des grilles, grimpe au classement et gagne du $FRANC virtuel !`,
           `🧩 <b>SUDOKU</b>\nSolve grids, climb the ranks and earn virtual $FRANC!`),
        { reply_markup: { inline_keyboard: [
          [{ text: tr('🧩 Jouer au Sudoku','🧩 Play Sudoku'), url: SUDOKU_URL }]
        ]}}
      )
      return new Response('ok')
    }

    if (btnIs(text, 'mastermind')) {
      await sendMessage(token, chatId,
        tr(`🎯 <b>MASTERMIND</b>\nPerce le code couleur secret de Francis avant d'épuiser tes essais !`,
           `🎯 <b>MASTERMIND</b>\nCrack Francis's secret color code before you run out of tries!`),
        { reply_markup: { inline_keyboard: [
          [{ text: tr('🎯 Jouer au Mastermind','🎯 Play Mastermind'), url: MASTERMIND_URL }]
        ]}}
      )
      return new Response('ok')
    }

    if (btnIs(text, 'motus')) {
      await sendMessage(token, chatId,
        tr(`🟢 <b>MOTUS</b>\nDevine le mot caché ! Chaque essai te dit quelles lettres sont bien placées. 🐔`,
           `🟢 <b>MOTUS</b>\nGuess the hidden word! Each try tells you which letters are correctly placed. 🐔`),
        { reply_markup: { inline_keyboard: [
          [{ text: tr('🟢 Jouer à Motus','🟢 Play Motus'), url: MOTUS_URL }]
        ]}}
      )
      return new Response('ok')
    }

    if (btnIs(text, 'cashback')) {
      if (msg.chat?.type !== 'private') return new Response('ok')
      await sendCashbackOffer(token, chatId, isFR, supabase, userId)
      return new Response('ok')
    }

    if (btnIs(text, 'wallet')) {
      await sendMessage(token, chatId,
        tr(`🔗 <b>Wallet</b>\nConnecte ton wallet Solana ou TON pour débloquer gratuitement toutes les fonctionnalités des jeux.\n\nOu opte pour un achat ⭐ accompagné d'un généreux cashback. Tu peux aussi vérifier ton statut ci-dessous 👇`,
           `🔗 <b>Wallet</b>\nConnect your Solana or TON wallet to unlock all game features for free.\n\nOr go for a ⭐ purchase with a generous cashback. You can also check your status below 👇`),
        { reply_markup: { inline_keyboard: [
          [
            { text: tr('💎 Connecter sur TON','💎 Connect on TON'), url: WALLET_URL },
            { text: tr('◎ Connecter sur SOL','◎ Connect on SOL'), callback_data: 'connectsol' }
          ],
          [
            { text: tr('📊 Mon statut','📊 My Status'), callback_data: 'status' },
            { text: '🔓 Cashback⭐', callback_data: 'cashback' }
          ]
        ]}}
      )
      return new Response('ok')
    }

    if (btnIs(text, 'francSol') || btnIs(text, 'francTon') || text === '💰 buy $franc') {
      await sendMessage(token, chatId,
        tr(`💰 <b>Acheter du $FRANC</b>\nChoisis ton réseau et procure-toi tes tokens pour débloquer tous les avantages !`,
           `💰 <b>Buy $FRANC</b>\nPick your network and grab your tokens to unlock all benefits!`),
        { reply_markup: { inline_keyboard: [
          [
            { text: '💰 $Franc on SOL', url: BUY_FRANC_SOL_URL },
            { text: '💰 $Franc on TON', url: BUY_FRANC_TON_URL }
          ]
        ]}}
      )
      return new Response('ok')
    }

    if (btnIs(text, 'coop')) {
      await sendMessage(token, chatId,
        tr(`🐓 <b>The Chicken Coop 🗺️</b>\nLe groupe international (anglophone) de la communauté $FRANC !`,
           `🐓 <b>The Chicken Coop 🗺️</b>\nOur international (English-speaking) $FRANC community!`),
        { reply_markup: { inline_keyboard: [
          [{ text: tr('🐓 Rejoindre The Chicken Coop','🐓 Join The Chicken Coop'), url: CHICKEN_COOP_URL }]
        ]}}
      )
      return new Response('ok')
    }

    if (btnIs(text, 'poulailler')) {
      await sendMessage(token, chatId,
        tr(`🐓 <b>Le Poulailler 🇫🇷</b>\nLe groupe francophone de la communauté $FRANC — bienvenue chez les Français !`,
           `🐓 <b>Le Poulailler 🇫🇷</b>\nThe French-speaking $FRANC community group!`),
        { reply_markup: { inline_keyboard: [
          [{ text: tr('🐓 Rejoindre Le Poulailler','🐓 Join Le Poulailler'), url: POULAILLER_URL }]
        ]}}
      )
      return new Response('ok')
    }

    // ══════════════════════════════════════════════════════════
    //  /skip — remettre à plus tard la saisie de l'adresse cashback
    //  La réclamation reste 'unclaimed' : le joueur peut faire
    //  /cashback ADRESSE quand il veut, même des mois après.
    // ══════════════════════════════════════════════════════════
    if (text === '/skip') {
      const { data: w } = await supabase
        .from('wallets').select('stars_unlocked').eq('telegram_id', userId).single()
      if (!w?.stars_unlocked) {
        await sendMessage(token, chatId,
          tr(`ℹ️ Rien à reporter — tu n'as pas encore de cashback en attente.`,
             `ℹ️ Nothing to skip — you don't have a pending cashback yet.`))
        return new Response('ok')
      }
      // Déjà payé ? on le dit clairement.
      const { data: paid } = await supabase
        .from('cashback_claims').select('id').eq('telegram_id', userId).eq('status','paid').limit(1).single()
      if (paid) {
        await sendMessage(token, chatId,
          tr(`✅ Ton cashback a déjà été envoyé. C'est scellé ! 🐓`,
             `✅ Your cashback has already been sent. It's sealed! 🐓`))
        return new Response('ok')
      }
      await sendMessage(token, chatId,
        tr(
          `👍 <b>Pas de souci !</b>\n\nTon cashback de <b>50⭐ en $FRANC</b> est mis de côté.\nReviens quand tu veux — même dans 3 mois — et tape simplement :\n<code>/cashback TON_ADRESSE</code>\n\n<i>Ton accès reste débloqué à vie. 🐓</i>`,
          `👍 <b>No worries!</b>\n\nYour <b>50⭐ in $FRANC</b> cashback is set aside.\nCome back anytime — even in 3 months — and just type:\n<code>/cashback YOUR_ADDRESS</code>\n\n<i>Your access stays unlocked for life. 🐓</i>`
        )
      )
      return new Response('ok')
    }

    // ══════════════════════════════════════════════════════════
    //  /cashback <address> — réclamer le cashback après un achat Stars
    //  Réservé aux acheteurs Stars. Complète une réclamation 'unclaimed'
    //  (ou en crée une) avec l'adresse, puis notifie le owner.
    // ══════════════════════════════════════════════════════════
    if (text === '/cashback' || text.startsWith('/cashback ') || text.startsWith('/cashback@')) {
      // Vérifie que l'utilisateur a bien débloqué via Stars
      const { data: w } = await supabase
        .from('wallets').select('stars_unlocked').eq('telegram_id', userId).single()
      if (!w?.stars_unlocked) {
        await sendMessage(token, chatId,
          tr(
            `❌ Le cashback est réservé aux déblocages via Stars.\n\nDébloque d'abord l'univers Francis avec des ⭐ : <a href="${WALLET_URL}">ouvre la page wallet</a>.`,
            `❌ Cashback is only for Stars unlocks.\n\nUnlock the Francis universe with ⭐ first: <a href="${WALLET_URL}">open the wallet page</a>.`
          )
        )
        return new Response('ok')
      }

      // Extrait l'adresse depuis le texte BRUT (préserve la casse, vital pour TON)
      // Format attendu : "/cashback <address>"
      const afterCmd = rawText.replace(/^\/cashback(@\S+)?/i, '').trim()
      if (!afterCmd) {
        await sendMessage(token, chatId,
          tr(
            `💰 <b>Réclame ton cashback</b>\n\nEnvoie ton adresse de wallet comme ceci :\n<code>/cashback TON_ADRESSE</code>\n\n<i>Adresse TON (UQ… / EQ…) ou Solana acceptée.</i>`,
            `💰 <b>Claim your cashback</b>\n\nSend your wallet address like this:\n<code>/cashback YOUR_ADDRESS</code>\n\n<i>TON (UQ… / EQ…) or Solana address accepted.</i>`
          )
        )
        return new Response('ok')
      }

      // Détecte la chaîne d'après le format de l'adresse
      let chain: string | null = null
      if (isValidTon(afterCmd))         chain = 'ton'
      else if (isValidSolana(afterCmd)) chain = 'solana'
      if (!chain) {
        await sendMessage(token, chatId,
          tr(
            `❌ Adresse invalide.\n\nEnvoie une adresse TON (UQ…/EQ…) ou Solana valide :\n<code>/cashback TON_ADRESSE</code>`,
            `❌ Invalid address.\n\nPlease send a valid TON (UQ…/EQ…) or Solana address:\n<code>/cashback YOUR_ADDRESS</code>`
          )
        )
        return new Response('ok')
      }

      // ── VERROU ANTI-MULTI-CASHBACK ─────────────────────────────
      // 1 seul cashback par joueur À VIE. On regarde TOUTES les
      // réclamations (y compris 'pending' et 'paid'), pas seulement
      // les 'unclaimed' — sinon un joueur payé pourrait en recréer une.
      const { data: allClaims } = await supabase
        .from('cashback_claims')
        .select('id, status')
        .eq('telegram_id', userId)
        .order('created_at', { ascending: false })

      const paidClaim    = allClaims?.find((c: any) => c.status === 'paid')
      const pendingClaim = allClaims?.find((c: any) => c.status === 'pending')
      const existingClaim = allClaims?.find((c: any) => c.status === 'unclaimed') ?? null

      // Déjà payé → scellé définitivement.
      if (paidClaim) {
        await sendMessage(token, chatId,
          tr(`✅ Ton cashback a déjà été envoyé. Un seul cashback par joueur — c'est scellé ! 🐓`,
             `✅ Your cashback has already been sent. One cashback per player — it's sealed! 🐓`)
        )
        return new Response('ok')
      }
      // Déjà en cours de traitement → on attend.
      if (pendingClaim) {
        await sendMessage(token, chatId,
          tr(`✅ Tu as déjà un cashback en cours de traitement. Il sera envoyé à ton adresse sous peu. 🐓`,
             `✅ You already have a cashback being processed. It'll be sent to your address shortly. 🐓`)
        )
        return new Response('ok')
      }

      let claimId: number | null = existingClaim?.id ?? null

      if (existingClaim) {
        // 'unclaimed' → on complète avec l'adresse et on passe en 'pending'
        await supabase.from('cashback_claims').update({
          chain, payout_address: afterCmd, status: 'pending'
        }).eq('id', existingClaim.id)
      } else {
        // Pas de réclamation existante → on en crée une (acheteur Stars confirmé)
        const { data: created } = await supabase.from('cashback_claims').insert({
          telegram_id: userId,
          username: msg.from?.username ?? null,
          name: userName,
          chain, payout_address: afterCmd,
          stars_paid: 100, cashback_stars: 50,
          status: 'pending'
        }).select('id').single()
        claimId = created?.id ?? null
      }

      // Confirme à l'utilisateur
      await sendMessage(token, chatId,
        tr(
          `✅ <b>Cashback demandé !</b>\n\nTon <b>équivalent de 50 ⭐ en $FRANC</b> sera envoyé manuellement à ton adresse sous peu. 🐓`,
          `✅ <b>Cashback requested!</b>\n\nYour <b>50 ⭐ worth of $FRANC</b> will be sent manually to your address shortly. 🐓`
        )
      )

      // Notifie le owner avec symbole de chaîne + bouton Payé
      const sym = chain === 'ton' ? '💎' : '◎'
      const uname = msg.from?.username ? `@${msg.from.username}` : userName
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: parseInt(CASHBACK_NOTIFY_ID), parse_mode: 'HTML',
          disable_web_page_preview: true,
          text: `💰 <b>NEW CASHBACK TO PAY</b> (#${claimId ?? '?'})\n\n` +
            `👤 ${uname}\n` +
            `${sym} <b>${chain.toUpperCase()}</b>\n` +
            `📬 <code>${afterCmd}</code>\n\n` +
            `⭐ Cashback: <b>50 ⭐ worth of $FRANC</b>\n\n` +
            `<i>Send the $FRANC on ${chain.toUpperCase()}, then tap below.</i>`,
          reply_markup: claimId ? { inline_keyboard: [[
            { text: '✅ Mark as paid', callback_data: `cbpaid:${claimId}` }
          ]]} : undefined
        })
      })
      return new Response('ok')
    }

    // ══════════════════════════════════════════════════════════
    //  /disconnect — NON DESTRUCTIF
    //  Neutralise le wallet (SOL + TON) mais conserve la ligne.
    //  stars_unlocked n'est JAMAIS modifié → l'accès Stars survit.
    // ══════════════════════════════════════════════════════════
    if (text === '/disconnect') {
      const { data: existing } = await supabase
        .from('wallets')
        .select('wallet_address, ton_address, stars_unlocked')
        .eq('telegram_id', userId).single()

      if (!existing) {
        await sendMessage(token, chatId, tr(`❌ Aucun wallet lié à ton compte.`,`❌ No wallet linked to your account.`))
        return new Response('ok')
      }

      // Acheteur Stars sans wallet → rien à déconnecter, accès permanent intact
      if (!existing.wallet_address && !existing.ton_address) {
        if (existing.stars_unlocked) {
          await sendMessage(token, chatId,
            tr(
              `⭐ <b>Ton accès a été débloqué avec des Stars.</b>\n\nIl est permanent et n'est pas lié à un wallet — il n'y a rien à déconnecter.\n\n<i>Tu gardes l'accès complet à tout l'univers Francis. 🐓</i>`,
              `⭐ <b>Your access was unlocked with Stars.</b>\n\nIt's permanent and not tied to a wallet — there's nothing to disconnect.\n\n<i>You keep full access to the whole Francis universe. 🐓</i>`
            )
          )
        } else {
          await sendMessage(token, chatId, tr(`❌ Aucun wallet lié à ton compte.`,`❌ No wallet linked to your account.`))
        }
        return new Response('ok')
      }

      // Neutralise le wallet SANS supprimer la ligne ni toucher stars_unlocked
      const { error } = await supabase.from('wallets').update({
        wallet_address:     null,
        franc_balance:      0,
        has_franc:          false,
        balance_checked_at: null,
        ton_address:        null,
        ton_balance:        0,
        has_franc_ton:      false,
        ton_checked_at:     null,
        updated_at:         new Date().toISOString()
      }).eq('telegram_id', userId)

      if (error) {
        await sendMessage(token, chatId, tr(`❌ Erreur lors de la déconnexion. Réessaie.`,`❌ Error while disconnecting. Please try again.`))
      } else {
        const addr  = existing.wallet_address || existing.ton_address
        const short = addr.slice(0,6)+'...'+addr.slice(-4)
        const starsNote = existing.stars_unlocked
          ? tr(`\n\n⭐ <i>Ton déblocage Stars reste actif — tu gardes l'accès complet.</i>`,`\n\n⭐ <i>Your Stars unlock stays active — you keep full access.</i>`)
          : ``
        await sendMessage(token, chatId,
          tr(
            `✅ <b>Wallet déconnecté</b>\n\n👛 ${short} a été délié de ton compte.${starsNote}\n\n<i>Utilise /connect pour lier un nouveau wallet.</i>`,
            `✅ <b>Wallet disconnected</b>\n\n👛 ${short} has been unlinked from your account.${starsNote}\n\n<i>Use /connect to link a new wallet.</i>`
          )
        )
      }
      return new Response('ok')
    }

    if (text === '/connectsolana' || text === '/connect') {
      await supabase.from('pending_connects')
        .upsert({ telegram_id: userId, created_at: new Date().toISOString() })
      await sendMessage(token, chatId,
        tr(
          `🔗 <b>Connecte ton wallet Solana</b>\n\n` +
          `La détection de $FRANC est automatique, colle uniquement ton adresse publique Solana ici 👇\n\n` +
          `<i>Exemple : 7xKXtg2CW87d...AsU</i>`,
          `🔗 <b>Connect your Solana wallet</b>\n\n` +
          `$FRANC detection is automatic — just paste your public Solana address here 👇\n\n` +
          `<i>Example: 7xKXtg2CW87d...AsU</i>`
        )
      )
      return new Response('ok')
    }

    // /connecton — connexion TON via la Mini App (TON Connect in-app)
    if (text === '/connecton') {
      await sendMessage(token, chatId,
        tr(
          `💎 <b>Connecte ton wallet TON</b>\n\nConnecte ton wallet directement dans l'app, sans rien coller. Appuie sur le bouton 👇`,
          `💎 <b>Connect your TON wallet</b>\n\nConnect your wallet right inside the app — nothing to paste. Tap the button 👇`
        ),
        { reply_markup: { inline_keyboard: [[
          { text: tr('💎 Connecter sur TON','💎 Connect on TON'), url: WALLET_URL }
        ]]}}
      )
      return new Response('ok')
    }

    // /buystars — débloquer via Stars (offre cashback)
    if (text === '/buystars') {
      if (msg.chat?.type !== 'private') return new Response('ok')
      await sendCashbackOffer(token, chatId, isFR, supabase, userId)
      return new Response('ok')
    }

    if (text === '/status' || text === '/start status') {
      const access = await getAccess(supabase, userId)
      if (!access.row) {
        await sendMessage(token, chatId,
          tr(`❌ Aucun wallet lié.\n\nUtilise /connect ou <a href="${WALLET_URL}">ouvre la page wallet</a>.`,
             `❌ No wallet linked.\n\nUse /connect or <a href="${WALLET_URL}">open the wallet page</a>.`)
        )
      } else {
        // Rafraîchit le solde Solana si une adresse Solana est liée
        if (access.row.wallet_address) {
          const balance  = await getFrancBalance(access.row.wallet_address)
          const hasFranc = balance > 0
          await supabase.from('wallets').update({
            franc_balance: balance, has_franc: hasFranc,
            balance_checked_at: new Date().toISOString()
          }).eq('telegram_id', userId)
        }
        const fresh = await getAccess(supabase, userId)
        await sendMessage(token, chatId, statusText(fresh, isFR))
      }
      return new Response('ok')
    }

    // ── Receive wallet address ────────────────────────────────
    const { data: pending } = await supabase
      .from('pending_connects').select('telegram_id')
      .eq('telegram_id', userId).single()

    if (pending && isValidSolana(rawText)) {
      await supabase.from('pending_connects').delete().eq('telegram_id', userId)
      const walletAddr = rawText.trim()

      const { data: existing } = await supabase
        .from('wallets').select('telegram_id')
        .eq('wallet_address', walletAddr).single()

      if (existing && existing.telegram_id !== userId) {
        await sendMessage(token, chatId,
          tr(
            `❌ <b>Ce wallet est déjà lié à un autre compte.</b>\n\nChaque wallet ne peut être connecté qu'à un seul compte Telegram.\nUtilise un autre wallet ou contacte le support.`,
            `❌ <b>This wallet is already linked to another account.</b>\n\nEach wallet can only be connected to one Telegram account.\nPlease use a different wallet or contact support.`
          )
        )
        return new Response('ok')
      }

      const balance  = await getFrancBalance(walletAddr)
      const hasFranc = balance > 0

      try {
        await supabase.rpc('upsert_player', {
          p_telegram_id: userId, p_name: userName,
          p_username: msg.from?.username ?? null, p_game_id: 'francrun'
        })
      } catch(_) {}

      const { error } = await supabase.from('wallets').upsert({
        telegram_id: userId, wallet_address: walletAddr,
        franc_balance: balance, has_franc: hasFranc,
        balance_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'telegram_id' })

      if (error) {
        await sendMessage(token, chatId, tr(`❌ Erreur lors de l'enregistrement du wallet. Réessaie.`,`❌ Error saving wallet. Please try again.`))
        return new Response('ok')
      }

      const short = walletAddr.slice(0,6)+'...'+walletAddr.slice(-4)
      if (hasFranc) {
        await sendMessage(token, chatId,
          tr(
            `✅ <b>Wallet lié !</b>\n\n👛 ${short}\n💰 $FRANC : <b>${balance.toLocaleString()}</b>\n\n🎉 <b>Accès débloqué :</b>\n• ✅ Écrire dans The Chicken Coop\n• ✅ 10 vies dans les jeux\n• ✅ Triple tir`,
            `✅ <b>Wallet linked!</b>\n\n👛 ${short}\n💰 $FRANC: <b>${balance.toLocaleString()}</b>\n\n🎉 <b>Unlocked access:</b>\n• ✅ Write in The Chicken Coop\n• ✅ 10 lives in games\n• ✅ Triple shot`
          ),
          { reply_markup: { inline_keyboard: [[
            { text: tr('🔄 Mettre à jour','🔄 Refresh menu'), callback_data: 'start' },
            { text: '🐔 The Chicken Coop', url: CHICKEN_COOP_URL }
          ]]}}
        )
      } else {
        await sendMessage(token, chatId,
          tr(
            `✅ <b>Wallet lié !</b>\n\n👛 ${short}\n⚠️ Aucun $FRANC trouvé.\n\nAchète du $FRANC pour débloquer tous les bonus !\n<i>Utilise /status pour revérifier après l'achat.</i>`,
            `✅ <b>Wallet linked!</b>\n\n👛 ${short}\n⚠️ No $FRANC found.\n\nBuy $FRANC to unlock all bonuses!\n<i>Use /status to check again after buying.</i>`
          ),
          { reply_markup: { inline_keyboard: [[
            { text: tr('🎮 Jouer (1 vie)','🎮 Play (1 life)'), url: FRANCRUN_URL }
          ]]}}
        )
      }
      return new Response('ok')
    }

    if (pending) {
      await sendMessage(token, chatId, tr(`❌ Adresse Solana invalide. Colle une adresse valide (32–44 caractères).`,`❌ Invalid Solana address. Please paste a valid address (32–44 characters).`))
    }

    // ── SECRÉTAIRE EN PRIVÉ : Francis répond aux questions libres (1:1) ──
    // Bilingue auto (FR/EN) + redirection vers le groupe de la langue.
    // UNIQUEMENT en privé, hors commande (/…), hors bouton, hors flux "coller wallet".
    if (msg.chat?.type === 'private' && !pending && rawText.length > 0
        && !rawText.startsWith('/') && !isKeyboardButton(text)) {
      // Anti-flood : au plus 1 réponse / FRANCIS_DM_COOLDOWN_MS par conversation.
      if ((Date.now() - (lastFrancisReplyByChat[chatId] || 0)) <= FRANCIS_DM_COOLDOWN_MS) return new Response('ok')
      lastFrancisReplyByChat[chatId] = Date.now()   // armé tout de suite (burst suivant ignoré)
      const bgDm = rawText
      const memKey = 'dm:' + chatId
      const bg = (async () => {
        try {
          const history = await fetchChatMemory(supabase, memKey, 5)   // cohérence : 5 derniers messages
          const reply = await askFrancisAI(bgDm, isFR ? 'fr' : 'en', 'dm', history)
          if (!reply) { lastFrancisReplyByChat[chatId] = 0; return }   // rien à dire → on relâche
          // Réponse différée ~1 min → échange plus naturel, moins tac-au-tac.
          await new Promise((r) => setTimeout(r, FRANCIS_REPLY_DELAY_MS))
          await sendMessage(token, chatId, reply)
          await saveChatMemory(supabase, memKey, 'user', bgDm)
          await saveChatMemory(supabase, memKey, 'model', reply)
        } catch (e) { console.error('DM francis bg:', String(e)) }
      })()
      try { (globalThis as any).EdgeRuntime?.waitUntil?.(bg) } catch (_) { /* best effort */ }
      return new Response('ok')
    }

  } catch (err) {
    console.error('bot-handler error:', String(err))
  }

  return new Response('ok')
})
