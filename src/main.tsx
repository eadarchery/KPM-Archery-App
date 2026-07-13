import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/globals.css'
import App from './App'

// One-time cleanup: earlier builds' service worker cached Supabase API
// responses ('supabase-api-cache'), which could replay one user's data to
// another on a shared device. The caching rule is gone (vite.config.ts);
// this removes the leftover bucket from already-installed clients.
if ('caches' in window) caches.delete('supabase-api-cache').catch(() => {})

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
