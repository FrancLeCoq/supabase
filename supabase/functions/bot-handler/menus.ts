// Module issu du decoupage de bot-handler (logique identique, code deplace).
export const FRANCRUN_URL   = 'https://t.me/FrancisLeCoqBot/FrancRun'

export const ORMUZ_URL      = 'https://t.me/FrancisLeCoqBot/Hormuz'

export const EGGCLICKER_URL = 'https://t.me/FrancisLeCoqBot/EggClicker'

export const TAMAGOTCHI_URL = 'https://t.me/FrancisLeCoqBot/Tamagotchi'

export const SNAKE_URL      = 'https://t.me/FrancisLeCoqBot/ChickenSnake'   // ChickenSnake

export const WORDSEARCH_URL = 'https://t.me/FrancisLeCoqBot/MotsMeles'

export const SOLITAIRE_URL  = 'https://t.me/FrancisLeCoqBot/ChickenSolitaire'  // ChickenSolitaire (Klondike)

export const CHICKENFIGHT_URL  = 'https://t.me/FrancisLeCoqBot/ChickenFight'
export const CHICKENREFLEX_URL = 'https://t.me/FrancisLeCoqBot/ChickenReflex'
export const CHICKENBLAST_URL  = 'https://t.me/FrancisLeCoqBot/ChickenBlast'
export const CHICKENHANG_URL   = 'https://t.me/FrancisLeCoqBot/ChickenHang'
export const CHICKENMEMORY_URL = 'https://t.me/FrancisLeCoqBot/ChickenMemory'
export const EGGSPONENTIAL_URL = 'https://t.me/FrancisLeCoqBot/Eggsponential'
export const CHICKENMINE_URL   = 'https://t.me/FrancisLeCoqBot/ChickenMine'

export const SUDOKU_URL     = 'https://t.me/FrancisLeCoqBot/Sudoku'

export const MASTERMIND_URL = 'https://t.me/FrancisLeCoqBot/Mastermind'

export const MOTUS_URL      = 'https://t.me/FrancisLeCoqBot/motus'

export const WALLET_URL     = 'https://t.me/FrancisLeCoqBot/wallet'

export const BOT_DM_URL     = 'https://t.me/FrancisLeCoqBot'                 // ouvrir le chat privé du bot

export const CASHBACK_DEEPLINK = 'https://t.me/FrancisLeCoqBot?start=cashback' // ouvre le bot et lance l'offre Stars

export const MENU_DEEPLINK     = 'https://t.me/FrancisLeCoqBot?start=menu'     // ouvre le bot ET rafraîchit le menu (/start)

export const RULES_DEEPLINK    = 'https://t.me/FrancisLeCoqBot?start=rules'    // ouvre le bot ET le menu des règles

export const BUY_FRANC_SOL_URL = 'https://pump.fun/coin/AacckLUizxHFpSGdcN9ppEfv2UCbdqZspEhHeR8Gpump'

export const BUY_FRANC_TON_URL = 'https://t.me/blum/app?startapp=memepadjetton_FRANC_Frudn-ref_E0h3KDx1jH'

export const CHICKEN_COOP_URL = 'https://t.me/LeCoqFrancis'   // groupe international (anglophone)

export const POULAILLER_URL   = 'https://t.me/FrancisLeCoq'   // groupe francophone « Le Poulailler »

// ══════════════════════════════════════════════════════════════
//  GAMES — source unique de vérité pour les jeux.
//  Utilisé par : le menu "Rules" du bot (boutons + règles).
//  Ordre = ordre d'affichage dans le menu Rules.
//  Chaque jeu : key, label (bouton), playLabel, url, rules (HTML).
// ══════════════════════════════════════════════════════════════

