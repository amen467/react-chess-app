// store/gameSlice.ts
import { configureStore, createSlice } from '@reduxjs/toolkit'
import type { PayloadAction } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'
import type { TypedUseSelectorHook } from 'react-redux'
import { useStockfish } from '../compostables/useStockfish'
import { useChat } from '../compostables/useChat'
import type { EngineEvaluation } from '../types/chess'


interface PgnImportRequest {
  id: number
  text: string
}

interface JumpToPlyRequest {
  id: number
  ply: number
}

interface PgnImportStatus {
  ok: boolean
  message: string
}

interface GameState {
  engineEnabled: boolean
  moves: string[]
  pgnInput: string
  pgnImportRequest?: PgnImportRequest
  jumpToPlyRequest?: JumpToPlyRequest
  pgnImportStatus?: PgnImportStatus
  currentFen: string
  currentPgn: string
  analysisDepth: number
  analysisLines: number
  isReady: boolean
  isAnalyzing: boolean
  analysisError?: string | null
  evaluation?: EngineEvaluation | null
}

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

const initialState: GameState = {
  engineEnabled: false,
  moves: [],
  pgnInput: '',
  currentFen: INITIAL_FEN,
  currentPgn: '',
  analysisDepth: 22,
  analysisLines: 5,
  isReady: false,
  isAnalyzing: false,
  analysisError: null,
  evaluation: null,
}

export const gameSlice = createSlice({
  name: 'game',
  initialState,
  reducers: {
    setEngineEnabledState(state, action: PayloadAction<boolean>) {
      state.engineEnabled = action.payload
      state.analysisError = null
      if (!action.payload) {
        state.isReady = false
        state.isAnalyzing = false
        state.evaluation = null
      }
    },
    setEngineReady(state, action: PayloadAction<boolean>) {
      state.isReady = action.payload
    },
    setMoves(state, action: PayloadAction<string[]>) {
      state.moves = action.payload
    },
    setPgnImportStatus(state, action: PayloadAction<PgnImportStatus>) {
      state.pgnImportStatus = action.payload
    },
    setCurrentFen(state, action: PayloadAction<string>) {
      state.currentFen = action.payload
    },
    setCurrentPgn(state, action: PayloadAction<string>) {
      state.currentPgn = action.payload
    },
    setPgnInput(state, action: PayloadAction<string>) {
      state.pgnInput = action.payload
    },
    setAnalysisDepth(state, action: PayloadAction<number>) {
      state.analysisDepth = action.payload
    },
    setAnalysisLines(state, action: PayloadAction<number>) {
      state.analysisLines = action.payload
    },
    requestPgnImport(state) {
      state.pgnImportRequest = { id: Date.now(), text: state.pgnInput }
    },
    requestJumpToPly(state, action: PayloadAction<number>) {
      state.jumpToPlyRequest = { id: Date.now(), ply: action.payload }
    },
    startAnalysis(state) {
      state.isAnalyzing = true
      state.analysisError = null
    },
    finishAnalysis(state, action: PayloadAction<EngineEvaluation | null>) {
      state.isAnalyzing = false
      state.evaluation = action.payload
    },
    failAnalysis(state, action: PayloadAction<string>) {
      state.isAnalyzing = false
      state.analysisError = action.payload
    },
    clearAnalysis(state) {
      state.isAnalyzing = false
      state.evaluation = null
      state.analysisError = null
    },
  },
})

export const {
  setEngineEnabledState,
  setEngineReady,
  setMoves,
  setPgnImportStatus,
  setCurrentFen,
  setCurrentPgn,
  setPgnInput,
  setAnalysisDepth,
  setAnalysisLines,
  requestPgnImport,
  requestJumpToPly,
  startAnalysis,
  finishAnalysis,
  failAnalysis,
  clearAnalysis,
} = gameSlice.actions

