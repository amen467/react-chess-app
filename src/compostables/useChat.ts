import { useRef, useState } from 'react'
import { createRequestLifecycle } from '../utils/requestLifecycle'

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

interface SendOptions {
  includeCurrentPosition?: boolean
  currentFen?: string
  currentPgn?: string
}

const OPENAI_API_URL = 'https://api.openai.com/v1/responses'
const OPENAI_MODEL = 'gpt-4.1-mini'
const CHAT_REQUEST_TIMEOUT_MS = 45000
const API_KEY_STORAGE_KEY = 'chess-analysis.openai.api-key.enc'
const LEGACY_API_KEY_STORAGE_KEY = 'chess-analysis.openai.api-key'
const SESSION_PASSPHRASE_KEY = 'chess-analysis.openai.api-key.passphrase'
const PBKDF2_ITERATIONS = 250000
const CHAT_SYSTEM_PROMPT =
  'You are a concise chess assistant inside a chess analysis app. Only answer questions related to the included chess game or chess more generally, such as rules, strategies, openings, tactics, etc. If a user asks about anything unrelated to chess, politely say that this assistant only answers chess-related questions. If the question is about the current position and the PGN is not included, remind the user to check the "include current position" box in the app which originated the request.'

interface EncryptedApiKeyPayload {
  v: 1
  i: number
  s: string
  iv: string
  ct: string
}

interface ResponsesOutputContentItem {
  type?: string
  text?: string
}

interface ResponsesOutputItem {
  content?: ResponsesOutputContentItem[]
}

interface ResponsesApiPayload {
  id?: string
  output_text?: string
  output?: ResponsesOutputItem[]
}

interface ResponsesInputContentItem {
  type: 'input_text'
  text: string
}

interface ResponsesInputItem {
  role: 'system' | 'user'
  content: ResponsesInputContentItem[]
}

interface ResponsesRequestPayload {
  model: string
  input: ResponsesInputItem[]
  previous_response_id?: string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const toBase64 = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return window.btoa(binary)
}

const fromBase64 = (value: string) => {
  const binary = window.atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

const deriveAesKey = async (passphrase: string, salt: Uint8Array, iterations: number) => {
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt'],
  )
}

const encryptApiKey = async (plainKey: string, passphrase: string) => {
  const salt = window.crypto.getRandomValues(new Uint8Array(16))
  const iv = window.crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveAesKey(passphrase, salt, PBKDF2_ITERATIONS)
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    encoder.encode(plainKey),
  )

  const payload: EncryptedApiKeyPayload = {
    v: 1,
    i: PBKDF2_ITERATIONS,
    s: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(encrypted)),
  }
  return JSON.stringify(payload)
}

const decryptApiKey = async (encryptedPayload: string, passphrase: string) => {
  const parsed = JSON.parse(encryptedPayload) as EncryptedApiKeyPayload
  if (parsed.v !== 1) {
    throw new Error('Unsupported encrypted key format.')
  }
  const salt = fromBase64(parsed.s)
  const iv = fromBase64(parsed.iv)
  const ciphertext = fromBase64(parsed.ct)
  const key = await deriveAesKey(passphrase, salt, parsed.i || PBKDF2_ITERATIONS)
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  )
  return decoder.decode(decrypted)
}

const extractAssistantText = (payload: ResponsesApiPayload) => {
  const fromOutput =
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
      .map((item) => item.text?.trim() ?? '')
      .filter(Boolean)
      .join('\n') ?? ''

  if (fromOutput) return fromOutput
  return payload.output_text?.trim() || ''
}

const buildChatRequest = (
  composedUserText: string,
  previousResponseId: string | null,
): ResponsesRequestPayload => {
  const payload: ResponsesRequestPayload = {
    model: OPENAI_MODEL,
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: CHAT_SYSTEM_PROMPT }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: composedUserText }],
      },
    ],
  }

  if (previousResponseId) {
    payload.previous_response_id = previousResponseId
  }

  return payload
}

