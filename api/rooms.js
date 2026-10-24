import { Redis } from '@upstash/redis'

const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN
const redisConfigured = Boolean(redisUrl && redisToken)
const redis = redisConfigured ? new Redis({ url: redisUrl, token: redisToken }) : null

const keyFor = (code) => `shithad:room:${code}`
const codeOf = (value) => String(value ?? '').trim().toUpperCase().slice(0, 8)
const nameOf = (value) => String(value ?? '').trim().slice(0, 20)
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

export async function POST(request) {
  try {
    if (!redis) return json({ message: 'Der Online-Raumserver ist noch nicht eingerichtet. Verbinde zuerst eine Upstash-Redis-Datenbank mit dem Vercel-Projekt.' }, 503)
    const payload = await request.json()
    const name = nameOf(payload.name)
    let code = codeOf(payload.roomCode)
    if (!name) return json({ message: 'Bitte einen Namen eingeben.' }, 400)
    if (payload.mode === 'create') {
      code = `SH${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    }
    if (!code) return json({ message: 'Bitte einen Raumcode eingeben.' }, 400)
    const key = keyFor(code)
    const room = (await redis.get(key)) ?? { players: [] }
    if (payload.mode === 'create' && room.players.length) return json({ message: 'Dieser Raumcode wird bereits verwendet.' }, 409)
    if (!room.players.some((player) => player.name === name) && room.players.length >= 4) return json({ message: 'Dieser Raum ist bereits voll.' }, 409)
    const player = room.players.find((entry) => entry.name === name) ?? { id: crypto.randomUUID(), name }
    const players = [...room.players.filter((entry) => entry.id !== player.id), player]
    await redis.set(key, { players }, { ex: 21600 })
    return json({ roomCode: code, playerId: player.id, players })
  } catch {
    return json({ message: 'Der Raumserver ist momentan nicht verfügbar.' }, 500)
  }
}

export async function GET(request) {
  const code = codeOf(new URL(request.url).searchParams.get('roomCode'))
  if (!code) return json({ message: 'Raumcode fehlt.' }, 400)
  try {
    if (!redis) return json({ message: 'Der Online-Raumserver ist noch nicht eingerichtet.' }, 503)
    const room = await redis.get(keyFor(code))
    return room ? json({ roomCode: code, players: room.players }) : json({ message: 'Raum nicht gefunden.' }, 404)
  } catch {
    return json({ message: 'Der Raumserver ist momentan nicht verfügbar.' }, 500)
  }
}
