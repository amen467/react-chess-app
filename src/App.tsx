import './App.scss'
import AnalysisPanel from './components/AnalysisPanel'
import ChessBoard from './components/ChessBoard.tsx'
import ChatWindow from './components/ChatWindow.tsx'
import MoveList from './components/MoveList.tsx'
import { useGameStore } from './store/gameStore'


function App() {
  const gameStore = useGameStore()

  return (
    <>
        <div className="app-shell">
          <header className="app-header">
            <div>
              <p className="eyebrow">Chess Analysis App</p>
              <h1>Analyze games with Stockfish + Chat</h1>
            </div>
          </header>

          <section className="importer">
            <label htmlFor="pgn-input">PGN Input</label>
            <textarea
              id="pgn-input"
              value={gameStore.pgnInput}
              onChange={(event) => gameStore.setPgnInput(event.target.value)}
              placeholder="Paste PGN here (example: 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6)"
            />
            <div className="header-actions">
              <button type="button" className="ghost" onClick={gameStore.requestPgnImport}>Import PGN</button>
            </div>
            {gameStore.pgnImportStatus && !gameStore.pgnImportStatus.ok && (
              <p
                className="import-status error"
                role="status"
                aria-live="polite"
              >
                {gameStore.pgnImportStatus.message}
              </p>
            )}
          </section>

          <main className="layout">
            <section className="board-area">
              <ChessBoard
                importPgn={gameStore.pgnImportRequest}
                jumpToPly={gameStore.jumpToPlyRequest}
                onMovesUpdated={gameStore.setMoves}
                onPgnImportStatus={gameStore.setPgnImportStatus}
                onPositionUpdated={gameStore.setCurrentFen}
                onPgnUpdated={gameStore.setCurrentPgn}  
              />
            </section>
            <section className="moves-area">
              <MoveList moves={gameStore.moves} onPlySelected={gameStore.requestJumpToPly} />
            </section>

            <section className="sidebar-area">
              <section className="analysis-area">
                <AnalysisPanel
                  enabled={gameStore.engineEnabled}
                  depth={gameStore.analysisDepth}
                  multiPv={gameStore.analysisLines}
                  ready={gameStore.isReady}
                  loading={gameStore.isAnalyzing}
                  currentFen={gameStore.currentFen}
                  error={gameStore.analysisError}
                  evaluation={gameStore.evaluation}
                  onEnabledChange={gameStore.setEngineEnabled}
                  onDepthChange={gameStore.setAnalysisDepth}
                  onMultiPvChange={gameStore.setAnalysisLines}
                  onCancelAnalysis={gameStore.cancelAnalysis}
                />
              </section>
              <section className="chat-area">
                <ChatWindow />
              </section>
            </section>
          </main>
        </div>
    </>
  )
}

export default App
