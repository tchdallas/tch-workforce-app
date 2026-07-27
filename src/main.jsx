import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { initErrorLog } from '@/lib/errorLog'
import { registerServiceWorker } from '@/lib/push'

// start capturing console errors early so bug reports can include recent ones
initErrorLog()

// The worker only receives push — it deliberately doesn't cache or intercept
// requests, so registration can't affect what the app serves. Failure is
// swallowed: no push is a degraded feature, not a broken app.
registerServiceWorker()

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
