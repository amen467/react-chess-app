export interface MoveEvaluation {
  san: string
  score: number // centipawns or mate value when combined with isMate flag
  line: string[]
  isMate?: boolean
}

export interface EngineEvaluation {
  centipawns: number | null
  mateIn: number | null
  depth: number
  bestMoves: MoveEvaluation[]
}

export interface PlayerEstimate {
  elo: number | null
  accuracy: number | null // 0–1 range
  blunders: number
  mistakes: number
  inaccuracies: number
}