import { useState } from 'react'
import './App.css'
import AnalysisPanel from './components/AnalysisPanel'

// import { onBeforeUnmount } from 'vue'
// import { storeToRefs } from 'pinia'
import ChessBoard from './components/ChessBoard.tsx'
import ChatWindow from './components/ChatWindow.tsx'
import MoveList from './components/MoveList.tsx'
import { useGameStore } from './store/gameStore'


function App() {

  return (
    <>
      <template>
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
              v-model="pgnInput"
              placeholder="Paste PGN here (example: 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6)"
            />
            <div className="header-actions">
              <button type="button" className="ghost" onClick={useGameStore.requestPgnImport}>Import PGN</button>
            </div>
            <p
              v-if="pgnImportStatus && !pgnImportStatus.ok"
              className="import-status error"
              role="status"
              aria-live="polite"
            >
              {/* {{ pgnImportStatus.message }} */}
            </p>
          </section>

          <main className="layout">
            <section className="board-area">
              <ChessBoard
                // :import-pgn="pgnImportRequest"
                // :jump-to-ply="jumpToPlyRequest"
                moves-updated={useGameStore.setMoves}
                pgn-import-status={useGameStore.setPgnImportStatus}
                position-updated={useGameStore.setCurrentFen}
                pgn-updated={useGameStore.setCurrentPgn}  
              />
            </section>
            <section className="moves-area">
              <MoveList moves="moves" ply-selected={useGameStore.requestJumpToPly} />
            </section>

            <section className="sidebar-area">
              <section className="analysis-area">
                <AnalysisPanel
                  enabled={useGameStore.engineEnabled}
                  v-model:depth={useGameStore.analysisDepth}
                  v-model:multi-pv={useGameStore.analysisLines}
                  ready={useGameStore.isReady}
                  loading={useGameStore.isAnalyzing}
                  current-fen={useGameStore.currentFen}
                  error={useGameStore.analysisError}
                  evaluation={useGameStore.evaluation}
                  // update:enabled={useGameStore.setEngineEnabled}
                  cancel-analysis={useGameStore.cancelAnalysis}
                />
              </section>
              <section className="chat-area">
                <ChatWindow />
              </section>
            </section>
          </main>
        </div>
      </template>
    </>
  )
}

export default App