export const GAMES: Array<{
  key: string; label: string; playLabel: string; url: string; rules: string
}> = [
  {
    key: 'tamagotchi',
    label: '🐓 Tamagotchi',
    playLabel: '🎮 Play Tamagotchi',
    url: TAMAGOTCHI_URL,
    rules:
      `🐓 <b>TAMAGOTCHI — Francis Le Coq</b>\n\n` +
      `Raise Francis, a French rooster with his blue beret and 1-Franc coin. Feed him, play with him, keep him healthy and watch him evolve!\n\n` +
      `📋 <b>Rules:</b>\n` +
      `🐣 <b>5 evolution stages</b> — Chick → Little Rooster → Teen → Adult → Old\n` +
      `💛 <b>7 live stats</b> to balance: Hunger, Happiness, Energy, Health, Hygiene, Love, Play\n` +
      `🍗 Feed, play, sleep, cuddle, heal, clean...\n` +
      `🦊 Survive random events: Fox attack, Storm, Covid-19, Chantal's visit...\n` +
      `🏚️ Upgrade your farm: Henhouse → Castle → SpaceX 🚀\n` +
      `🌙 Day/night cycle, weather, mini-games & daily quests\n\n` +
      `💎 <b>Trial vs $FRANC Holder:</b>\n` +
      `⏱️ <b>Free</b> — Play until the end of the Chick stage\n` +
      `♾️ <b>$FRANC Holders</b> — All 5 stages unlocked + exclusive surprises!\n\n` +
      `<i>Don't hold $FRANC yet? Connect your wallet and get yours!</i>`
  },
  {
    key: 'francrun',
    label: '🔫 FrancRun',
    playLabel: '🎮 Play FrancRun',
    url: FRANCRUN_URL,
    rules:
      `🐓 <b>FRANC RUN</b>\n\n` +
      `Collect golden eggs and dodge enemies across 11 levels!\n\n` +
      `📋 <b>Rules:</b>\n` +
      `🥚 30 eggs = +1 level\n` +
      `🔫 Weapons unlock at level 4\n` +
      `💀 Level 11 = Sudden Death — fight to the end!\n\n` +
      `💎 <b>$FRANC Holder bonuses:</b>\n` +
      `❤️ 10 lives to start (instead of 1)\n` +
      `🔫 Triple shot — auto-targets multiple enemies\n` +
      `<i>Don't hold $FRANC yet? Connect your wallet and get yours!</i>`
  },
  {
    key: 'ormuz',
    label: '⛵ Ormuz',
    playLabel: '⛵ Play Ormuz',
    url: ORMUZ_URL,
    rules:
      `⛵ <b>ORMUZ</b>\n\n` +
      `Will you make it through the <b>Strait of Hormuz</b>? 🌊\n` +
      `Tons of enemies and obstacles all along the journey!\n\n` +
      `📋 <b>Rules:</b>\n` +
      `🐥 Collect chicks — 1 to 4 points each depending on size\n` +
      `🆙 30 points = +1 level\n` +
      `🎯 11 levels — Level 11 is <b>Sudden Death</b> — fight to the end!\n\n` +
      `💎 <b>$FRANC Holder bonuses:</b>\n` +
      `❤️ 10 lives to start (instead of 1)\n` +
      `🔫 Pistol unlocks at level 4\n` +
      `🔥 Machine gun unlocks at level 6\n\n` +
      `<i>Don't hold $FRANC yet? Connect your wallet and get yours!</i>`
  },
  {
    key: 'eggclicker',
    label: '🥚 EggClicker',
    playLabel: '🥚 Play EggClicker',
    url: EGGCLICKER_URL,
    rules:
      `🥚 <b>EGG CLICKER</b>\n\n` +
      `Produce your eggs, buy buildings and grow a farm the size of an empire! 🏰\n\n` +
      `📋 <b>Rules:</b>\n` +
      `🖱️ Tap Francis to collect eggs manually\n` +
      `🏚️ Buy <b>10 producers</b> — from the Curious Chick to the Rooster Paradox — for automatic egg production\n` +
      `⚡ Unlock <b>17 upgrades</b> to multiply your output\n` +
      `🏆 Earn <b>15 trophies</b> — each one gives +1% global bonus\n` +
      `🪶 <b>Prestige</b> at 1B eggs to earn Golden Feathers (+2% permanent each)\n` +
      `🌧️ Live day/night cycle, weather events… and watch out for fox attacks!\n\n` +
      `💎 <b>Trial vs Holder:</b>\n` +
      `⏱️ <b>Free trial</b> — 10 minutes of play\n` +
      `♾️ <b>$FRANC Holders</b> — unlimited time + cloud save + bonuses & surprises!\n\n` +
      `<i>Don't hold $FRANC yet? Connect your wallet and get yours!</i>`
  },
  {
    key: 'sudoku',
    label: '🧩 Sudoku',
    playLabel: '🧩 Play Sudoku',
    url: SUDOKU_URL,
    rules:
      `🧩 <b>SUDOKU — Le Coq Francis</b>\n\n` +
      `Solve grids, climb the ranks and earn virtual $FRANC with Francis the rooster! 🐓\n\n` +
      `📋 <b>Rules:</b>\n` +
      `🔢 Fill the 9×9 grid — each row, column and 3×3 box holds 1 to 9\n` +
      `🎯 <b>5 difficulties</b>: Very Easy → Very Hard\n` +
      `🎮 <b>Single Grid</b> — fill the grid, hit Validate, win or lose\n` +
      `🏆 <b>Competition</b> — climb the ladder with 3 lives & earn virtual $FRANC\n` +
      `💡 Hints & helpers available (at a $FRANC cost in Competition)\n\n` +
      `💎 <b>Trial vs $FRANC Holder:</b>\n` +
      `⏱️ <b>Free</b> — Single Grid, Very Easy & Easy only\n` +
      `♾️ <b>$FRANC Holders</b> — All 5 difficulties + Competition mode + virtual $FRANC economy\n\n` +
      `<i>Don't hold $FRANC yet? Connect your wallet and get yours!</i>`
  },
  {
    key: 'mastermind',
    label: '🎯 Mastermind',
    playLabel: '🎯 Play Mastermind',
    url: MASTERMIND_URL,
    rules:
      `🎯 <b>MASTERMIND — Le Coq Francis</b>\n\n` +
      `Crack the secret color code Francis picked — before you run out of tries! 🐓\n\n` +
      `📋 <b>Rules:</b>\n` +
      `🟢 <b>Green</b> — right color, right spot\n` +
      `🟠 <b>Orange</b> — right color, wrong spot\n` +
      `🎯 <b>5 difficulties</b>: Very Easy → Very Hard\n` +
      `🎮 <b>Free Play</b> — pick your difficulty, no pressure\n` +
      `🏆 <b>Competition</b> — chain levels with 3 lives, earn virtual $FRANC & climb the TOP 3\n` +
      `💡 Hints available (at a $FRANC cost in Competition)\n\n` +
      `💎 <b>Trial vs $FRANC Holder:</b>\n` +
      `⏱️ <b>Free</b> — Free Play, first 2 difficulties only\n` +
      `♾️ <b>$FRANC Holders</b> — All 5 difficulties + Competition mode + virtual $FRANC economy\n\n` +
      `<i>Don't hold $FRANC yet? Connect your wallet and get yours!</i>`
  },
  {
    key: 'motus',
    label: '🟢 Motus',
    playLabel: '🟢 Play Motus',
    url: MOTUS_URL,
    rules:
      `🟢 <b>MOTUS — Le Coq Francis</b>\n\n` +
      `Guess the word Francis is hiding — letter by letter! 🐓\n\n` +
      `📋 <b>Rules:</b>\n` +
      `🟢 <b>Green</b> — right letter, right spot\n` +
      `🟠 <b>Orange</b> — right letter, wrong spot\n` +
      `🎯 <b>3 difficulties</b>: Easy (4 letters), Medium (5), Hard (6)\n` +
      `🎮 <b>Free Play</b> — practice at your own pace\n` +
      `🏆 <b>Competition</b> — chain words with 3 lives, earn virtual $FRANC & climb the TOP 3\n` +
      `💡 Hints available (at a $FRANC cost in Competition)\n\n` +
      `💎 <b>Trial vs $FRANC Holder:</b>\n` +
      `⏱️ <b>Free</b> — Easy mode (4 letters), unlimited\n` +
      `♾️ <b>$FRANC Holders</b> — Medium & Hard + Competition mode + virtual $FRANC economy\n\n` +
      `<i>Don't hold $FRANC yet? Connect your wallet and get yours!</i>`
  },
  {
    key: 'wordsearch',
    label: '🔍 Words searches',
    playLabel: '🔍 Play Words searches',
    url: WORDSEARCH_URL,
    rules:
      `🔍 <b>WORD SEARCHES — Le Coq Francis</b>\n\n` +
      `Spot. Circle. Score. — find every word Francis hid in the grid! 🐓\n\n` +
      `📋 <b>Rules:</b>\n` +
      `🔤 Swipe across the hidden words — horizontal, vertical, diagonal & reversed\n` +
      `🎯 <b>5 difficulties</b>: Very Easy → Very Hard (bigger grids, more words, trickier paths)\n` +
      `🎮 <b>Single Grid</b> — pick a difficulty and clear the grid\n` +
      `🏆 <b>Competition</b> — chain grids with lives, earn virtual $FRANC & climb the TOP 3\n` +
      `💡 Hints & first-letter Reveal available (at a $FRANC cost in Competition)\n\n` +
      `💎 <b>Trial vs $FRANC Holder:</b>\n` +
      `⏱️ <b>Free</b> — Very Easy & Easy grids\n` +
      `♾️ <b>$FRANC Holders</b> — Medium, Hard & Very Hard + Competition mode + virtual $FRANC economy\n\n` +
      `<i>Don't hold $FRANC yet? Connect your wallet and get yours!</i>`
  },
  {
    key: 'chickensolitaire',
    label: '🃏 ChickenSolitaire',
    playLabel: '🃏 Play ChickenSolitaire',
    url: SOLITAIRE_URL,
    rules:
      `🃏 <b>CHICKEN SOLITAIRE — Le Coq Francis</b>\n\n` +
      `Classic Klondike solitaire in Francis' universe — flip, stack and clear all four foundations! 🐓\n\n` +
      `📋 <b>Rules:</b>\n` +
      `♠️ Build the <b>4 foundations</b> up by suit, from Ace to King\n` +
      `🎨 Stack the tableau <b>down in alternating colours</b> — only Kings go on empty columns\n` +
      `👆 <b>Tap</b> a card to select, tap where to move it — <b>double-tap</b> to auto-send to a foundation\n` +
      `🔄 Tap the stock to draw / recycle\n` +
      `🎆 Fill all four foundations → festive win screen with Francis!\n\n` +
      `💎 <b>Trial vs $FRANC Holder:</b>\n` +
      `⏱️ <b>Free</b> — Draw 1 card mode\n` +
      `♾️ <b>$FRANC Holders</b> — Draw 3 cards mode + 3 hints per game + best score & time\n\n` +
      `<i>Don't hold $FRANC yet? Connect your wallet and get yours!</i>`
  },
  {
    key: 'chickenfight',
    label: '🥊 Chicken Fight',
    playLabel: '🥊 Play Chicken Fight',
    url: CHICKENFIGHT_URL,
    rules:
      `🥊 <b>CHICKEN FIGHT — Le Coq Francis</b>\n\n` +
      `Peck. Dodge. Knock out. — step into Francis' arena! 🐓\n\n` +
      `📋 <b>Rules:</b>\n` +
      `🥊 Each turn both roosters pick an action — they resolve <b>at the same time</b>: peck, guard, Cocorico, slashing wing, dodge, feint & special attack\n` +
      `❤️ Read your rival, counter their move and empty their health bar before yours\n` +
      `🕹️ <b>Real-Time Arena (beta)</b>: move with the D-pad, jump ⬆️, guard ⬇️, strike — beak (J), leg (L), wing (K), egg projectile (space)\n` +
      `🐓 <b>My Rooster</b> — level up with XP, feathers, stats & trophies\n\n` +
      `🎮 <b>Modes:</b>\n` +
      `🥊 <b>Training</b> — everyone, face the Valet\n` +
      `🏆 <b>Ranked Arena</b> — climb a local rating vs evolving AI\n` +
      `👥 <b>Local Duel</b> — 2 players on one device, hidden picks\n\n` +
      `💎 <b>Trial vs $FRANC Holder:</b>\n` +
      `⏱️ <b>Free</b> — Training, Ranked Arena & Local Duel\n` +
      `♾️ <b>$FRANC Holders</b> — Royal Campaign (Valet ▸ Queen ▸ King) + advanced techniques\n\n` +
      `<i>Don't hold $FRANC yet? Connect your wallet and get yours!</i>`
  },
  {
    key: 'chickenreflex',
    label: '⚡ Chicken Reflex',
    playLabel: '⚡ Play Chicken Reflex',
    url: CHICKENREFLEX_URL,
    rules:
      `⚡ <b>CHICKEN REFLEX — Le Coq Francis</b>\n\n` +
      `Tap fast. Beat the clock. — a 30-second reflex rush! 🐓\n\n` +
      `📋 <b>Rules:</b>\n` +
      `👆 A target flashes in the center — tap it as fast as you can… but NEVER tap the 🦊 fox!\n` +
      `🥚 <b>Points:</b> farm loot (egg/corn/worm/coin) +1 · Francis +2 · Jack +3 · Queen +4 · King +5\n` +
      `⚠️ <b>Penalties:</b> a fox or trapped egg −2 · empty tap −1 · tap under 90 ms −1\n` +
      `⏱️ The pace speeds up over the 30s — the last 6 seconds double the foxes!\n\n` +
      `🎮 <b>Difficulty:</b>\n` +
      `🟢 <b>Easy</b> — everyone\n` +
      `🟠 <b>Medium</b> — $FRANC holders (faster, more foxes)\n` +
      `🔴 <b>Hard</b> — $FRANC holders (fastest + traps)\n\n` +
      `🏆 <b>Daily leaderboard</b> — best reaction time, resets at midnight (Paris).\n\n` +
      `💎 <b>Trial vs $FRANC Holder:</b>\n` +
      `⏱️ <b>Free</b> — Easy mode\n` +
      `♾️ <b>$FRANC Holders</b> — Medium & Hard (via wallet or ⭐ Stars)\n\n` +
      `<i>Don't hold $FRANC yet? Connect your wallet and get yours!</i>`
  },
  {
    key: 'chickenmemory',
    label: '🧠 Chicken Memory',
    playLabel: '🧠 Play Chicken Memory',
    url: CHICKENMEMORY_URL,
    rules:
      `🧠 <b>CHICKEN MEMORY — Le Coq Francis</b>\n\n` +
      `Flip. Match. Remember. — find every pair in Francis' henhouse! 🐓\n\n` +
      `📋 <b>Rules:</b>\n` +
      `👆 Tap a card to flip it, then a second — a match stays face-up, a miss flips back\n` +
      `🏆 <b>Score:</b> +100 per pair, combo up to ×5 (+20 each), −8 per miss + speed & flawless bonuses\n` +
      `💡 3 hints per game (reveal a pair) — $FRANC holders / ⭐ only\n` +
      `🎯 Each mode keeps its own best score & time\n\n` +
      `📊 <b>Difficulty:</b>\n` +
      `🟢 Facile 6 pairs · 🟡 Normal 10 pairs — everyone\n` +
      `🔴 Expert 15 pairs — $FRANC holders / ⭐\n\n` +
      `💎 <b>Trial vs $FRANC Holder:</b>\n` +
      `⏱️ <b>Free</b> — Facile & Normal\n` +
      `♾️ <b>$FRANC Holders</b> — Expert + 3 hints per game\n\n` +
      `<i>Don't hold $FRANC yet? Connect your wallet and get yours!</i>`
  },
  {
    key: 'eggsponential',
    label: '📈 Eggsponential',
    playLabel: '📈 Play Eggsponential',
    url: EGGSPONENTIAL_URL,
    rules:
      `📈 <b>EGGSPONENTIAL — Le Coq Francis</b>\n\n` +
      `Swipe. Merge. Grow. — a 2048 with eggs, chase the biggest one! 🐓\n\n` +
      `📋 <b>Rules:</b>\n` +
      `👆 Swipe ⬆️⬇️⬅️➡️ — all eggs slide, and two identical ones merge into the next tier\n` +
      `🥚 A new egg appears after every move — it's over when the 4×4 grid is stuck\n` +
      `🏆 Score from every merge; chain merges in one move for a multiplier bonus\n` +
      `🎯 Reach the target egg to clear a level and climb the difficulty\n\n` +
      `💎 <b>Trial vs $FRANC Holder:</b>\n` +
      `⏱️ <b>Free</b> — classic play\n` +
      `♾️ <b>$FRANC Holders</b> — bonus power-ups & premium features\n\n` +
      `<i>Don't hold $FRANC yet? Connect your wallet and get yours!</i>`
  },
  {
    key: 'chickenmine',
    label: '💣 Chicken Mine',
    playLabel: '💣 Play Chicken Mine',
    url: CHICKENMINE_URL,
    rules:
      `💣 <b>CHICKEN MINE — Le Coq Francis</b>\n\n` +
      `Open. Flag. Don't wake the foxes! — Francis' minesweeper 🦊🐓\n\n` +
      `📋 <b>Rules:</b>\n` +
      `👆 Tap a cell to open it — numbers show how many 🦊 foxes hide around it\n` +
      `🚩 Long-press (or Flag Mode) to flag a fox; tap a number with all its foxes flagged to auto-open the rest\n` +
      `✅ The first cell is always safe — flag every fox and open all safe cells to win\n` +
      `🏆 <b>Score:</b> foxes × 20 + speed bonus (up to ×2 under ~8s per fox)\n` +
      `⭐ Power-ups unlock by total score: Flair (300), Beacon (700), Shield (1200) — once per game\n\n` +
      `📊 <b>Difficulty:</b>\n` +
      `🗺️ 12 levels across 5 worlds — from 8×8 (8 foxes) to 12×16 (46 foxes)\n\n` +
      `💎 <b>Trial vs $FRANC Holder:</b>\n` +
      `⏱️ <b>Free</b> — Level 1\n` +
      `♾️ <b>$FRANC Holders</b> — Levels 2 → 12\n\n` +
      `<i>Don't hold $FRANC yet? Connect your wallet and get yours!</i>`
  },
  {
    key: 'chickenblast',
    label: '💥 Chicken Blast',
    playLabel: '💥 Play Chicken Blast',
    url: CHICKENBLAST_URL,
    rules:
      `💥 <b>CHICKEN BLAST — Le Coq Francis</b>\n\n` +
      `Slide. Fill. Blast. — a chill block-puzzle, no timer, no rotation! 🐓\n\n` +
      `📋 <b>Rules:</b>\n` +
      `🧩 <b>Drag</b> the blocks onto the grid — fill a full row or column and it clears\n` +
      `🚫 No rotation, no time pressure — it's over when no piece fits anymore\n` +
      `🏆 <b>Score:</b> 1 pt per placed cell + line clears (10 × lines² × combo, combo up to ×5)\n` +
      `✨ Clear rows <b>and</b> columns at once for the biggest rewards\n\n` +
      `🎮 <b>Modes:</b>\n` +
      `🎯 <b>Free Play</b> — pick a tier, chase your high score\n` +
      `🗺️ <b>Adventure</b> (holders) — chained levels, 3 lives, line goals, virtual $FRANC & TOP-3\n\n` +
      `📊 <b>Difficulty:</b>\n` +
      `🟢 Easy 8×8 · 🟡 Normal 8×8 (Tetrominos) — everyone\n` +
      `🟠 Hard 8×8 · 🔴 Expert 9×9 — $FRANC holders\n\n` +
      `💎 <b>Trial vs $FRANC Holder:</b>\n` +
      `⏱️ <b>Free</b> — Easy & Normal\n` +
      `♾️ <b>$FRANC Holders</b> — Hard, Expert + Adventure mode & virtual $FRANC economy\n\n` +
      `<i>Don't hold $FRANC yet? Connect your wallet and get yours!</i>`
  },
  {
    key: 'chickenhang',
    label: '🪝 Chicken Hang',
    playLabel: '🪝 Play Chicken Hang',
    url: CHICKENHANG_URL,
    rules:
      `🪝 <b>CHICKEN HANG — Le Coq Francis</b>\n\n` +
      `Guess the word before Francis runs out of rope! 🐓\n\n` +
      `📋 <b>Rules:</b>\n` +
      `🔤 Pick letters to reveal the hidden word, one guess at a time\n` +
      `❤️ Each wrong letter costs a life — crack the word before they run out\n` +
      `🗂️ Themed word packs to keep it fresh, with hints when you're stuck\n` +
      `🏆 Chain wins and climb the leaderboard\n\n` +
      `💎 <b>Trial vs $FRANC Holder:</b>\n` +
      `⏱️ <b>Free</b> — starter word packs\n` +
      `♾️ <b>$FRANC Holders</b> — all packs + harder words + competition mode & virtual $FRANC\n\n` +
      `<i>Don't hold $FRANC yet? Connect your wallet and get yours!</i>`
  }
]


