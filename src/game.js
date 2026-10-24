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

export function shuffle(cards) {
  const copy = [...cards]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
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
  const top = effectiveTop(discardPile)
  if (!top || card.value === 2) return true
  if (card.value === 3) return true
  if (card.value === 7) return top.value <= 7 || top.value === 10
  return card.value >= top.value
}

export function specialRule(value) {
  return {
    2: 'Reset: Der nächste Spieler darf wieder bei 0 beginnen.',
    3: 'Durchsichtig: Es zählt die Karte darunter.',
    7: 'Der nächste muss 7 oder niedriger legen – oder eine 10.',
    10: 'Der Ablagestapel wird aus dem Spiel genommen.',
    11: 'Bube: Der nächste Spieler wird übersprungen.',
  }[value] ?? null
}

export function dealGame(playerCount = 4) {
  const deck = shuffle(createDeck())
  const players = Array.from({ length: playerCount }, (_, index) => ({
    id: index,
    name: index === 0 ? 'Du' : ['Lena', 'Tom', 'Mika'][index - 1],
    hand: deck.splice(0, 3),
    faceUp: deck.splice(0, 3),
    faceDown: deck.splice(0, 3),
  }))

  return { players, drawPile: deck, discardPile: [], currentPlayer: 0, phase: 'hand', skipped: false }
}
