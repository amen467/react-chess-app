// store/gameSlice.ts
import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit'
import { useStockfish } from '../compostables/useStockfish'
import { useChat } from '../compostables/useChat'


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
  // Stockfish/Chat state will be handled separately in thunks
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
}

// Initialize Stockfish and Chat outside slice
const stockfish = useStockfish()
const chat = useChat()

// Async thunk to enable or disable engine
export const setEngineEnabled = createAsyncThunk(
  'game/setEngineEnabled',
  async (enabled: boolean, { dispatch }) => {
    if (!enabled) {
      stockfish.destroy()
      return false
    }

    try {
      await stockfish.start()
      await dispatch(runAnalysis())
      return true
    } catch {
      stockfish.destroy()
      return false
    }
  }
)

// Async thunk to run analysis
export const runAnalysis = createAsyncThunk(
  'game/runAnalysis',
  async (_, { getState }) => {
    const state = getState() as { game: GameState }
    if (!state.game.engineEnabled) return

    try {
      await stockfish.analyzePosition(state.game.currentFen, {
        depth: state.game.analysisDepth,
        multiPv: state.game.analysisLines,
      })
    } catch {
      // Error is handled inside useStockfish
    }
  }
)

// Async thunk to send chat message
export const sendChatMessage = createAsyncThunk(
  'game/sendChatMessage',
  async ({ text, includeCurrentPosition }: { text: string; includeCurrentPosition: boolean }, { getState }) => {
    const state = getState() as { game: GameState }
    return chat.send(text, {
      includeCurrentPosition,
      currentFen: state.game.currentFen,
      currentPgn: state.game.currentPgn,
    })
  }
)

export const gameSlice = createSlice({
  name: 'game',
  initialState,
  reducers: {
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
    requestPgnImport(state) {
      state.pgnImportRequest = { id: Date.now(), text: state.pgnInput }
    },
    requestJumpToPly(state, action: PayloadAction<number>) {
      state.jumpToPlyRequest = { id: Date.now(), ply: action.payload }
    },
  },
  extraReducers: (builder) => {
    builder.addCase(setEngineEnabled.fulfilled, (state, action) => {
      state.engineEnabled = action.payload
    })
  },
})

export const {
  setMoves,
  setPgnImportStatus,
  setCurrentFen,
  setCurrentPgn,
  setPgnInput,
  requestPgnImport,
  requestJumpToPly,
} = gameSlice.actions

export default gameSlice.reducer