import { useRef, useEffect, useState } from 'react'
import { Chess } from 'chess.js'
import type { Move as ChessMove, Square } from 'chess.js'
import '@chrisoakman/chessboardjs/dist/chessboard-1.0.0.min.css'

interface BoardApi {
  position: (fen: string, useAnimation?: boolean) => void
  orientation?: (orientation?: 'white' | 'black' | 'flip') => 'white' | 'black'
  destroy?: () => void
  resize?: () => void
}

type PieceTheme = string | ((piece: string) => string)
type ThemeWindow = Window & {
  [key: string]: unknown
  $?: unknown
  jQuery?: unknown
  Chessboard?: (elementOrId: string | HTMLElement, config: unknown) => BoardApi
}

type BoardColor = 'w' | 'b'
type PromotionPiece = 'q' | 'r' | 'b' | 'n'

interface PlayedMove {
  from: string
  to: string
  san: string
  promotion?: PromotionPiece
}

interface PgnImportPayload {
  id: number
  text: string
}

interface JumpToPlyPayload {
  id: number
  ply: number
}

interface PendingPromotion {
  source: Square
  target: Square
  options: PromotionPiece[]
}

type boardProps = {
  importPgn?: PgnImportPayload
  jumpToPly?: JumpToPlyPayload

  onMovesUpdated: (moves: string[]) => void
  onPgnImportStatus: (payload: {
    ok: boolean
    message: string
  }) => void
  onPositionUpdated: (fen: string) => void
  onPgnUpdated: (pgn: string) => void
}

const THEME_SCRIPT_ID = 'chessboardjs-themes-script'
const THEME_SCRIPT_SRC = '/vendor/chessboardjs-themes.js'
const PIECE_THEME_GLOBALS = ['uscf_theme', 'uscf_piece_theme']
const BOARD_THEME_GLOBAL = 'uscf_board_theme'

const getPieceTheme = (globalWindow: ThemeWindow) => {
  for (const key of PIECE_THEME_GLOBALS) {
    const value = globalWindow[key]
    if (typeof value === 'string' || typeof value === 'function') {
      return value as PieceTheme
    }
  }
  return null
}

const getBoardTheme = (globalWindow: ThemeWindow) => {
  const value = globalWindow[BOARD_THEME_GLOBAL]
  return value ?? null
}

const ChessBoard = ({
  importPgn,
  jumpToPly,
  onMovesUpdated,
  onPgnImportStatus,
  onPositionUpdated,
  onPgnUpdated
  }: boardProps) => {

  const boardContainerEl = useRef<HTMLElement | null>(null)
  const boardEl = useRef<HTMLElement | null>(null)
  const gameRef = useRef(new Chess())
  const boardRef = useRef<BoardApi | null>(null)
  const boardResizeObserverRef = useRef<ResizeObserver | null>(null)
  const selectedSourceSquareRef = useRef<Square | null>(null)
  const highlightedTargetSquaresRef = useRef<Square[]>([])
  const dragHoverSquareRef = useRef<Square | null>(null)
  const playedMovesRef = useRef<PlayedMove[]>([])
  const currentPlyRef = useRef(0)
  const pendingPromotionRef = useRef<PendingPromotion | null>(null)

  const [playedMoves, setPlayedMoves] = useState<PlayedMove[]>([])
  const [currentPly, setCurrentPlyState] = useState(0)
  const [boardOrientation, setBoardOrientationState] = useState<'white' | 'black'>('white')
  const [pendingPromotion, setPendingPromotionState] = useState<PendingPromotion | null>(null)
  const game = gameRef.current

  const setPlayedMovesState = (nextMoves: PlayedMove[]) => {
    playedMovesRef.current = nextMoves
    setPlayedMoves(nextMoves)
  }

  const setCurrentPly = (nextPly: number) => {
    currentPlyRef.current = nextPly
    setCurrentPlyState(nextPly)
  }

  const setBoardOrientation = (nextOrientation: 'white' | 'black') => {
    setBoardOrientationState(nextOrientation)
  }

  const setPendingPromotion = (nextPromotion: PendingPromotion | null) => {
    pendingPromotionRef.current = nextPromotion
    setPendingPromotionState(nextPromotion)
  }

  const onWindowResize = () => {
    boardRef.current?.resize?.()
  }

  const applyBoardTheme = (theme: unknown) => {
  if (!boardEl.current) return

  const [light, dark] = Array.isArray(theme) ? theme : []
  const lightColor = typeof light === 'string' ? light : null
  const darkColor = typeof dark === 'string' ? dark : null

  if (!lightColor || !darkColor) {
    boardEl.current.style.removeProperty('--board-light-square')
    boardEl.current.style.removeProperty('--board-dark-square')
    boardEl.current.style.removeProperty('--board-light-notation')
    boardEl.current.style.removeProperty('--board-dark-notation')
    return
  }

  boardEl.current.style.setProperty('--board-light-square', lightColor)
  boardEl.current.style.setProperty('--board-dark-square', darkColor)
  boardEl.current.style.setProperty('--board-light-notation', darkColor)
  boardEl.current.style.setProperty('--board-dark-notation', lightColor)
}

const ensureThemeLibrary = async () => {
  const existing = document.getElementById(THEME_SCRIPT_ID) as HTMLScriptElement | null
  if (existing) {
    if (existing.dataset.loaded === 'true') return true
    await new Promise<void>((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Theme script failed to load.')), {
        once: true,
      })
    })
    return true
  }

  const script = document.createElement('script')
  script.id = THEME_SCRIPT_ID
  script.src = THEME_SCRIPT_SRC
  script.async = true
  script.dataset.loaded = 'false'

  const loaded = await new Promise<boolean>((resolve) => {
    script.onload = () => {
      script.dataset.loaded = 'true'
      resolve(true)
    }
    script.onerror = () => resolve(false)
    document.head.appendChild(script)
  })

  return loaded
}

