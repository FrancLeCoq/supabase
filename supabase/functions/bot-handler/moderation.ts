// Module issu du decoupage de bot-handler (logique identique, code deplace).
export const ABUSE_WORDS = [
  // insultes EN
  'fuck', 'fucker', 'fucking', 'motherfucker', 'shit', 'bitch', 'asshole',
  'bastard', 'cunt', 'dick', 'dickhead', 'retard', 'retarded', 'faggot',
  'fag', 'nigger', 'nigga', 'whore', 'slut', 'moron', 'idiot', 'scumbag',
  // dénigrement projet / scam-baiting agressif
  'scam', 'scammer', 'rugpull', 'rug pull', 'ponzi',
  // insultes FR (au cas où, même si groupe EN)
  'connard', 'salope', 'enculé', 'encule', 'pute', 'ducon', 'abruti', 'arnaque'
]

export function isAbusive(raw: string): boolean {
  if (!raw) return false
  const lower = raw.toLowerCase()
  for (const w of ABUSE_WORDS) {
    // \b pour mot entier ; on échappe les espaces (ex. "rug pull")
    const pattern = new RegExp(`(^|[^a-zà-ÿ])${w.replace(/ /g, '\\s+')}([^a-zà-ÿ]|$)`, 'i')
    if (pattern.test(lower)) return true
  }
  return false
}


export async function getChatMemberStatus(token: string, chatId: number, userId: number): Promise<string> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getChatMember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, user_id: userId })
    })
    const data = await res.json()
    return data?.result?.status ?? 'member'
  } catch { return 'member' }
}

