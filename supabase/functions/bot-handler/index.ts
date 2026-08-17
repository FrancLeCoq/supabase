// ══════════════════════════════════════════════════════════════
//  bot-handler — Edge Function Supabase
//  @FrancisLeCoqBot — All messages in English
//  v2 — Accès harmonisé : Solana OU TON OU Stars (logique unifiée)
//        /disconnect non destructif (préserve la ligne + stars_unlocked)
// ══════════════════════════════════════════════════════════════

import { createClient } from 'jsr:@supabase/supabase-js@2'

import { FRANCIS_COOLDOWN_MS, FRANCIS_DM_COOLDOWN_MS, FRANCIS_REPLY_DELAY_MS, askFrancisAI, buildBatchedReply, claimReplySlot, fetchChatMemory, isUserPaused, lastFrancisReplyByChat, releaseReplySlot, saveChatMemory } from './francis-ai.ts'

// Libellé lisible d'un scope de pause par utilisateur.
function pauseScopeLabel(scope: string): string {
  return scope === 'chickencoop' ? 'The Chicken Coop'
    : 'les échanges individuels (DM + Business)'
}
import { BUY_FRANC_SOL_URL, BUY_FRANC_TON_URL, CASHBACK_DEEPLINK, CHICKEN_COOP_URL, CHICKENBLAST_URL, CHICKENFIGHT_URL, CHICKENHANG_URL, CHICKENMEMORY_URL, CHICKENMINE_URL, CHICKENREFLEX_URL, EGGCLICKER_URL, EGGSPONENTIAL_URL, FRANCRUN_URL, MASTERMIND_URL, MENU_DEEPLINK, MOTUS_URL, ORMUZ_URL, RULES_DEEPLINK, RULES_MENU_TEXT, SNAKE_URL, SOLITAIRE_URL, SUDOKU_URL, TAMAGOTCHI_URL, WALLET_URL, WORDSEARCH_URL, btnIs, buildGameRulesKeyboard, buildInlineMenu, buildKeyboard, buildRulesMenuKeyboard, gameByKey, isKeyboardButton } from './menus.ts'
import { getChatMemberStatus, isAbusive } from './moderation.ts'
import { sendCashbackOffer } from './payments.ts'
import { CASHBACK_NOTIFY_ID, CHICKEN_COOP, EN_TOPIC, FR_TOPIC, HOLDERS_GROUP_ID, OWNER_ID, ROOSTER_CHANNEL_ID, caPayload, createOneTimeInvite, deleteMessage, isCaRequest, mentionsOldTestCa, pinMessage, sendCA, sendMessage, sendNoDM } from './telegram.ts'
import { getAccess, getFrancBalance, getLang, isValidSolana, isValidTon, setLang, statusText } from './wallet.ts'

// ══════════════════════════════════════════════════════════════
//  SPICY (18+) — accès GRATUIT au groupe privé (HOLDERS_GROUP_ID),
//  réservé aux MEMBRES de The Chicken Coop 🇬🇧 OU du Poulailler 🇫🇷.
//  Plus AUCUNE condition de détention $FRANC. Parcours : rejoindre un
//  groupe -> vérifier -> certifier 18 ans -> recevoir le lien d'invitation.
//  Le recheck quotidien (daily-recheck) expulse ceux qui quittent les
//  deux groupes et les réinvite gratuitement.
// ══════════════════════════════════════════════════════════════
function spicyWelcomeText(isFR: boolean): string {
  return isFR
    ? `🔞 <b>Bienvenue dans l'espace Spicy (« Golden Rooster »).</b>\n\nL'accès est <b>gratuit</b>, mais réservé aux <b>membres de The Chicken Coop 🇬🇧🇫🇷</b> (le groupe bilingue de Francis) et aux personnes <b>majeures (18+)</b>.\n\n1️⃣ Rejoins The Chicken Coop\n2️⃣ Certifie tes 18 ans → tu reçois ton lien 🔥\n\n⚠️ <b>Reste membre</b> de The Chicken Coop : le bot vérifie chaque jour et retire l'accès à ceux qui l'ont quitté.`
    : `🔞 <b>Welcome to the Spicy space ("Golden Rooster").</b>\n\nAccess is <b>free</b>, but reserved for <b>members of The Chicken Coop 🇬🇧🇫🇷</b> (Francis' bilingual group) and <b>adults (18+)</b> only.\n\n1️⃣ Join The Chicken Coop\n2️⃣ Certify you're 18+ → you get your link 🔥\n\n⚠️ <b>Stay a member</b> of The Chicken Coop: the bot checks daily and removes access from anyone who leaves it.`
}
function spicyWelcomeKeyboard(isFR: boolean) {
  return { inline_keyboard: [
    [{ text: '🇬🇧 The Chicken Coop 🇫🇷', url: CHICKEN_COOP_URL }],
    [{ text: isFR ? '🔞 Je certifie avoir 18 ans' : "🔞 I certify I'm 18+", callback_data: 'spicy_18' }],
  ] }
}
// Membre de The Chicken Coop ? (getChatMemberStatus renvoie 'member' en cas
// d'échec réseau → fail-open : on n'empêche pas l'accès sur une erreur ponctuelle.)
async function isCoopMember(token: string, userId: number): Promise<boolean> {
  const ok = (s: string) => s === 'member' || s === 'administrator' || s === 'creator' || s === 'restricted'
  const coop = await getChatMemberStatus(token, CHICKEN_COOP, userId)
  return ok(coop)
}
async function sendSpicyInvite(token: string, userId: number, isFR: boolean): Promise<void> {
  const invite = await createOneTimeInvite(token, HOLDERS_GROUP_ID)
  if (!invite) {
    await sendMessage(token, userId, isFR
      ? `⚠️ Impossible de générer ton lien pour le moment. Réessaie dans un instant 🐔`
      : `⚠️ Couldn't generate your link right now. Try again in a moment 🐔`)
    return
  }
  await sendMessage(token, userId, isFR
    ? `🔞 <b>Accès Spicy débloqué !</b>\n\n⏳ Ton lien est <b>personnel</b>, valable <b>15 min</b> et <b>à usage unique</b>. Ne le partage pas. 🔥`
    : `🔞 <b>Spicy access unlocked!</b>\n\n⏳ Your link is <b>personal</b>, valid for <b>15 min</b> and <b>single-use</b>. Don't share it. 🔥`,
    { reply_markup: { inline_keyboard: [[{ text: isFR ? '🔥 Entrer dans Spicy' : '🔥 Enter Spicy', url: invite }]] } })
}

// ══════════════════════════════════════════════════════════════
//  MESSAGES DE BIENVENUE (nouveaux arrivants, postés DANS le groupe)
//   • Golden Rooster : version adaptée selon que la personne est déjà
//     membre de The Chicken Coop (vérif individuelle à l'arrivée).
//   • The Chicken Coop : accueil + accès au bot (au 1er GM/hi).
// ══════════════════════════════════════════════════════════════
const ALL_GAMES_BTN = { text: 'All games & Rooster universe', url: MENU_DEEPLINK }

// Mention cliquable (ping même sans @username).
function userMention(u: any): string {
  if (u?.username) return '@' + u.username
  const nm = String(u?.first_name || 'friend').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<a href="tg://user?id=${u.id}">${nm}</a>`
}
// Salutation d'ouverture (GM / hi / bonjour…) → déclenche l'accueil (1 fois/user).
// Court volontairement (les vraies salutations le sont) pour éviter les faux positifs.
function isGreeting(raw: string): boolean {
  const t = (raw || '').trim().toLowerCase()
  if (!t || t.length > 30) return false
  return /^(gm+|g\s?m|good\s?morning|good\s?evening|hi+|hii+|hey+|hello+|helo+|yo+|hola|wagmi|salut|slt|bonjour|bjr|coucou|cc|bonsoir|bsr)\b/.test(t)
}

// Golden Rooster — NON membre de The Chicken Coop.
function grWelcomeNotMember(m: string) {
  return {
    text:
      `🤩 <b>Bienvenue ${m} dans Golden Rooster !</b> 🐓\n\n` +
      `Préparez-vous à découvrir un espace rempli de contenu exclusif 🔞.\n\n` +
      `🔓 Pour conserver votre accès à <b>Golden Rooster</b>, pensez à rejoindre <b>The Chicken Coop</b> 🇬🇧🇫🇷 (le groupe bilingue de Francis). Notre bot vérifie automatiquement votre adhésion.\n\n` +
      `🇬🇧 The Chicken Coop 🇫🇷\n👉 t.me/LeCoqFrancis\n\n` +
      `Amusez-vous bien et bienvenue dans l'univers de <b>Francis Le Coq</b> ! 🔥🐓`,
    reply_markup: { inline_keyboard: [
      [ { text: '🇬🇧 The Chicken Coop 🇫🇷', url: CHICKEN_COOP_URL } ],
      [ ALL_GAMES_BTN ],
    ] },
  }
}

// Golden Rooster — DÉJÀ membre.
function grWelcomeMember(m: string) {
  return {
    text:
      `🤩 <b>Bienvenue ${m} dans Golden Rooster !</b> 🐓\n\n` +
      `Préparez-vous à découvrir un espace rempli de contenu exclusif 🔞 et de nombreuses surprises.\n\n` +
      `🎮 Envie d'aller encore plus loin ? Discutez avec notre bot (lien ci-dessous) pour débloquer encore plus de jeux, de fonctionnalités et de contenus exclusifs.\n\n` +
      `✨ <b>Tout est gratuit, alors profitez-en !</b>`,
    reply_markup: { inline_keyboard: [[ ALL_GAMES_BTN ]] },
  }
}

// The Chicken Coop (EN).
function coopWelcome(m: string) {
  return {
    text:
      `🤩 <b>Welcome ${m} to The Chicken Coop!</b> 🐓\n\n` +
      `Get ready to discover a space full of news, games, exclusive content and lots of surprises every day. 👀\n\n` +
      `🎮 Want to go even further? Chat with our bot (link below) to unlock even more games, features and exclusive content. 🚀`,
    reply_markup: { inline_keyboard: [[ ALL_GAMES_BTN ]] },
  }
}

// ══════════════════════════════════════════════════════════════
//  SETUP : poste dans The Chicken Coop (EN par défaut) avec ses boutons de
//  contenu + une ligne 🇬🇧/🇫🇷. Les DEUX versions (texte + clavier) sont
//  mémorisées dans setup_i18n pour la bascule instantanée (callback slang),
//  gardées jusqu'au prochain /setup. (Poulailler supprimé.)
// ══════════════════════════════════════════════════════════════
const SLANG_ROW = [
  { text: 'Translate in French 🇫🇷', callback_data: 'slang:fr' },
]
// French Coop (topic 2290) : présentation FR par défaut → bouton vers l'anglais.
const SLANG_FR_ROW = [
  { text: 'Translate in English 🇬🇧', callback_data: 'slangf:en' },
]
const FRENCH_COOP_THREAD = 2290
async function postSetupBilingual(
  token: string, supabase: any,
  enThread: number, frThread: number,
  enText: string, enKb: any[], frText: string, frKb: any[],
): Promise<void> {
  // EN (défaut) -> The Chicken Coop
  const enExtra: Record<string, any> = { reply_markup: { inline_keyboard: [...enKb, SLANG_ROW] } }
  if (enThread && enThread > 1) enExtra.message_thread_id = enThread
  const sentEn = await sendMessage(token, CHICKEN_COOP, enText, enExtra)
  if (sentEn?.message_id) {
    await pinMessage(token, CHICKEN_COOP, sentEn.message_id)
    // On mémorise les DEUX langues → le bouton 🇬🇧/🇫🇷 bascule sur place.
    try { await supabase.from('setup_i18n').upsert({ chat_id: CHICKEN_COOP, message_id: sentEn.message_id, en_text: enText, fr_text: frText, en_kb: enKb, fr_kb: frKb, updated_at: new Date().toISOString() }) } catch (e) { console.error('setup_i18n', String(e)) }
  }
  // Poulailler supprimé : plus d'envoi FR séparé (la version FR reste dans le
  // Chicken Coop via le bouton 🇬🇧/🇫🇷). frThread conservé pour compat de signature.
  void frThread
}