export function gameByKey(key: string) {
  return GAMES.find(g => g.key === key)
}

// Clavier de l'écran "liste des jeux" (menu Rules) : 1 bouton par jeu.

export function buildRulesMenuKeyboard() {
  const rows = GAMES.map(g => ([{ text: g.label, callback_data: `rules_game_${g.key}` }]))
  return { inline_keyboard: rows }
}

// Clavier de l'écran "règles d'un jeu" : Play + Retour aux règles.

export function buildGameRulesKeyboard(game: { playLabel: string; url: string }) {
  return { inline_keyboard: [
    [{ text: game.playLabel, url: game.url }],
    [{ text: '⬅ Back to rules', callback_data: 'rules_menu' }]
  ]}
}


export const RULES_MENU_TEXT =
  `🎉 <b>Welcome to Francis' Games Universe</b>\n\n` +
  `🐓 <b>Tamagotchi</b> — Keep Francis alive\n` +
  `🔫 <b>FrancRun</b> — Run. Dodge. Score.\n` +
  `⛵ <b>Ormuz</b> — Survive the crossing\n` +
  `🥚 <b>EggClicker</b> — Grow your empire\n` +
  `🧩 <b>Sudoku</b> — Solve. Compete. Earn.\n` +
  `🎯 <b>Mastermind</b> — Crack the code\n` +
  `🟢 <b>Motus</b> — Guess the hidden word\n` +
  `🔍 <b>Words searches</b> — Spot. Circle. Score.\n` +
  `🃏 <b>ChickenSolitaire</b> — Flip. Stack. Win.\n\n` +
  `<i>Tap a game to see its full rules — then play! 🐓</i>`