const syncBoardToCursor = () => {
  setPendingPromotion(null)
  clearSelectedSquare()
  game.reset()
  for (let i = 0; i < currentPlyRef.current; i += 1) {
    const move = playedMovesRef.current[i]
    if (!move) break
    game.move(move)
  }

  boardRef.current?.position(game.fen(), false)
}

const isBoardSquare = (value: string): value is Square => /^[a-h][1-8]$/.test(value)

const getSquareElement = (square: Square) => {
  if (!boardEl.current) return null
  return boardEl.current.querySelector(`[data-square="${square}"]`) as HTMLElement | null
}

const clearLegalTargetSquares = () => {
  for (const square of highlightedTargetSquaresRef.current) {
    getSquareElement(square)?.classList.remove('legal-target')
  }
  highlightedTargetSquaresRef.current = []
}

const clearDragHoverSquare = () => {
  if (!dragHoverSquareRef.current) return
  getSquareElement(dragHoverSquareRef.current)?.classList.remove('drag-legal-target')
  dragHoverSquareRef.current = null
}

const isPromotionPiece = (value: string | undefined): value is PromotionPiece => {
  return value === 'q' || value === 'r' || value === 'b' || value === 'n'
}

const getLegalMovesFromSquare = (source: Square) => {
  return game.moves({ square: source, verbose: true }) as ChessMove[]
}

const setLegalTargetSquares = (source: Square) => {
  clearLegalTargetSquares()
  const targets = new Set<Square>()
  for (const move of getLegalMovesFromSquare(source)) {
    targets.add(move.to)
  }
  highlightedTargetSquaresRef.current = [...targets]
  for (const square of highlightedTargetSquaresRef.current) {
    getSquareElement(square)?.classList.add('legal-target')
  }
}

const getPromotionOptions = (source: Square, target: Square): PromotionPiece[] => {
  const promotionMoves = getLegalMovesFromSquare(source).filter(
    (move) => move.to === target && isPromotionPiece(move.promotion),
  )
  if (!promotionMoves.length) return []
  const promotionOrder: PromotionPiece[] = ['q', 'r', 'b', 'n']
  const available = new Set<PromotionPiece>(
    promotionMoves.map((move) => move.promotion as PromotionPiece),
  )
  return promotionOrder.filter((piece) => available.has(piece))
}

const clearSelectedSquare = () => {
  clearLegalTargetSquares()
  clearDragHoverSquare()
  if (!selectedSourceSquareRef.current) return
  getSquareElement(selectedSourceSquareRef.current)?.classList.remove('click-selected')
  selectedSourceSquareRef.current = null
}

const selectSquare = (square: Square) => {
  clearSelectedSquare()
  selectedSourceSquareRef.current = square
  getSquareElement(square)?.classList.add('click-selected')
  setLegalTargetSquares(square)
}

