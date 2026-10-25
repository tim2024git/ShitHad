import React, { useEffect, useRef, useState } from 'react'
import { Copy, Crown, HelpCircle, LogOut, Plus, Settings, Users, Wifi } from 'lucide-react'
import { canPlay, dealGame, effectiveTop, specialRule } from './game'

const opponents = [
  { name: 'Lena', initials: 'L', cards: 5, active: false, color: 'coral' },
  { name: 'Tom', initials: 'T', cards: 3, active: false, color: 'blue' },
  { name: 'Mika', initials: 'M', cards: 7, active: true, color: 'yellow' },
]

function Card({ rank, suit, faceDown = false, small = false, onClick, className = '' }) {
  return (
    <button className={`card ${faceDown ? 'card-back' : ''} ${small ? 'card-small' : ''} ${className}`} onClick={onClick}>
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
  const [phase, setPhase] = useState('home')
  const [game, setGame] = useState(null)
  const [selectedCard, setSelectedCard] = useState(null)
  const [showHelp, setShowHelp] = useState(false)
  const [copied, setCopied] = useState(false)
  const [joinCode, setJoinCode] = useState('SH7HAD')
  const [playerName, setPlayerName] = useState('Du')
  const [connection, setConnection] = useState('offline')
  const [roomPlayers, setRoomPlayers] = useState([])
  const [connectionMessage, setConnectionMessage] = useState('')
  const [availableRooms, setAvailableRooms] = useState([])
  const [roomsLoading, setRoomsLoading] = useState(true)
  const socketRef = useRef(null)
  const [roomMode, setRoomMode] = useState('join')
  const [isConnecting, setIsConnecting] = useState(false)
  const [myPlayerId, setMyPlayerId] = useState(null)
  const [dealingStep, setDealingStep] = useState(0)
  const dealingTimerRef = useRef(null)
  const roomStateRef = useRef(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const playerIndex = game?.players.findIndex((entry) => entry.id === myPlayerId) ?? 0
  const player = game?.players[playerIndex >= 0 ? playerIndex : 0]
  const topCard = game ? effectiveTop(game.discardPile) : null
  const currentTurnName = game?.currentPlayer === playerIndex
    ? playerName
    : roomPlayers[game?.currentPlayer]?.name ?? game?.players[game?.currentPlayer]?.name ?? 'Nächster Spieler'
  const isPlayable = game?.currentPlayer === playerIndex && selectedCard !== null && canPlay(player?.hand[selectedCard], game.discardPile)
  const isHost = roomPlayers.find((roomPlayer) => roomPlayer.id === myPlayerId)?.host === true
  const dealingPlayerCount = Math.max(3, Math.min(6, roomPlayers.length || 3))
  const dealingTarget = dealingStep % dealingPlayerCount
  const dealingRound = Math.floor(dealingStep / dealingPlayerCount)
  const seatColors = ['purple', 'coral', 'blue', 'yellow', 'coral', 'blue']
  const leaveRoom = async () => {
    if (joinCode && myPlayerId && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'leave', roomCode: joinCode, playerId: myPlayerId, name: playerName }),
      }).catch(() => {})
    }
    window.clearInterval(dealingTimerRef.current)
    if (typeof socketRef.current === 'number') window.clearInterval(socketRef.current)
    else socketRef.current?.close()
    localStorage.removeItem('shithad-session')
    setPhase('home')
    setGame(null)
    setRoomPlayers([])
    setMyPlayerId(null)
    setConnection('offline')
    setConnectionMessage('')
  }

  const loadRooms = async () => {
    try {
      const response = await fetch('/api/rooms')
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message ?? 'Räume konnten nicht geladen werden.')
      setAvailableRooms(payload.rooms ?? [])
      setConnectionMessage('')
    } catch (error) {
      setConnectionMessage(error.message)
    } finally {
      setRoomsLoading(false)
    }
  }

  const beginDealing = (startedAt) => {
    if (phaseRef.current === 'dealing' || phaseRef.current === 'game') return
    const playerCount = Math.max(3, Math.min(6, roomPlayers.length || 3))
    const totalSteps = playerCount * 9
    const elapsedSteps = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 650))
    let step = Math.min(totalSteps, elapsedSteps)
    setGame(dealGame(playerCount, startedAt, roomPlayers))
    setDealingStep(step)
    setPhase(step >= totalSteps ? 'game' : 'dealing')
    window.clearInterval(dealingTimerRef.current)
    dealingTimerRef.current = window.setInterval(() => {
      step += 1
      setDealingStep(Math.min(step, totalSteps))
      if (step >= totalSteps) {
        window.clearInterval(dealingTimerRef.current)
        setPhase('game')
      }
    }, 650)
  }

  const applyRoomState = (payload) => {
    setJoinCode(payload.roomCode ?? joinCode)
    setRoomPlayers(payload.players ?? [])
    if (payload.playerId) {
      setMyPlayerId(payload.playerId)
      localStorage.setItem('shithad-session', JSON.stringify({ roomCode: payload.roomCode, playerName, playerId: payload.playerId }))
    }
    roomStateRef.current = payload
    if (payload.gameState?.discardPile) {
      setGame((currentGame) => currentGame ? {
        ...currentGame,
        discardPile: payload.gameState.discardPile,
        currentPlayer: Math.max(0, (payload.players ?? []).findIndex((entry) => entry.id === payload.gameState.currentPlayerId)),
      } : currentGame)
    }
    if (payload.phase === 'dealing' && payload.startedAt) beginDealing(payload.startedAt)
  }

  const connectOnlineRoom = async (mode, requestedCode, restoredPlayerId = null) => {
      setIsConnecting(true)
      setConnection('connecting')
      setConnectionMessage('')
      try {
        const result = await fetch('/api/rooms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode, roomCode: requestedCode, name: playerName, playerId: restoredPlayerId }),
        })
        const payload = await result.json()
        if (!result.ok) throw new Error(payload.message ?? 'Raum konnte nicht geöffnet werden.')
        applyRoomState(payload)
        setConnection('connected')
        setPhase('lobby')
        window.clearInterval(socketRef.current)
        socketRef.current = window.setInterval(async () => {
          const state = await fetch(`/api/rooms?roomCode=${encodeURIComponent(payload.roomCode)}&playerId=${encodeURIComponent(payload.playerId ?? myPlayerId ?? '')}`)
          if (state.ok) applyRoomState(await state.json())
        }, 2000)
      } catch (error) {
        setConnection('offline')
        setConnectionMessage(error.message)
    } finally {
        setIsConnecting(false)
      }
  }

  const connectRoom = (mode = roomMode, requestedCode = joinCode) => {
    if (typeof socketRef.current === 'number') window.clearInterval(socketRef.current)
    else socketRef.current?.close()
    const configuredSocketUrl = import.meta.env.VITE_WS_URL
    if (!configuredSocketUrl && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    connectOnlineRoom(mode, requestedCode)
    return
    }

    const socketUrl = configuredSocketUrl
      ?? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:3001`
    const socket = new WebSocket(socketUrl)
    socketRef.current = socket
    setConnection('connecting')
    setConnectionMessage('')
    socket.addEventListener('open', () => socket.send(JSON.stringify({
      type: mode === 'create' ? 'room:create' : 'room:join',
      roomCode: requestedCode,
      name: playerName,
    })))
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.type === 'room:joined') {
        setMyPlayerId(message.playerId)
        if (message.roomCode) setJoinCode(message.roomCode)
        setConnection('connected')
        setPhase('lobby')
      }
      if (message.type === 'room:update') setRoomPlayers(message.players)
      if (message.type === 'error') {
        setConnection('offline')
        setConnectionMessage(message.message)
        socket.close()
      }
    })
    socket.addEventListener('error', () => {
      setConnection('offline')
      setConnectionMessage('Spielserver nicht erreichbar. Prüfe VITE_WS_URL in Vercel oder starte lokal npm run dev.')
    })
  }

  useEffect(() => () => {
    window.clearInterval(dealingTimerRef.current)
    if (typeof socketRef.current === 'number') window.clearInterval(socketRef.current)
    else socketRef.current?.close()
    socketRef.current = null
  }, [])

  useEffect(() => {
    if (phase !== 'home') return undefined
    loadRooms()
    const roomsTimer = window.setInterval(loadRooms, 3000)
    return () => window.clearInterval(roomsTimer)
  }, [phase])

  useEffect(() => {
    const saved = localStorage.getItem('shithad-session')
    if (!saved) return undefined
    try {
      const session = JSON.parse(saved)
      setPlayerName(session.playerName)
      setJoinCode(session.roomCode)
      setMyPlayerId(session.playerId)
      connectOnlineRoom('join', session.roomCode, session.playerId)
    } catch {
      localStorage.removeItem('shithad-session')
    }
    return undefined
  }, [])

  const startGame = async () => {
    if (!isHost || !roomStateRef.current?.roomCode) return
    try {
      const result = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', roomCode: roomStateRef.current.roomCode, playerId: myPlayerId, name: playerName }),
      })
      const payload = await result.json()
      if (!result.ok) throw new Error(payload.message ?? 'Das Spiel konnte nicht gestartet werden.')
      applyRoomState(payload)
    } catch (error) {
      setConnectionMessage(error.message)
    }
  }

  const dealingLabel = () => {
    if (dealingRound < 3) return `Verdeckte Karte ${dealingRound + 1} von 3`
    if (dealingRound < 6) return `Offene Karte ${dealingRound - 2} von 3`
    return `Handkarte ${dealingRound - 5} von 3`
  }

  const dealtCardsForPlayer = (index) => {
    const completedRounds = Math.floor(dealingStep / dealingPlayerCount)
    const playersInCurrentRound = dealingStep % dealingPlayerCount
    return Math.min(9, completedRounds + (index < playersInCurrentRound ? 1 : 0))
  }

  const visibleCards = (cards, amount) => cards.slice(0, Math.max(0, Math.min(cards.length, amount)))

  const createRoom = () => {
    setRoomMode('create')
    connectRoom('create', '')
  }

  const playCard = () => {
    if (!isPlayable) return
    const card = player.hand[selectedCard]
    const remainingHand = player.hand.filter((_, index) => index !== selectedCard)
    const nextDrawPile = [...game.drawPile]
    while (remainingHand.length < 3 && nextDrawPile.length && card.value !== 10) remainingHand.push(nextDrawPile.pop())
    const nextPlayerIndex = (game.currentPlayer + (card.value === 11 ? 2 : 1)) % game.players.length
    const updatedPlayers = game.players.map((entry, index) => index === playerIndex ? { ...entry, hand: remainingHand } : entry)
    setGame({
      ...game,
      players: updatedPlayers,
      drawPile: nextDrawPile,
      discardPile: card.value === 10 ? [] : [...game.discardPile, card],
      currentPlayer: nextPlayerIndex,
    })
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'play',
          roomCode: joinCode,
          playerId: myPlayerId,
          nextPlayerId: roomPlayers[nextPlayerIndex]?.id ?? game.players[nextPlayerIndex]?.id,
          card,
          players: updatedPlayers.map((entry) => ({ id: entry.id, name: entry.name, host: entry.host, lastSeen: new Date().toISOString() })),
        }),
      }).catch((error) => setConnectionMessage(error.message))
    }
    setSelectedCard(null)
  }

  const copyRoom = async () => {
    try {
      await navigator.clipboard.writeText(joinCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
  }

  if (phase === 'home') {
    return (
      <main className="app-shell start-screen">
        <div className="start-card">
          <div className="brand start-brand"><span className="brand-mark">S</span><span>shithad</span></div>
          <span className="eyebrow">DAS KARTENSPIEL</span>
          <h1>Bereit für eine Runde?</h1>
          <p className="start-copy">Erstelle einen Raum oder tritt mit deinen Freunden bei. Alle sitzen gemeinsam am Tisch.</p>
          <div className="start-form">
            <label>Dein Name<input value={playerName} onChange={(event) => setPlayerName(event.target.value)} placeholder="z. B. Alex" maxLength={20} /></label>
            <div className="room-list">
              <div className="room-list-header"><span>Offene Räume</span><button className="refresh-rooms" onClick={loadRooms}>Aktualisieren</button></div>
              {roomsLoading ? <p className="room-empty">Räume werden geladen …</p> : availableRooms.length === 0 ? <p className="room-empty">Noch keine Räume vorhanden.</p> : availableRooms.map((room) => <div className="room-row" key={room.roomCode}><div><strong>Spielraum</strong><span>{room.players.length}/6 Spieler · {room.phase === 'lobby' ? 'Wartet auf Spieler' : 'Spiel läuft'}</span></div><button className="join-room-button" disabled={isConnecting || room.players.length >= 6 || room.phase !== 'lobby'} onClick={() => { setJoinCode(room.roomCode); connectRoom('join', room.roomCode) }}>{room.phase !== 'lobby' ? 'Läuft' : room.players.length >= 6 ? 'Voll' : 'Beitreten'}</button></div>)}
            </div>
            <div className="start-actions"><button className="secondary-action" disabled={isConnecting} onClick={createRoom}>{isConnecting ? 'Bitte warten …' : 'Raum erstellen'}</button></div>
          </div>
          {connectionMessage && <p className="connection-error">{connectionMessage}</p>}
          <span className="start-note">Offene Räume · bis zu 6 Spieler pro Raum</span>
        </div>
      </main>
    )
  }

  if (phase === 'lobby') {
    const seatedPlayers = roomPlayers.length ? roomPlayers : [{ id: 'local', name: playerName }]
    return (
      <main className="app-shell lobby-screen">
        <div className="lobby-header"><div className="brand"><span className="brand-mark">S</span><span>shithad</span></div><div className="lobby-header-actions"><span className="room-pill">Raum <strong>{joinCode}</strong> · {connection === 'connected' ? 'Verbunden' : 'Verbinde …'}</span><button className="leave-button lobby-leave-button" onClick={leaveRoom}><LogOut size={16} /> Verlassen</button></div></div>
        <section className="lobby-card">
          <span className="eyebrow">SPIELRAUM</span>
          <h1>Setzt euch an den Tisch</h1>
          <p className="start-copy">Warte, bis alle da sind. Wenn ihr bereit seid, startet die Runde.</p>
          <div className="lobby-table">
            <div className="lobby-table-center"><span className="brand-mark">S</span><span>SHITHAD</span></div>
            {seatedPlayers.map((seatedPlayer, index) => <div className={`seat seat-position-${index}`} key={seatedPlayer.id}><Avatar player={{ initials: seatedPlayer.name.slice(0, 1).toUpperCase(), color: index === 0 ? 'purple' : opponents[(index - 1) % opponents.length].color }} /><strong>{seatedPlayer.name}</strong>{seatedPlayer.host && <span className="host-label">Host · teilt aus</span>}</div>)}
          </div>
          <div className="lobby-footer"><span><span className="live-dot" /> {seatedPlayers.length}/6 am Tisch</span>{isHost ? <button className="primary-action" disabled={phase === 'dealing' || seatedPlayers.length < 3} onClick={startGame}>{phase === 'dealing' ? 'Karten werden ausgeteilt …' : seatedPlayers.length < 3 ? 'Mindestens 3 Spieler' : 'Spiel starten'}</button> : <span className="waiting-host">Warte auf den Host</span>}</div>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">S</span><span>shithad</span></div>
        <div className="room-status"><span className="live-dot" /> Raum <strong>{joinCode}</strong><button className="copy-button" onClick={copyRoom} aria-label="Raumcode kopieren"><Copy size={14} />{copied ? 'Kopiert' : 'Kopieren'}</button></div>
        <div className="top-actions">
          <button className="icon-button" onClick={() => setShowHelp(!showHelp)} aria-label="Spielregeln"><HelpCircle size={19} /></button>
          <button className="icon-button" aria-label="Einstellungen"><Settings size={19} /></button>
          <button className="leave-button" onClick={leaveRoom}><LogOut size={16} /> Verlassen</button>
        </div>
      </header>

      <section className="game-layout">
        <div className="table-wrap">
          <div className="table">
            <div className="table-texture" />
            {game.players.map((tablePlayer, index) => { const dealt = phase === 'dealing' ? dealtCardsForPlayer(index) : 9; return <div className={`player table-seat table-seat-${index}`} key={tablePlayer.id}><div className="table-player-info"><Avatar player={{ initials: tablePlayer.name.slice(0, 1).toUpperCase(), color: seatColors[index % seatColors.length] }} /><div><strong>{tablePlayer.name}</strong><span>{phase === 'dealing' ? `${dealt}/9 Karten` : `${tablePlayer.hand.length} Handkarten`}</span></div>{game.currentPlayer === index && phase !== 'dealing' && <span className="turn-chip">dran</span>}</div><div className="table-player-cards">{visibleCards(tablePlayer.faceDown, Math.min(3, dealt)).map((card) => <Card key={`down-${card.id}`} faceDown small className={phase === 'dealing' ? 'dealing-card' : ''} />)}{visibleCards(tablePlayer.faceUp, Math.max(0, Math.min(3, dealt - 3))).map((card) => <Card key={card.id} {...card} small className={phase === 'dealing' ? 'dealing-card' : ''} />)}</div></div> })}

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

            <div className="table-message"><span className="message-dot" /> {phase === 'dealing' ? `${dealingLabel()} · ${roomPlayers[dealingTarget]?.name ?? game.players[dealingTarget]?.name ?? ''}` : `${currentTurnName} ist dran`}</div>
          </div>

          <div className={`your-area ${phase === 'dealing' ? 'your-area-dealing' : ''}`}>
            <div className="your-heading"><div className="your-player"><Avatar player={{ initials: playerName.slice(0, 1).toUpperCase(), color: 'purple' }} /><div><strong>{playerName}</strong><span>{player.hand.length} Karten auf der Hand</span></div></div><span className="hint">Wähle eine Karte zum Ablegen</span></div>
            <div className="face-up-row">
              <span className="row-label">Deine offenen Karten</span>
              <div className="cards-row">{visibleCards(player.faceUp, phase === 'dealing' ? Math.max(0, Math.min(3, dealtCardsForPlayer(playerIndex) - 3)) : 3).map((card) => <Card key={card.id} {...card} small />)}</div>
            </div>
            <div className="face-down-row">
              <span className="row-label">Deine verdeckten Karten</span>
              <div className="cards-row">{visibleCards(player.faceDown, phase === 'dealing' ? Math.min(3, dealtCardsForPlayer(playerIndex)) : 3).map((card) => <Card key={card.id} faceDown small />)}</div>
            </div>
            <div className="hand-row"><span className="row-label">Handkarten</span><div className="cards-row">{visibleCards(player.hand, phase === 'dealing' ? Math.max(0, Math.min(3, dealtCardsForPlayer(playerIndex) - 6)) : 3).map((card, index) => <Card key={card.id} {...card} onClick={() => setSelectedCard(index)} />)}</div></div>
            {selectedCard !== null && <button className="play-button" disabled={!isPlayable} onClick={playCard}>{isPlayable ? 'Karte ablegen' : 'Nicht spielbar'}</button>}
          </div>
        </div>

      </section>
      <footer><span>SHITHAD</span><span>Lokaler Prototyp · Bereit für Multiplayer</span><span>v0.1.0</span></footer>
    </main>
  )
}

export default App