// ── Libellés de boutons bilingues ─────────────────────────────
// Chaque bouton garde le même emoji dans les 2 langues (ancre stable).
// Les handlers reconnaissent FR ET EN via btnIs().

export const BTN = {
  coop:      { fr: '🇬🇧 The Chicken Coop 🇫🇷',  en: '🇬🇧 The Chicken Coop 🇫🇷' },  // groupe bilingue (unique)
  poulailler:{ fr: '🐓 Le Poulailler 🇫🇷',      en: '🐓 Le Poulailler 🇫🇷' },      // ⚠️ supprimé — gardé pour reconnaître les anciens clics en cache
  tamagotchi:{ fr: '🐓 Tamagotchi',           en: '🐓 Tamagotchi' },
  mastermind:{ fr: '🎯 Mastermind',           en: '🎯 Mastermind' },
  eggclicker:{ fr: '🥚 EggClicker',           en: '🥚 EggClicker' },
  sudoku:    { fr: '🧩 Sudoku',               en: '🧩 Sudoku' },
  francrun:  { fr: '🔫 FrancRun',             en: '🔫 FrancRun' },
  ormuz:     { fr: '⛵ Ormuz',                en: '⛵ Ormuz' },
  motus:     { fr: '🟢 Motus',               en: '🟢 Motus' },
  wallet:    { fr: '🔗 Wallet',              en: '🔗 Wallet' },
  cashback:  { fr: '🔓 Cashback⭐',       en: '🔓 Cashback⭐' },
  francSol:  { fr: '💰 $FRANC sur SOL',       en: '💰 $FRANC on SOL' },
  francTon:  { fr: '💰 $FRANC sur TON',       en: '💰 $FRANC on TON' },
  langFr:    { fr: '🇫🇷 Français',             en: '🇫🇷 Français' },
  langEn:    { fr: '🇬🇧 English',              en: '🇬🇧 English' },
  snake:     { fr: '🐍 ChickenSnake',          en: '🐍 ChickenSnake' },
  wordsearch:{ fr: '🔍 Words searches',        en: '🔍 Words searches' },
  chickensolitaire:{ fr: '🃏 ChickenSolitaire', en: '🃏 ChickenSolitaire' },
  chickenfight:{ fr: '🥊 Chicken Fight', en: '🥊 Chicken Fight' },
  chickenreflex:{ fr: '⚡ Chicken Reflex', en: '⚡ Chicken Reflex' },
  chickenmemory:{ fr: '🧠 Chicken Memory', en: '🧠 Chicken Memory' },
  eggsponential:{ fr: '📈 Eggsponential', en: '📈 Eggsponential' },
  chickenmine:{ fr: '💣 Chicken Mine', en: '💣 Chicken Mine' },
  chickenhang:{ fr: '🪝 Chicken Hang', en: '🪝 Chicken Hang' },
  chickenblast:{ fr: '💥 Chicken Blast', en: '💥 Chicken Blast' },
  holders:   { fr: '🔞 Spicy (18+)',  en: '🔞 Spicy (18+)' },
  refresh:   { fr: '🔄 Rafraîchir le menu',    en: '🔄 Refresh menu' },
  rules:     { fr: '📜 Règles des jeux',       en: '📜 Game Rules' },
} as const