const squareFromEventTarget = (target: EventTarget | null): Square | null => {
  if (!(target instanceof Element)) return null
  const squareEl = target.closest('.square-55d63')
  if (!(squareEl instanceof HTMLElement)) return null
  if (!boardEl.current?.contains(squareEl)) return null
  const square = squareEl.dataset.square ?? null
  return square && isBoardSquare(square) ? square : null
}
  
  const handleMovesUpdated = () => {
    onMovesUpdated(playedMovesRef.current.map((playedMove) => playedMove.san))
  }

  const handlePositionUpdated = () => {
    onPositionUpdated(game.fen());
  }

  const handlePgnUpdated = () => {
    onPgnUpdated(game.pgn());
  }

  const handlePgnImportStatus = (payload: { ok: boolean; message: string }) => {
    onPgnImportStatus(payload);
  }

  const syncAndEmitPosition = () => {
    syncBoardToCursor()
    handlePositionUpdated()
    handlePgnUpdated()
  }

  const setPly = (nextPly: number) => {
    const clampedPly = Math.max(0, Math.min(nextPly, playedMovesRef.current.length))
    if (clampedPly === currentPlyRef.current) return false
    setCurrentPly(clampedPly)
    syncAndEmitPosition()
    return true
  }

  const applyMove = (source: Square, target: Square, promotion?: PromotionPiece) => {
    let move: ChessMove
    try {
      move = game.move({
        from: source,
        to: target,
        promotion,
      }) as ChessMove
    } catch {
      return false
    }

    const nextMoves =
      currentPlyRef.current < playedMovesRef.current.length
        ? playedMovesRef.current.slice(0, currentPlyRef.current)
        : [...playedMovesRef.current]

    nextMoves.push({
      from: source,
      to: target,
      san: move.san,
      promotion: move.promotion as PromotionPiece | undefined,
    })
    setPlayedMovesState(nextMoves)
    setCurrentPly(nextMoves.length)
    handleMovesUpdated()
    handlePositionUpdated()
    handlePgnUpdated()
    return true
  }

  const openPromotionPicker = (source: Square, target: Square, options: PromotionPiece[]) => {
    setPendingPromotion({ source, target, options })
  }

  const closePromotionPicker = () => {
    setPendingPromotion(null)
  }

  const resolveMoveAttempt = (source: Square, target: Square) => {
    const promotionOptions = getPromotionOptions(source, target)
    if (!promotionOptions.length) {
      const moved = applyMove(source, target)
      if (!moved) return false
      return true
    }
    openPromotionPicker(source, target, promotionOptions)
    return 'promotion'
  }

  const confirmPromotion = (piece: PromotionPiece) => {
    if (!pendingPromotionRef.current) return
    const { source, target, options } = pendingPromotionRef.current
    if (!options.includes(piece)) return
    const moved = applyMove(source, target, piece)
    closePromotionPicker()
    clearSelectedSquare()
    if (moved) {
      boardRef.current?.position(game.fen(), false)
    }
  }

  const cancelPromotion = () => {
    closePromotionPicker()
    clearSelectedSquare()
  }

  const promotionLabel = (piece: PromotionPiece) => {
    if (piece === 'q') return 'Queen'
    if (piece === 'r') return 'Rook'
    if (piece === 'b') return 'Bishop'
    return 'Knight'
  }

  const applyImportedPgn = (pgnText: string) => {
    const trimmed = pgnText.trim()
    if (!trimmed) {
      handlePgnImportStatus({ ok: false, message: 'Paste a PGN before importing.' })
      return
    }

    const importer = new Chess()
    try {
      importer.loadPgn(trimmed)
    } catch {
      handlePgnUpdated()
      handlePgnImportStatus({ ok: false, message: 'Invalid PGN. Please check the format.' })
      return
    }

    const verboseMoves = importer.history({ verbose: true })
    const nextMoves = verboseMoves.map((move) => ({
      from: move.from,
      to: move.to,
      san: move.san,
      promotion: move.promotion as PromotionPiece | undefined,
    }))
    setPlayedMovesState(nextMoves)
    setCurrentPly(nextMoves.length)
    syncBoardToCursor()
    handleMovesUpdated()
    handlePositionUpdated()
    handlePgnUpdated()
    handlePgnImportStatus({
      ok: true,
      message: `Imported ${nextMoves.length} move${nextMoves.length === 1 ? '' : 's'}.`,
    })
  }

  const isTypingElement = (target: EventTarget | null) => {
    const el = target as HTMLElement | null
    if (!el) return false
    const tag = el.tagName.toLowerCase()
    return tag === 'input' || tag === 'textarea' || el.isContentEditable
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (isTypingElement(event.target)) return

    if (event.key === 'ArrowLeft') {
      const moved = setPly(currentPlyRef.current - 1)
      if (moved) {
        event.preventDefault()
      }
      return
    }

    if (event.key === 'ArrowRight') {
      const moved = setPly(currentPlyRef.current + 1)
      if (moved) {
        event.preventDefault()
      }
    }
  }

  const goToStart = () => {
    setPly(0)
  }

  const goBack = () => {
    setPly(currentPlyRef.current - 1)
  }

  const goForward = () => {
    setPly(currentPlyRef.current + 1)
  }

  const goToEnd = () => {
    setPly(playedMovesRef.current.length)
  }

  const toggleBoardOrientation = () => {
    const next = boardRef.current?.orientation?.('flip')
    if (!next) return
    setBoardOrientation(next)
    clearSelectedSquare()
  }

  const onBoardPointerUp = (event: PointerEvent) => {
    if (!boardEl.current || !boardRef.current) return
    if (pendingPromotionRef.current) return
    const clickedSquare = squareFromEventTarget(event.target)
    if (!clickedSquare) {
      clearSelectedSquare()
      return
    }

    if (game.isGameOver()) {
      clearSelectedSquare()
      return
    }

    const clickedPiece = game.get(clickedSquare)
    const isOwnPiece = Boolean(clickedPiece && clickedPiece.color === game.turn())

    if (!selectedSourceSquareRef.current) {
      if (isOwnPiece) {
        selectSquare(clickedSquare)
      } else {
        clearSelectedSquare()
      }
      return
    }

    if (clickedSquare === selectedSourceSquareRef.current) {
      clearSelectedSquare()
      return
    }

    if (isOwnPiece) {
      selectSquare(clickedSquare)
      return
    }

    const moveResult = resolveMoveAttempt(selectedSourceSquareRef.current, clickedSquare)
    if (moveResult === true) {
      clearSelectedSquare()
      boardRef.current.position(game.fen(), false)
      return
    }
    if (moveResult === false) {
      clearSelectedSquare()
    }
  }

  const onGlobalPointerDown = (event: PointerEvent) => {
    if (!selectedSourceSquareRef.current) return
    const target = event.target
    if (!(target instanceof Node)) {
      clearSelectedSquare()
      return
    }
    if (!boardEl.current?.contains(target)) {
      clearSelectedSquare()
    }
  }

  const isLegalTargetForSource = (source: Square, target: Square) => {
    return getLegalMovesFromSquare(source).some((move) => move.to === target)
  }

  useEffect(() => {
    if (!boardEl.current) return
    let isMounted = true
    let boardElement: HTMLElement | null = null
    handleMovesUpdated()

    const initializeBoard = async () => {
      if (!boardEl.current) return

      // chessboard.js expects jQuery and exposes a global constructor.
      const jqueryModule = await import('jquery')
      const jquery = jqueryModule.default

      const globalWindow = window as unknown as ThemeWindow

      globalWindow.$ = jquery
      globalWindow.jQuery = jquery

      await import('@chrisoakman/chessboardjs/dist/chessboard-1.0.0.js')
      const themeLibraryLoaded = await ensureThemeLibrary()

      if (!isMounted || !boardEl.current || !globalWindow.Chessboard) return

      const onDragStart = (_source: string, piece: string) => {
        if (game.isGameOver()) return false

        const turn = game.turn() as BoardColor
        const pieceColor = piece[0] as BoardColor
        const canDrag = turn === pieceColor
        if (canDrag) {
          clearSelectedSquare()
        }
        return canDrag
      }

      const onDrop = (source: string, target: string) => {
        clearDragHoverSquare()
        // Cancel if user drops outside the board or back on the origin square.
        if (!isBoardSquare(source)) return 'snapback'
        if (target === 'offboard') {
          clearSelectedSquare()
          return 'snapback'
        }

        if (source === target) {
          const clickedPiece = game.get(source)
          if (clickedPiece && clickedPiece.color === game.turn()) {
            selectSquare(source)
          } else {
            clearSelectedSquare()
          }
          return 'snapback'
        }

        if (!isBoardSquare(source) || !isBoardSquare(target)) return 'snapback'
        const moveResult = resolveMoveAttempt(source, target)
        if (moveResult === 'promotion') return 'snapback'
        if (moveResult !== true) return 'snapback'
        clearSelectedSquare()

        return undefined
      }

      const onDragMove = (location: string, _prev: string, source: string) => {
        clearDragHoverSquare()
        if (!isBoardSquare(location) || !isBoardSquare(source)) return
        if (!isLegalTargetForSource(source, location)) return
        dragHoverSquareRef.current = location
        getSquareElement(location)?.classList.add('drag-legal-target')
      }

      const activePieceTheme = getPieceTheme(globalWindow)
      const activeBoardTheme = getBoardTheme(globalWindow)
      applyBoardTheme(activeBoardTheme)

      const boardConfig: Record<string, unknown> = {
        draggable: true,
        onDragStart,
        onDragMove,
        onDrop,
        onSnapEnd: () => boardRef.current?.position(game.fen(), false),
        position: 'start',
        showNotation: true,
        pieceTheme: activePieceTheme || '/chesspieces/wikipedia/{piece}.png',
      }

      if (activeBoardTheme != null) {
        boardConfig.boardTheme = activeBoardTheme
      }

      if (!themeLibraryLoaded) {
        console.warn(`Theme library not found at ${THEME_SCRIPT_SRC}; using default board assets.`)
      } else if (!activePieceTheme) {
        console.warn(`Theme globals not found (${PIECE_THEME_GLOBALS.join(', ')}); using defaults.`)
      }

      boardElement = boardEl.current
      boardRef.current = globalWindow.Chessboard(boardEl.current, boardConfig)
      const initialOrientation = boardRef.current.orientation?.()
      if (initialOrientation) {
        setBoardOrientation(initialOrientation)
      }
      requestAnimationFrame(() => {
        boardRef.current?.resize?.()
      })

      window.addEventListener('resize', onWindowResize)

      if (typeof ResizeObserver !== 'undefined' && boardContainerEl.current) {
        boardResizeObserverRef.current = new ResizeObserver(() => {
          boardRef.current?.resize?.()
        })
        boardResizeObserverRef.current.observe(boardContainerEl.current)
      }

      if (importPgn?.text) {
        applyImportedPgn(importPgn.text)
      } else {
        handlePositionUpdated()
        handlePgnUpdated()
      }

      boardEl.current.addEventListener('pointerup', onBoardPointerUp)
      window.addEventListener('pointerdown', onGlobalPointerDown)
      window.addEventListener('keydown', onKeyDown)
    }

    void initializeBoard()

    return () => {
      isMounted = false
      clearSelectedSquare()
      boardElement?.removeEventListener('pointerup', onBoardPointerUp)
      window.removeEventListener('pointerdown', onGlobalPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onWindowResize)
      boardResizeObserverRef.current?.disconnect()
      boardResizeObserverRef.current = null
      boardRef.current?.destroy?.()
      boardRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!importPgn || !boardRef.current) return

    applyImportedPgn(importPgn.text)
  }, [importPgn?.id])

  useEffect(() => {
    if (!jumpToPly || !boardRef.current) return

    setPly(jumpToPly.ply)
  }, [jumpToPly?.id])

  return (
    <section ref={boardContainerEl} className="chess-board">
      <div className="board-stage">
        <div ref={boardEl} className="board-root"></div>
          {pendingPromotion && (
            <div className="promotion-overlay">
              <div className="promotion-picker" role="dialog" aria-label="Choose promotion piece">
                <p className="promotion-title">Promote to:</p>
                <div className="promotion-options">
                  {pendingPromotion.options.map((piece: PromotionPiece) => (
                    <button
                      key={piece}
                      type="button"
                      onClick={() => confirmPromotion(piece)}
                    >
                      {promotionLabel(piece)}
                    </button>
                  ))}
                </div>
                <button type="button" className="promotion-cancel" onClick={cancelPromotion}>
                  Cancel
                </button>
              </div>
            </div>
          )}
      </div>
      <nav className="board-nav" aria-label="Move navigation">
        <button
          type="button"
          className="flip-button"
          title={boardOrientation === 'white' ? 'View from Black side' : 'View from White side'}
          onClick={toggleBoardOrientation}
        >
          Flip
        </button>
        <div className="nav-arrows">
        <button
          type="button"
          disabled={currentPly === 0}
          aria-label="Go to first move"
          title="Go to first move"
          onClick={goToStart}
        >
          <span aria-hidden="true">&lt;&lt;</span>
        </button>
        <button
          type="button"
          disabled={currentPly === 0}
          aria-label="Go to previous move"
          title="Go to previous move (Left Arrow)"
          onClick={goBack}
        >
          <span aria-hidden="true">&lt;</span>
        </button>
        <button
          type="button"
          disabled={currentPly >= playedMoves.length}
          aria-label="Go to next move"
          title="Go to next move (Right Arrow)"
          onClick={goForward}
        >
          <span aria-hidden="true">&gt;</span>
        </button>
        <button
          type="button"
          disabled={currentPly >= playedMoves.length}
          aria-label="Go to last move"
          title="Go to last move"
          onClick={goToEnd}
        >
          <span aria-hidden="true">&gt;&gt;</span>
        </button>
        </div>
      </nav>
    </section>
  )
}

export default ChessBoard

