// ================================================================
//  standings-image.ts — Rendu PNG des classements F1 / MotoGP.
//
//  Le texte habituel reste envoyé tel quel (avec toggle FR/EN). En
//  COMPLÉMENT, on génère une image du classement : n° de position,
//  nom du pilote, badge aux COULEURS de l'écurie (pas de logo = pas
//  de marque déposée) et points.
//
//  Chaîne : on parse le texte EN déjà mis en forme -> SVG -> PNG via
//  @resvg/resvg-wasm (WASM, chargé une fois par isolate). Tout est
//  best-effort : la moindre erreur renvoie null et l'appelant ignore
//  simplement l'image (le texte, lui, est déjà publié).
// ================================================================
import { Resvg, initWasm } from 'https://esm.sh/@resvg/resvg-wasm@2.6.2'

const NL = String.fromCharCode(10)

// ── Init WASM (une seule fois, mémoïsé) ───────────────────────
let wasmReady: Promise<boolean> | null = null
function ensureWasm(): Promise<boolean> {
  if (!wasmReady) {
    wasmReady = (async () => {
      try {
        const res = await fetch('https://esm.sh/@resvg/resvg-wasm@2.6.2/index_bg.wasm')
        if (!res.ok) { console.error('resvg wasm HTTP', res.status); return false }
        await initWasm(res)
        return true
      } catch (e) { console.error('resvg initWasm', String(e)); return false }
    })()
  }
  return wasmReady
}

// ── Police (TTF statique, une seule fois, mémoïsé) ─────────────
// Plusieurs sources candidates : on garde la première qui répond.
const FONT_URLS = [
  'https://cdn.jsdelivr.net/gh/google/fonts@main/apache/roboto/static/Roboto-Regular.ttf',
  'https://cdn.jsdelivr.net/npm/@fontsource/roboto@5.0.8/files/roboto-latin-400-normal.ttf',
  'https://cdn.jsdelivr.net/gh/googlefonts/roboto-2@main/src/hinted/Roboto-Regular.ttf',
  'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf',
]
// Fonte grasse (indispensable : resvg ne synthétise PAS le gras, il faut la face).
const BOLD_URLS = [
  'https://cdn.jsdelivr.net/gh/google/fonts@main/apache/roboto/static/Roboto-Bold.ttf',
  'https://cdn.jsdelivr.net/npm/@fontsource/roboto@5.0.8/files/roboto-latin-700-normal.ttf',
  'https://cdn.jsdelivr.net/gh/googlefonts/roboto-2@main/src/hinted/Roboto-Bold.ttf',
  'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf',
]
async function loadFirst(urls: string[]): Promise<Uint8Array | null> {
  for (const url of urls) {
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      const buf = new Uint8Array(await res.arrayBuffer())
      if (buf.length > 20000) return buf   // garde-fou : vraie police
    } catch (_) { /* essaie la suivante */ }
  }
  return null
}
let fontsReady: Promise<Uint8Array[] | null> | null = null
// Renvoie [regular, bold] (bold optionnel). null si même la regular manque.
function ensureFonts(): Promise<Uint8Array[] | null> {
  if (!fontsReady) {
    fontsReady = (async () => {
      const [reg, bold] = await Promise.all([loadFirst(FONT_URLS), loadFirst(BOLD_URLS)])
      if (!reg) { console.error('resvg: police regular introuvable'); return null }
      return bold ? [reg, bold] : [reg]
    })()
  }
  return fontsReady
}

