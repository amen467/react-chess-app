// import React from 'react'
import type { EngineEvaluation } from '../types/chess'

type AnalysisPanelProps = {
  enabled: boolean
  ready: boolean
  loading: boolean
  depth: number
  multiPv: number
  currentFen: string
  error?: string | null
  evaluation?: EngineEvaluation | null

  onEnabledChange: (value: boolean) => void
  onDepthChange: (value: number) => void
  onMultiPvChange: (value: number) => void
  onCancelAnalysis: () => void
}

// -------- Utilities --------

const formatPawns = (centipawns: number) => {
  const pawns = centipawns / 100
  const sign = pawns > 0 ? '+' : ''
  return `${sign}${pawns.toFixed(2)}`
}

const toSafeInt = (
  value: string,
  fallback: number,
  min: number,
  max: number
) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

const MAX_PV_PLIES_DISPLAY = 13

const formatPvLine = (line: string[], fen: string) => {
  if (!line.length) return ''

  const truncated = line.length > MAX_PV_PLIES_DISPLAY
  const visibleLine = truncated ? line.slice(0, MAX_PV_PLIES_DISPLAY) : line

  const parts = fen.trim().split(/\s+/)
  const turn = parts[1] === 'b' ? 'b' : 'w'
  const fullmove = Number.parseInt(parts[5] || '1', 10)

  let moveNumber =
    Number.isFinite(fullmove) && fullmove > 0 ? fullmove : 1

  let sideToMove: 'w' | 'b' = turn
  const formatted: string[] = []

  for (const san of visibleLine) {
    if (sideToMove === 'w') {
      formatted.push(`${moveNumber}. ${san}`)
      sideToMove = 'b'
      continue
    }

    if (formatted.length === 0) {
      formatted.push(`${moveNumber}... ${san}`)
    } else {
      formatted.push(san)
    }

    moveNumber += 1
    sideToMove = 'w'
  }

  return truncated
    ? `${formatted.join(' ')}...`
    : formatted.join(' ')
}

// -------- Component --------
  
const AnalysisPanel = ({
  enabled,
  ready,
  loading,
  depth,
  multiPv,
  currentFen,
  error,
  evaluation,
  onEnabledChange,
  onDepthChange,
  onMultiPvChange,
  onCancelAnalysis
}: AnalysisPanelProps) => {
  // Handlers
  const handleDepthInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    onDepthChange(toSafeInt(e.target.value, depth, 1, 30))
  }

  const handleMultiPvInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    onMultiPvChange(toSafeInt(e.target.value, multiPv, 1, 40))
  }

  const handleEnabledChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onEnabledChange(e.target.checked)
  }

  return (
    <section className="analysis-panel">
      <div className="analysis-header">
        <div className="header-row">
          <h2>Analysis</h2>

          <label className="toggle">
            <input type="checkbox" checked={enabled} onChange={handleEnabledChange} />
            <span>Engine {enabled ? "On" : "Off"}</span>
          </label>
        </div>

        <div className="controls-row">
          <label className="control">
            Depth
            <input type="number" min="1" max="30" value={depth} onChange={handleDepthInput} />
          </label>

          <label className="control">
            Lines
            <input type="number" min="1"  max="40" value={multiPv} onChange={handleMultiPvInput} />
          </label>

          {loading && (
            <button type="button" className="cancel-button" onClick={onCancelAnalysis} >
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="analysis-body">
        {(() => {
          // ---- PRECOMPUTED BODY LOGIC ----
          if (!enabled) {
            return <p className="hint">Engine is off.</p>;
          }

          if (!ready) {
            return <p className="hint">Starting engine...</p>;
          }

          if (loading) {
            return <p className="hint">Analyzing current position...</p>;
          }

          if (error) {
            return <p className="error">{error}</p>;
          }

          if (!evaluation) {
            return <p className="hint">Waiting for position analysis...</p>;
          }

          // ---- MAIN RENDER (EVALUATION READY) ----
          return (
            <>
              <p className="summary">
                Depth {evaluation.depth} |{" "}
                {evaluation.mateIn !== null ? (
                  <span>Mate {evaluation.mateIn}</span>
                ) : evaluation.centipawns !== null ? (
                  <span>Eval {formatPawns(evaluation.centipawns)}</span>
                ) : (
                  <span>Eval --</span>
                )}
              </p>

              <ol className="pv-list">
                {evaluation.bestMoves.map((line, index) => (
                  <li key={index}>
                    <div>
                      <strong>#{index + 1}</strong>&nbsp;&nbsp;
                      {line.isMate ? (
                        <span>Mate {line.score}</span>
                      ) : (
                        <span>{formatPawns(line.score)}</span>
                      )}
                    </div>

                    <code>{formatPvLine(line.line, currentFen)}</code>
                  </li>
                ))}
              </ol>
            </>
          );
        })()}
      </div>
    </section>
  );
}

export default AnalysisPanel