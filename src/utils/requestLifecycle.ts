export function createRequestLifecycle<CancelReason extends string>() {
  let sequence = 0
  let activeRequestId = 0
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  let cancelReason: CancelReason | null = null
  let cancelAction: (() => void) | null = null

  const clearTimeoutHandle = () => {
    if (timeoutHandle === null) return
    clearTimeout(timeoutHandle)
    timeoutHandle = null
  }

  const clear = () => {
    clearTimeoutHandle()
    activeRequestId = 0
    cancelReason = null
    cancelAction = null
  }

  const begin = (onCancel?: () => void) => {
    sequence += 1
    activeRequestId = sequence
    cancelReason = null
    cancelAction = onCancel ?? null
    clearTimeoutHandle()
    return activeRequestId
  }

  const isActive = (requestId?: number) => {
    if (activeRequestId === 0) return false
    if (requestId == null) return true
    return requestId === activeRequestId
  }

  const scheduleTimeout = (
    requestId: number,
    timeoutMs: number,
    reason: CancelReason,
    onTimeout: () => void,
  ) => {
    if (!isActive(requestId)) return
    clearTimeoutHandle()
    timeoutHandle = setTimeout(() => {
      if (!isActive(requestId)) return
      cancelReason = reason
      onTimeout()
    }, timeoutMs)
  }

  const cancel = (reason: CancelReason) => {
    if (!isActive()) return false
    cancelReason = reason
    cancelAction?.()
    return true
  }

  const end = (requestId: number) => {
    if (!isActive(requestId)) return
    clear()
  }

  const getCancelReason = () => cancelReason

  return {
    begin,
    scheduleTimeout,
    cancel,
    end,
    clear,
    isActive,
    getCancelReason,
  }
}