// ── Couleurs d'écuries (badge = couleur officielle) ───────────
type TeamStyle = { bg: string; fg: string; short: string }
const FALLBACK: TeamStyle = { bg: '#6B7280', fg: '#FFFFFF', short: '' }
// Ordre important : le 1er mot-clé contenu dans le nom gagne.
const F1_TEAMS: Array<[string, TeamStyle]> = [
  ['ferrari', { bg: '#E8002D', fg: '#FFFFFF', short: 'Ferrari' }],
  ['mclaren', { bg: '#FF8000', fg: '#111111', short: 'McLaren' }],
  ['mercedes', { bg: '#27F4D2', fg: '#0A2A24', short: 'Mercedes' }],
  ['aston', { bg: '#229971', fg: '#FFFFFF', short: 'Aston M.' }],
  ['alpine', { bg: '#0093CC', fg: '#FFFFFF', short: 'Alpine' }],
  ['williams', { bg: '#64C4FF', fg: '#0A2233', short: 'Williams' }],
  ['haas', { bg: '#B6BABD', fg: '#111111', short: 'Haas' }],
  ['kick', { bg: '#52E252', fg: '#08260F', short: 'Sauber' }],
  ['sauber', { bg: '#52E252', fg: '#08260F', short: 'Sauber' }],
  ['stake', { bg: '#52E252', fg: '#08260F', short: 'Sauber' }],
  ['racing b', { bg: '#6692FF', fg: '#0A1733', short: 'Racing B.' }],
  ['visa', { bg: '#6692FF', fg: '#0A1733', short: 'Racing B.' }],
  ['red b', { bg: '#3671C6', fg: '#FFFFFF', short: 'Red Bull' }],
  ['red bull', { bg: '#3671C6', fg: '#FFFFFF', short: 'Red Bull' }],
  ['audi', { bg: '#BB0A30', fg: '#FFFFFF', short: 'Audi' }],
  ['cadillac', { bg: '#111111', fg: '#E1B60A', short: 'Cadillac' }],
]
const MOTOGP_TEAMS: Array<[string, TeamStyle]> = [
  ['ktm', { bg: '#FF6600', fg: '#111111', short: 'KTM' }],
  ['vr46', { bg: '#FFEB00', fg: '#111111', short: 'VR46' }],
  ['gresini', { bg: '#6CA0DC', fg: '#0A1B33', short: 'Gresini' }],
  ['aprilia', { bg: '#B10E2F', fg: '#FFFFFF', short: 'Aprilia' }],
  ['ducati', { bg: '#CC0000', fg: '#FFFFFF', short: 'Ducati' }],
  ['trackhouse', { bg: '#E4002B', fg: '#FFFFFF', short: 'Trackhouse' }],
  ['pramac', { bg: '#0D1E45', fg: '#FFFFFF', short: 'Pramac' }],
  ['yamaha', { bg: '#0D1E45', fg: '#FFFFFF', short: 'Yamaha' }],
  ['honda', { bg: '#E60012', fg: '#FFFFFF', short: 'Honda' }],
  ['lcr', { bg: '#E60012', fg: '#FFFFFF', short: 'LCR' }],
]
function teamStyle(team: string, isF1: boolean): TeamStyle {
  const t = (team || '').toLowerCase()
  const table = isF1 ? F1_TEAMS : MOTOGP_TEAMS
  for (const [kw, st] of table) if (t.includes(kw)) return st
  // Repli : couleur neutre + 1er mot du nom comme libellé.
  return { ...FALLBACK, short: (team || '').split(/[\s,]/)[0] || '' }
}

