import { activeCardZone, canPlay } from '../src/game.js'

const codeOf = (value) => String(value ?? '').trim().toUpperCase().slice(0, 8)
const nameOf = (value) => String(value ?? '').trim().slice(0, 20)
const presenceWindowMs = 10 * 60 * 1000
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

const visibleGameState = (gameState, playerId) => {
  if (!gameState) return gameState
  return {
    ...gameState,
    players: gameState.players?.map((player) => ({
      ...player,
      hand: player.id === playerId ? player.hand : [],
      faceDown: player.id === playerId
        ? player.faceDown
        : (player.faceDown ?? []).map((_, index) => ({ id: `hidden-${player.id}-${index}` })),
      handCount: player.hand?.length ?? player.handCount ?? 0,
    })),
  }
}

async function database() {
  if (!process.env.DATABASE_URL) return null
  const { neon } = await import('@neondatabase/serverless')
  const sql = neon(process.env.DATABASE_URL)
  await sql`
    CREATE TABLE IF NOT EXISTS shithad_rooms (
      code TEXT PRIMARY KEY,
      players JSONB NOT NULL DEFAULT '[]'::jsonb,
      host_id TEXT,
      phase TEXT NOT NULL DEFAULT 'lobby',
      started_at TIMESTAMPTZ,
      game_state JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '6 hours'
    )
  `
  await sql`ALTER TABLE shithad_rooms ADD COLUMN IF NOT EXISTS host_id TEXT`
  await sql`ALTER TABLE shithad_rooms ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'lobby'`
  await sql`ALTER TABLE shithad_rooms ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`
  await sql`ALTER TABLE shithad_rooms ADD COLUMN IF NOT EXISTS game_state JSONB`
  return sql
}

async function removeInactiveRooms(sql) {
  const rows = await sql`SELECT code, players FROM shithad_rooms WHERE expires_at > NOW()`
  const cutoff = Date.now() - presenceWindowMs
  for (const room of rows) {
    const players = room.players.filter((player) => player.lastSeen && Date.parse(player.lastSeen) > cutoff)
    if (players.length === 0) {
      await sql`DELETE FROM shithad_rooms WHERE code = ${room.code}`
    } else if (players.length !== room.players.length) {
      await sql`UPDATE shithad_rooms SET players = ${JSON.stringify(players)}::jsonb WHERE code = ${room.code}`
    }
  }
}

async function mutateGame(sql, code, initialRoom, mutate) {
  let room = initialRoom
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = mutate(room)
    if (result.error) return result
    const revision = Number(room.game_state.revision ?? 0)
    const saved = await sql`
      UPDATE shithad_rooms
      SET game_state = ${JSON.stringify(result.gameState)}::jsonb, expires_at = NOW() + INTERVAL '10 minutes'
      WHERE code = ${code} AND COALESCE((game_state->>'revision')::integer, 0) = ${revision}
      RETURNING code
    `
    if (saved.length) return { ...result, room }
    const rows = await sql`SELECT players, host_id, phase, started_at, game_state FROM shithad_rooms WHERE code = ${code} AND expires_at > NOW()`
    if (!rows[0]) return { error: 'Raum nicht gefunden.', status: 404 }
    room = rows[0]
  }
  return { error: 'Der Spielstand wird gerade geändert. Bitte versuche es erneut.', status: 409 }
}

