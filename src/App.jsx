import React, { useEffect, useRef, useState } from 'react'
import { Copy, Crown, HelpCircle, LogOut, Plus, Settings, Users, Wifi } from 'lucide-react'
import { activeCardZone, canPlay, dealGame, specialRule } from './game'

const opponents = [
  { name: 'Lena', initials: 'L', cards: 5, active: false, color: 'coral' },
  { name: 'Tom', initials: 'T', cards: 3, active: false, color: 'blue' },
  { name: 'Mika', initials: 'M', cards: 7, active: true, color: 'yellow' },
]

const randomPlayerName = () => {
  const names = ['Alex', 'Sam', 'Max', 'Mika', 'Luca', 'Nico', 'Toni', 'Jona']
  return `${names[Math.floor(Math.random() * names.length)]}${Math.floor(100 + Math.random() * 900)}`
}

function Card({ rank, suit, faceDown = false, small = false, onClick, className = '', extraProps = {} }) {
  return (
    <button className={`card ${faceDown ? 'card-back' : ''} ${small ? 'card-small' : ''} ${className}`} onClick={onClick} {...extraProps}>
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
  const [animatingCard, setAnimatingCard] = useState(null)
  const [showHelp, setShowHelp] = useState(false)
  const [copied, setCopied] = useState(false)
  const [joinCode, setJoinCode] = useState('SH7HAD')
  const [playerName, setPlayerName] = useState(randomPlayerName)
  const [connection, setConnection] = useState('offline')
  const [roomPlayers, setRoomPlayers] = useState([])
  const [connectionMessage, setConnectionMessage] = useState('')
  const [availableRooms, setAvailableRooms] = useState([])
  const [roomsLoading, setRoomsLoading] = useState(true)
  const socketRef = useRef(null)
  const [roomMode, setRoomMode] = useState('join')
  const [isConnecting, setIsConnecting] = useState(false)
  const [myPlayerId, setMyPlayerId] = useState(null)
  const myPlayerIdRef = useRef(null)
  const [dealingStep, setDealingStep] = useState(0)
  const dealingTimerRef = useRef(null)
  const roomStateRef = useRef(null)
  const pollInFlightRef = useRef(false)
  const gameRevisionRef = useRef(-1)
  const playInFlightRef = useRef(false)
  const swapBusyRef = useRef(false)
  const dragRef = useRef(null)
  const [swapSelection, setSwapSelection] = useState(null)
  const [dragState, setDragState] = useState(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const playerIndex = game?.players.findIndex((entry) => entry.id === myPlayerId) ?? -1
  const player = game?.players[playerIndex]
  const topCard = game?.discardPile.at(-1) ?? null
  const turnZone = activeCardZone(player)
  const isMyTurn = phase === 'game' && game?.currentPlayer === playerIndex && !game?.swapping && !game?.winnerId
  const turnCards = turnZone ? player?.[turnZone] ?? [] : []
  const hasPlayableTurnCard = turnZone === 'faceDown' || turnCards.some((card) => canPlay(card, game?.discardPile ?? []))
  const needsPickup = isMyTurn && ['hand', 'faceUp'].includes(turnZone) && game?.discardPile.length > 0 && !hasPlayableTurnCard
  const isSwapping = Boolean(game?.swapping) && phase === 'game'
  const iAmReady = Boolean(game?.ready?.[myPlayerId])
  const canSwap = isSwapping && Boolean(player) && !iAmReady
  const readyCount = Object.keys(game?.ready ?? {}).length
  const isHost = roomPlayers.find((roomPlayer) => roomPlayer.id === myPlayerId)?.host === true
  const dealingPlayerCount = Math.max(3, Math.min(6, roomPlayers.length || 3))
  const dealingTarget = dealingStep % dealingPlayerCount
  const dealingRound = Math.floor(dealingStep / dealingPlayerCount)
  const seatColors = ['purple', 'coral', 'blue', 'yellow', 'coral', 'blue']
  const leaveRoom = async () => {
    if (joinCode && myPlayerId) {
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
    gameRevisionRef.current = -1
    setAnimatingCard(null)
    setRoomPlayers([])
    setMyPlayerId(null)
    myPlayerIdRef.current = null
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

  const beginDealing = (startedAt, players = roomPlayers) => {
    if (phaseRef.current === 'dealing' || phaseRef.current === 'game') return
    const dealingPlayers = players.length ? players : roomPlayers
    const playerCount = Math.max(3, Math.min(6, dealingPlayers.length || 3))
    const totalSteps = playerCount * 9
    const elapsedSteps = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 650))
    let step = Math.min(totalSteps, elapsedSteps)
    setGame(dealGame(playerCount, startedAt, dealingPlayers))
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
    if (payload.phase === 'game' && phaseRef.current !== 'game') {
      window.clearInterval(dealingTimerRef.current)
      setDealingStep(dealingPlayerCount * 9)
      setPhase('game')
    }
    if (payload.playerId) {
      myPlayerIdRef.current = payload.playerId
      setMyPlayerId(payload.playerId)
      localStorage.setItem('shithad-session', JSON.stringify({ roomCode: payload.roomCode, playerName, playerId: payload.playerId }))
    }
    const gameRevision = Number(payload.gameState?.revision ?? 0)
    if (payload.gameState?.players && gameRevision >= gameRevisionRef.current) {
      gameRevisionRef.current = gameRevision
      setGame((currentGame) => {
        const baseGame = currentGame ?? dealGame(
          Math.max(3, Math.min(6, (payload.players ?? []).length || 3)),
          payload.startedAt ?? 'room',
          payload.players ?? [],
        )
        const serverPlayers = new Map(payload.gameState.players.map((entry) => [entry.id, entry]))
        return {
          ...baseGame,
          drawPile: payload.gameState.drawPile ?? baseGame.drawPile,
          players: baseGame.players.map((entry) => {
            const serverPlayer = serverPlayers.get(entry.id)
            return serverPlayer ? {
              ...entry,
              faceUp: serverPlayer.faceUp ?? entry.faceUp,
              faceDown: serverPlayer.faceDown ?? entry.faceDown,
              hand: serverPlayer.id === myPlayerIdRef.current
                ? (serverPlayer.hand ?? [])
                : entry.hand.slice(0, serverPlayer.handCount ?? entry.hand.length),
            } : entry
          }),
          discardPile: payload.gameState.discardPile ?? baseGame.discardPile,
          swapping: Boolean(payload.gameState.swapping),
          ready: payload.gameState.ready ?? {},
          currentPlayer: Math.max(0, baseGame.players.findIndex((entry) => entry.id === payload.gameState.currentPlayerId)),
        }
      })
    }
    roomStateRef.current = payload
    if (payload.phase === 'dealing' && payload.startedAt && phaseRef.current !== 'dealing') beginDealing(payload.startedAt, payload.players ?? [])
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
        setPhase(['game', 'finished'].includes(payload.phase) ? 'game' : payload.phase === 'dealing' ? 'dealing' : 'lobby')
        window.clearInterval(socketRef.current)
        socketRef.current = window.setInterval(async () => {
          if (pollInFlightRef.current) return
          pollInFlightRef.current = true
          try {
            const state = await fetch(`/api/rooms?roomCode=${encodeURIComponent(payload.roomCode)}&playerId=${encodeURIComponent(payload.playerId ?? myPlayerIdRef.current ?? '')}`)
            if (state.ok) applyRoomState(await state.json())
          } finally {
            pollInFlightRef.current = false
          }
        }, 1000)
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
    connectOnlineRoom(mode, requestedCode)
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
      const startedAt = new Date().toISOString()
      const initialGame = dealGame(Math.max(3, Math.min(6, roomPlayers.length || 3)), startedAt, roomPlayers)
      const result = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          roomCode: roomStateRef.current.roomCode,
          playerId: myPlayerId,
          name: playerName,
          startedAt,
          gamePlayers: initialGame.players,
          drawPile: initialGame.drawPile,
        }),
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

  const playCard = (zone, selection) => {
    const selected = zone === 'hand'
      ? player?.hand[selection]
      : player?.[zone]?.find((card) => card.id === selection)
    if (game?.swapping) return
    if (playInFlightRef.current || !game || !player || !selected || !isMyTurn || zone !== turnZone) return
    if (zone !== 'faceDown' && !canPlay(selected, game.discardPile)) return
    playInFlightRef.current = true
    if (zone !== 'faceDown') {
      setAnimatingCard({ ...selected, animationId: `${selected.id}-${Date.now()}` })
      window.setTimeout(() => setAnimatingCard(null), 520)
    }
    fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'play',
          roomCode: joinCode,
          playerId: myPlayerId,
          zone,
          cardId: selected.id,
        }),
      }).then(async (response) => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.message ?? 'Karte konnte nicht gelegt werden.')
        setConnectionMessage(payload.message ?? '')
        applyRoomState(payload)
      }).catch((error) => setConnectionMessage(error.message))
      .finally(() => {
        playInFlightRef.current = false
      })
  }

  const pickUpDiscard = () => {
    if (!needsPickup || playInFlightRef.current) return
    playInFlightRef.current = true
    fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pickup', roomCode: joinCode, playerId: myPlayerId }),
    }).then(async (response) => {
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message ?? 'Ablagestapel konnte nicht aufgenommen werden.')
      setConnectionMessage('')
      applyRoomState(payload)
    }).catch((error) => setConnectionMessage(error.message))
      .finally(() => {
        playInFlightRef.current = false
      })
  }

  const sendSwapAction = (body) => {
    if (swapBusyRef.current) return
    swapBusyRef.current = true
    setSwapSelection(null)
    fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode: joinCode, playerId: myPlayerId, ...body }),
    }).then(async (response) => {
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message ?? 'Aktion fehlgeschlagen.')
      setConnectionMessage('')
      applyRoomState(payload)
    }).catch((error) => setConnectionMessage(error.message))
      .finally(() => {
        swapBusyRef.current = false
      })
  }

  const swapCards = (zone, card, otherId) => {
    const handCardId = zone === 'hand' ? card.id : otherId
    const faceUpCardId = zone === 'faceUp' ? card.id : otherId
    sendSwapAction({ action: 'swap', handCardId, faceUpCardId })
  }

  const markReady = () => {
    if (canSwap) sendSwapAction({ action: 'ready' })
  }

  const swapCardProps = (zone, card) => !canSwap ? {} : {
    'data-swap-zone': zone,
    'data-swap-id': card.id,
    onPointerDown: (event) => {
      if (event.button > 0) return
      dragRef.current = { zone, card, startX: event.clientX, startY: event.clientY, moved: false }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    onPointerMove: (event) => {
      const drag = dragRef.current
      if (!drag || (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 8)) return
      drag.moved = true
      setDragState({ zone: drag.zone, card: drag.card, x: event.clientX, y: event.clientY })
    },
    onPointerUp: (event) => {
      const drag = dragRef.current
      dragRef.current = null
      setDragState(null)
      if (!drag) return
      if (drag.moved) {
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-swap-zone]')
        if (target && target.dataset.swapZone !== drag.zone) swapCards(drag.zone, drag.card, target.dataset.swapId)
        return
      }
      if (swapSelection && swapSelection.zone !== zone) swapCards(zone, card, swapSelection.id)
      else setSwapSelection(swapSelection?.id === card.id ? null : { zone, id: card.id })
    },
    onPointerCancel: () => {
      dragRef.current = null
      setDragState(null)
    },
  }

  const swapClass = (card) => !canSwap ? '' : `swap-card ${swapSelection?.id === card.id || dragState?.card.id === card.id ? 'swap-selected' : ''}`

  const isTurn = (index) => phase === 'game' && !game?.swapping && !game?.winnerId && game?.currentPlayer === index

  const cardStacks = (owner, dealt, dealing, own = false) => {
    const down = visibleCards(owner.faceDown, Math.min(3, dealt))
    const up = visibleCards(owner.faceUp, Math.max(0, Math.min(3, dealt - 3)))
    const dealingClass = dealing ? 'dealing-card' : ''
    return [0, 1, 2].map((slot) => (
      <div className="card-stack" key={`stack-${slot}`}>
        {down[slot] && <Card key={`down-${down[slot].id}`} faceDown small className={`stack-down ${dealingClass} ${own && isMyTurn && turnZone === 'faceDown' ? 'playable' : ''}`} onClick={own && isMyTurn && turnZone === 'faceDown' ? () => playCard('faceDown', down[slot].id) : undefined} />}
        {up[slot] && <Card key={`up-${up[slot].id}`} {...up[slot]} small className={`stack-up ${dealingClass} ${own ? swapClass(up[slot]) : ''} ${own && isMyTurn && turnZone === 'faceUp' && canPlay(up[slot], game.discardPile) ? 'playable' : ''}`} onClick={own && isMyTurn && turnZone === 'faceUp' && canPlay(up[slot], game.discardPile) ? () => playCard('faceUp', up[slot].id) : undefined} extraProps={own ? swapCardProps('faceUp', up[slot]) : {}} />}
      </div>
    ))
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
        <div className="room-status"><span className="live-dot" /> <span>Du bist <strong>{playerName}</strong></span><span className="header-room">Raum <strong>{joinCode}</strong></span><button className="copy-button" onClick={copyRoom} aria-label="Raumcode kopieren"><Copy size={14} />{copied ? 'Kopiert' : 'Kopieren'}</button></div>
        <div className="top-actions">
          <button className="icon-button" onClick={() => setShowHelp(!showHelp)} aria-label="Spielregeln"><HelpCircle size={19} /></button>
          <button className="icon-button" aria-label="Einstellungen"><Settings size={19} /></button>
          <button className="leave-button" onClick={leaveRoom}><LogOut size={16} /> Verlassen</button>
        </div>
      </header>

      {connectionMessage && <p className="connection-error" role="alert">{connectionMessage}</p>}
      <section className="game-layout">
        <div className="table-wrap">
          <div className="table">
            <div className="table-texture" />
            <div className="table-opponents">
            {game.players.filter((tablePlayer) => tablePlayer.id !== myPlayerId).map((tablePlayer, tableIndex) => { const index = game.players.findIndex((entry) => entry.id === tablePlayer.id); const dealt = phase === 'dealing' ? dealtCardsForPlayer(index) : 9; return <div className={`player table-seat table-opponent-seat table-opponent-${tableIndex} ${isTurn(index) ? 'is-turn' : ''}`} key={tablePlayer.id}><div className="table-player-info"><Avatar player={{ initials: tablePlayer.name.slice(0, 1).toUpperCase(), color: seatColors[index % seatColors.length] }} /><div><strong>{tablePlayer.name}</strong><span>{phase === 'dealing' ? `${dealt}/9 Karten` : `${tablePlayer.hand.length} Handkarten`}</span></div>{game.swapping && phase !== 'dealing' && game.ready?.[tablePlayer.id] && <span className="turn-chip">bereit</span>}</div><div className="table-player-cards">{cardStacks(tablePlayer, phase === 'dealing' ? dealt : 9, phase === 'dealing')}</div></div> })}
            </div>

            <div className="table-center">
              <div className="pile-area">
                <div className="pile-label"><span>Nachziehen</span><b>{game.drawPile.length}</b></div>
                <Card faceDown />
              </div>
              <div className="pile-area discard-area">
                <div className="pile-label"><span>Ablegen</span><b>{game.discardPile.length}</b></div>
                {topCard ? <Card rank={topCard.rank} suit={topCard.suit} /> : <div className="empty-discard-pile" aria-label="Ablagestapel leer" />}
              </div>
            </div>
            {animatingCard && <div className="played-card-animation"><Card rank={animatingCard.rank} suit={animatingCard.suit} /></div>}

            <div className={`bottom-hand-area ${player?.hand.length > 3 ? 'has-many-cards' : ''} ${isTurn(playerIndex) ? 'is-turn' : ''}`}>
              {player && visibleCards(player.hand, phase === 'dealing' ? Math.max(0, Math.min(3, dealtCardsForPlayer(playerIndex) - 6)) : player.hand.length).map((card, handIndex) => {
                const playable = isMyTurn && turnZone === 'hand' && canPlay(card, game.discardPile)
                return <Card key={`hand-${card.id}`} {...card} onClick={playable ? () => playCard('hand', handIndex) : undefined} className={`${phase === 'dealing' ? 'dealing-card' : ''} ${swapClass(card)} ${playable ? 'playable' : ''}`} extraProps={swapCardProps('hand', card)} />
              })}
            </div>
            <div className={`bottom-public-area ${isTurn(playerIndex) ? 'is-turn' : ''}`}>
              {player && cardStacks(player, phase === 'dealing' ? dealtCardsForPlayer(playerIndex) : 9, phase === 'dealing', true)}
            </div>
          </div>
          {isSwapping && (
            <div className="swap-bar">
              <span>{iAmReady ? `Warte auf die anderen Spieler … (${readyCount}/${game.players.length} bereit)` : 'Tausche Handkarten mit deinen offenen Karten per Drag & Drop (oder antippen). Dann auf Fertig drücken.'}</span>
              <button className="primary-action" disabled={iAmReady} onClick={markReady}>{iAmReady ? 'Bereit ✓' : 'Fertig'}</button>
            </div>
          )}
          {needsPickup && (
            <div className="turn-action-bar">
              <span>Keine deiner Karten ist spielbar. Nimm den Ablagestapel auf.</span>
              <button className="primary-action" onClick={pickUpDiscard}>Ablagestapel aufnehmen</button>
            </div>
          )}
          {isMyTurn && turnZone === 'faceDown' && (
            <div className="turn-action-bar"><span>Wähle eine verdeckte Karte. Sie muss passen.</span></div>
          )}
          {game.winnerId && (
            <div className="game-result" role="status">
              <strong>{game.winnerId === myPlayerId ? 'Du hast gewonnen!' : `${game.players.find((entry) => entry.id === game.winnerId)?.name ?? 'Ein Spieler'} hat gewonnen!`}</strong>
              <button className="leave-button" onClick={leaveRoom}><LogOut size={16} /> Verlassen</button>
            </div>
          )}

        </div>

      </section>
      {dragState && <div className="drag-ghost" style={{ left: dragState.x, top: dragState.y }}><Card rank={dragState.card.rank} suit={dragState.card.suit} small={dragState.zone === 'faceUp'} /></div>}
      <footer><span>SHITHAD</span><span>Lokaler Prototyp · Bereit für Multiplayer</span><span>v0.1.0</span></footer>
    </main>
  )
}

export default App