export const store = configureStore({
  reducer: {
    game: gameSlice.reducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export const useAppDispatch = () => useDispatch<AppDispatch>()
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector

export const useGameStore = () => {
  const dispatch = useAppDispatch()
  const game = useAppSelector((state) => state.game)

  const stockfish = useStockfish()
  const chat = useChat()

  const runPositionAnalysis = async (
    fen = game.currentFen,
    depth = game.analysisDepth,
    multiPv = game.analysisLines,
    enabled = game.engineEnabled,
  ) => {
    if (!enabled) return

    dispatch(startAnalysis())
    try {
      const nextEvaluation = await stockfish.analyzePosition(fen, {
        depth,
        multiPv,
      })
      dispatch(finishAnalysis(nextEvaluation))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Analysis failed.'
      if (message === 'Analysis canceled by user.' || message === 'Stockfish engine stopped.') {
        dispatch(clearAnalysis())
        return
      }
      dispatch(failAnalysis(message))
    }
  }

  const setEngineEnabled = async (enabled: boolean) => {
    if (!enabled) {
      stockfish.destroy()
      dispatch(setEngineEnabledState(false))
      return
    }

    dispatch(setEngineEnabledState(true))
    dispatch(setEngineReady(false))
    try {
      await stockfish.start()
      dispatch(setEngineReady(true))
      await runPositionAnalysis(game.currentFen, game.analysisDepth, game.analysisLines, true)
    } catch (error) {
      stockfish.destroy()
      const message = error instanceof Error ? error.message : 'Could not start engine.'
      dispatch(setEngineEnabledState(false))
      dispatch(failAnalysis(message))
    }
  }

  const setPositionFen = (fen: string) => {
    dispatch(setCurrentFen(fen))
    void runPositionAnalysis(fen)
  }

  const setDepth = (depth: number) => {
    dispatch(setAnalysisDepth(depth))
    void runPositionAnalysis(game.currentFen, depth, game.analysisLines)
  }

  const setLines = (lines: number) => {
    dispatch(setAnalysisLines(lines))
    void runPositionAnalysis(game.currentFen, game.analysisDepth, lines)
  }

  const cancelCurrentAnalysis = () => {
    stockfish.cancelAnalysis()
    dispatch(clearAnalysis())
  }

  const sendChatMessage = (text: string, includeCurrentPosition: boolean) => {
    return chat.send(text, {
      includeCurrentPosition,
      currentFen: game.currentFen,
      currentPgn: game.currentPgn,
    })
  }

  return {
    ...game,
    setMoves: (moves: string[]) => dispatch(setMoves(moves)),
    setPgnImportStatus: (status: PgnImportStatus) => dispatch(setPgnImportStatus(status)),
    setCurrentFen: setPositionFen,
    setCurrentPgn: (pgn: string) => dispatch(setCurrentPgn(pgn)),
    setPgnInput: (pgn: string) => dispatch(setPgnInput(pgn)),
    setAnalysisDepth: setDepth,
    setAnalysisLines: setLines,
    requestPgnImport: () => dispatch(requestPgnImport()),
    requestJumpToPly: (ply: number) => dispatch(requestJumpToPly(ply)),
    setEngineEnabled,
    cancelAnalysis: cancelCurrentAnalysis,

    start: stockfish.start,
    destroy: stockfish.destroy,
    analyzePosition: stockfish.analyzePosition,

    messages: chat.messages,
    sending: chat.sending,
    send: chat.send,
    cancelSend: chat.cancelSend,
    apiKey: chat.apiKey,
    loadApiKey: chat.loadApiKey,
    saveApiKey: chat.saveApiKey,
    clearApiKey: chat.clearApiKey,
    unlockApiKey: chat.unlockApiKey,
    lockApiKey: chat.lockApiKey,
    hasStoredEncryptedKey: chat.hasStoredEncryptedKey,
    lastError: chat.lastError,
    sendChatMessage
  }
}

export default gameSlice.reducer