// French Coop : présentation FR par DÉFAUT (public francophone) + bouton
// « Translate in English 🇬🇧 » (bascule instantanée, aperçu EN puis retour FR).
async function postSetupFrench(
  token: string, supabase: any, thread: number,
  frText: string, frKb: any[], enText: string, enKb: any[],
): Promise<void> {
  const extra: Record<string, any> = { reply_markup: { inline_keyboard: [...frKb, SLANG_FR_ROW] } }
  if (thread && thread > 1) extra.message_thread_id = thread
  const sent = await sendMessage(token, CHICKEN_COOP, frText, extra)
  if (sent?.message_id) {
    await pinMessage(token, CHICKEN_COOP, sent.message_id)
    try { await supabase.from('setup_i18n').upsert({ chat_id: CHICKEN_COOP, message_id: sent.message_id, en_text: enText, fr_text: frText, en_kb: enKb, fr_kb: frKb, updated_at: new Date().toISOString() }) } catch (e) { console.error('setup_i18n(fr)', String(e)) }
  }
}

// ══════════════════════════════════════════════════════════════
//  Mentions "rejoins le poulailler" à coller EN COMMENTAIRE d'un post X.
//  Le lien t.me dans le post LUI-MÊME provoque un shadowban : on ne le met
//  donc plus dans les copies owner, il se poste en commentaire via /x…
//  Chaque commande renvoie le texte + un bouton 📋 Copier (copy_text natif).
// ══════════════════════════════════════════════════════════════
const X_CTA: Record<string, string> = {
  '/xf1':     "🏎️Don't miss any F1 news.\n🏁 Join the Chicken Coop :\n👉 T.me/LeCoqFrancis",
  '/xmotogp': "🏍️Don't miss any MotoGP news.\n🏁 Join the Chicken Coop :\n👉 T.me/LeCoqFrancis",
  '/xcrypto': "⚡ Don't miss any crypto news.\n🐔 Join the Chicken Coop :\n👉 T.me/LeCoqFrancis",
  '/xnews':   "🌍 Don't miss any international news.\n🐔 Join the Chicken Coop :\n👉 T.me/LeCoqFrancis",
  '/xfranc':  "Join the coop👉 t.me/LeCoqFrancis\nDiscover Francis👉 t.me/FrancisLeCoqBot\n\n◎ $FRANC on SOL:  AacckLUizxHFpSGdcN9ppEfv2UCbdqZspEhHeR8Gpump\n💎 $FRANC on TON: EQBMR3POM1sdShe7QoSVt6DDauoor4QOK4HsN7eBdoi5lrn6",
}

// Bouton "🌐 FR / EN" placé sous les news automatiques (traduction bascule).
const TR_BUTTON = { inline_keyboard: [[{ text: '🇬🇧 EN', callback_data: 'trhot' }, { text: '🇫🇷 FR', callback_data: 'trhot' }]] }
// Bouton des news auto PRÉ-ENREGISTRÉES : un SEUL bouton « Translate in French ».
// Au clic → aperçu FR ~20 s avec décompte, puis retour auto à l'anglais.
const NLANG_BTN = { inline_keyboard: [[{ text: 'Translate in French 🇫🇷', callback_data: 'nlang:fr' }]] }
// French Coop : message FR par défaut → bouton vers l'anglais (toggle home=fr).
const NLANG_FR_BTN = { inline_keyboard: [[{ text: 'Translate in English 🇬🇧', callback_data: 'nlangf:en' }]] }