// ── Parsing du classement depuis le texte EN mis en forme ─────
export type StKind = 'we' | 'course' | 'constructors'
type Row = { pos: number; name: string; team: string; points: string; sub?: string }
// Retire un préfixe de position en emojis keycap (1️⃣, 🔟, 1️⃣1️⃣…).
const KEYCAP_PREFIX = /^[\s]*(?:[0-9️⃣]|\u{1F51F})+\s*/u
// Vrai si la ligne débute par une position en keycap (ligne de classement).
export function isStandingLine(line: string): boolean {
  return KEYCAP_PREFIX.test(line)
}
function stripKeycap(line: string): string | null {
  const m = line.match(KEYCAP_PREFIX)
  if (!m) return null
  return line.slice(m[0].length).trim()
}
// kind 'we' -> "I. Nom, Écurie - 208p" ; 'course'/qualifs -> "Nom (Écurie)" ;
// 'constructors' -> "Écurie - 512p | Pilote1 & Pilote2".
export function parseStandings(enText: string, kind: StKind): Row[] {
  const rows: Row[] = []
  const lines = (enText || '').split(NL)
  for (const raw of lines) {
    const content = stripKeycap(raw)
    if (!content) continue
    if (kind === 'we') {
      const pm = content.match(/[-–]\s*(\d+)\s*p\b/i)
      const points = pm ? pm[1] : ''
      let rest = pm ? content.slice(0, pm.index).trim() : content
      rest = rest.replace(/[-–]\s*$/, '').trim()
      const ci = rest.lastIndexOf(',')
      const name = ci >= 0 ? rest.slice(0, ci).trim() : rest
      const team = ci >= 0 ? rest.slice(ci + 1).trim() : ''
      if (name) rows.push({ pos: rows.length + 1, name, team, points })
    } else if (kind === 'constructors') {
      const bar = content.indexOf('|')
      const left = (bar >= 0 ? content.slice(0, bar) : content).trim()
      const drivers = bar >= 0 ? content.slice(bar + 1).trim() : ''
      const pm = left.match(/[-–]\s*(\d+)\s*p\b/i)
      const points = pm ? pm[1] : ''
      let name = pm ? left.slice(0, pm.index).trim() : left
      name = name.replace(/[-–]\s*$/, '').trim()
      if (name) rows.push({ pos: rows.length + 1, name, team: name, points, sub: drivers })
    } else {
      const tm = content.match(/\(([^)]+)\)/)
      const team = tm ? tm[1].trim() : ''
      const name = (tm ? content.slice(0, tm.index) : content).trim()
      if (name) rows.push({ pos: rows.length + 1, name, team, points: '' })
    }
    if (rows.length >= 24) break
  }
  return rows
}