// Vrai si `text` (déjà en minuscules) correspond au bouton `key` en FR ou EN.

export function btnIs(text: string, key: keyof typeof BTN): boolean {
  const b = BTN[key]
  return text === b.fr.toLowerCase() || text === b.en.toLowerCase()
}

// Vrai si le message est le libellé d'un bouton du clavier persistant.
// Sert à laisser ces messages FILER vers leurs handlers (jeux, liens…)
// au lieu d'être avalés par le bloc « groupe » (IA Francis).

export function isKeyboardButton(text: string): boolean {
  return (Object.keys(BTN) as (keyof typeof BTN)[]).some(k => btnIs(text, k))
}

// Construit le clavier persistant dans la langue voulue.

export function buildKeyboard(isFR: boolean) {
  const L = (k: keyof typeof BTN) => ({ text: isFR ? BTN[k].fr : BTN[k].en })
  return {
    keyboard: [
      [L('coop')],
      [L('tamagotchi'), L('snake')],
      [L('motus'),      L('mastermind')],
      [L('eggclicker'), L('sudoku')],
      [L('francrun'),   L('ormuz')],
      [L('wordsearch'), L('chickensolitaire')],
      [L('chickenfight'), L('chickenreflex')],
      [L('chickenmemory'), L('eggsponential')],
      [L('chickenmine'), L('chickenhang')],
      [L('chickenblast')],
      [L('refresh'),    L('rules')],
      [L('holders')],
      [L('francTon'),   L('francSol')],
      [L('cashback'),   L('wallet')],
      [L('langFr'),     L('langEn')],
    ],
    resize_keyboard: true,
    is_persistent: true,
  }
}

