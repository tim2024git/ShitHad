import React, { useEffect, useRef, useState } from 'react'
import { Copy, Crown, HelpCircle, LogOut, Plus, Settings, Users, Wifi } from 'lucide-react'
import { canPlay, dealGame, effectiveTop, specialRule } from './game'

const opponents = [
  { name: 'Lena', initials: 'L', cards: 5, active: false, color: 'coral' },
  { name: 'Tom', initials: 'T', cards: 3, active: false, color: 'blue' },
  { name: 'Mika', initials: 'M', cards: 7, active: true, color: 'yellow' },
]

function Card({ rank, suit, faceDown = false, small = false, onClick }) {
  return (
    <button className={`card ${faceDown ? 'card-back' : ''} ${small ? 'card-small' : ''}`} onClick={onClick}>
      {faceDown ? (
        <span className="card-back-mark">S</span>
      ) : (
        <>
          <span className="card-corner">{rank}<b className={suit === '♥' || suit === '♦' ? 'red' : ''}>{suit}</b></span>
          <span className={`card-suit ${suit === '♥' || suit === '♦' ? 'red' : ''}`}>{suit}</span>
          <span className="card-corner card-corner-bottom">{rank}<b className={suit === '♥' || suit === '♦' ? 'red' : ''}>{suit}</b></span>
        </>
      )}
    </button>
  )
}

function Avatar({ player, size = '' }) {
  return <span className={`avatar ${player.color} ${size}`}>{player.initials}</span>
}

