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
let fontReady: Promise<Uint8Array | null> | null = null
function ensureFont(): Promise<Uint8Array | null> {
  if (!fontReady) {
    fontReady = (async () => {
      for (const url of FONT_URLS) {
        try {
          const res = await fetch(url)
          if (!res.ok) continue
          const buf = new Uint8Array(await res.arrayBuffer())
          if (buf.length > 20000) return buf   // garde-fou : vraie police
        } catch (_) { /* essaie la suivante */ }
      }
      console.error('resvg: aucune police chargée')
      return null
    })()
  }
  return fontReady
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
const MEDAL = ['#F4C542', '#C7CDD4', '#CD7F32'] // or / argent / bronze
function buildSvg(rows: Row[], title: string, subtitle: string, isF1: boolean, showPoints: boolean): string {
  const hasSub = rows.some((r) => r.sub && r.sub.length > 0)
  const W = 780
  const padX = 20
  const headH = 78
  const rowH = hasSub ? 64 : 52   // lignes plus hautes si sous-titre (pilotes)
  const gap = 8
  const H = headH + rows.length * (rowH + gap) + 20
  const accent = isF1 ? '#E10600' : '#C8102E'
  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`)
  parts.push(`<rect width="${W}" height="${H}" rx="24" fill="#0B1220"/>`)
  // Bandeau titre
  parts.push(`<rect x="0" y="0" width="${W}" height="${headH}" rx="24" fill="#0B1220"/>`)
  parts.push(`<rect x="${padX}" y="34" width="6" height="30" rx="3" fill="${accent}"/>`)
  parts.push(`<text x="${padX + 20}" y="50" fill="#FFFFFF" font-size="30" font-weight="700">${esc(title)}</text>`)
  parts.push(`<text x="${padX + 20}" y="70" fill="#93A3B8" font-size="16">${esc(subtitle)}</text>`)

  let y = headH
  for (const r of rows) {
    const st = teamStyle(r.team, isF1)
    const rowBg = (r.pos % 2 === 0) ? '#111A2B' : '#0F1626'
    parts.push(`<rect x="${padX}" y="${y}" width="${W - padX * 2}" height="${rowH}" rx="12" fill="${rowBg}"/>`)
    // Barre couleur écurie (accent gauche)
    parts.push(`<rect x="${padX}" y="${y}" width="7" height="${rowH}" rx="3" fill="${st.bg}"/>`)
    // Pastille position (médaille pour le podium)
    const cx = padX + 40, cy = y + rowH / 2
    const posBg = r.pos <= 3 ? MEDAL[r.pos - 1] : '#1E293B'
    const posFg = r.pos <= 3 ? '#111111' : '#E2E8F0'
    parts.push(`<circle cx="${cx}" cy="${cy}" r="17" fill="${posBg}"/>`)
    parts.push(`<text x="${cx}" y="${cy + 6}" fill="${posFg}" font-size="18" font-weight="700" text-anchor="middle">${r.pos}</text>`)
    if (r.sub && r.sub.length > 0) {
      // Ligne constructeur : nom (grand) + pilotes titulaires (petit) dessous.
      parts.push(`<text x="${padX + 72}" y="${cy - 2}" fill="#F8FAFC" font-size="22" font-weight="700">${esc(r.name)}</text>`)
      parts.push(`<text x="${padX + 72}" y="${cy + 19}" fill="#93A3B8" font-size="15" font-weight="500">${esc(r.sub)}</text>`)
    } else {
      // Nom du pilote
      parts.push(`<text x="${padX + 72}" y="${cy + 7}" fill="#F8FAFC" font-size="22" font-weight="600">${esc(r.name)}</text>`)
      // Badge écurie (pastille colorée avec le nom court)
      const label = st.short || r.team
      if (label) {
        const bw = Math.min(150, 22 + label.length * 10)
        const bx = showPoints ? (W - padX - 92 - bw) : (W - padX - 16 - bw)
        parts.push(`<rect x="${bx}" y="${y + rowH / 2 - 15}" width="${bw}" height="30" rx="15" fill="${st.bg}"/>`)
        parts.push(`<text x="${bx + bw / 2}" y="${cy + 5}" fill="${st.fg}" font-size="15" font-weight="700" text-anchor="middle">${esc(label)}</text>`)
      }
    }
    // Points (alignés à droite)
    if (showPoints && r.points) {
      parts.push(`<text x="${W - padX - 16}" y="${cy + 7}" fill="#FFFFFF" font-size="22" font-weight="800" text-anchor="end">${esc(r.points)}<tspan fill="#93A3B8" font-size="14" font-weight="600"> p</tspan></text>`)
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
    const [ok, font] = await Promise.all([ensureWasm(), ensureFont()])
    if (!ok || !font) return null
    const title = sportShort
    const showPoints = kind === 'we' || kind === 'constructors'
    const svg = buildSvg(rows, title, subtitle, isF1, showPoints)
    const resvg = new Resvg(svg, {
      background: '#0B1220',
      fitTo: { mode: 'width', value: 1120 }, // haute résolution -> texte net
      font: { fontBuffers: [font], defaultFontFamily: 'Roboto', loadSystemFonts: false },
    })
    const png = resvg.render().asPng()
    return png
  } catch (e) { console.error('renderStandingsPng', String(e)); return null }
}