export async function POST(request) {
  try {
    const sql = await database()
    if (!sql) return json({ message: 'Die Neon-Datenbank ist in Vercel noch nicht als DATABASE_URL eingerichtet.' }, 503)
    const payload = await request.json()
    const name = nameOf(payload.name)
    let code = codeOf(payload.roomCode)
    if (payload.mode === 'create') {
      code = `SH${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    }
    if (!code) return json({ message: 'Bitte einen Raumcode eingeben.' }, 400)
    const rows = await sql`SELECT players, host_id, phase, started_at, game_state FROM shithad_rooms WHERE code = ${code} AND expires_at > NOW()`
    const room = rows[0] ?? { players: [], host_id: null, phase: 'lobby', started_at: null, game_state: null }
    if (payload.action === 'leave') {
      const players = room.players.filter((player) => player.id !== payload.playerId)
      if (players.length === 0) {
        await sql`DELETE FROM shithad_rooms WHERE code = ${code}`
        return json({ roomCode: code, players: [] })
      }
      const nextHostId = room.host_id === payload.playerId ? players[0].id : room.host_id
      const nextPlayers = players.map((player) => ({ ...player, host: player.id === nextHostId, lastSeen: new Date().toISOString() }))
      await sql`UPDATE shithad_rooms SET players = ${JSON.stringify(nextPlayers)}::jsonb, host_id = ${nextHostId}, expires_at = NOW() + INTERVAL '10 minutes' WHERE code = ${code}`
      return json({ roomCode: code, players: nextPlayers, hostId: nextHostId, phase: room.phase })
    }
    if (payload.action === 'start') {
      if (room.host_id !== payload.playerId) return json({ message: 'Nur der Host kann das Spiel starten.' }, 403)
      const startedAt = payload.startedAt ?? new Date().toISOString()
      const players = room.players.map((player) => ({ ...player, handCount: payload.gamePlayers?.find((entry) => entry.id === player.id)?.hand?.length ?? 3 }))
      const gamePlayers = (payload.gamePlayers ?? players).map((player) => ({
        ...player,
        name: players.find((entry) => entry.id === player.id)?.name ?? player.name,
        host: players.find((entry) => entry.id === player.id)?.host ?? player.host,
      }))
      const gameState = {
        players: gamePlayers,
        drawPile: payload.drawPile ?? [],
        discardPile: [],
        currentPlayerId: players[0]?.id ?? null,
        handCounts: Object.fromEntries(gamePlayers.map((player) => [player.id, player.hand?.length ?? 3])),
        lastAction: null,
        revision: 0,
        swapping: true,
        ready: {},
      }
      await sql`UPDATE shithad_rooms SET phase = 'dealing', started_at = ${startedAt}, players = ${JSON.stringify(players)}::jsonb, game_state = ${JSON.stringify(gameState)}::jsonb, expires_at = NOW() + INTERVAL '10 minutes' WHERE code = ${code}`
      return json({ roomCode: code, phase: 'dealing', startedAt, gameState: visibleGameState(gameState, payload.playerId), players })
    }
    if (payload.action === 'swap' || payload.action === 'ready') {
      if (!room.game_state) return json({ message: 'Das Spiel hat noch nicht begonnen.' }, 409)
      const result = await mutateGame(sql, code, room, (current) => {
        const state = current.game_state
        if (!state?.swapping) return { error: 'Die Tauschphase ist bereits beendet.', status: 409 }
        if (state.ready?.[payload.playerId]) return { error: 'Du bist bereits fertig.', status: 409 }
        const players = (state.players ?? []).map((entry) => ({ ...entry, hand: [...(entry.hand ?? [])], faceUp: [...(entry.faceUp ?? [])] }))
        const me = players.find((entry) => entry.id === payload.playerId)
        if (!me) return { error: 'Spieler ist in diesem Spiel nicht vorhanden.', status: 403 }
        if (payload.action === 'swap') {
          const handIndex = me.hand.findIndex((card) => card.id === payload.handCardId)
          const faceUpIndex = me.faceUp.findIndex((card) => card.id === payload.faceUpCardId)
          if (handIndex < 0 || faceUpIndex < 0) return { error: 'Diese Karten können nicht getauscht werden.', status: 409 }
          ;[me.hand[handIndex], me.faceUp[faceUpIndex]] = [me.faceUp[faceUpIndex], me.hand[handIndex]]
          return { gameState: { ...state, players, revision: Number(state.revision ?? 0) + 1 } }
        }
        const ready = { ...(state.ready ?? {}), [payload.playerId]: true }
        const seated = players.filter((entry) => current.players.some((roomPlayer) => roomPlayer.id === entry.id))
        const everyoneReady = seated.every((entry) => ready[entry.id])
        return {
          gameState: {
            ...state,
            players,
            ready: everyoneReady ? {} : ready,
            swapping: !everyoneReady,
            revision: Number(state.revision ?? 0) + 1,
          },
        }
      })
      if (result.error) return json({ message: result.error }, result.status)
      return json({
        roomCode: code,
        playerId: payload.playerId,
        players: result.room.players,
        hostId: result.room.host_id,
        phase: result.room.phase,
        startedAt: result.room.started_at,
        gameState: visibleGameState(result.gameState, payload.playerId),
      })
    }
    if (payload.action === 'play') {
      if (room.game_state?.swapping) return json({ message: 'Es geht los, sobald alle Spieler auf Fertig gedrückt haben.' }, 409)
      if (!['dealing', 'game'].includes(room.phase)) return json({ message: 'Das Spiel hat noch nicht begonnen.' }, 409)
      if (room.game_state?.winnerId) return json({ message: 'Das Spiel ist bereits beendet.' }, 409)
      if (room.game_state?.currentPlayerId !== payload.playerId) return json({ message: 'Du bist nicht an der Reihe.' }, 403)
      const gamePlayers = room.game_state.players ?? []
      const currentIndex = gamePlayers.findIndex((player) => player.id === payload.playerId)
      if (currentIndex < 0) return json({ message: 'Spieler ist in diesem Spiel nicht vorhanden.' }, 403)
      const currentPlayer = gamePlayers[currentIndex]
      const zone = payload.zone ?? 'hand'
      if (zone !== activeCardZone(currentPlayer)) return json({ message: 'Du musst zuerst deine Handkarten und danach deine offenen Karten spielen.' }, 409)
      const zoneCards = [...(currentPlayer[zone] ?? [])]
      const playedIndex = zoneCards.findIndex((card) => card.id === payload.cardId)
      if (playedIndex < 0) return json({ message: 'Diese Karte ist nicht mehr verfügbar.' }, 409)
      const card = zoneCards[playedIndex]
      const discardPile = [...(room.game_state.discardPile ?? [])]
      if (zone !== 'faceDown' && !canPlay(card, discardPile)) return json({ message: 'Diese Karte kannst du nicht legen.' }, 409)

      if (zone !== 'faceDown' && !zoneCards.some((candidate) => canPlay(candidate, discardPile))) {
        return json({ message: 'Du kannst keine Karte legen. Nimm den Ablagestapel auf.' }, 409)
      }

      const drawPile = [...(room.game_state.drawPile ?? [])]
      const isBlindPlayInvalid = zone === 'faceDown' && !canPlay(card, discardPile)
      const updatedCurrentPlayer = { ...currentPlayer, [zone]: zoneCards.filter((_, index) => index !== playedIndex) }
      if (isBlindPlayInvalid) {
        updatedCurrentPlayer.hand = [...(updatedCurrentPlayer.hand ?? []), ...discardPile, card]
      } else if (zone === 'hand') {
        while (updatedCurrentPlayer.hand.length < 3 && drawPile.length) updatedCurrentPlayer.hand.push(drawPile.pop())
        if (!updatedCurrentPlayer.hand.length && !drawPile.length && updatedCurrentPlayer.faceUp?.length) {
          updatedCurrentPlayer.hand = [...updatedCurrentPlayer.faceUp]
          updatedCurrentPlayer.faceUp = []
        }
      }
      const updatedGamePlayers = gamePlayers.map((player, index) => index === currentIndex ? updatedCurrentPlayer : player)
      const playerFinished = ['hand', 'faceUp', 'faceDown'].every((cardZone) => (updatedCurrentPlayer[cardZone] ?? []).length === 0)
      const winnerId = playerFinished ? payload.playerId : null
      const nextPlayerIndex = isBlindPlayInvalid
        ? (currentIndex + 1) % gamePlayers.length
        : card.value === 10
          ? currentIndex
          : (currentIndex + (card.value === 11 ? 2 : 1)) % gamePlayers.length
      const nextDiscardPile = isBlindPlayInvalid
        ? []
        : card.value === 10
          ? []
          : [...discardPile, card]
      const gameState = {
        discardPile: nextDiscardPile,
        currentPlayerId: winnerId ? payload.playerId : gamePlayers[nextPlayerIndex]?.id ?? payload.playerId,
        handCounts: Object.fromEntries(updatedGamePlayers.map((player) => [player.id, player.hand?.length ?? 0])),
        players: updatedGamePlayers,
        drawPile,
        winnerId,
        lastAction: { type: isBlindPlayInvalid ? 'pickup' : 'play', playerId: payload.playerId, at: new Date().toISOString() },
        revision: Number(room.game_state.revision ?? 0) + 1,
      }
      const players = room.players.map((player) => ({
        ...player,
        handCount: gameState.handCounts[player.id] ?? player.handCount ?? 0,
        lastSeen: new Date().toISOString(),
      }))
      const saved = await sql`
        UPDATE shithad_rooms
        SET phase = ${winnerId ? 'finished' : 'game'}, game_state = ${JSON.stringify(gameState)}::jsonb, players = ${JSON.stringify(players)}::jsonb, expires_at = NOW() + INTERVAL '10 minutes'
        WHERE code = ${code}
          AND game_state->>'currentPlayerId' = ${payload.playerId}
          AND COALESCE((game_state->>'revision')::integer, 0) = ${Number(room.game_state.revision ?? 0)}
        RETURNING code
      `
      if (!saved.length) return json({ message: 'Der Spielstand wurde zwischenzeitlich aktualisiert. Bitte warte auf deinen nächsten Zug.' }, 409)
      return json({
        roomCode: code,
        playerId: payload.playerId,
        gameState: visibleGameState(gameState, payload.playerId),
        players,
        phase: winnerId ? 'finished' : 'game',
        message: isBlindPlayInvalid ? 'Die verdeckte Karte war nicht spielbar. Du hast den Ablagestapel aufgenommen.' : undefined,
      })
    }
    if (payload.action === 'pickup') {
      if (!['dealing', 'game'].includes(room.phase) || room.game_state?.swapping) return json({ message: 'Das Spiel hat noch nicht begonnen.' }, 409)
      if (room.game_state?.winnerId) return json({ message: 'Das Spiel ist bereits beendet.' }, 409)
      if (room.game_state?.currentPlayerId !== payload.playerId) return json({ message: 'Du bist nicht an der Reihe.' }, 403)
      const gamePlayers = room.game_state.players ?? []
      const currentIndex = gamePlayers.findIndex((player) => player.id === payload.playerId)
      const currentPlayer = gamePlayers[currentIndex]
      if (!currentPlayer) return json({ message: 'Spieler ist in diesem Spiel nicht vorhanden.' }, 403)
      const zone = activeCardZone(currentPlayer)
      if (!['hand', 'faceUp'].includes(zone)) return json({ message: 'Verdeckte Karten musst du einzeln aufdecken.' }, 409)
      const discardPile = [...(room.game_state.discardPile ?? [])]
      if (!discardPile.length || (currentPlayer[zone] ?? []).some((card) => canPlay(card, discardPile))) {
        return json({ message: 'Du musst eine spielbare Karte legen.' }, 409)
      }
      const updatedGamePlayers = gamePlayers.map((player, index) => index === currentIndex
        ? { ...player, hand: [...(player.hand ?? []), ...discardPile] }
        : player)
      const nextPlayerIndex = (currentIndex + 1) % gamePlayers.length
      const gameState = {
        ...room.game_state,
        players: updatedGamePlayers,
        discardPile: [],
        currentPlayerId: gamePlayers[nextPlayerIndex]?.id ?? payload.playerId,
        handCounts: Object.fromEntries(updatedGamePlayers.map((player) => [player.id, player.hand?.length ?? 0])),
        lastAction: { type: 'pickup', playerId: payload.playerId, at: new Date().toISOString() },
        revision: Number(room.game_state.revision ?? 0) + 1,
      }
      const players = room.players.map((player) => ({
        ...player,
        handCount: gameState.handCounts[player.id] ?? player.handCount ?? 0,
        lastSeen: new Date().toISOString(),
      }))
      const saved = await sql`
        UPDATE shithad_rooms
        SET game_state = ${JSON.stringify(gameState)}::jsonb, players = ${JSON.stringify(players)}::jsonb, expires_at = NOW() + INTERVAL '10 minutes'
        WHERE code = ${code}
          AND game_state->>'currentPlayerId' = ${payload.playerId}
          AND COALESCE((game_state->>'revision')::integer, 0) = ${Number(room.game_state.revision ?? 0)}
        RETURNING code
      `
      if (!saved.length) return json({ message: 'Der Spielstand wurde zwischenzeitlich aktualisiert. Bitte versuche es erneut.' }, 409)
      return json({ roomCode: code, playerId: payload.playerId, gameState: visibleGameState(gameState, payload.playerId), players, phase: 'game' })
    }
    if (!name) return json({ message: 'Bitte einen Namen eingeben.' }, 400)
    if (payload.mode === 'create' && room.players.length) return json({ message: 'Dieser Raumcode wird bereits verwendet.' }, 409)
    const duplicateName = room.players.some((player) => player.name.toLocaleLowerCase() === name.toLocaleLowerCase() && player.id !== payload.playerId)
    if (duplicateName) return json({ message: 'Dieser Name wird in diesem Raum bereits verwendet.' }, 409)
    if (!room.players.some((player) => player.id === payload.playerId) && room.players.length >= 6) return json({ message: 'Dieser Raum ist bereits voll.' }, 409)
    const player = room.players.find((entry) => entry.id === payload.playerId || entry.name === name) ?? {
      id: crypto.randomUUID(),
      name,
      host: payload.mode === 'create',
    }
    const hostId = room.host_id ?? room.players.find((entry) => entry.host)?.id ?? player.id
    player.host = player.id === hostId
    player.lastSeen = new Date().toISOString()
    const players = [...room.players.filter((entry) => entry.id !== player.id), player]
      .map((entry) => ({ ...entry, host: entry.id === hostId }))
    await sql`
      INSERT INTO shithad_rooms (code, players, host_id, phase, started_at, game_state, expires_at)
      VALUES (${code}, ${JSON.stringify(players)}::jsonb, ${hostId}, ${room.phase}, ${room.started_at}, ${room.game_state ? JSON.stringify(room.game_state) : null}::jsonb, NOW() + INTERVAL '10 minutes')
      ON CONFLICT (code) DO UPDATE
      SET players = EXCLUDED.players, host_id = COALESCE(shithad_rooms.host_id, EXCLUDED.host_id), expires_at = EXCLUDED.expires_at
    `
    return json({
      roomCode: code,
      playerId: player.id,
      players,
      hostId,
      phase: room.phase,
      startedAt: room.started_at,
      gameState: visibleGameState(room.game_state, player.id),
    })
  } catch {
    return json({ message: 'Die Neon-Datenbank konnte nicht erreicht werden.' }, 500)
  }
}

export async function GET(request) {
  const code = codeOf(new URL(request.url).searchParams.get('roomCode'))
  try {
    const sql = await database()
    if (!sql) return json({ message: 'Die Neon-Datenbank ist in Vercel noch nicht als DATABASE_URL eingerichtet.' }, 503)
    await removeInactiveRooms(sql)
    if (!code) {
      const rows = await sql`
        SELECT code, players, phase
        FROM shithad_rooms
        WHERE expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 50
      `
      return json({
        rooms: rows.map((room) => ({
          roomCode: room.code,
          players: room.players,
          phase: room.phase,
        })),
      })
    }
    const rows = await sql`SELECT players, host_id, phase, started_at, game_state FROM shithad_rooms WHERE code = ${code} AND expires_at > NOW()`
    if (rows[0] && new URL(request.url).searchParams.get('playerId')) {
      const playerId = new URL(request.url).searchParams.get('playerId')
      const players = rows[0].players.map((player) => player.id === playerId ? { ...player, lastSeen: new Date().toISOString() } : player)
      await sql`UPDATE shithad_rooms SET players = ${JSON.stringify(players)}::jsonb, expires_at = NOW() + INTERVAL '10 minutes' WHERE code = ${code}`
      rows[0].players = players
    }
    const playerId = new URL(request.url).searchParams.get('playerId')
    return rows[0] ? json({ roomCode: code, players: rows[0].players, hostId: rows[0].host_id, phase: rows[0].phase, startedAt: rows[0].started_at, gameState: visibleGameState(rows[0].game_state, playerId) }) : json({ message: 'Raum nicht gefunden.' }, 404)
  } catch {
    return json({ message: 'Die Neon-Datenbank konnte nicht erreicht werden.' }, 500)
  }
}