function App() {
  const [game, setGame] = useState(() => dealGame())
  const [selectedCard, setSelectedCard] = useState(null)
  const [showHelp, setShowHelp] = useState(false)
  const [copied, setCopied] = useState(false)
  const [roomCode] = useState('SH7HAD')
  const [joinCode, setJoinCode] = useState('SH7HAD')
  const [playerName, setPlayerName] = useState('Du')
  const [connection, setConnection] = useState('offline')
  const [roomPlayers, setRoomPlayers] = useState([])
  const [connectionMessage, setConnectionMessage] = useState('')
  const socketRef = useRef(null)
  const player = game.players[0]
  const topCard = effectiveTop(game.discardPile)
  const currentTurnName = game.currentPlayer === 0
    ? playerName
    : roomPlayers[game.currentPlayer]?.name ?? game.players[game.currentPlayer]?.name ?? 'Nächster Spieler'
  const isPlayable = game.currentPlayer === 0 && selectedCard !== null && canPlay(player.hand[selectedCard], game.discardPile)

  const joinRoom = () => {
    socketRef.current?.close()
    const socketUrl = import.meta.env.VITE_WS_URL
      ?? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:3001`
    const socket = new WebSocket(socketUrl)
    socketRef.current = socket
    setConnection('connecting')
    setConnectionMessage('')
    socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'room:join', roomCode: joinCode, name: playerName })))
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.type === 'room:joined') setConnection('connected')
      if (message.type === 'room:update') setRoomPlayers(message.players)
      if (message.type === 'error') {
        setConnection('offline')
        setConnectionMessage(message.message)
        socket.close()
      }
    })
    socket.addEventListener('error', () => {
      setConnection('offline')
      setConnectionMessage('Server nicht erreichbar. Starte npm run dev auf dem Host.')
    })
  }

  useEffect(() => {
    joinRoom()
    return () => {
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [])

  const playCard = () => {
    if (!isPlayable) return
    const card = player.hand[selectedCard]
    const remainingHand = player.hand.filter((_, index) => index !== selectedCard)
    const nextDrawPile = [...game.drawPile]
    while (remainingHand.length < 3 && nextDrawPile.length && card.value !== 10) remainingHand.push(nextDrawPile.pop())
    setGame({
      ...game,
      players: [{ ...player, hand: remainingHand }, ...game.players.slice(1)],
      drawPile: nextDrawPile,
      discardPile: card.value === 10 ? [] : [...game.discardPile, card],
      currentPlayer: (game.currentPlayer + (card.value === 11 ? 2 : 1)) % game.players.length,
    })
    setSelectedCard(null)
  }

  const copyRoom = async () => {
    try {
      await navigator.clipboard.writeText(roomCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">S</span><span>shithad</span></div>
        <div className="room-status"><span className="live-dot" /> Raum <strong>{roomCode}</strong><button className="copy-button" onClick={copyRoom} aria-label="Raumcode kopieren"><Copy size={14} />{copied ? 'Kopiert' : 'Kopieren'}</button></div>
        <div className="top-actions">
          <button className="icon-button" onClick={() => setShowHelp(!showHelp)} aria-label="Spielregeln"><HelpCircle size={19} /></button>
          <button className="icon-button" aria-label="Einstellungen"><Settings size={19} /></button>
          <button className="leave-button"><LogOut size={16} /> Verlassen</button>
        </div>
      </header>

      <section className="game-layout">
        <div className="table-wrap">
          <div className="table">
            <div className="table-texture" />
            <div className="player player-top"><Avatar player={opponents[2]} /><div><strong>{currentTurnName}</strong><span>{game.currentPlayer === 0 ? player.hand.length : game.players[game.currentPlayer]?.hand.length ?? 0} Karten</span></div><span className="turn-chip">ist dran</span></div>
            <div className="player player-left"><Avatar player={opponents[0]} /><div><strong>{opponents[0].name}</strong><span>{opponents[0].cards} Karten</span></div></div>
            <div className="player player-right"><Avatar player={opponents[1]} /><div><strong>{opponents[1].name}</strong><span>{opponents[1].cards} Karten</span></div></div>

            <div className="table-center">
              <div className="pile-area">
                <div className="pile-label"><span>Nachziehen</span><b>{game.drawPile.length}</b></div>
                <Card faceDown />
              </div>
              <div className="pile-area discard-area">
                <div className="pile-label"><span>Ablegen</span><b>{game.discardPile.length}</b></div>
                <Card rank={topCard?.rank ?? '—'} suit={topCard?.suit ?? '♠'} />
              </div>
            </div>

            <div className="table-message"><span className="message-dot" /> {currentTurnName} ist dran</div>
          </div>

          <div className="your-area">
            <div className="your-heading"><div className="your-player"><Avatar player={{ initials: 'D', color: 'purple' }} /><div><strong>Du</strong><span>{player.hand.length} Karten auf der Hand</span></div></div><span className="hint">Wähle eine Karte zum Ablegen</span></div>
            <div className="face-up-row">
              <span className="row-label">Deine offenen Karten</span>
              <div className="cards-row">{player.faceUp.map((card) => <Card key={card.id} {...card} small />)}</div>
            </div>
            <div className="face-down-row">
              <span className="row-label">Deine verdeckten Karten</span>
              <div className="cards-row">{[0, 1, 2].map((index) => <Card key={index} faceDown small />)}</div>
            </div>
            <div className="hand-row"><span className="row-label">Handkarten</span><div className="cards-row">{player.hand.map((card, index) => <Card key={card.id} {...card} onClick={() => setSelectedCard(index)} />)}</div></div>
            {selectedCard !== null && <button className="play-button" disabled={!isPlayable} onClick={playCard}>{isPlayable ? 'Karte ablegen' : 'Nicht spielbar'}</button>}
          </div>
        </div>

        <aside className="sidebar">
          <div className="side-header"><div><span className="eyebrow">SPIELRAUM</span><h1>Freundeabend</h1></div><span className="round-badge">Runde 1</span></div>
          <div className="divider" />
          <div className="section-title"><span><Users size={16} /> Spieler <b>{roomPlayers.length || 1}/4</b></span><button className="invite-button" onClick={copyRoom}><Plus size={15} /> Einladen</button></div>
          <div className="player-list">{(roomPlayers.length ? roomPlayers : [{ name: playerName, id: 'local' }]).map((roomPlayer, index) => { const currentPlayer = { ...roomPlayer, initials: roomPlayer.name.slice(0, 1).toUpperCase(), color: index === 0 ? 'purple' : opponents[(index - 1) % opponents.length].color, host: roomPlayer.name === playerName }; return <div className="list-player" key={roomPlayer.id}><Avatar player={currentPlayer} /><div><strong>{roomPlayer.name}</strong><span>{currentPlayer.name === playerName ? 'Du' : 'Verbunden'}</span></div>{currentPlayer.name === playerName && <Crown size={14} className="crown" />}{currentPlayer.name !== playerName && <span className="ready-dot" />}</div> })}</div>
          <div className="divider" />
          <div className="rules"><div className="section-title"><span><Wifi size={16} /> Verbindung</span><span className={connection === 'connected' ? 'connected' : 'connection-offline'}>{connection === 'connected' ? 'Verbunden' : connection === 'connecting' ? 'Verbinde …' : 'Nicht verbunden'}</span></div><p>Teile den Raumcode <strong>{joinCode}</strong> und die LAN-Adresse dieses Computers mit deinen Freunden.</p><div className="join-form"><input value={playerName} onChange={(event) => setPlayerName(event.target.value)} placeholder="Dein Name" maxLength={20} /><input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="Raumcode" maxLength={8} /><button onClick={joinRoom}>Raum beitreten</button></div>{connectionMessage && <small className="connection-error">{connectionMessage}</small>}</div>
          <button className="settings-link" onClick={() => setShowHelp(!showHelp)}><HelpCircle size={16} /> Wie wird gespielt?</button>
          {showHelp && <div className="help-popover"><strong>ShitHad – Spielregeln</strong><p>4 ist die niedrigste Karte, Ass die höchste. Spiele reihum eine gleich hohe oder höhere Karte. Eine 2 darf immer gelegt werden, eine 3 ist durchsichtig, die 7 verlangt eine niedrige Karte, die 10 räumt den Stapel weg und der Bube setzt aus. Wenn du nicht legen kannst, nimmst du den ganzen Ablagestapel.</p><p>Start: 3 Handkarten, 3 offene und 3 verdeckte Karten. Sind die Handkarten leer, folgen die offenen und danach die verdeckten Karten einzeln.</p></div>}
        </aside>
      </section>
      <footer><span>SHITHAD</span><span>Lokaler Prototyp · Bereit für Multiplayer</span><span>v0.1.0</span></footer>
    </main>
  )
}

export default App
