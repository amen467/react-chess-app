import { useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { EngineEvaluation, MoveEvaluation } from '../types/chess'
import { createRequestLifecycle } from '../utils/requestLifecycle'
import stockfishWorkerUrl from 'stockfish/bin/stockfish-18-lite-single.js?url'
import stockfishWasmUrl from 'stockfish/bin/stockfish-18-lite-single.wasm?url'

interface AnalyzeOptions {
  depth?: number
  multiPv?: number
}

interface PendingAnalysis {
  requestId: number
  resolve: (value: EngineEvaluation) => void
  reject: (reason?: unknown) => void
}

const START_FEN = 'startpos'
const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const WORKER_STARTUP_TIMEOUT_MS = 15000
const ANALYSIS_TIMEOUT_MS = 45000
type AnalysisCancelReason =
  | 'timeout'
  | 'user'
  | 'stopped'
  | 'replaced'
  | 'shutdown'
  | 'worker-failure'

export function useStockfish() {
  const [isReady, setIsReadyState] = useState(false)
  const [isAnalyzing, setIsAnalyzingState] = useState(false)
  const [lastError, setLastErrorState] = useState<string | null>(null)
  const [bestLines, setBestLinesState] = useState<MoveEvaluation[]>([])
  const [evaluation, setEvaluationState] = useState<EngineEvaluation | null>(null)
  const isReadyRef = useRef(false)
  const isAnalyzingRef = useRef(false)
  const lastErrorRef = useRef<string | null>(null)
  const bestLinesRef = useRef<MoveEvaluation[]>([])
  const evaluationRef = useRef<EngineEvaluation | null>(null)
  const analysisLifecycleRef = useRef(createRequestLifecycle<AnalysisCancelReason>())
  const workerRef = useRef<Worker | null>(null)
  const readyPromiseRef = useRef<Promise<void> | null>(null)
  const readyResolverRef = useRef<(() => void) | null>(null)
  const readyRejecterRef = useRef<((reason?: unknown) => void) | null>(null)
  const workerStartupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sawUciOkRef = useRef(false)
  const pendingRef = useRef<PendingAnalysis | null>(null)
  const lastRequestedDepthRef = useRef(12)
  const currentAnalysisFenRef = useRef(INITIAL_FEN)
  const analysisLifecycle = analysisLifecycleRef.current

  const setIsReady = (value: boolean) => {
    isReadyRef.current = value
    setIsReadyState(value)
  }

  const setIsAnalyzing = (value: boolean) => {
    isAnalyzingRef.current = value
    setIsAnalyzingState(value)
  }

  const setLastError = (value: string | null) => {
    lastErrorRef.current = value
    setLastErrorState(value)
  }

  const setBestLines = (value: MoveEvaluation[]) => {
    bestLinesRef.current = value
    setBestLinesState(value)
  }

  const setEvaluation = (value: EngineEvaluation | null) => {
    evaluationRef.current = value
    setEvaluationState(value)
  }

  const post = (command: string) => {
    if (!workerRef.current) return
    workerRef.current.postMessage(command)
  }

  const resetAnalysis = () => {
    setBestLines([])
    setEvaluation(null)
  }

  const clearStartupTimeout = () => {
    if (workerStartupTimeoutRef.current === null) return
    clearTimeout(workerStartupTimeoutRef.current)
    workerStartupTimeoutRef.current = null
  }

  const resolveReadyState = () => {
    clearStartupTimeout()
    readyResolverRef.current?.()
    readyResolverRef.current = null
    readyRejecterRef.current = null
    readyPromiseRef.current = null
  }

  const rejectReadyState = (message: string) => {
    clearStartupTimeout()
    readyRejecterRef.current?.(new Error(message))
    readyResolverRef.current = null
    readyRejecterRef.current = null
    readyPromiseRef.current = null
  }

  const abortPendingAnalysis = (
    message: string,
    options: {
      persistError?: boolean
      stopAnalyzing?: boolean
      requestId?: number
    } = {},
  ) => {
    const { persistError = false, stopAnalyzing = true, requestId } = options
    if (stopAnalyzing) {
      setIsAnalyzing(false)
    }
    if (persistError) {
      setLastError(message)
    }
    if (pendingRef.current && (requestId == null || pendingRef.current.requestId === requestId)) {
      const pendingRequestId = pendingRef.current.requestId
      pendingRef.current.reject(new Error(message))
      pendingRef.current = null
      analysisLifecycle.end(pendingRequestId)
      return
    }

    if (requestId != null) {
      analysisLifecycle.end(requestId)
      return
    }

    analysisLifecycle.clear()
  }

  const terminateWorker = (sendQuit: boolean) => {
    if (!workerRef.current) return
    if (sendQuit) {
      try {
        workerRef.current.postMessage('quit')
      } catch {
        // Ignore worker post failures during teardown.
      }
    }
    workerRef.current.removeEventListener('message', handleWorkerMessage as EventListener)
    workerRef.current.removeEventListener('error', handleWorkerError)
    workerRef.current.terminate()
    workerRef.current = null
  }

  const failWorkerSession = (message: string) => {
    setIsReady(false)
    sawUciOkRef.current = false
    setLastError(message)
    rejectReadyState(message)
    if (analysisLifecycle.isActive()) {
      analysisLifecycle.cancel('worker-failure')
    } else {
      setIsAnalyzing(false)
      analysisLifecycle.clear()
    }
    terminateWorker(false)
  }

  const parseUciMove = (move: string) => {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) return null
    return {
      from: move.slice(0, 2),
      to: move.slice(2, 4),
      promotion: move[4] as 'q' | 'r' | 'b' | 'n' | undefined,
    }
  }

  const uciLineToSan = (fen: string, line: string[]) => {
    const replay = new Chess(fen)
    const sanLine: string[] = []

    for (const uciMove of line) {
      const parsed = parseUciMove(uciMove)
      if (!parsed) break

      const played = replay.move(parsed)
      if (!played) break
      sanLine.push(played.san)
    }

    return sanLine
  }

  const parseInfoLine = (line: string) => {
    if (!line.startsWith('info ')) return

    const depthMatch = line.match(/\bdepth (\d+)/)
    const pvMatch = line.match(/\bpv (.+)$/)
    const multipvMatch = line.match(/\bmultipv (\d+)/)
    const cpMatch = line.match(/\bscore cp (-?\d+)/)
    const mateMatch = line.match(/\bscore mate (-?\d+)/)

    if (!pvMatch || (!cpMatch && !mateMatch)) return

    const depth = depthMatch ? Number(depthMatch[1]) : lastRequestedDepthRef.current
    const multipv = multipvMatch ? Number(multipvMatch[1]) : 1
    const pv = pvMatch[1]
    if (!pv) return
    const pvMoves = pv.trim().split(/\s+/)
    const sanLine = uciLineToSan(currentAnalysisFenRef.current, pvMoves)
    const leadingMove = sanLine[0] ?? pvMoves[0] ?? ''

    const lineEval: MoveEvaluation = {
      san: leadingMove,
      score: cpMatch ? Number(cpMatch[1]) : Number(mateMatch?.[1] ?? 0),
      line: sanLine.length ? sanLine : pvMoves,
      isMate: Boolean(mateMatch),
    }

    const nextLines = [...bestLinesRef.current]
    const lineIndex = Math.max(multipv - 1, 0)
    nextLines[lineIndex] = lineEval
    const filteredLines = nextLines.filter((entry) => Boolean(entry))
    setBestLines(filteredLines)

    const principal = filteredLines[0] ?? null
    setEvaluation({
      centipawns: principal && !principal.isMate ? principal.score : null,
      mateIn: principal && principal.isMate ? principal.score : null,
      depth,
      bestMoves: filteredLines,
    })
  }

  const handleWorkerMessage = (event: MessageEvent<string>) => {
    const line = String(event.data ?? '').trim()
    if (!line) return

    if (line === 'uciok') {
      sawUciOkRef.current = true
      post('isready')
      return
    }

    if (line === 'readyok') {
      if (!sawUciOkRef.current) return
      setIsReady(true)
      setLastError(null)
      resolveReadyState()
      return
    }

    parseInfoLine(line)

    if (line.startsWith('bestmove')) {
      if (!pendingRef.current) return
      const activePending = pendingRef.current
      setIsAnalyzing(false)
      if (evaluationRef.current) {
        activePending.resolve(evaluationRef.current)
      } else {
        activePending.reject(new Error('Stockfish returned no evaluation.'))
      }
      pendingRef.current = null
      analysisLifecycle.end(activePending.requestId)
    }
  }

  const handleWorkerError = (event: ErrorEvent) => {
    const detail = event.message?.trim()
    const message = detail ? `Stockfish worker crashed: ${detail}` : 'Stockfish worker crashed.'
    failWorkerSession(message)
  }

  const createWorker = () => {
    const workerSource = `${stockfishWorkerUrl}#${encodeURIComponent(stockfishWasmUrl)}`
    workerRef.current = new Worker(workerSource)
    workerRef.current.addEventListener('message', handleWorkerMessage as EventListener)
    workerRef.current.addEventListener('error', handleWorkerError)

    readyPromiseRef.current = new Promise<void>((resolve, reject) => {
      readyResolverRef.current = resolve
      readyRejecterRef.current = reject
    })

    const timeoutSeconds = Math.round(WORKER_STARTUP_TIMEOUT_MS / 1000)
    workerStartupTimeoutRef.current = setTimeout(() => {
      failWorkerSession(`Stockfish startup timed out after ${timeoutSeconds}s.`)
    }, WORKER_STARTUP_TIMEOUT_MS)

    sawUciOkRef.current = false
    setIsReady(false)
    post('uci')
  }

  const ensureWorker = async () => {
    if (workerRef.current && isReadyRef.current) return

    if (!workerRef.current || !readyPromiseRef.current) {
      createWorker()
    }

    if (!readyPromiseRef.current) {
      throw new Error('Stockfish failed to create a startup session.')
    }
    await readyPromiseRef.current
  }

  const start = async () => {
    setLastError(null)
    await ensureWorker()
  }

  const cancellationHandlers: Record<
    AnalysisCancelReason,
    (requestId: number, timeoutSeconds: number) => void
  > = {
    timeout: (requestId, timeoutSeconds) => {
      post('stop')
      abortPendingAnalysis(`Analysis timed out after ${timeoutSeconds}s.`, {
        persistError: true,
        requestId,
      })
    },
    user: (requestId) => {
      post('stop')
      abortPendingAnalysis('Analysis canceled by user.', { requestId })
    },
    stopped: (requestId) => {
      post('stop')
      abortPendingAnalysis('Analysis stopped.', { requestId })
    },
    replaced: (requestId) => {
      post('stop')
      abortPendingAnalysis('Analysis replaced by a newer request.', {
        stopAnalyzing: false,
        requestId,
      })
    },
    shutdown: (requestId) => {
      abortPendingAnalysis('Stockfish engine stopped.', { requestId })
    },
    'worker-failure': (requestId) => {
      abortPendingAnalysis(lastErrorRef.current ?? 'Stockfish worker crashed.', { requestId })
    },
  }

  const analyzePosition = async (fen: string, options: AnalyzeOptions = {}) => {
    await start()
    resetAnalysis()
    setLastError(null)

    lastRequestedDepthRef.current = options.depth ?? 12
    const multiPv = options.multiPv ?? 3

    if (analysisLifecycle.isActive()) {
      analysisLifecycle.cancel('replaced')
    }

    setIsAnalyzing(true)
    const timeoutSeconds = Math.round(ANALYSIS_TIMEOUT_MS / 1000)
    let requestId = 0
    requestId = analysisLifecycle.begin(() => {
      const cancelReason = analysisLifecycle.getCancelReason()
      if (cancelReason) {
        cancellationHandlers[cancelReason](requestId, timeoutSeconds)
        return
      }

      abortPendingAnalysis('Analysis request canceled.', { requestId })
    })

    const analysisPromise = new Promise<EngineEvaluation>((resolve, reject) => {
      pendingRef.current = { requestId, resolve, reject }
    })
    analysisLifecycle.scheduleTimeout(requestId, ANALYSIS_TIMEOUT_MS, 'timeout', () => {
      analysisLifecycle.cancel('timeout')
    })

    const position = fen.trim() ? `fen ${fen}` : START_FEN
    currentAnalysisFenRef.current = fen.trim() || INITIAL_FEN
    post('stop')
    post('ucinewgame')
    post(`position ${position}`)
    post(`setoption name MultiPV value ${multiPv}`)
    post(`go depth ${lastRequestedDepthRef.current}`)

    return analysisPromise
  }

  const cancelAnalysis = () => {
    if (!analysisLifecycle.isActive() && !isAnalyzingRef.current) return
    if (!analysisLifecycle.cancel('user')) {
      post('stop')
      abortPendingAnalysis('Analysis canceled by user.')
    }
  }

  const stop = () => {
    if (!analysisLifecycle.isActive() && !isAnalyzingRef.current) return
    if (!analysisLifecycle.cancel('stopped')) {
      post('stop')
      abortPendingAnalysis('Analysis stopped.')
    }
  }

  const destroy = () => {
    const shutdownMessage = 'Stockfish engine stopped.'
    clearStartupTimeout()
    rejectReadyState(shutdownMessage)
    if (!analysisLifecycle.cancel('shutdown')) {
      abortPendingAnalysis(shutdownMessage)
    }
    sawUciOkRef.current = false
    setIsAnalyzing(false)
    setIsReady(false)
    if (!workerRef.current) return
    post('stop')
    terminateWorker(true)
  }

  const summary = useMemo(
    () => ({
      ready: isReady,
      analyzing: isAnalyzing,
      error: lastError,
      evaluation,
    }),
    [evaluation, isAnalyzing, isReady, lastError],
  )

  return {
    isReady,
    isAnalyzing,
    lastError,
    bestLines,
    evaluation,
    summary,
    start,
    stop,
    cancelAnalysis,
    destroy,
    analyzePosition,
  }
}
