const codeOf = (value) => String(value ?? '').trim().toUpperCase().slice(0, 8)
const nameOf = (value) => String(value ?? '').trim().slice(0, 20)
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '6 hours'
    )
  `
  await sql`ALTER TABLE shithad_rooms ADD COLUMN IF NOT EXISTS host_id TEXT`
  await sql`ALTER TABLE shithad_rooms ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'lobby'`
  await sql`ALTER TABLE shithad_rooms ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`
  return sql
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
    const rows = await sql`SELECT players, host_id, phase, started_at FROM shithad_rooms WHERE code = ${code} AND expires_at > NOW()`
    const room = rows[0] ?? { players: [], host_id: null, phase: 'lobby', started_at: null }
    if (payload.action === 'start') {
      if (room.host_id !== payload.playerId) return json({ message: 'Nur der Host kann das Spiel starten.' }, 403)
      await sql`UPDATE shithad_rooms SET phase = 'dealing', started_at = NOW(), expires_at = NOW() + INTERVAL '6 hours' WHERE code = ${code}`
      return json({ roomCode: code, phase: 'dealing', startedAt: new Date().toISOString(), players: room.players })
    }
    if (payload.mode === 'create' && room.players.length) return json({ message: 'Dieser Raumcode wird bereits verwendet.' }, 409)
    if (!room.players.some((player) => player.name === name) && room.players.length >= 6) return json({ message: 'Dieser Raum ist bereits voll.' }, 409)
    const player = room.players.find((entry) => entry.id === payload.playerId || entry.name === name) ?? {
      id: crypto.randomUUID(),
      name,
      host: payload.mode === 'create',
    }
    const hostId = room.host_id ?? room.players.find((entry) => entry.host)?.id ?? player.id
    player.host = player.id === hostId
    const players = [...room.players.filter((entry) => entry.id !== player.id), player]
      .map((entry) => ({ ...entry, host: entry.id === hostId }))
    await sql`
      INSERT INTO shithad_rooms (code, players, host_id, phase, started_at, expires_at)
      VALUES (${code}, ${JSON.stringify(players)}::jsonb, ${hostId}, ${room.phase}, ${room.started_at}, NOW() + INTERVAL '6 hours')
      ON CONFLICT (code) DO UPDATE
      SET players = EXCLUDED.players, host_id = COALESCE(shithad_rooms.host_id, EXCLUDED.host_id), expires_at = EXCLUDED.expires_at
    `
    return json({ roomCode: code, playerId: player.id, players, hostId, phase: room.phase, startedAt: room.started_at })
  } catch {
    return json({ message: 'Die Neon-Datenbank konnte nicht erreicht werden.' }, 500)
  }
}

export async function GET(request) {
  const code = codeOf(new URL(request.url).searchParams.get('roomCode'))
  if (!code) return json({ message: 'Raumcode fehlt.' }, 400)
  try {
    const sql = await database()
    if (!sql) return json({ message: 'Die Neon-Datenbank ist in Vercel noch nicht als DATABASE_URL eingerichtet.' }, 503)
    const rows = await sql`SELECT players, host_id, phase, started_at FROM shithad_rooms WHERE code = ${code} AND expires_at > NOW()`
    return rows[0] ? json({ roomCode: code, players: rows[0].players, hostId: rows[0].host_id, phase: rows[0].phase, startedAt: rows[0].started_at }) : json({ message: 'Raum nicht gefunden.' }, 404)
  } catch {
    return json({ message: 'Die Neon-Datenbank konnte nicht erreicht werden.' }, 500)
  }
}
