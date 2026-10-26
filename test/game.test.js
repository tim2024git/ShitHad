import test from 'node:test'
import assert from 'node:assert/strict'
import { activeCardZone, canPlay, effectiveTop } from '../src/game.js'

const card = (value) => ({ value })

test('2, 3 and 10 can always be played', () => {
  for (const value of [2, 3, 10]) {
    assert.equal(canPlay(card(value), [card(14)]), true)
  }
})

test('ordinary cards must match or exceed the effective top card', () => {
  assert.equal(canPlay(card(8), [card(9)]), false)
  assert.equal(canPlay(card(9), [card(9)]), true)
  assert.equal(canPlay(card(10), [card(9)]), true)
})

test('a 7 allows cards seven or lower', () => {
  assert.equal(canPlay(card(6), [card(7)]), true)
  assert.equal(canPlay(card(7), [card(7)]), true)
  assert.equal(canPlay(card(8), [card(7)]), false)
})

test('a 3 is transparent and a 2 resets the effective value', () => {
  assert.equal(effectiveTop([card(9), card(3)]).value, 9)
  assert.equal(canPlay(card(8), [card(9), card(2)]), true)
})

test('card zones progress from hand to face-up to face-down', () => {
  assert.equal(activeCardZone({ hand: [card(4)], faceUp: [card(5)], faceDown: [card(6)] }), 'hand')
  assert.equal(activeCardZone({ hand: [], faceUp: [card(5)], faceDown: [card(6)] }), 'faceUp')
  assert.equal(activeCardZone({ hand: [], faceUp: [], faceDown: [card(6)] }), 'faceDown')
  assert.equal(activeCardZone({ hand: [], faceUp: [], faceDown: [] }), null)
})