// ── Construction du SVG (thème sombre premium) ────────────────
function esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
const MEDAL = ['#F5C542', '#CBD1D8', '#CE8946']       // or / argent / bronze
const MEDAL_DARK = ['#B7860B', '#8B939C', '#8A5524']  // liserés
// Étoile à 5 branches centrée (cx,cy).
function star(cx: number, cy: number, r: number, fill: string): string {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + i * Math.PI / 5
    const rr = (i % 2) ? r * 0.42 : r
    pts.push((cx + rr * Math.cos(ang)).toFixed(1) + ',' + (cy + rr * Math.sin(ang)).toFixed(1))
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`
}
// Petite médaille (rubans + disque + étoile) pour le podium, à côté du nom.
function medal(cx: number, cy: number, rank: number): string {
  const col = MEDAL[rank - 1], dk = MEDAL_DARK[rank - 1]
  const p: string[] = []
  p.push(`<rect x="${cx - 7}" y="${cy - 17}" width="4.5" height="15" rx="1.5" fill="#EF4444" transform="rotate(-14 ${cx - 5} ${cy - 10})"/>`)
  p.push(`<rect x="${cx + 2.5}" y="${cy - 17}" width="4.5" height="15" rx="1.5" fill="#3B82F6" transform="rotate(14 ${cx + 5} ${cy - 10})"/>`)
  p.push(`<circle cx="${cx}" cy="${cy + 3}" r="11.5" fill="${col}" stroke="${dk}" stroke-width="1.5"/>`)
  p.push(star(cx, cy + 3, 6, dk))
  return p.join('')
}
function buildSvg(rows: Row[], title: string, subtitle: string, isF1: boolean, showPoints: boolean): string {
  const hasSub = rows.some((r) => r.sub && r.sub.length > 0)
  const W = 780
  const padX = 20
  const headH = 96
  const rowH = hasSub ? 64 : 52   // lignes plus hautes si sous-titre (pilotes)
  const gap = 8
  const H = headH + rows.length * (rowH + gap) + 20
  const accent = isF1 ? '#E10600' : '#C8102E'
  const nameX = padX + 72
  const teamCx = 588             // colonne des badges d'écurie (centrés)
  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`)
  parts.push(`<rect width="${W}" height="${H}" rx="24" fill="#0B1220"/>`)
  // Bandeau titre : centré, plus gros et gras.
  parts.push(`<rect x="${W / 2 - 26}" y="26" width="52" height="4" rx="2" fill="${accent}"/>`)
  parts.push(`<text x="${W / 2}" y="60" fill="#FFFFFF" font-size="34" font-weight="700" text-anchor="middle">${esc(title)}</text>`)
  parts.push(`<text x="${W / 2}" y="84" fill="#AEB9C9" font-size="19" font-weight="700" text-anchor="middle">${esc(subtitle)}</text>`)

  let y = headH
  for (const r of rows) {
    const st = teamStyle(r.team, isF1)
    const rowBg = (r.pos % 2 === 0) ? '#111A2B' : '#0F1626'
    parts.push(`<rect x="${padX}" y="${y}" width="${W - padX * 2}" height="${rowH}" rx="12" fill="${rowBg}"/>`)
    // Barre couleur écurie (accent gauche)
    parts.push(`<rect x="${padX}" y="${y}" width="7" height="${rowH}" rx="3" fill="${st.bg}"/>`)
    // Pastille position (neutre pour tous ; le podium est marqué par la médaille)
    const cx = padX + 40, cy = y + rowH / 2
    parts.push(`<circle cx="${cx}" cy="${cy}" r="17" fill="#1E293B"/>`)
    parts.push(`<text x="${cx}" y="${cy + 6}" fill="#E2E8F0" font-size="18" font-weight="400" text-anchor="middle">${r.pos}</text>`)
    // Nom + (médaille du podium à droite du nom)
    const nameY = (r.sub && r.sub.length > 0) ? (cy - 2) : (cy + 7)
    const nameFs = 22
    if (r.sub && r.sub.length > 0) {
      parts.push(`<text x="${nameX}" y="${nameY}" fill="#F8FAFC" font-size="${nameFs}" font-weight="700">${esc(r.name)}</text>`)
      parts.push(`<text x="${nameX}" y="${cy + 19}" fill="#9AA6B8" font-size="15" font-weight="400">${esc(r.sub)}</text>`)
    } else {
      parts.push(`<text x="${nameX}" y="${nameY}" fill="#F8FAFC" font-size="${nameFs}" font-weight="400">${esc(r.name)}</text>`)
      // Badge écurie (pastille colorée, CENTRÉE sur la colonne)
      const label = st.short || r.team
      if (label) {
        const bw = Math.min(150, 22 + label.length * 10)
        const bx = teamCx - bw / 2
        parts.push(`<rect x="${bx}" y="${cy - 15}" width="${bw}" height="30" rx="15" fill="${st.bg}"/>`)
        parts.push(`<text x="${teamCx}" y="${cy + 5}" fill="${st.fg}" font-size="15" font-weight="700" text-anchor="middle">${esc(label)}</text>`)
      }
    }
    if (r.pos <= 3) {
      const estW = r.name.length * (nameFs * 0.52)
      const mY = (r.sub && r.sub.length > 0) ? (y + 22) : cy
      parts.push(medal(nameX + estW + 20, mY, r.pos))
    }
    // Points (alignés à droite, en GRAS)
    if (showPoints && r.points) {
      parts.push(`<text x="${W - padX - 16}" y="${cy + 7}" fill="#FFFFFF" font-size="23" font-weight="700" text-anchor="end">${esc(r.points)}<tspan fill="#9AA6B8" font-size="14" font-weight="400"> p</tspan></text>`)
    }
    y += rowH + gap
  }
  parts.push(`</svg>`)
  return parts.join('')
}

// ── API publique : renvoie le PNG (ou null si indispo) ────────
export async function renderStandingsPng(
  enText: string, kind: StKind, isF1: boolean, sportShort: string, subtitle: string,
): Promise<Uint8Array | null> {
  try {
    const rows = parseStandings(enText, kind)
    if (rows.length < 3) return null // pas assez de lignes exploitables
    const [ok, fonts] = await Promise.all([ensureWasm(), ensureFonts()])
    if (!ok || !fonts) return null
    const title = sportShort
    const showPoints = kind === 'we' || kind === 'constructors'
    const svg = buildSvg(rows, title, subtitle, isF1, showPoints)
    const resvg = new Resvg(svg, {
      background: '#0B1220',
      fitTo: { mode: 'width', value: 1120 }, // haute résolution -> texte net
      font: { fontBuffers: fonts, defaultFontFamily: 'Roboto', loadSystemFonts: false },
    })
    const png = resvg.render().asPng()
    return png
  } catch (e) { console.error('renderStandingsPng', String(e)); return null }
}