// ── Aperçu FR temporaire (20 s) + décompte, puis retour auto à l'anglais ──
// Message partagé par tout le groupe → le FR n'est qu'un coup d'œil de 20 s.
const FR_PEEK_SECONDS = 20
const translateRow = (frCb: string) => [{ text: 'Translate in French 🇫🇷', callback_data: frCb }]
const backRow = (enCb: string, s: number) => [{ text: `⏳ Back in English in ${s}s`, callback_data: enCb }]
const peekSleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
// Gère le clic (lang='fr' → aperçu+décompte ; lang='en' → retour immédiat).
// enRows/frRows = éventuels boutons de contenu à garder au-dessus de la langue.
async function handleFrToggle(o: {
  token: string; chatId: number; messageId: number; isCaption: boolean; html: boolean;
  lang: string; enText: string; frText: string; enRows: any[]; frRows: any[]; frCb: string; enCb: string;
  homeLang?: 'en' | 'fr';
}) {
  // Langue PERSISTANTE (home) et langue d'APERÇU (peek, 20 s puis retour auto).
  // Par défaut home=en (news EN partagée par tout le groupe). French Coop : home=fr.
  const home = o.homeLang || 'en'
  const peek = home === 'en' ? 'fr' : 'en'
  const homeText = home === 'en' ? o.enText : o.frText
  const peekText = peek === 'en' ? o.enText : o.frText
  const homeRows = home === 'en' ? o.enRows : o.frRows
  const peekRows = peek === 'en' ? o.enRows : o.frRows
  const homeCb = home === 'en' ? o.enCb : o.frCb
  const peekCb = peek === 'en' ? o.enCb : o.frCb
  const persistRow = () => [{ text: peek === 'fr' ? 'Translate in French 🇫🇷' : 'Translate in English 🇬🇧', callback_data: peekCb }]
  const backRowX = (s: number) => [{ text: home === 'en' ? `⏳ Back in English in ${s}s` : `⏳ Retour au français dans ${s}s`, callback_data: homeCb }]
  // editBody renvoie true si Telegram accepte l'édition (pour fiabiliser le retour home).
  const editBody = async (txt: string, kb: any[]): Promise<boolean> => {
    const method = o.isCaption ? 'editMessageCaption' : 'editMessageText'
    const p: any = { chat_id: o.chatId, message_id: o.messageId, reply_markup: { inline_keyboard: kb } }
    if (o.html) p.parse_mode = 'HTML'
    if (o.isCaption) p.caption = txt; else { p.text = txt; p.disable_web_page_preview = true }
    try {
      const res = await fetch(`https://api.telegram.org/bot${o.token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
      const j = await res.json().catch(() => null)
      return !!(j && j.ok)
    } catch (_) { return false }
  }
  if (o.lang === home) { await editBody(homeText, [...homeRows, persistRow()]); return }
  // Aperçu de l'autre langue + décompte, puis retour AUTO à la langue home.
  await editBody(peekText, [...peekRows, backRowX(FR_PEEK_SECONDS)])
  const setBtn = async (kb: any[]) => {
    try {
      await fetch(`https://api.telegram.org/bot${o.token}/editMessageReplyMarkup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: o.chatId, message_id: o.messageId, reply_markup: { inline_keyboard: kb } }) })
    } catch (_) { /* un tick qui échoue ne doit PAS casser le décompte */ }
  }
  const bg = (async () => {
    // Décompte par pas de 5 s (≈4 éditions) → largement sous la limite Telegram.
    let s = FR_PEEK_SECONDS
    while (s > 0) {
      const step = s >= 5 ? 5 : s
      await peekSleep(step * 1000)
      s -= step
      if (s > 0) await setBtn([...peekRows, backRowX(s)])
    }
    // Retour à la langue home GARANTI : plusieurs tentatives si Telegram limite (429).
    for (let a = 0; a < 5; a++) {
      if (await editBody(homeText, [...homeRows, persistRow()])) break
      await peekSleep(1500)
    }
  })()
  ;(globalThis as any).EdgeRuntime?.waitUntil?.(bg)
}

// Traduit un message vers l'AUTRE langue (FR↔EN) en conservant emojis/mise en
// page. Utilisé par le bouton de traduction sous les news auto.
async function geminiTranslateToggle(text: string): Promise<string> {
  const key = Deno.env.get('GEMINI_API_KEY') || ''
  if (!key) return ''
  const prompt = [
    'If the following message is in French, translate it to natural English. Otherwise translate it to natural French.',
    'Keep ALL emojis exactly where they are and keep the same line breaks / layout.',
    'Do NOT translate or alter proper names, tickers, URLs or numbers.',
    'Output ONLY the translated message, nothing else.',
    '',
    'MESSAGE:',
    text,
  ].join('\n')
  // Gemini 3.5 Flash-Lite, repli 3.1 Flash-Lite si quota atteint.
  for (const model of ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 2048 } }),
          signal: AbortSignal.timeout(25000),
        }
      )
      if (res.status === 429 || !res.ok) continue
      const data = await res.json()
      const parts = data?.candidates?.[0]?.content?.parts ?? []
      const out = parts.map((p: any) => p?.text ?? '').join('').trim()
      if (out) return out
    } catch { /* modèle suivant */ }
  }
  return ''
}

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
      const chatIdCm = cm.chat?.id
      const u = cm.new_chat_member?.user
      const newStatus = cm.new_chat_member?.status
      const isInNow = ['member', 'administrator', 'creator', 'restricted'].includes(newStatus || '')
      const wasIn = ['member', 'administrator', 'creator', 'restricted'].includes(cm.old_chat_member?.status || '')
      if (u && !u.is_bot) {
        const token = Deno.env.get('BOT_TOKEN')!
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        )
        const mention = userMention(u)

        if (chatIdCm === HOLDERS_GROUP_ID) {
          if (isInNow) {
            await supabase.from('group_members').upsert({
              telegram_id: u.id,
              username: u.username || null,
              name: [u.first_name, u.last_name].filter(Boolean).join(' ') || null,
              status: 'member'
            }, { onConflict: 'telegram_id' })
            // Accueil public UNIQUEMENT sur une vraie nouvelle arrivée (pas une
            // promotion). Vérif individuelle → version adaptée (membre ou non).
            if (!wasIn) {
              try {
                const already = await isCoopMember(token, u.id)
                const w = already ? grWelcomeMember(mention) : grWelcomeNotMember(mention)
                await sendMessage(token, HOLDERS_GROUP_ID, w.text, { reply_markup: w.reply_markup })
              } catch (e) { console.error('GR welcome:', String(e)) }
            }
          } else {
            // left / kicked / banned
            await supabase.from('group_members').update({ status: 'kicked' }).eq('telegram_id', u.id)
          }
        } else if (chatIdCm === CHICKEN_COOP && isInNow && !wasIn) {
          // The Chicken Coop : on marque le NOUVEL arrivant comme « à accueillir ».
          // L'accueil se déclenchera à son 1er GM/hi (voir handler plus bas). Les
          // membres déjà en place ne sont jamais marqués → aucun accueil pour eux.
          try { await supabase.from('welcome_pending').upsert({ chat_id: CHICKEN_COOP, user_id: u.id }) } catch (_) { /* ok */ }
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

      // ── Bouton "🌐 FR / EN" sous les news auto : traduit/bascule le message ──
      // Sans état : on lit le texte actuel (légende de photo ou texte), on le
      // traduit vers l'autre langue et on édite le message sur place. Un
      // nouveau clic rebascule. Le bouton est réattaché à chaque fois.
      if (cb.data === 'trhot') {
        const m: any = cb.message
        const orig = (m?.caption ?? m?.text ?? '').toString()
        if (m && orig) {
          const translated = await geminiTranslateToggle(orig)
          if (translated) {
            const isCaption = m.caption !== undefined && m.caption !== null
            const method = isCaption ? 'editMessageCaption' : 'editMessageText'
            const payload: any = {
              chat_id: m.chat.id, message_id: m.message_id, reply_markup: TR_BUTTON,
            }
            if (isCaption) payload.caption = translated
            else { payload.text = translated; payload.disable_web_page_preview = true }
            await fetch(`https://api.telegram.org/bot${cbToken}/${method}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
          }
        }
      }

      // ── Rappel Golden Rooster : bouton 🇬🇧/🇫🇷 (rendu natif, déterministe) ──
      // Réédite le message dans la langue choisie via le mode "render" de
      // daily-recheck (pas de traduction IA : wording + heure exacts).
      if (cb.data === 'grtr:en' || cb.data === 'grtr:fr') {
        const lang = cb.data.split(':')[1]
        const m: any = cb.message
        if (m) {
          try {
            const cronSecret = Deno.env.get('CRON_SECRET') || ''
            const render = async (l: string) => {
              const r = await fetch('https://mubqtnqulpyehkgubhnh.supabase.co/functions/v1/daily-recheck', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronSecret },
                body: JSON.stringify({ mode: 'render', lang: l, chat_id: m.chat.id, message_id: m.message_id }),
              })
              const j = await r.json(); return (j && j.text) ? String(j.text) : ''
            }
            const [enText, frText] = await Promise.all([render('en'), render('fr')])
            const coopRow = [{ text: '🇬🇧 The Chicken Coop 🇫🇷', url: 'https://t.me/LeCoqFrancis' }]
            if (enText) {
              await handleFrToggle({
                token: cbToken, chatId: m.chat.id, messageId: m.message_id, isCaption: false, html: true,
                lang, enText, frText: frText || enText, enRows: [coopRow], frRows: [coopRow], frCb: 'grtr:fr', enCb: 'grtr:en',
              })
            }
          } catch (e) { console.error('grtr:', String(e)) }
        }
        return new Response('ok')
      }

      // ── News auto : bouton 🇬🇧/🇫🇷 (bascule pré-enregistrée, sans Gemini) ──
      // La news reste par DÉFAUT en anglais (le message est partagé par tout le
      // groupe). Un clic sur 🇫🇷 montre le français ~20 s AVEC un décompte dans
      // le bouton, puis revient tout seul en anglais. 🇬🇧 rebascule tout de suite.
      if (cb.data === 'nlang:en' || cb.data === 'nlang:fr') {
        const lang = cb.data.split(':')[1]
        const m: any = cb.message
        if (m) {
          try {
            const { data: snap } = await cbSupa.from('news_i18n').select('en, fr, html').eq('chat_id', m.chat.id).eq('message_id', m.message_id).maybeSingle()
            if (snap) {
              await handleFrToggle({
                token: cbToken, chatId: m.chat.id, messageId: m.message_id,
                isCaption: m.caption !== undefined && m.caption !== null, html: !!snap.html,
                lang, enText: snap.en, frText: snap.fr, enRows: [], frRows: [], frCb: 'nlang:fr', enCb: 'nlang:en',
              })
            }
          } catch (e) { console.error('nlang:', String(e)) }
        }
        return new Response('ok')
      }

      // ── French Coop : news FR par DÉFAUT + aperçu EN (home=fr, miroir de nlang) ──
      if (cb.data === 'nlangf:en' || cb.data === 'nlangf:fr') {
        const lang = cb.data.split(':')[1]
        const m: any = cb.message
        if (m) {
          try {
            const { data: snap } = await cbSupa.from('news_i18n').select('en, fr, html').eq('chat_id', m.chat.id).eq('message_id', m.message_id).maybeSingle()
            if (snap) {
              await handleFrToggle({
                token: cbToken, chatId: m.chat.id, messageId: m.message_id,
                isCaption: m.caption !== undefined && m.caption !== null, html: !!snap.html,
                lang, enText: snap.en, frText: snap.fr, enRows: [], frRows: [], frCb: 'nlangf:fr', enCb: 'nlangf:en', homeLang: 'fr',
              })
            }
          } catch (e) { console.error('nlangf:', String(e)) }
        }
        return new Response('ok')
      }

      // ── Setup : bouton 🇬🇧/🇫🇷 (bascule texte + clavier, pré-enregistrée) ──
      if (cb.data === 'slang:en' || cb.data === 'slang:fr') {
        const lang = cb.data.split(':')[1]
        const m: any = cb.message
        if (m) {
          try {
            const { data: snap } = await cbSupa.from('setup_i18n').select('en_text, fr_text, en_kb, fr_kb').eq('chat_id', m.chat.id).eq('message_id', m.message_id).maybeSingle()
            if (snap) {
              await handleFrToggle({
                token: cbToken, chatId: m.chat.id, messageId: m.message_id, isCaption: false, html: true,
                lang, enText: snap.en_text, frText: snap.fr_text,
                enRows: snap.en_kb || [], frRows: snap.fr_kb || [], frCb: 'slang:fr', enCb: 'slang:en',
              })
            }
          } catch (e) { console.error('slang:', String(e)) }
        }
        return new Response('ok')
      }

      // ── Setup French Coop : FR par défaut + aperçu EN (home=fr, miroir de slang) ──
      if (cb.data === 'slangf:en' || cb.data === 'slangf:fr') {
        const lang = cb.data.split(':')[1]
        const m: any = cb.message
        if (m) {
          try {
            const { data: snap } = await cbSupa.from('setup_i18n').select('en_text, fr_text, en_kb, fr_kb').eq('chat_id', m.chat.id).eq('message_id', m.message_id).maybeSingle()
            if (snap) {
              await handleFrToggle({
                token: cbToken, chatId: m.chat.id, messageId: m.message_id, isCaption: false, html: true,
                lang, enText: snap.en_text, frText: snap.fr_text,
                enRows: snap.en_kb || [], frRows: snap.fr_kb || [], frCb: 'slangf:fr', enCb: 'slangf:en', homeLang: 'fr',
              })
            }
          } catch (e) { console.error('slangf:', String(e)) }
        }
        return new Response('ok')
      }

      // ── /xtrend : choix d'une tendance → post viral (OWNER) ──
      if (cb.data.startsWith('xt:')) {
        if (cbUser.id.toString() !== OWNER_ID) return new Response('ok')
        const idx = Number(cb.data.split(':')[1])
        const { data: row } = await cbSupa.from('xtrend_pending').select('trends, region').eq('owner_id', cbUser.id).maybeSingle()
        const trends: string[] = (row && Array.isArray(row.trends)) ? row.trends : []
        const region: string = (row && typeof row.region === 'string') ? row.region : 'world'
        const trend = trends[idx]
        if (!trend) { await sendMessage(cbToken, cbUser.id, '⚠️ Tendance introuvable (relance /xtrend).'); return new Response('ok') }
        const cronSecret = Deno.env.get('CRON_SECRET') || ''
        const trigger = fetch('https://mubqtnqulpyehkgubhnh.supabase.co/functions/v1/breaking-news', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronSecret },
          body: JSON.stringify({ category: 'xtrend', subject: trend, owner: Number(cbUser.id), region }),
        }).catch((e) => console.error('xtrend gen:', String(e)))
        ;(globalThis as any).EdgeRuntime?.waitUntil?.(trigger)
        try { await cbSupa.from('xtrend_pending').delete().eq('owner_id', cbUser.id) } catch (_) { /* ok */ }
        await sendMessage(cbToken, cbUser.id, `🔥 <b>${trend.replace(/</g, '&lt;')}</b> — ⏳ je rédige un post viral prêt à publier…`)
        return new Response('ok')
      }

      // ── Breaking news perso : ✅ Publier / ❌ Annuler (OWNER) ──
      if (cb.data === 'bn_pub' || cb.data === 'bn_cancel') {
        if (cbUser.id.toString() !== OWNER_ID) return new Response('ok')
        const { data: draft } = await cbSupa.from('breaking_pending').select('*').eq('owner_id', cbUser.id).maybeSingle()
        if (!draft) { await sendMessage(cbToken, cbUser.id, '⚠️ Brouillon introuvable (déjà publié ou expiré).'); return new Response('ok') }
        if (cb.data === 'bn_cancel') {
          await cbSupa.from('breaking_pending').delete().eq('owner_id', cbUser.id)
          await sendMessage(cbToken, cbUser.id, '❌ Breaking news annulée.')
          return new Response('ok')
        }
        // Catégorie → emoji + topics (EN Chicken Coop / FR Poulailler).
        const BN_PUB: Record<string, { emoji: string; en: number; fr: number }> = {
          f1:         { emoji: '🏎️', en: 1631, fr: 147 },
          motogp:     { emoji: '🏍️', en: 2259, fr: 147 },
          worldroost: { emoji: '🌍', en: 1489, fr: 45 },
          frenchcoop: { emoji: '🇫🇷', en: 2290, fr: 2290 },
          crypto:     { emoji: '⚡', en: 1490, fr: 43 },
        }
        const m = BN_PUB[String(draft.category)]
        if (!m) { await sendMessage(cbToken, cbUser.id, '⚠️ Catégorie inconnue, publication annulée.'); await cbSupa.from('breaking_pending').delete().eq('owner_id', cbUser.id); return new Response('ok') }
        const enMsg = `🚨 <b>BREAKING</b> ${m.emoji}\n\n${draft.en}`
        const frMsg = `🚨 <b>BREAKING</b> ${m.emoji}\n\n${draft.fr}`
        // The Chicken Coop : bouton 🇬🇧/🇫🇷 pré-enregistré (bascule instantanée). html:true.
        // French Coop = FR par défaut (bouton EN) ; les autres = EN par défaut (bouton FR).
        const frDefault = String(draft.category) === 'frenchcoop'
        const sent = await sendMessage(cbToken, CHICKEN_COOP, frDefault ? frMsg : enMsg,
          { message_thread_id: m.en, reply_markup: frDefault ? NLANG_FR_BTN : NLANG_BTN })
        if (sent?.message_id) await cbSupa.from('news_i18n').upsert({ chat_id: CHICKEN_COOP, message_id: sent.message_id, en: enMsg, fr: frMsg, html: true })
        await cbSupa.from('breaking_pending').delete().eq('owner_id', cbUser.id)
        await sendMessage(cbToken, cbUser.id, '✅ Breaking news publiée dans The Chicken Coop.')
        return new Response('ok')
      }

      // ── Bouton "🔞 Spicy" (menu /start) → ouvre le parcours Spicy gratuit ──
      if (cb.data === 'holders' || cb.data === 'spicy_open') {
        const isFR = await getLang(cbSupa, cbUser.id.toString()) === 'fr'
        await sendMessage(cbToken, cbUser.id, spicyWelcomeText(isFR), { reply_markup: spicyWelcomeKeyboard(isFR) })
      }

      // ── Spicy : "✅ J'ai rejoint le groupe" → vérifie l'appartenance ──
      if (cb.data === 'spicy_check') {
        const isFR = await getLang(cbSupa, cbUser.id.toString()) === 'fr'
        const member = await isCoopMember(cbToken, cbUser.id)
        if (member) {
          await sendMessage(cbToken, cbUser.id,
            isFR ? `✅ Parfait, tu es bien membre ! Dernière étape : certifie tes 18 ans 👇`
                 : `✅ Great, you're a member! Last step: certify you're 18+ 👇`,
            { reply_markup: { inline_keyboard: [[{ text: isFR ? '🔞 Je certifie avoir 18 ans' : "🔞 I certify I'm 18+", callback_data: 'spicy_18' }]] } })
        } else {
          await sendMessage(cbToken, cbUser.id,
            isFR ? `❌ Tu n'es pas encore membre de The Chicken Coop. Rejoins-le, puis reclique sur ✅.`
                 : `❌ You're not a member of The Chicken Coop yet. Join it, then tap ✅ again.`,
            { reply_markup: spicyWelcomeKeyboard(isFR) })
        }
      }

      // ── Spicy : "🔞 Je certifie avoir 18 ans" → envoie le lien si membre ──
      if (cb.data === 'spicy_18') {
        const isFR = await getLang(cbSupa, cbUser.id.toString()) === 'fr'
        if (await isCoopMember(cbToken, cbUser.id)) {
          await sendSpicyInvite(cbToken, cbUser.id, isFR)
        } else {
          await sendMessage(cbToken, cbUser.id,
            isFR ? `❌ Tu dois d'abord être membre de The Chicken Coop 🇬🇧🇫🇷. Rejoins, puis reclique.`
                 : `❌ You must first be a member of The Chicken Coop 🇬🇧🇫🇷. Join, then tap again.`,
            { reply_markup: spicyWelcomeKeyboard(isFR) })
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

      // ── Bouton de réactivation d'un utilisateur (liste /playbot…user) ──
      if (cb.data && cb.data.startsWith('unpause:')) {
        if (String(cbUser.id) === OWNER_ID) {
          const parts = cb.data.split(':')          // unpause:<scope>:<username>
          const uScope = parts[1]
          const uName = parts.slice(2).join(':')
          try { await cbSupa.from('user_pause').delete().eq('scope', uScope).eq('username', uName) } catch (_) { /* ok */ }
          if (cb.message) {
            await fetch(`https://api.telegram.org/bot${cbToken}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: cb.message.chat.id, parse_mode: 'HTML',
                text: `▶️ Francis répond de nouveau à <b>@${uName}</b> dans <b>${pauseScopeLabel(uScope)}</b>.` })
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
      // Connexion inconnue / désactivée / sans droit de réponse → on ne répond
      // pas, MAIS on alerte l'OWNER une fois/jour (sinon échec 100 % silencieux :
      // Francis reçoit le DM mais ne peut pas répondre).
      if (!conn || conn.is_enabled === false || conn.can_reply === false) {
        try {
          const parisDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
          if (await claimReplySlot(sb, 'bmgated:' + parisDay, 90000)) {
            const why = !conn ? 'connexion Business inconnue (jamais enregistrée)'
              : (conn.is_enabled === false ? 'connexion Business désactivée' : 'droit de réponse non accordé')
            await sendMessage(bToken, Number(OWNER_ID),
              `⚠️ <b>DM Business reçu — Francis n'a PAS pu répondre</b>\n\n` +
              `Raison : ${why}.\n\n` +
              `👉 Telegram → Réglages → Entreprise → Chatbots → reconnecte @FrancisLeCoqBot en lui laissant le droit de répondre, puis relance /enablesecretary.`)
          }
        } catch (_) { /* best-effort */ }
        return new Response('ok')
      }
      // Anti-boucle : ne JAMAIS répondre aux messages du titulaire du compte
      // Business (ses propres messages ET les réponses déjà envoyées par Francis).
      if (conn.owner_id && String(bm.from.id) === conn.owner_id) return new Response('ok')
      const connId = bm.business_connection_id
      const bChat  = bm.chat.id
      const memKeyB = 'bm:' + bChat
      // Réponses individuelles en pause (/stopbot) ? → mode secrétaire silencieux.
      try {
        const { data: indivPause } = await sb.from('bot_pause').select('paused').eq('chat_id', 0).single()
        if (indivPause?.paused) return new Response('ok')
      } catch (_) { /* pas de ligne → actif */ }
      // Utilisateur précis mis en pause (/stopbotuser) ?
      if (await isUserPaused(sb, 'dm', bm.from.username)) return new Response('ok')
      await saveChatMemory(sb, memKeyB, 'user', bText)   // contexte immédiat (batch + mémoire)
      // CA impératif : réponse déterministe (jamais générée par l'IA → zéro erreur d'adresse).
      const bOldCa = mentionsOldTestCa(bText)
      if (isCaRequest(bText) || bOldCa) {
        if (await claimReplySlot(sb, memKeyB + ':ca', 30)) {
          const bIsFR = /[àâçéèêëîïôûù]/.test(bText.toLowerCase()) || /\b(le|la|c'est|quoi|adresse|contrat|salut|bonjour|merci|envoie|donne)\b/.test(bText.toLowerCase())
          const cp = caPayload(bIsFR, bOldCa)
          try {
            await fetch(`https://api.telegram.org/bot${bToken}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ business_connection_id: connId, chat_id: bChat, text: cp.text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: cp.inline_keyboard } }),
            })
          } catch (e) { console.error('business CA:', String(e)) }
        }
      }
      // Verrou PARTAGÉ (DB) : une seule réponse par fenêtre, même multi-instances.
      const bClaimed = await claimReplySlot(sb, memKeyB, 90)
      if (!bClaimed) return new Response('ok')
      const bg = (async () => {
        try {
          await new Promise((r) => setTimeout(r, FRANCIS_REPLY_DELAY_MS))   // laisse arriver la salve
          const reply = await buildBatchedReply(sb, memKeyB, 'dm', 'en')   // dm = bilingue auto + redirection par langue
          if (!reply) { await releaseReplySlot(sb, memKeyB); return }   // CA seul / rien à ajouter
          await fetch(`https://api.telegram.org/bot${bToken}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ business_connection_id: connId, chat_id: bChat, text: reply, parse_mode: 'HTML', disable_web_page_preview: true }),
          })
          await saveChatMemory(sb, memKeyB, 'model', reply)
          // 🔔 Notifie l'OWNER : DM Business et Francis a répondu. UNE SEULE
          // notif par conversation et par JOUR (Paris). Le titulaire du compte
          // Business est déjà exclu plus haut (anti-boucle).
          try {
            const parisDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
            const firstOfDay = await claimReplySlot(sb, 'dmnotif:' + bChat + ':' + parisDay, 90000)  // ~25h
            if (firstOfDay) {
              const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              const f: any = bm.from || {}
              const fullName = esc([f.first_name, f.last_name].filter(Boolean).join(' ')) || 'Sans nom'
              const at = f.username ? ('@' + f.username) : '(pas de pseudo)'
              const notif =
                `🔔 <b>Nouveau DM (Business) — Francis a répondu</b>\n\n` +
                `👤 <a href="tg://user?id=${f.id}">${fullName}</a> ${esc(at)}\n` +
                `🆔 <code>${f.id}</code>\n\n` +
                `💬 <b>1er message :</b>\n${esc(bText)}\n\n` +
                `🤖 <b>Réponse :</b>\n${esc(reply)}`
              const extra: Record<string, any> = {}
              if (f.username) extra.reply_markup = { inline_keyboard: [[{ text: '💬 Ouvrir la conversation', url: 'https://t.me/' + f.username }]] }
              await sendMessage(bToken, Number(OWNER_ID), notif, extra)
            }
          } catch (e) { console.error('notifyOwnerBM:', String(e)) }
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

    // Préférence de langue : lue en privé. Dans The Chicken Coop (groupe bilingue),
    // les réponses « canned » (boutons/CA) sont en anglais par défaut ; l'IA de
    // Francis, elle, répond dans la langue du message (voir francis-ai).
    const isFR = (msg.chat?.type === 'private')
      ? (await getLang(supabase, userId) === 'fr')
      : false
    const tr = (fr: string, en: string) => isFR ? fr : en

    // ══════════════════════════════════════════════════════════
    //  COCORICO RACING (F1 + MotoGP) — commandes OWNER, à la demande
    //  /F1essais /GPessais /F1qualifs /GPqualifs /F1sprint /GPsprint
    //  /F1course /GPcourse /F1we /GPwe /F1news /GPnews
    //  Délègue à la fonction isolée « racing » (recherche + EN + FR).
    // ══════════════════════════════════════════════════════════
    {
      const RACING_CMDS = ['/f1essais','/gpessais','/f1qualifs','/gpqualifs','/f1qualifssprint','/gpqualifssprint','/f1sprint','/gpsprint','/f1course','/gpcourse','/f1we','/gpwe','/f1news','/gpnews','/f1constructeurs','/gpconstructeurs']
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
    //  /xtrend (OWNER) — post viral prêt pour X sur une tendance X.
    //  Le bot cherche les 10 plus grosses tendances X, tu en choisis une, l'IA
    //  rédige un post viral (hors $FRANC) + bouton « Publier sur X ». Clé en main.
    //  Variantes régionales + pluriels tolérés :
    //   monde : /xtrend /xtrends        US : /xtrendUS /xtrendsUS
    //   France : /xtrendFR /xtrendsFR
    // ══════════════════════════════════════════════════════════
    const xcmd = text.toLowerCase().split(/[\s@]/)[0]
    const xtrendRegion =
      (xcmd === '/xtrend' || xcmd === '/xtrends') ? 'world'
      : (xcmd === '/xtrendus' || xcmd === '/xtrendsus') ? 'us'
      : (xcmd === '/xtrendfr' || xcmd === '/xtrendsfr') ? 'fr'
      : null
    if (xtrendRegion) {
      if (userId !== OWNER_ID) return new Response('ok')
      const rLabel = xtrendRegion === 'us' ? '🇺🇸 US' : xtrendRegion === 'fr' ? '🇫🇷 France' : '🌍 monde'
      const cronSecret = Deno.env.get('CRON_SECRET') || ''
      const trigger = fetch('https://mubqtnqulpyehkgubhnh.supabase.co/functions/v1/breaking-news', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronSecret },
        body: JSON.stringify({ action: 'xtrend_list', owner: Number(userId), region: xtrendRegion }),
      }).catch((e) => console.error('xtrend list:', String(e)))
      ;(globalThis as any).EdgeRuntime?.waitUntil?.(trigger)
      await sendMessage(token, chatId, `🔥 <b>X Trends</b> (${rLabel}) — ⏳ je cherche les plus grosses tendances…`)
      return new Response('ok')
    }

    // ══════════════════════════════════════════════════════════
    //  BREAKING NEWS perso (OWNER) — /f1 /motogp /worldroost /crypto + /x
    //  Le bot demande un SUJET, l'IA rédige (grounded) et envoie un APERÇU au
    //  owner → délègue à « breaking-news ».
    //   • /f1 /motogp /worldroost /crypto : aperçu EN+FR + ✅ Publier / ❌ Annuler
    //     (publie dans les 2 groupes au clic).
    //   • /x : un post prêt pour X + bouton « 📤 Publier sur X » (pas de post groupe).
    //  On peut aussi coller le sujet directement : « /f1 Toto Wolff en vacances… ».
    // ══════════════════════════════════════════════════════════
    {
      const BN_META: Record<string, { cat: string; emoji: string; label: string }> = {
        '/f1':         { cat: 'f1',         emoji: '🏎️', label: 'F1' },
        '/motogp':     { cat: 'motogp',     emoji: '🏍️', label: 'MotoGP' },
        '/worldroost': { cat: 'worldroost', emoji: '🌍', label: 'World Roost' },
        '/frenchcoop': { cat: 'frenchcoop', emoji: '🇫🇷', label: 'French Coop' },
        '/crypto':     { cat: 'crypto',     emoji: '⚡', label: 'Crypto' },
        '/x':          { cat: 'x',          emoji: '📤', label: 'X (annonce à publier)' },
      }
      const firstTok = text.split(/\s+/)[0]
      const meta = BN_META[firstTok]
      if (meta) {
        if (userId !== OWNER_ID) return new Response('ok')   // owner uniquement
        const inline = rawText.slice(firstTok.length).trim()   // sujet éventuel collé après la commande
        if (inline) {
          try { await supabase.from('admin_pending').delete().eq('owner_id', userId) } catch (_) { /* ok */ }
          const cronSecret = Deno.env.get('CRON_SECRET') || ''
          const trigger = fetch('https://mubqtnqulpyehkgubhnh.supabase.co/functions/v1/breaking-news', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronSecret },
            body: JSON.stringify({ category: meta.cat, subject: inline, owner: Number(userId) }),
          }).catch((e) => console.error('breaking trigger:', String(e)))
          ;(globalThis as any).EdgeRuntime?.waitUntil?.(trigger)
          await sendMessage(token, chatId, meta.cat === 'x'
            ? `📤 <b>Annonce X</b> — ⏳ je rédige ton post prêt à publier…`
            : `${meta.emoji} <b>Breaking news ${meta.label}</b> — ⏳ je rédige et je te montre l'aperçu EN+FR…`)
        } else {
          await supabase.from('admin_pending')
            .upsert({ owner_id: userId, action: 'breaking:' + meta.cat, created_at: new Date().toISOString() }, { onConflict: 'owner_id' })
          await sendMessage(token, chatId, meta.cat === 'x'
            ? `📤 <b>Annonce X</b> — quelle nouveauté veux-tu annoncer ?\nRéponds avec le sujet, je te rédige un post prêt à publier sur X (avec le bouton « Publier sur X »).`
            : `${meta.emoji} <b>Breaking news ${meta.label}</b> — quel sujet ?\nRéponds avec le sujet. Si c'est un potin (X/Twitter…), ajoute la source, je le mettrai en forme comme rumeur.`)
        }
        return new Response('ok')
      }
    }

    // ══════════════════════════════════════════════════════════
    //  /commandes (OWNER) — annuaire de toutes les commandes, bien classé.
    //  /horaires  (OWNER) — programme journalier d'envoi (heure de Paris).
    //  /gemini    (OWNER) — modèles IA utilisés par fonctionnalité.
    //  (singulier ou pluriel : les deux formes fonctionnent)
    // ══════════════════════════════════════════════════════════
    if (text === '/commandes' || text === '/commande') {
      if (userId !== OWNER_ID) return new Response('ok')
      await sendMessage(token, chatId,
        `🛠️ <b>Commandes disponibles</b>\n\n` +
        `<b>1️⃣ Setup (messages épinglés)</b>\n` +
        `/setupwallet — Topic Wallet\n/setupgames — Topic Games\n` +
        `/setupchickencoop — The Chicken Coop (General)\n/setuphotwings — Topic Hot Wings\n` +
        `/setupcryptocoop — Topic Crypto Coop\n/setupworldroost — Topic World Roost\n/setupfr — Topic French Coop\n/setuptrump — Topic Trump News\n\n` +
        `<b>2️⃣ Racing</b> (The Chicken Coop, EN + bouton 🇫🇷)\n` +
        `/F1essais · /GPessais — Essais libres\n/F1qualifs · /GPqualifs — Qualifications\n` +
        `/F1qualifssprint · /GPqualifssprint — Qualifs sprint\n/F1sprint · /GPsprint — Course sprint\n` +
        `/F1course · /GPcourse — Course (GP)\n/F1we · /GPwe — Programme du week-end\n/F1news · /GPnews — Potins paddock\n` +
        `/F1constructeurs · /GPconstructeurs — Classement constructeurs (PNG + bouton X)\n` +
        `<i>(classements course/qualifs/we envoyés en image PNG)</i>\n\n` +
        `<b>3️⃣ Breaking news perso</b>\n` +
        `/f1 — Breaking news F1\n/motogp — Breaking news MotoGP\n/worldroost — Breaking news World Roost\n` +
        `/frenchcoop — Breaking news French Coop 🇫🇷\n/crypto — Breaking news Crypto\n/x — Annonce prête pour X\n` +
        `/xtrend — Post viral sur une tendance X (🌍 monde)\n` +
        `/xtrendUS — Post viral tendance X (🇺🇸 US)\n/xtrendFR — Post viral tendance X (🇫🇷 France)\n` +
        `<i>(pluriels aussi ok : /xtrends, /xtrendsUS, /xtrendsFR)</i>\n\n` +
        `<b>4️⃣ Textes pour X</b>\n` +
        `/xf1 — Post X F1\n/xmotogp — Post X MotoGP\n/xcrypto — Post X Crypto\n` +
        `/xnews — Post X actu internationale\n/xfranc — Post X $FRANC (CA + liens)\n\n` +
        `<b>5️⃣ Modération</b>\n` +
        `/stopbotuser — Couper le bot pour un user (DM)\n` +
        `/stopbotchickencoopuser — … dans The Chicken Coop\n` +
        `/playbotuser · /playbotchickencoopuser — Réactiver un user\n` +
        `/stopbot · /stopbotchickencoop — Couper par groupe\n` +
        `/playbot · /playbotchickencoop — Réactiver par groupe\n` +
        `/enablesecretary — Mode secrétaire Business\n\n` +
        `<b>6️⃣ Publiques (tous)</b>\n` +
        `/start · /help · /rules · /status · /ca · /nodm\n` +
        `/spicy (= /holders) — accès Golden Rooster\n` +
        `/connect · /connecton · /connectsolana · /disconnect — wallet\n` +
        `/buystars · /cashback — Stars & cashback\n/en · /fr — langue · /play · /skip — jeux\n\n` +
        `<b>ℹ️ Utilitaires</b>\n/commandes — cette liste\n/horaires — programme journalier\n/gemini — modèles IA par fonctionnalité`)
      return new Response('ok')
    }

    if (text === '/horaires' || text === '/horaire') {
      if (userId !== OWNER_ID) return new Response('ok')
      await sendMessage(token, chatId,
        `🕒 <b>Programme journalier d'envoi</b>\n<i>(heure de Paris)</i>\n\n` +
        `<b>1️⃣ The Chicken Coop 🇬🇧🇫🇷</b> (bilingue)\n` +
        `06h05 — 🇺🇸 Trump Morning Brief\n` +
        `07h00 — 🌍 World Roost · Matin\n` +
        `07h55 — ⏰ Crypto Morning\n` +
        `08h50 — 😄 Blague du matin\n` +
        `09h45 — ⚡ Cocorico Dump\n` +
        `10h40 — 🌍 World Roost · Éco\n` +
        `11h35 — 🇫🇷 Le Coq de Midi\n` +
        `12h30 — 🌞 Crypto Midday\n` +
        `13h25 — 🌍 World Roost · Midi\n` +
        `14h20 — 🐓 Cocorico Fact\n` +
        `15h15 — 🇪🇺 Le Cocorico Express\n` +
        `16h10 — 🌍 World Roost · Tech\n` +
        `17h05 — 🚀 Cocorico Pump\n` +
        `18h00 — 🌍 World Roost · Soir\n` +
        `18h05 — 🇺🇸 Trump Evening Brief\n` +
        `18h55 — 🌆 Crypto Evening\n` +
        `19h50 — 🇫🇷 Le Cocorico du Soir\n` +
        `20h45 — 🌙 Crypto Night\n` +
        `21h40 — 🌍 World Roost · Nuit\n` +
        `22h30 — 🌙 Bonne nuit\n\n` +
        `<b>2️⃣ Golden Rooster 🔞</b>\n` +
        `10h10 — 🌶️ Hot News · Matin\n` +
        `13h10 — 🌶️ Hot News · Midi\n` +
        `20h10 — 🌶️ Hot News · Soir\n` +
        `🖼️ Feed images : chaque heure (via le NAS)\n` +
        `🔒 Vérif adhésion : rappel 08h00 · expulsion 10h00\n\n` +
        `<b>ℹ️ Interne (toi seul)</b>\n` +
        `22h40 — 📊 Rapport quotidien\n` +
        `23h00 — 🧹 Nettoyage mémoire`)
      return new Response('ok')
    }

    if (text === '/gemini') {
      if (userId !== OWNER_ID) return new Response('ok')
      await sendMessage(token, chatId,
        `🤖 <b>Modèles Gemini par fonctionnalité</b>\n` +
        `<i>(sollicitations = passages programmés par jour)</i>\n\n` +
        `<b>1️⃣ Gemini 2.5 Flash-Lite</b> — recherche web (primaire)\n` +
        `Daily-crypto : 4/jour\nDaily-pump : 2/jour\n<i>(+ repli pour Daily-world & Racing)</i>\n\n` +
        `<b>2️⃣ Gemini 2.5 Flash</b> — recherche web (primaire)\n` +
        `Daily-world : 6/jour\nRacing : à la demande\n<i>(+ repli pour Daily-crypto & Daily-pump)</i>\n\n` +
        `<b>3️⃣ Gemini 3.5 Flash-Lite</b> — mise en forme, traduction, génération & réponses\n` +
        `<i>(repli automatique sur 3.1 Flash-Lite si quota atteint)</i>\n` +
        `Daily-crypto : 4/jour\nDaily-world : 6/jour\nDaily-pump : 2/jour\nDaily-hot : 3/jour\n` +
        `Daily-general : 2/jour\nDaily-fact-dyk : 1/jour\nTrump-news : en pause\n` +
        `Racing : à la demande\nBreaking-news : à la demande\nRéponses du bot (Telegram) : à la demande`)
      return new Response('ok')
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
        const allowed = ['message','edited_message','callback_query','channel_post','chat_member','business_connection','business_message','edited_business_message','deleted_business_messages']
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
    //  PAUSE / REPRISE de Francis IA dans The Chicken Coop
    //  À taper dans le bot en privé (réservé au owner) :
    //   /stopbotchickencoop · /playbotchickencoop
    //  Coupe / relance les réponses auto de Francis quand les
    //  membres discutent entre eux et n'ont pas besoin du bot.
    // ══════════════════════════════════════════════════════════
    if (text === '/stopbotchickencoop' || text === '/playbotchickencoop') {
      if (userId !== OWNER_ID) return new Response('ok')   // owner uniquement
      const target = CHICKEN_COOP
      const groupName = 'The Chicken Coop'
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
    //  PAUSE / REPRISE des réponses INDIVIDUELLES (DM + Business)
    //  /stopbot · /playbot — réservé au owner, à taper dans le bot.
    //  Clé sentinelle chat_id = 0 dans bot_pause (aucun chat réel = 0).
    // ══════════════════════════════════════════════════════════
    if (text === '/stopbot' || text === '/playbot') {
      if (userId !== OWNER_ID) return new Response('ok')   // owner uniquement
      const paused = text === '/stopbot'
      await supabase.from('bot_pause')
        .upsert({ chat_id: 0, paused, updated_at: new Date().toISOString() }, { onConflict: 'chat_id' })
      await sendMessage(token, chatId,
        paused
          ? `⏸️ <b>Réponses individuelles en pause.</b>\nFrancis ne répond plus en privé (DM) ni en mode secrétaire (Business). Tape /playbot pour réactiver.`
          : `▶️ <b>Réponses individuelles réactivées.</b>\nFrancis répond de nouveau en privé et en mode secrétaire.`)
      return new Response('ok')
    }

    // ══════════════════════════════════════════════════════════
    //  PAUSE / REPRISE par UTILISATEUR (owner, en privé)
    //  /stopbotuser · /stopbotchickencoopuser
    //     → le bot demande le pseudo, puis coupe Francis pour cet user.
    //  /playbotuser · /playbotchickencoopuser
    //     → le bot liste les users en pause (boutons) pour réactiver.
    // ══════════════════════════════════════════════════════════
    if (text === '/stopbotuser' || text === '/stopbotchickencoopuser') {
      if (userId !== OWNER_ID) return new Response('ok')
      const scope = text.includes('chickencoop') ? 'chickencoop' : 'dm'
      await supabase.from('admin_pending')
        .upsert({ owner_id: userId, action: 'stopuser:' + scope, created_at: new Date().toISOString() }, { onConflict: 'owner_id' })
      await sendMessage(token, chatId,
        `👤 Pour <b>${pauseScopeLabel(scope)}</b> : quel utilisateur dois-je arrêter ?\nRéponds avec son pseudo (ex. <code>@jean</code> ou <code>jean</code>).`)
      return new Response('ok')
    }

    if (text === '/playbotuser' || text === '/playbotchickencoopuser') {
      if (userId !== OWNER_ID) return new Response('ok')
      const scope = text.includes('chickencoop') ? 'chickencoop' : 'dm'
      const { data: rows } = await supabase.from('user_pause')
        .select('username').eq('scope', scope).eq('paused', true).order('added_at')
      if (!rows || rows.length === 0) {
        await sendMessage(token, chatId, `✅ Aucun utilisateur en pause pour <b>${pauseScopeLabel(scope)}</b>.`)
        return new Response('ok')
      }
      const kb = rows.map((r: any) => [{ text: '▶️ @' + r.username, callback_data: 'unpause:' + scope + ':' + r.username }])
      await sendMessage(token, chatId,
        `👤 Utilisateurs en pause pour <b>${pauseScopeLabel(scope)}</b> — touche pour réactiver :`,
        { reply_markup: { inline_keyboard: kb } })
      return new Response('ok')
    }

    // Owner répond au "quel utilisateur ?" ou "quel sujet ?" (en privé).
    if (msg.chat?.type === 'private' && userId === OWNER_ID && rawText.length > 0 && !rawText.startsWith('/')) {
      const { data: pend } = await supabase.from('admin_pending').select('action').eq('owner_id', userId).maybeSingle()
      // Sujet d'une breaking news perso (/f1 /motogp /worldroost /crypto).
      if (pend?.action && String(pend.action).startsWith('breaking:')) {
        const category = String(pend.action).split(':')[1]
        try { await supabase.from('admin_pending').delete().eq('owner_id', userId) } catch (_) { /* ok */ }
        const cronSecret = Deno.env.get('CRON_SECRET') || ''
        const trigger = fetch('https://mubqtnqulpyehkgubhnh.supabase.co/functions/v1/breaking-news', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronSecret },
          body: JSON.stringify({ category, subject: rawText.trim(), owner: Number(userId) }),
        }).catch((e) => console.error('breaking trigger:', String(e)))
        ;(globalThis as any).EdgeRuntime?.waitUntil?.(trigger)
        await sendMessage(token, chatId, `⏳ Je rédige la breaking news et je te montre l'aperçu EN+FR…`)
        return new Response('ok')
      }
      if (pend?.action && String(pend.action).startsWith('stopuser:')) {
        const scope = String(pend.action).split(':')[1]
        try { await supabase.from('admin_pending').delete().eq('owner_id', userId) } catch (_) { /* ok */ }
        const uname = rawText.trim().replace(/^@/, '').toLowerCase()
        if (!/^[a-z0-9_]{3,32}$/.test(uname)) {
          await sendMessage(token, chatId, `❌ Pseudo invalide « ${rawText.trim()} ». Relance la commande /stopbot…user.`)
          return new Response('ok')
        }
        await supabase.from('user_pause')
          .upsert({ scope, username: uname, paused: true, added_at: new Date().toISOString() }, { onConflict: 'scope,username' })
        await sendMessage(token, chatId,
          `⏸️ Francis ne répondra plus à <b>@${uname}</b> dans <b>${pauseScopeLabel(scope)}</b>.\n(<code>/playbot${scope === 'chickencoop' ? 'chickencoop' : ''}user</code> pour réactiver.)`)
        return new Response('ok')
      }
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
    //  /xf1 /xmotogp /xcrypto /xnews /xfranc — mentions à coller EN
    //  COMMENTAIRE d'un post X (le lien t.me dans le post = shadowban).
    //  Renvoie le texte + un bouton 📋 Copier.
    // ══════════════════════════════════════════════════════════
    if (X_CTA[text] !== undefined) {
      if (msg.chat?.type !== 'private') return new Response('ok')
      const t = X_CTA[text]
      const kb = (t.length <= 256) ? { reply_markup: { inline_keyboard: [[{ text: '📋 Copier', copy_text: { text: t } }]] } } : {}
      await sendMessage(token, chatId, t, kb)
      return new Response('ok')
    }

    // ══════════════════════════════════════════════════════════
    //  SPICY (18+) — accès GRATUIT au groupe privé, réservé aux membres
    //  de The Chicken Coop 🇬🇧 OU du Poulailler 🇫🇷 (plus de condition $FRANC).
    //  Deep-link ?start=spicy, bouton clavier 🔞, /holders (alias) et /spicy.
    // ══════════════════════════════════════════════════════════
    // NB : /only for holders/i capte les ANCIENS libellés du bouton Spicy encore
    // en cache chez certains (ex. « 🔞 Only for Holders or ⭐ (Soon …) »). Sans
    // ça, ce clic tombait dans le flux « message libre » → réponse IA parasite
    // (« You've got an eye… ») + notif owner injustifiée. On le renvoie vers
    // l'accueil Spicy fixe : pas d'IA, pas de notif.
    if (text === '/start spicy' || text === '/spicy' || text === '/holders' || btnIs(text, 'holders')
        || /only for holders/i.test(rawText)) {
      if (msg.chat?.type !== 'private') return new Response('ok')
      await sendMessage(token, chatId, spicyWelcomeText(isFR), { reply_markup: spicyWelcomeKeyboard(isFR) })
      // Installe aussi le clavier de menu principal (jeux, wallet…) pour que
      // l'utilisateur arrivé par le deep-link ?start=spicy ne se retrouve pas
      // sans navigation une fois la procédure Spicy terminée.
      await sendMessage(token, chatId, tr('💡 Utilise le menu ci-dessous pour naviguer 👇', '💡 Use the menu below to navigate 👇'), { reply_markup: buildKeyboard(isFR) })
      return new Response('ok')
    }

    // ══════════════════════════════════════════════════════════
    //  CHICKEN COOP GROUP — accès unifié (Solana / TON / Stars)
    // ══════════════════════════════════════════════════════════
    // NB : les libellés de boutons du clavier (jeux, Coop, Poulailler…) sont EXCLUS
    // de ce bloc → ils filent vers leurs handlers plus bas (sinon ils étaient avalés
    // ici et « il ne se passait rien » quand on cliquait dans le groupe).
    if (chatId === CHICKEN_COOP
        && !text.startsWith('/setup')
        && !isKeyboardButton(text)) {

      const grpLang: 'en' | 'fr' = 'en'

      // Owner toujours autorisé
      if (userId === OWNER_ID) return new Response('ok')

      // Si le message vient d'un canal lié (sender_chat) → ignore
      if (msg.sender_chat) return new Response('ok')

      // Vérifie le statut admin
      const status = await getChatMemberStatus(token, chatId, msg.from.id)
      console.log(`group msg: userId=${userId} status=${status}`)
      if (status === 'administrator' || status === 'creator') return new Response('ok')

      // ── Accueil déclenché par le 1er GM/hi d'un NOUVEL arrivant ──
      // On n'accueille QUE les personnes marquées « à accueillir » à leur arrivée
      // (table welcome_pending) → les membres déjà en place ne reçoivent rien.
      if (isGreeting(rawText)) {
        const { data: pendingW } = await supabase.from('welcome_pending').select('user_id').eq('chat_id', chatId).eq('user_id', msg.from.id).maybeSingle()
        if (pendingW) {
          try { await supabase.from('welcome_pending').delete().eq('chat_id', chatId).eq('user_id', msg.from.id) } catch (_) { /* ok */ }
          const w = coopWelcome(userMention(msg.from))
          await sendMessage(token, chatId, w.text, { reply_markup: w.reply_markup, reply_to_message_id: messageId })
          return new Response('ok')
        }
      }

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
        if (isPlainText) {
          // Bot en pause pour ce groupe ? (piloté par /stopbot… /playbot… depuis le bot en privé)
          try {
            const { data: pauseRow } = await supabase.from('bot_pause').select('paused').eq('chat_id', chatId).single()
            if (pauseRow?.paused) return new Response('ok')
          } catch (_) { /* pas de ligne / table injoignable → on considère actif */ }
          // Utilisateur précis mis en pause dans CE groupe (/stopbot…user) ?
          if (await isUserPaused(supabase, 'chickencoop', msg.from.username)) return new Response('ok')
          const grpKey = 'grp:' + chatId
          await saveChatMemory(supabase, grpKey, 'user', rawText)   // contexte immédiat (batch + cohérence)
          // CA impératif : envoi déterministe dans le topic (dédup 60s).
          const grpOldCa = mentionsOldTestCa(rawText)
          if (isCaRequest(rawText) || grpOldCa) {
            if (await claimReplySlot(supabase, grpKey + ':ca', 60)) {
              const cp = caPayload(isFR, grpOldCa)
              await sendMessage(token, chatId, cp.text,
                { ...(threadId ? { message_thread_id: threadId } : {}), reply_markup: { inline_keyboard: cp.inline_keyboard } })
            }
          }
          // Verrou PARTAGÉ (DB) : une seule réponse / 5 min, même multi-instances.
          const grpClaimed = await claimReplySlot(supabase, grpKey, 300)
          if (grpClaimed) {
            const bgMsgId = messageId
            const bgThread = threadId
            const bg = (async () => {
              await new Promise((r) => setTimeout(r, FRANCIS_REPLY_DELAY_MS))   // laisse arriver la salve
              const reply = await buildBatchedReply(supabase, grpKey, 'group', grpLang)
              if (!reply) { await releaseReplySlot(supabase, grpKey); return }
              await sendMessage(token, chatId, reply,
                { reply_to_message_id: bgMsgId, ...(bgThread ? { message_thread_id: bgThread } : {}) })
              await saveChatMemory(supabase, grpKey, 'model', reply)
            })()
            // 200 immédiat au webhook (sinon Telegram retente → doublons).
            try { (globalThis as any).EdgeRuntime?.waitUntil?.(bg) } catch (_) { /* best effort */ }
          }
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
      await postSetupBilingual(token, supabase, EN_TOPIC.wallet, FR_TOPIC.wallet,
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
      ,
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
      await postSetupBilingual(token, supabase, EN_TOPIC.games, FR_TOPIC.games,
        `🎉 <b>Welcome to Francis' Games Universe</b>\n\n` +
        `🐓 <b>Tamagotchi</b> — Keep Francis alive\n` +
        `🔫 <b>FrancRun</b> — Run. Dodge. Score.\n` +
        `⛵ <b>Ormuz</b> — Survive the crossing\n` +
        `🥚 <b>EggClicker</b> — Grow your empire\n` +
        `🧩 <b>Sudoku</b> — Solve. Compete. Earn.\n` +
        `🎯 <b>Mastermind</b> — Crack the code\n` +
        `🟢 <b>Motus</b> — Guess the hidden word\n` +
        `🐍 <b>ChickenSnake</b> — Slither. Gobble. Grow.\n` +
        `🔍 <b>Words searches</b> — Spot. Circle. Score.\n` +
        `🃏 <b>ChickenSolitaire</b> — Flip. Stack. Win.\n` +
        `🥊 <b>Chicken Fight</b> — Peck. Dodge. Knock out.\n` +
        `⚡ <b>Chicken Reflex</b> — Tap fast. Beat the clock.\n` +
        `🧠 <b>Chicken Memory</b> — Flip. Match. Remember.\n` +
        `📈 <b>Eggsponential</b> — Swipe. Merge. Grow.\n` +
        `💣 <b>Chicken Mine</b> — Open. Flag. Dodge the foxes.\n` +
        `🪝 <b>Chicken Hang</b> — Guess the word.\n` +
        `💥 <b>Chicken Blast</b> — Slide. Fill. Blast.`,
        [
          [{ text: '🐔 All games & Rooster Universe', url: MENU_DEEPLINK }],
          [{ text: '🐓 Tamagotchi', url: TAMAGOTCHI_URL }, { text: '🥚 EggClicker', url: EGGCLICKER_URL }],
          [{ text: '🔫 FrancRun', url: FRANCRUN_URL }, { text: '⛵ Ormuz', url: ORMUZ_URL }],
          [{ text: '🎯 Mastermind', url: MASTERMIND_URL }, { text: '🧩 Sudoku', url: SUDOKU_URL }],
          [{ text: '🟢 Motus', url: MOTUS_URL }, { text: '🐍 ChickenSnake', url: SNAKE_URL }],
          [{ text: '🔍 Words searches', url: WORDSEARCH_URL }, { text: '🃏 ChickenSolitaire', url: SOLITAIRE_URL }],
          [{ text: '🥊 Chicken Fight', url: CHICKENFIGHT_URL }, { text: '⚡ Chicken Reflex', url: CHICKENREFLEX_URL }],
          [{ text: '🧠 Chicken Memory', url: CHICKENMEMORY_URL }, { text: '📈 Eggsponential', url: EGGSPONENTIAL_URL }],
          [{ text: '💣 Chicken Mine', url: CHICKENMINE_URL }, { text: '🪝 Chicken Hang', url: CHICKENHANG_URL }],
          [{ text: '💥 Chicken Blast', url: CHICKENBLAST_URL }],
          [{ text: '📜 Game Rules', url: RULES_DEEPLINK }]
        ]
      ,
        `🎉 <b>Bienvenue dans l'univers des jeux de Francis</b>\n\n` +
        `🐓 <b>Tamagotchi</b> — Garde Francis en vie\n` +
        `🔫 <b>FrancRun</b> — Cours. Esquive. Score.\n` +
        `⛵ <b>Ormuz</b> — Survis à la traversée\n` +
        `🥚 <b>EggClicker</b> — Bâtis ton empire\n` +
        `🧩 <b>Sudoku</b> — Résous. Rivalise. Gagne.\n` +
        `🎯 <b>Mastermind</b> — Casse le code\n` +
        `🟢 <b>Motus</b> — Devine le mot caché\n` +
        `🐍 <b>ChickenSnake</b> — Rampe. Gobe. Grandis.\n` +
        `🔍 <b>Words searches</b> — Repère. Entoure. Score.\n` +
        `🃏 <b>ChickenSolitaire</b> — Retourne. Empile. Gagne.\n` +
        `🥊 <b>Chicken Fight</b> — Frappe. Esquive. Assomme.\n` +
        `⚡ <b>Chicken Reflex</b> — Tape vite. Bats le chrono.\n` +
        `🧠 <b>Chicken Memory</b> — Retourne. Associe. Mémorise.\n` +
        `📈 <b>Eggsponential</b> — Glisse. Fusionne. Grandis.\n` +
        `💣 <b>Chicken Mine</b> — Ouvre. Marque. Évite les renards.\n` +
        `🪝 <b>Chicken Hang</b> — Devine le mot.\n` +
        `💥 <b>Chicken Blast</b> — Glisse. Remplis. Explose.`,
        [
          [{ text: '🐔 Tous les jeux & univers Francis', url: MENU_DEEPLINK }],
          [{ text: '🐓 Tamagotchi', url: TAMAGOTCHI_URL }, { text: '🥚 EggClicker', url: EGGCLICKER_URL }],
          [{ text: '🔫 FrancRun', url: FRANCRUN_URL }, { text: '⛵ Ormuz', url: ORMUZ_URL }],
          [{ text: '🎯 Mastermind', url: MASTERMIND_URL }, { text: '🧩 Sudoku', url: SUDOKU_URL }],
          [{ text: '🟢 Motus', url: MOTUS_URL }, { text: '🐍 ChickenSnake', url: SNAKE_URL }],
          [{ text: '🔍 Words searches', url: WORDSEARCH_URL }, { text: '🃏 ChickenSolitaire', url: SOLITAIRE_URL }],
          [{ text: '🥊 Chicken Fight', url: CHICKENFIGHT_URL }, { text: '⚡ Chicken Reflex', url: CHICKENREFLEX_URL }],
          [{ text: '🧠 Chicken Memory', url: CHICKENMEMORY_URL }, { text: '📈 Eggsponential', url: EGGSPONENTIAL_URL }],
          [{ text: '💣 Chicken Mine', url: CHICKENMINE_URL }, { text: '🪝 Chicken Hang', url: CHICKENHANG_URL }],
          [{ text: '💥 Chicken Blast', url: CHICKENBLAST_URL }],
          [{ text: '📜 Règles des jeux', url: RULES_DEEPLINK }]
        ]
      )
      await sendMessage(token, chatId, tr('✅ Jeux publiés et épinglés dans les deux groupes.', '✅ Games posted and pinned in both groups.'))
      return new Response('ok')
    }

    if (text === '/setupchickencoop') {
      if (userId !== OWNER_ID) return new Response('ok')   // owner uniquement (tapé dans le bot)
      await deleteMessage(token, chatId, messageId)
      await postSetupBilingual(token, supabase, EN_TOPIC.coop, FR_TOPIC.coop,
        `🐓 <b>Welcome to The Chicken Coop!</b>\n\n` +
        `The official home of <b>$FRANC by Francis the rooster</b> — a community memecoin with a whole universe of games. 🎮\n\n` +
        `Find your way around:\n` +
        `💰 <b>Crypto Coop</b> — non-stop crypto news, decoded\n` +
        `📰 <b>World Roost</b> — the world's biggest stories, every day\n` +
        `🇺🇸 <b>Trump News</b> — every Trump post first, so you're always a step ahead\n` +
        `🔥 <b>Hot Wings</b> — the spiciest must-read headlines\n` +
        `🏁 <b>Cocorico Racing</b> — F1 & MotoGP highlights, race by race\n` +
        `🎮 <b>Games</b> — play all of Francis' mini-games\n` +
        `🔗 <b>Wallet</b> — connect & unlock the full experience\n\n` +
        `👉 <b>Everything is free in the Rooster Universe!</b>\n` +
        `💲 Unlock exclusive features across all our games. Hold just 1 $FRANC to unlock everything — it costs less than a cent!\n` +
        `💲 Not a holder yet? Unlock everything with ⭐ Stars and get $FRANC cashback!\n\n` +
        `Have fun, be kind, and enjoy the coop! 🐔\n` +
        `🌐 Bilingual group: 🇬🇧🇫🇷 — write in English or French!`,
        [
          [{ text: '🐔 All games & Rooster Universe', url: MENU_DEEPLINK }],
          [{ text: '📜 Game Rules', url: RULES_DEEPLINK }, { text: '🔗 Wallet', url: WALLET_URL }],
          [{ text: '💰 $Franc on TON', url: BUY_FRANC_TON_URL }, { text: '💰 $Franc on SOL', url: BUY_FRANC_SOL_URL }]
        ]
      ,
        `🐓 <b>Bienvenue dans The Chicken Coop !</b>\n\n` +
        `La maison officielle de <b>$FRANC by Francis le coq</b> — un memecoin communautaire bilingue 🇬🇧🇫🇷 avec tout un univers de jeux. 🎮\n\n` +
        `Repère-toi facilement :\n` +
        `💰 <b>Crypto Cocorico</b> — l'actu crypto en continu, décryptée\n` +
        `📰 <b>Le Chant du Monde</b> — les grandes actus internationales, chaque jour\n` +
        `🇺🇸 <b>Trump News</b> — les posts du président américain en avant-première, pour ne rien louper et garder un coup d'avance\n` +
        `🔥 <b>Hot Wings</b> — l'actu hot à ne pas manquer\n` +
        `🏁 <b>Cocorico Racing</b> — F1 & MotoGP, les temps forts course après course\n` +
        `🎮 <b>Jeux</b> — des mini-jeux uniques à l'effigie du coq\n` +
        `🔗 <b>Portefeuille</b> — connecte-toi & débloque tout l'univers\n\n` +
        `👉 <b>Tout est gratuit dans l'univers du coq !</b>\n` +
        `💲 Débloque de belles fonctionnalités exclusives dans l'ensemble de nos jeux. Détiens seulement 1 $FRANC pour tout débloquer — moins d'un centime !\n` +
        `💲 Pas encore holder ? Débloque tout avec des ⭐ Stars et reçois du cashback $FRANC !\n\n` +
        `Amuse-toi, sois sympa, et profite du groupe ! 🐔\n` +
        `🌐 Groupe bilingue : 🇬🇧🇫🇷 — écris en français ou en anglais !`,
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
      await postSetupBilingual(token, supabase, EN_TOPIC.hotwings, FR_TOPIC.hotwings,
        `🌶️ <b>Hot Wings</b>\n\n` +
        `The spiciest corner of the coop: the must-read headlines from the adult-entertainment industry — new releases, performers, launches, awards and big moves. Playful and flirty, always tasteful. 🔥\n\n` +
        `🕒 <b>Posted every day (Paris time):</b>\n` +
        `👉 10:10 — Hot morning\n` +
        `👉 13:10 — Hot midday\n` +
        `👉 20:10 — Hot evening`,
        [[{ text: '🔗 Wallet', url: WALLET_URL }, { text: '🐔 Rooster Universe', url: MENU_DEEPLINK }]]
      ,
        `🌶️ <b>Hot Wings</b>\n\n` +
        `Le coin le plus épicé du groupe : l'actu à ne pas manquer de l'industrie du divertissement pour adultes — sorties, stars, lancements, récompenses et gros mouvements. Taquin et coquin, toujours avec classe. 🔥\n\n` +
        `🕒 <b>Diffusion chaque jour (heure de Paris) :</b>\n` +
        `👉 10:10 — Hot du matin\n` +
        `👉 13:10 — Hot du midi\n` +
        `👉 20:10 — Hot du soir`,
        [[{ text: '🔗 Wallet', url: WALLET_URL }, { text: '🐔 Univers Francis', url: MENU_DEEPLINK }]]
      )
      await sendMessage(token, chatId, tr('✅ Hot Wings publié et épinglé dans les deux groupes.', '✅ Hot Wings posted and pinned in both groups.'))
      return new Response('ok')
    }

    // ══════════════════════════════════════════════════════════
    //  /setupTrump — présentation du topic "Trump News" (🇺🇸)
    // ══════════════════════════════════════════════════════════
    if (text === '/setuptrump') {
      if (userId !== OWNER_ID) return new Response('ok')   // owner uniquement (tapé dans le bot)
      await deleteMessage(token, chatId, messageId)
      await postSetupBilingual(token, supabase, EN_TOPIC.trump, FR_TOPIC.trump,
        `🇺🇸 <b>Trump News — the daily brief</b>\n\n` +
        `Donald J. Trump posts a LOT. So instead of drowning you in every post, Francis reads them all and hands you <b>two clean recaps a day</b> — topics covered, the essentials, and Francis' take. 🦅\n\n` +
        `🕒 <b>Every day (Paris time):</b>\n` +
        `👉 06:05 — 🐓 <b>Trump Morning Brief</b> — the last 12h, summed up\n` +
        `👉 18:05 — 🐓 <b>Trump Evening Brief</b> — the last 12h, summed up\n\n` +
        `💰 Trump wanted to charge up to <b>$100,000/month</b> for early access to his posts. Here it's <b>100% FREE</b>. <b>That's the spirit of the coop.</b> 🐔\n\n` +
        `<i>Reposts (RT) are skipped — only his own original posts. No brief on the rare days he doesn't post.</i>`,
        [[{ text: '🔗 Wallet', url: WALLET_URL }, { text: '🐔 Rooster Universe', url: MENU_DEEPLINK }]]
      ,
        `🇺🇸 <b>Trump News — le brief quotidien</b>\n\n` +
        `Donald J. Trump poste ÉNORMÉMENT. Plutôt que de te noyer sous chaque post, Francis les lit tous et te livre <b>deux récaps par jour</b> — les sujets abordés, l'essentiel, et le mot de Francis. 🦅\n\n` +
        `🕒 <b>Chaque jour (heure de Paris) :</b>\n` +
        `👉 06:05 — 🐓 <b>Trump Morning Brief</b> — les 12 dernières heures résumées\n` +
        `👉 18:05 — 🐓 <b>Trump Evening Brief</b> — les 12 dernières heures résumées\n\n` +
        `💰 Trump voulait faire payer jusqu'à <b>100 000 $/mois</b> pour accéder en primeur à ses posts. Ici, c'est <b>100% GRATUIT</b>. <b>C'est ça, l'esprit de la basse-cour.</b> 🐔\n\n` +
        `<i>Les reposts (RT) sont ignorés — uniquement ses posts originaux. Pas de résumé les rares jours sans post.</i>`,
        [[{ text: '🔗 Wallet', url: WALLET_URL }, { text: '🐔 Univers Francis', url: MENU_DEEPLINK }]]
      )
      await sendMessage(token, chatId, tr('✅ Trump News publié et épinglé dans les deux groupes.', '✅ Trump News posted and pinned in both groups.'))
      return new Response('ok')
    }

    // ══════════════════════════════════════════════════════════
    //  /setupcryptocoop — présentation du topic Crypto (💰)
    // ══════════════════════════════════════════════════════════
    if (text === '/setupcryptocoop') {
      if (userId !== OWNER_ID) return new Response('ok')   // owner uniquement (tapé dans le bot)
      await deleteMessage(token, chatId, messageId)
      await postSetupBilingual(token, supabase, EN_TOPIC.cryptocoop, FR_TOPIC.cryptocoop,
        `💰 <b>Crypto Coop</b>\n\n` +
        `Non-stop crypto news, decoded for everyone: the biggest market moves, regulation, ETFs, hacks and adoption — plus a daily "Cocorico Pump" spotlight on the top 24h gainer, and an end-of-day wrap. 🐓\n\n` +
        `🕒 <b>Posted every day (Paris time):</b>\n` +
        `👉 07:55 — GM / Morning\n` +
        `👉 09:45 — 📉 Cocorico Dump\n` +
        `👉 12:30 — Midday\n` +
        `👉 17:05 — 🚀 Cocorico Pump\n` +
        `👉 18:55 — Evening\n` +
        `👉 20:45 — Night wrap`,
        [
          [{ text: '🐔 All games & Rooster Universe', url: MENU_DEEPLINK }],
          [{ text: '💰 $Franc on SOL', url: BUY_FRANC_SOL_URL }, { text: '💰 $Franc on TON', url: BUY_FRANC_TON_URL }]
        ]
      ,
        `💰 <b>Crypto Cocorico</b>\n\n` +
        `L'actu crypto en continu, décryptée pour tous : les gros mouvements de marché, la régulation, les ETF, les hacks et l'adoption — plus un « Cocorico Pump » quotidien sur le plus gros gagnant 24h, et un récap de fin de journée. 🐓\n\n` +
        `🕒 <b>Diffusion chaque jour (heure de Paris) :</b>\n` +
        `👉 07:55 — GM / Matin\n` +
        `👉 09:45 — 📉 Cocorico Dump\n` +
        `👉 12:30 — Midi\n` +
        `👉 17:05 — 🚀 Cocorico Pump\n` +
        `👉 18:55 — Soir\n` +
        `👉 20:45 — Récap du soir`,
        [
          [{ text: '🐔 Tous les jeux & univers Francis', url: MENU_DEEPLINK }],
          [{ text: '💰 $Franc sur SOL', url: BUY_FRANC_SOL_URL }, { text: '💰 $Franc sur TON', url: BUY_FRANC_TON_URL }]
        ]
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
      await postSetupBilingual(token, supabase, EN_TOPIC.worldroost, FR_TOPIC.worldroost,
        `📰 <b>World Roost</b>\n\n` +
        `The world's biggest stories, every day, clear and to the point: geopolitics, economy, tech and the evening brief — so you never miss what matters. 🌍\n\n` +
        `🕒 <b>Posted every day (Paris time):</b>\n` +
        `👉 07:00 — Wake-up brief\n` +
        `👉 10:40 — Cocorico Eco\n` +
        `👉 13:25 — Midday news\n` +
        `👉 16:10 — Cocorico Tech\n` +
        `👉 18:00 — The World Tonight\n` +
        `👉 21:40 — The Day in Review`,
        [
          [{ text: '🐔 All games & Rooster Universe', url: MENU_DEEPLINK }],
          [{ text: '💰 $Franc on SOL', url: BUY_FRANC_SOL_URL }, { text: '💰 $Franc on TON', url: BUY_FRANC_TON_URL }]
        ]
      ,
        `📰 <b>Le Chant du Monde</b>\n\n` +
        `Les grandes actus internationales, chaque jour, claires et à l'essentiel : géopolitique, économie, tech et le brief du soir — pour ne rien rater de ce qui compte. 🌍\n\n` +
        `🕒 <b>Diffusion chaque jour (heure de Paris) :</b>\n` +
        `👉 07:00 — Réveil Info\n` +
        `👉 10:40 — Cocorico Éco\n` +
        `👉 13:25 — Actu Midi\n` +
        `👉 16:10 — Cocorico Tech\n` +
        `👉 18:00 — Le Monde ce Soir\n` +
        `👉 21:40 — L'actu du Jour en Bref`,
        [
          [{ text: '🐔 Tous les jeux & univers Francis', url: MENU_DEEPLINK }],
          [{ text: '💰 $Franc sur SOL', url: BUY_FRANC_SOL_URL }, { text: '💰 $Franc sur TON', url: BUY_FRANC_TON_URL }]
        ]
      )
      await sendMessage(token, chatId, tr('✅ World Roost publié et épinglé dans les deux groupes.', '✅ World Roost posted and pinned in both groups.'))
      return new Response('ok')
    }

    // ══════════════════════════════════════════════════════════
    //  /setupfr — présentation du topic French Coop (🇫🇷, FR par défaut)
    // ══════════════════════════════════════════════════════════
    if (text === '/setupfr' || text === '/setupfrenchcoop') {
      if (userId !== OWNER_ID) return new Response('ok')   // owner uniquement (tapé dans le bot)
      await deleteMessage(token, chatId, messageId)
      await postSetupFrench(token, supabase, FRENCH_COOP_THREAD,
        // FR (défaut)
        `🇫🇷 <b>French Coop</b>\n\n` +
        `L'actualité française et européenne, chaque jour, claire et à l'essentiel — l'info qui compte pour la communauté francophone. 🐓\n\n` +
        `🕒 <b>Diffusion chaque jour (heure de Paris) :</b>\n` +
        `👉 11:35 — 🇫🇷 Meilleure actu France\n` +
        `👉 15:15 — 🇪🇺 Meilleure actu Union Européenne\n` +
        `👉 19:50 — 🇫🇷 Meilleure actu France`,
        [
          [{ text: '🐓 All games & Rooster universe', url: MENU_DEEPLINK }],
          [{ text: '💎 $Franc on TON', url: BUY_FRANC_TON_URL }, { text: '💰 $Franc on SOL', url: BUY_FRANC_SOL_URL }],
        ],
        // EN (aperçu)
        `🇫🇷 <b>French Coop</b>\n\n` +
        `French and European news, every day, clear and to the point — the stories that matter to the French-speaking community. 🐓\n\n` +
        `🕒 <b>Posted every day (Paris time):</b>\n` +
        `👉 11:35 — 🇫🇷 Top French story\n` +
        `👉 15:15 — 🇪🇺 Top EU story\n` +
        `👉 19:50 — 🇫🇷 Top French story`,
        [
          [{ text: '🐓 All games & Rooster universe', url: MENU_DEEPLINK }],
          [{ text: '💎 $Franc on TON', url: BUY_FRANC_TON_URL }, { text: '💰 $Franc on SOL', url: BUY_FRANC_SOL_URL }],
        ],
      )
      await sendMessage(token, chatId, tr('✅ French Coop publié et épinglé.', '✅ French Coop posted and pinned.'))
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

    if (btnIs(text, 'chickensolitaire')) {
      await sendMessage(token, chatId,
        tr(`🃏 <b>CHICKEN SOLITAIRE</b>\nRetourne. Empile. Gagne. — le solitaire Klondike à l'effigie de Francis ! 🐔`,
           `🃏 <b>CHICKEN SOLITAIRE</b>\nFlip. Stack. Win. — the classic Klondike solitaire in Francis' universe! 🐔`),
        { reply_markup: { inline_keyboard: [
          [{ text: tr('🃏 Jouer à ChickenSolitaire','🃏 Play ChickenSolitaire'), url: SOLITAIRE_URL }]
        ]}}
      )
      return new Response('ok')
    }

    if (btnIs(text, 'chickenfight')) {
      await sendMessage(token, chatId,
        tr(`🥊 <b>CHICKEN FIGHT</b>\nFrappe, esquive et assomme tes adversaires dans l'arène de Francis ! 🐔`,
           `🥊 <b>CHICKEN FIGHT</b>\nPeck, dodge and knock out your rivals in Francis' arena! 🐔`),
        { reply_markup: { inline_keyboard: [
          [{ text: tr('🥊 Jouer à ChickenFight','🥊 Play ChickenFight'), url: CHICKENFIGHT_URL }]
        ]}}
      )
      return new Response('ok')
    }

    if (btnIs(text, 'chickenreflex')) {
      await sendMessage(token, chatId,
        tr(`⚡ <b>CHICKEN REFLEX</b>\nTape le plus vite possible et bats le chrono — teste tes réflexes ! 🐔`,
           `⚡ <b>CHICKEN REFLEX</b>\nTap as fast as you can and beat the clock — test your reflexes! 🐔`),
        { reply_markup: { inline_keyboard: [
          [{ text: tr('⚡ Jouer à ChickenReflex','⚡ Play ChickenReflex'), url: CHICKENREFLEX_URL }]
        ]}}
      )
      return new Response('ok')
    }

    if (btnIs(text, 'chickenmemory')) {
      await sendMessage(token, chatId,
        tr(`🧠 <b>CHICKEN MEMORY</b>\nRetourne les cartes, retrouve les paires et bats ton meilleur temps ! 🐔`,
           `🧠 <b>CHICKEN MEMORY</b>\nFlip the cards, find every pair and beat your best time! 🐔`),
        { reply_markup: { inline_keyboard: [
          [{ text: tr('🧠 Jouer à Chicken Memory','🧠 Play Chicken Memory'), url: CHICKENMEMORY_URL }]
        ]}}
      )
      return new Response('ok')
    }

    if (btnIs(text, 'eggsponential')) {
      await sendMessage(token, chatId,
        tr(`📈 <b>EGGSPONENTIAL</b>\nGlisse et fusionne les œufs pour atteindre le plus gros — un 2048 façon Francis ! 🐔`,
           `📈 <b>EGGSPONENTIAL</b>\nSwipe and merge the eggs to reach the biggest one — a 2048, Francis style! 🐔`),
        { reply_markup: { inline_keyboard: [
          [{ text: tr('📈 Jouer à Eggsponential','📈 Play Eggsponential'), url: EGGSPONENTIAL_URL }]
        ]}}
      )
      return new Response('ok')
    }

    if (btnIs(text, 'chickenmine')) {
      await sendMessage(token, chatId,
        tr(`💣 <b>CHICKEN MINE</b>\nOuvre les cases, marque les renards 🦊 et vide le poulailler sans les réveiller ! 🐔`,
           `💣 <b>CHICKEN MINE</b>\nOpen the cells, flag the foxes 🦊 and clear the henhouse without waking them! 🐔`),
        { reply_markup: { inline_keyboard: [
          [{ text: tr('💣 Jouer à Chicken Mine','💣 Play Chicken Mine'), url: CHICKENMINE_URL }]
        ]}}
      )
      return new Response('ok')
    }

    if (btnIs(text, 'chickenblast')) {
      await sendMessage(token, chatId,
        tr(`💥 <b>CHICKEN BLAST</b>\nGlisse les blocs, remplis les lignes et fais tout exploser — sans chrono ni rotation ! 🐔`,
           `💥 <b>CHICKEN BLAST</b>\nSlide the blocks, fill the lines and blast them away — no timer, no rotation! 🐔`),
        { reply_markup: { inline_keyboard: [
          [{ text: tr('💥 Jouer à ChickenBlast','💥 Play ChickenBlast'), url: CHICKENBLAST_URL }]
        ]}}
      )
      return new Response('ok')
    }

    if (btnIs(text, 'chickenhang')) {
      await sendMessage(token, chatId,
        tr(`🪝 <b>CHICKEN HANG</b>\nDevine le mot lettre par lettre avant que Francis ne soit à court de corde ! 🐔`,
           `🪝 <b>CHICKEN HANG</b>\nGuess the word letter by letter before Francis runs out of rope! 🐔`),
        { reply_markup: { inline_keyboard: [
          [{ text: tr('🪝 Jouer à ChickenHang','🪝 Play ChickenHang'), url: CHICKENHANG_URL }]
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

    // The Chicken Coop = le groupe bilingue UNIQUE (le Poulailler a été supprimé).
    // On garde le handler 'poulailler' pour rattraper les anciens boutons en cache
    // et rediriger tout le monde vers The Chicken Coop.
    if (btnIs(text, 'coop') || btnIs(text, 'poulailler')) {
      await sendMessage(token, chatId,
        tr(`🐓 <b>The Chicken Coop 🇬🇧🇫🇷</b>\nLe groupe bilingue de la communauté $FRANC — tout le monde est le bienvenu !`,
           `🐓 <b>The Chicken Coop 🇬🇧🇫🇷</b>\nThe bilingual $FRANC community group — everyone's welcome!`),
        { reply_markup: { inline_keyboard: [
          [{ text: '🇬🇧 The Chicken Coop 🇫🇷', url: CHICKEN_COOP_URL }]
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

    // ── Receive wallet address (PRIVÉ UNIQUEMENT) ─────────────
    // IMPORTANT : ne JAMAIS déclencher le flux "coller une adresse" dans un
    // groupe. Sinon, si l'owner a un connect wallet en attente, chaque message
    // envoyé dans un groupe (ex. création d'un topic) déclenchait à tort la
    // réponse "Invalid Solana address".
    // On ne récupère le "connect wallet en attente" QUE si :
    //  • le message est en privé (jamais dans un groupe), ET
    //  • la demande a moins de 30 minutes.
    // Une demande abandonnée expire donc automatiquement : plus de
    // "Invalid Solana address" à répétition sur chaque message anodin.
    let pending: { telegram_id: string } | null = null
    if (msg.chat?.type === 'private') {
      const { data: pRow } = await supabase.from('pending_connects')
        .select('telegram_id, created_at').eq('telegram_id', userId).single()
      if (pRow) {
        const ageMs = Date.now() - new Date(pRow.created_at).getTime()
        if (ageMs > 30 * 60 * 1000) {
          // Demande périmée → on la supprime et on l'ignore.
          await supabase.from('pending_connects').delete().eq('telegram_id', userId)
        } else {
          pending = { telegram_id: pRow.telegram_id }
        }
      }
    }

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
      // Réponses individuelles en pause (/stopbot) ? → on ne répond pas.
      try {
        const { data: indivPause } = await supabase.from('bot_pause').select('paused').eq('chat_id', 0).single()
        if (indivPause?.paused) return new Response('ok')
      } catch (_) { /* pas de ligne → actif */ }
      // Utilisateur précis mis en pause (/stopbotuser) ?
      if (await isUserPaused(supabase, 'dm', msg.from.username)) return new Response('ok')
      const memKey = 'dm:' + chatId
      await saveChatMemory(supabase, memKey, 'user', rawText)   // contexte immédiat (batch + mémoire)
      // CA impératif : réponse déterministe (jamais générée par l'IA → zéro erreur d'adresse).
      const dmOldCa = mentionsOldTestCa(rawText)
      if (isCaRequest(rawText) || dmOldCa) {
        if (await claimReplySlot(supabase, memKey + ':ca', 30)) await sendCA(token, chatId, isFR, 0, dmOldCa)
      }
      // Verrou PARTAGÉ (DB) : une seule réponse par fenêtre, même si les messages
      // d'une salve arrivent sur plusieurs instances de la fonction.
      const dmClaimed = await claimReplySlot(supabase, memKey, 90)
      if (!dmClaimed) return new Response('ok')
      const bg = (async () => {
        try {
          await new Promise((r) => setTimeout(r, FRANCIS_REPLY_DELAY_MS))   // laisse arriver la salve
          const reply = await buildBatchedReply(supabase, memKey, 'dm', isFR ? 'fr' : 'en')
          if (!reply) { await releaseReplySlot(supabase, memKey); return }   // CA seul / rien à ajouter
          await sendMessage(token, chatId, reply)
          await saveChatMemory(supabase, memKey, 'model', reply)
          // 🔔 Notifie l'OWNER : quelqu'un a écrit en privé et Francis a répondu.
          // UNE SEULE notif par conversation et par JOUR (fuseau Paris) : au
          // début de l'échange. On "claim" un créneau daté (réutilise le verrou
          // existant chat_reply_lock, pas de nouvelle table). Repart à zéro
          // chaque jour → si la personne revient le lendemain, nouvelle notif.
          // (jamais pour les DM de l'owner lui-meme)
          if (userId !== OWNER_ID) {
            try {
              const parisDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
              const firstOfDay = await claimReplySlot(supabase, 'dmnotif:' + chatId + ':' + parisDay, 90000)  // ~25h
              if (firstOfDay) {
                const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                const f: any = msg.from || {}
                const fullName = esc([f.first_name, f.last_name].filter(Boolean).join(' ')) || 'Sans nom'
                const at = f.username ? ('@' + f.username) : '(pas de pseudo)'
                const notif =
                  `🔔 <b>Nouveau DM — Francis a répondu</b>\n\n` +
                  `👤 <a href="tg://user?id=${f.id}">${fullName}</a> ${esc(at)}\n` +
                  `🆔 <code>${f.id}</code>\n\n` +
                  `💬 <b>1er message :</b>\n${esc(rawText)}\n\n` +
                  `🤖 <b>Réponse :</b>\n${esc(reply)}`
                const extra: Record<string, any> = {}
                if (f.username) extra.reply_markup = { inline_keyboard: [[{ text: '💬 Ouvrir la conversation', url: 'https://t.me/' + f.username }]] }
                await sendMessage(token, Number(OWNER_ID), notif, extra)
              }
            } catch (e) { console.error('notifyOwnerDm:', String(e)) }
          }
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