export function useChat() {
  const [messages, setMessagesState] = useState<ChatMessage[]>([])
  const [sending, setSendingState] = useState(false)
  const [apiKey, setApiKeyState] = useState('')
  const [lastError, setLastErrorState] = useState<string | null>(null)
  const [hasStoredEncryptedKey, setHasStoredEncryptedKeyState] = useState(false)
  const messagesRef = useRef<ChatMessage[]>([])
  const sendingRef = useRef(false)
  const apiKeyRef = useRef('')
  const lastResponseId = useRef<string | null>(null)
  const requestLifecycle = useRef(createRequestLifecycle<'timeout' | 'user'>()).current

  const setMessages = (nextMessages: ChatMessage[]) => {
    messagesRef.current = nextMessages
    setMessagesState(nextMessages)
  }

  const addMessage = (message: ChatMessage) => {
    setMessages([...messagesRef.current, message])
  }

  const setSending = (value: boolean) => {
    sendingRef.current = value
    setSendingState(value)
  }

  const setApiKey = (value: string) => {
    apiKeyRef.current = value
    setApiKeyState(value)
  }

  const setLastError = (value: string | null) => {
    setLastErrorState(value)
  }

  const setHasStoredEncryptedKey = (value: boolean) => {
    setHasStoredEncryptedKeyState(value)
  }

  const cancelSend = () => {
    requestLifecycle.cancel('user')
  }

  const loadApiKey = async () => {
    if (typeof window === 'undefined') return
    const storedEncryptedKey = Boolean(window.localStorage.getItem(API_KEY_STORAGE_KEY))
    setHasStoredEncryptedKey(storedEncryptedKey)
    setApiKey('')

    const legacyKey = window.localStorage.getItem(LEGACY_API_KEY_STORAGE_KEY)
    if (legacyKey) {
      setApiKey(legacyKey)
      setHasStoredEncryptedKey(true)
      window.localStorage.removeItem(LEGACY_API_KEY_STORAGE_KEY)
      setLastError(
        'A legacy unencrypted key was loaded into memory. Save it with a passphrase to encrypt it.',
      )
      return
    }

    const sessionPassphrase = window.sessionStorage.getItem(SESSION_PASSPHRASE_KEY)
    if (storedEncryptedKey && sessionPassphrase) {
      await unlockApiKey(sessionPassphrase)
    }
  }

  const saveApiKey = async (nextKey: string, passphrase: string) => {
    if (typeof window === 'undefined') return
    if (!window.crypto?.subtle) {
      setLastError('Web Crypto is not available in this browser.')
      return
    }
    const trimmed = nextKey.trim()
    const passphraseTrimmed = passphrase.trim()
    if (!passphraseTrimmed || passphraseTrimmed.length < 8) {
      setLastError('Passphrase must be at least 8 characters.')
      return
    }

    setLastError(null)

    if (!trimmed) {
      window.localStorage.removeItem(API_KEY_STORAGE_KEY)
      window.localStorage.removeItem(LEGACY_API_KEY_STORAGE_KEY)
      setHasStoredEncryptedKey(false)
      setApiKey('')
      return
    }

    const encryptedPayload = await encryptApiKey(trimmed, passphraseTrimmed)
    window.localStorage.setItem(API_KEY_STORAGE_KEY, encryptedPayload)
    window.localStorage.removeItem(LEGACY_API_KEY_STORAGE_KEY)
    window.sessionStorage.setItem(SESSION_PASSPHRASE_KEY, passphraseTrimmed)
    setHasStoredEncryptedKey(true)
    setApiKey(trimmed)
  }

  const clearApiKey = () => {
    cancelSend()
    if (typeof window === 'undefined') return
    setLastError(null)
    setApiKey('')
    lastResponseId.current = null
    window.localStorage.removeItem(API_KEY_STORAGE_KEY)
    window.localStorage.removeItem(LEGACY_API_KEY_STORAGE_KEY)
    window.sessionStorage.removeItem(SESSION_PASSPHRASE_KEY)
    setHasStoredEncryptedKey(false)
  }

  const lockApiKey = () => {
    cancelSend()
    setApiKey('')
    lastResponseId.current = null
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(SESSION_PASSPHRASE_KEY)
    }
  }

  const unlockApiKey = async (passphrase: string) => {
    if (typeof window === 'undefined') return
    if (!window.crypto?.subtle) {
      setLastError('Web Crypto is not available in this browser.')
      return
    }
    const passphraseTrimmed = passphrase.trim()
    if (!passphraseTrimmed) {
      setLastError('Enter a passphrase to unlock the API key.')
      return
    }

    const encryptedPayload = window.localStorage.getItem(API_KEY_STORAGE_KEY)
    if (!encryptedPayload) {
      setLastError('No encrypted API key is stored yet.')
      return
    }

    try {
      setApiKey(await decryptApiKey(encryptedPayload, passphraseTrimmed))
      window.sessionStorage.setItem(SESSION_PASSPHRASE_KEY, passphraseTrimmed)
      setLastError(null)
    } catch {
      setLastError('Unable to decrypt key. Check passphrase.')
      setApiKey('')
    }
  }

  const send = async (text: string, options: SendOptions = {}) => {
    if (!text.trim()) return false
    if (sendingRef.current) return false
    if (!apiKeyRef.current.trim()) {
      setLastError('Add your API key before sending messages.')
      return false
    }

    const userText = text.trim()
    setLastError(null)
    setSending(true)
    addMessage({ role: 'user', text: userText })

    let composedUserText = userText
    if (options.includeCurrentPosition && (options.currentFen || options.currentPgn)) {
      const contextLines: string[] = []
      if (options.currentFen) {
        contextLines.push(`Current position FEN: ${options.currentFen}`)
      }
      if (options.currentPgn?.trim()) {
        contextLines.push(`Current game PGN:\n${options.currentPgn}`)
      }
      composedUserText = `${composedUserText}\n\n${contextLines.join('\n\n')}`
    }

    const controller = new AbortController()
    const requestId = requestLifecycle.begin(() => {
      controller.abort()
    })
    requestLifecycle.scheduleTimeout(requestId, CHAT_REQUEST_TIMEOUT_MS, 'timeout', () => {
      controller.abort()
    })

    try {
      const requestPayload = buildChatRequest(composedUserText, lastResponseId.current)

      const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKeyRef.current}`,
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      })

      if (!response.ok) {
        let message = `OpenAI request failed (${response.status}).`
        try {
          const payload = (await response.json()) as { error?: { message?: string } }
          if (payload.error?.message) message = payload.error.message
        } catch {
          // Ignore JSON parse errors and use generic message.
        }
        throw new Error(message)
      }

      const payload = (await response.json()) as ResponsesApiPayload
      lastResponseId.current = payload.id || null
      const assistantText = extractAssistantText(payload) || 'No response text returned.'
      addMessage({ role: 'assistant', text: assistantText })
      return true
    } catch (error) {
      const isAbortError = error instanceof DOMException && error.name === 'AbortError'
      let message: string
      let shouldAppendAssistantError = true

      if (isAbortError) {
        if (requestLifecycle.getCancelReason() === 'timeout') {
          const timeoutSeconds = Math.round(CHAT_REQUEST_TIMEOUT_MS / 1000)
          message = `Request timed out after ${timeoutSeconds}s.`
        } else {
          message = 'Request canceled.'
          shouldAppendAssistantError = false
        }
      } else {
        message = error instanceof Error ? error.message : 'Unable to reach OpenAI.'
      }

      setLastError(message)
      if (shouldAppendAssistantError) {
        addMessage({ role: 'assistant', text: `Error: ${message}` })
      }
      return false
    } finally {
      requestLifecycle.end(requestId)
      setSending(false)
    }
  }

  return {
    messages,
    sending,
    send,
    apiKey,
    loadApiKey,
    saveApiKey,
    clearApiKey,
    unlockApiKey,
    lockApiKey,
    cancelSend,
    hasStoredEncryptedKey,
    lastError,
  }
}
