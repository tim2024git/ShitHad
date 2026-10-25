const codeOf = (value) => String(value ?? '').trim().toUpperCase().slice(0, 8)
const nameOf = (value) => String(value ?? '').trim().slice(0, 20)
const presenceWindowMs = 10 * 60 * 1000
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

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

export async function POST(request) {
  try {
    const sql = await database()
    if (!sql) return json({ message: 'Die Neon-Datenbank ist in Vercel noch nicht als DATABASE_URL eingerichtet.' }, 503)
    const payload = await request.json()
    const name = nameOf(payload.name)
    let code = codeOf(payload.roomCode)
    if (!name) return json({ message: 'Bitte einen Namen eingeben.' }, 400)
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
      const startedAt = new Date().toISOString()
      const players = room.players.map((player) => ({ ...player, handCount: 3 }))
      const gameState = { discardPile: [], currentPlayerId: players[0]?.id ?? null, handCounts: Object.fromEntries(players.map((player) => [player.id, 3])), lastAction: null }
      await sql`UPDATE shithad_rooms SET phase = 'dealing', started_at = ${startedAt}, players = ${JSON.stringify(players)}::jsonb, game_state = ${JSON.stringify(gameState)}::jsonb, expires_at = NOW() + INTERVAL '10 minutes' WHERE code = ${code}`
      return json({ roomCode: code, phase: 'dealing', startedAt, gameState, players })
    }
    if (payload.action === 'play') {
      if (!['dealing', 'game'].includes(room.phase)) return json({ message: 'Das Spiel hat noch nicht begonnen.' }, 409)
      if (room.game_state?.currentPlayerId !== payload.playerId) return json({ message: 'Du bist nicht an der Reihe.' }, 403)
      const gameState = {
        discardPile: [...(room.game_state.discardPile ?? []), payload.card],
        currentPlayerId: payload.nextPlayerId,
        handCounts: payload.handCounts ?? room.game_state.handCounts ?? {},
        lastAction: { type: 'play', playerId: payload.playerId, card: payload.card, at: new Date().toISOString() },
      }
      const players = (payload.players ?? room.players).map((player) => ({ id: player.id, name: player.name, host: player.host, handCount: gameState.handCounts[player.id] ?? player.handCount ?? 3, lastSeen: new Date().toISOString() }))
      await sql`UPDATE shithad_rooms SET phase = 'game', game_state = ${JSON.stringify(gameState)}::jsonb, players = ${JSON.stringify(players)}::jsonb, expires_at = NOW() + INTERVAL '10 minutes' WHERE code = ${code}`
      return json({ roomCode: code, gameState, players, phase: 'game' })
    }
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
    return json({ roomCode: code, playerId: player.id, players, hostId, phase: room.phase, startedAt: room.started_at, gameState: room.game_state })
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
    return rows[0] ? json({ roomCode: code, players: rows[0].players, hostId: rows[0].host_id, phase: rows[0].phase, startedAt: rows[0].started_at, gameState: rows[0].game_state }) : json({ message: 'Raum nicht gefunden.' }, 404)
  } catch {
    return json({ message: 'Die Neon-Datenbank konnte nicht erreicht werden.' }, 500)
  }
}
