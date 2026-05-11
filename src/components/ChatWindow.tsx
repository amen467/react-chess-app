import { useGameStore } from '../store/gameStore'

import { useEffect, useState } from 'react'
import type { ChatMessage } from '../compostables/useChat'

export function ChatWindow() {
  const gameStore = useGameStore()
  const {
    messages,
    sending,
    apiKey,
    hasStoredEncryptedKey,
    lastError,
  } = gameStore
  const [draft, setDraft] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [passphraseDraft, setPassphraseDraft] = useState('')
  const [includeCurrentPosition, setIncludeCurrentPosition] = useState(false)

  useEffect(() => {
    gameStore.loadApiKey().then(() => {
      setKeyDraft(gameStore.apiKey)
    })
  }, [])

  const saveKey = async () => {
    await gameStore.saveApiKey(keyDraft, passphraseDraft)
  }

  const removeKey = () => {
    gameStore.clearApiKey()
    setKeyDraft('')
    setPassphraseDraft('')
  }

  const unlockKey = async () => {
    await gameStore.unlockApiKey(passphraseDraft)
    if (gameStore.apiKey) {
      setKeyDraft(gameStore.apiKey)
    }
  }

  const lockKey = () => {
    gameStore.lockApiKey()
    setKeyDraft('')
  }

  const sendMessage = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!draft.trim() || sending) return
    const sent = await gameStore.send(draft, {
      includeCurrentPosition,
      currentFen: gameStore.currentFen,
      currentPgn: gameStore.currentPgn,
    })
    if (sent) {
      setDraft('')
    }
  }

  const cancelMessage = () => {
    gameStore.cancelSend()
  }

  return (
    <section className="chat-window">
      <header>Game Chat</header>
      <div className="api-key">
        <div className="api-key-header">
          <label htmlFor="openai-key">ChatGPT API key</label>
          <input
            id="openai-key"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            type="password"
            placeholder="sk-..."
            autoComplete="off"
          />
        </div>
        <div className="api-key-controls">
          <button type="button" onClick={saveKey}>Save Encrypted</button>
          {hasStoredEncryptedKey && !apiKey && (
          <button
            type="button"
            className="ghost"
            onClick={unlockKey}
          >
            Unlock
          </button>
          )}
          {apiKey && (
            <button type="button" className="ghost" onClick={lockKey}>Lock</button>
          )}
          <button type="button" className="ghost" onClick={removeKey}>Clear</button>
        </div>
        <label htmlFor="openai-passphrase" className="passphrase-label">Encryption passphrase</label>
        <input
          id="openai-passphrase"
          value={passphraseDraft}
          onChange={(e) => setPassphraseDraft(e.target.value)}
          type="password"
          className="passphrase-input"
          placeholder="At least 8 characters"
          autoComplete="off"
        />
        <p className="api-key-note">Key is encrypted in local storage and decrypted only in-memory.</p>
      </div>
      <div className="transcript">
        {!messages.length ? (
          <p className="empty"></p>
        ) : (
          <div>
            {messages.map((msg: ChatMessage, index: number) => (
              <p key={index} className={msg.role}>
                <strong>
                  {msg.role === "user" ? "You" : "Assistant"}:
                </strong>{" "}
                <span>{msg.text}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      {
        lastError && (
          <p className="error">{ lastError }</p>
        )
      }
      <label className="include-position">
        <input
          checked={includeCurrentPosition}
          onChange={(e) => setIncludeCurrentPosition(e.target.checked)}
          type="checkbox"
        />
        Include current position?
      </label>
      <form className="composer" onSubmit={sendMessage}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          type="text"
          placeholder="Why is this move bad?"
          disabled={sending}
        />
        <button type="submit" disabled={sending || !apiKey}>
          { sending ? 'Sending...' : 'Send' }
        </button>
        {sending && (
          <button type="button" className="cancel" onClick={cancelMessage}>
            Cancel
          </button>
        )}
      </form>
    </section>
  )
}

export default ChatWindow
