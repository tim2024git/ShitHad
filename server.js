import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

const port = Number(process.env.GAME_PORT ?? 3001)
const rooms = new Map()
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end('ShitHad LAN server is running')
})
const webSocketServer = new WebSocketServer({ server })

function roomPlayers(room) {
  return [...room.values()].map(({ id, name }) => ({ id, name }))
}

function broadcast(room) {
  const players = roomPlayers(room)
  for (const client of room.values()) {
    if (client.socket.readyState === client.socket.OPEN) {
      client.socket.send(JSON.stringify({ type: 'room:update', players }))
    }
  }
}

webSocketServer.on('connection', (socket) => {
  let membership = null
  let membershipId = null

  socket.on('message', (rawMessage) => {
    let message
    try {
      message = JSON.parse(rawMessage.toString())
    } catch {
      socket.send(JSON.stringify({ type: 'error', message: 'Ungültige Nachricht.' }))
      return
    }

    if (message.type !== 'room:join' || typeof message.roomCode !== 'string' || typeof message.name !== 'string') {
      socket.send(JSON.stringify({ type: 'error', message: 'Raumcode und Name werden benötigt.' }))
      return
    }

    const roomCode = message.roomCode.trim().toUpperCase().slice(0, 8)
    const name = message.name.trim().slice(0, 20)
    if (!roomCode || !name) {
      socket.send(JSON.stringify({ type: 'error', message: 'Bitte Raumcode und Namen eingeben.' }))
      return
    }

    if (membership && membershipId) {
      membership.delete(membershipId)
      broadcast(membership)
    }

    const room = rooms.get(roomCode) ?? new Map()
    if (room.size >= 4) {
      socket.send(JSON.stringify({ type: 'error', message: 'Dieser Raum ist bereits voll.' }))
      return
    }

    const id = crypto.randomUUID()
    membership = room
    membershipId = id
    room.set(id, { id, name, socket })
    rooms.set(roomCode, room)
    socket.send(JSON.stringify({ type: 'room:joined', roomCode, playerId: id }))
    broadcast(room)
  })

  socket.on('close', () => {
    if (!membership) return
    if (membershipId) membership.delete(membershipId)
    if (membership.size === 0) {
      for (const [code, room] of rooms) if (room === membership) rooms.delete(code)
    } else {
      broadcast(membership)
    }
  })
})

server.listen(port, '0.0.0.0', () => {
  console.log(`ShitHad LAN server listening on http://0.0.0.0:${port}`)
})
