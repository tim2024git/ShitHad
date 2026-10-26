export const RANKS = [
  { value: 4, label: '4' },
  { value: 5, label: '5' },
  { value: 6, label: '6' },
  { value: 7, label: '7' },
  { value: 8, label: '8' },
  { value: 9, label: '9' },
  { value: 10, label: '10' },
  { value: 11, label: 'J' },
  { value: 12, label: 'Q' },
  { value: 13, label: 'K' },
  { value: 14, label: 'A' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
]

export const SUITS = ['♠', '♥', '♦', '♣']

export function createDeck() {
  return SUITS.flatMap((suit) =>
    RANKS.map(({ value, label }, index) => ({
      id: `${suit}-${value}-${index}`,
      rank: label,
      value,
      suit,
    })),
  )
}

export function shuffle(cards, random = Math.random) {
  const copy = [...cards]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(random() * (index + 1))
    ;[copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]]
  }
  return copy
}

export function effectiveTop(discardPile) {
  for (let index = discardPile.length - 1; index >= 0; index -= 1) {
    if (discardPile[index].value !== 3) return discardPile[index]
  }
  return null
}

export function canPlay(card, discardPile) {
  if (!card) return false
  if ([2, 3, 10].includes(card.value)) return true
  const top = effectiveTop(discardPile)
  if (!top || top.value === 2) return true
  if (top.value === 7) return card.value <= 7
  return card.value >= top.value
}

export function specialRule(value) {
  return {
    2: 'Reset: Der Ablagestapel bleibt liegen, der nächste Spieler darf wieder bei 0 beginnen.',
    3: 'Durchsichtig: Es zählt die Karte darunter.',
    7: 'Der nächste Spieler muss eine 7 oder niedriger legen.',
    10: 'Der Ablagestapel wird entfernt und du bist noch einmal dran.',
    11: 'Bube: Der nächste Spieler wird übersprungen.',
  }[value] ?? null
}

export function activeCardZone(player) {
  if (player?.hand?.length) return 'hand'
  if (player?.faceUp?.length) return 'faceUp'
  if (player?.faceDown?.length) return 'faceDown'
  return null
}

export function dealGame(playerCount = 4, seed = 'local', playerData = []) {
  let state = [...String(seed)].reduce((value, character) => ((value * 31) + character.charCodeAt(0)) >>> 0, 2166136261)
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 4294967296
  }
  const deck = shuffle(createDeck(), random)
  const players = Array.from({ length: playerCount }, (_, index) => ({
    id: playerData[index]?.id ?? index,
    name: playerData[index]?.name ?? (index === 0 ? 'Du' : ['Lena', 'Tom', 'Mika'][index - 1] ?? `Spieler ${index + 1}`),
    hand: deck.splice(0, 3),
    faceUp: deck.splice(0, 3),
    faceDown: deck.splice(0, 3),
  }))

  return { players, drawPile: deck, discardPile: [], currentPlayer: 0, phase: 'hand', skipped: false }
}
