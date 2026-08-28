import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const hadController = Boolean(navigator.serviceWorker.controller)
  let isReloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !isReloading) {
      isReloading = true
      window.location.reload()
    }
  })

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js?v=6`, { updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch(() => {
        // The app remains usable if offline support cannot be registered.
      })
  })
}
