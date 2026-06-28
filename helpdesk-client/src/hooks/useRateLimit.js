import { useState, useCallback, useEffect } from 'react'

const LIMITS = {
  login: { max: 5, window: 5 * 60 * 1000 },
  register: { max: 3, window: 10 * 60 * 1000 },
  forgot_password: { max: 3, window: 10 * 60 * 1000 },
}

function getKey(action) {
  return `rl_${action}`
}

function getStored(action) {
  try {
    const raw = localStorage.getItem(getKey(action))
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function setStored(action, timestamps) {
  localStorage.setItem(getKey(action), JSON.stringify(timestamps))
}

function cleanOld(timestamps, window) {
  const cutoff = Date.now() - window
  return timestamps.filter((t) => t > cutoff)
}

export function useRateLimit(action) {
  const config = LIMITS[action]
  if (!config) throw new Error(`Unknown rate limit action: ${action}`)

  const [remaining, setRemaining] = useState(() => {
    const stored = cleanOld(getStored(action), config.window)
    return Math.max(0, config.max - stored.length)
  })
  const [resetIn, setResetIn] = useState(0)

  useEffect(() => {
    if (remaining > 0) return
    const stored = getStored(action)
    if (stored.length === 0) return
    const oldest = Math.min(...stored)
    const ms = Math.max(0, oldest + config.window - Date.now())
    setResetIn(ms)
    const timer = setInterval(() => {
      const msLeft = Math.max(0, oldest + config.window - Date.now())
      setResetIn(msLeft)
      if (msLeft <= 0) {
        setRemaining(config.max)
        clearInterval(timer)
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [remaining, action, config.max, config.window])

  const increment = useCallback(() => {
    const stored = cleanOld(getStored(action), config.window)
    stored.push(Date.now())
    setStored(action, stored)
    setRemaining(Math.max(0, config.max - stored.length))
  }, [action, config.max, config.window])

  return { remaining, limited: remaining <= 0, resetIn, increment }
}