// Menu INLINE qui reproduit EXACTEMENT la disposition du clavier persistant
// (buildKeyboard). Utilisé dans le message /start & "Refresh menu".

export function buildInlineMenu(isFR: boolean) {
  const L = (k: keyof typeof BTN) => (isFR ? BTN[k].fr : BTN[k].en)
  return { inline_keyboard: [
    [{ text: L('coop'), url: CHICKEN_COOP_URL }],
    [{ text: L('tamagotchi'), url: TAMAGOTCHI_URL }, { text: L('snake'), url: SNAKE_URL }],
    [{ text: L('motus'), url: MOTUS_URL }, { text: L('mastermind'), url: MASTERMIND_URL }],
    [{ text: L('eggclicker'), url: EGGCLICKER_URL }, { text: L('sudoku'), url: SUDOKU_URL }],
    [{ text: L('francrun'), url: FRANCRUN_URL }, { text: L('ormuz'), url: ORMUZ_URL }],
    [{ text: L('wordsearch'), url: WORDSEARCH_URL }, { text: L('chickensolitaire'), url: SOLITAIRE_URL }],
    [{ text: L('chickenfight'), url: CHICKENFIGHT_URL }, { text: L('chickenreflex'), url: CHICKENREFLEX_URL }],
    [{ text: L('chickenmemory'), url: CHICKENMEMORY_URL }, { text: L('eggsponential'), url: EGGSPONENTIAL_URL }],
    [{ text: L('chickenmine'), url: CHICKENMINE_URL }, { text: L('chickenhang'), url: CHICKENHANG_URL }],
    [{ text: L('chickenblast'), url: CHICKENBLAST_URL }],
    [{ text: L('refresh'), callback_data: 'start' }, { text: L('rules'), callback_data: 'rules_menu' }],
    [{ text: L('holders'), callback_data: 'holders' }],
    [{ text: L('francTon'), url: BUY_FRANC_TON_URL }, { text: L('francSol'), url: BUY_FRANC_SOL_URL }],
    [{ text: L('cashback'), callback_data: 'cashback' }, { text: L('wallet'), url: WALLET_URL }],
    [{ text: L('langFr'), callback_data: 'lang_fr' }, { text: L('langEn'), callback_data: 'lang_en' }],
  ]}
}
