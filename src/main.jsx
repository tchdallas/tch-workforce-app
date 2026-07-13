import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { initErrorLog } from '@/lib/errorLog'

// start capturing console errors early so bug reports can include recent ones
initErrorLog()

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
