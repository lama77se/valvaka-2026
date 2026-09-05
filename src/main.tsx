import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Sista skyddsnätet: utan en ErrorBoundary blir ETT render-undantag (t.ex. en oväntad null-rad
// från en ny fil på valnatten) en helt vit sida för alla besökare. Här visar vi i stället ett
// tydligt felläge med "ladda om" — data ligger kvar på servern, fliken behöver bara starta om.
class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[valvaka] okänt renderfel', error, info.componentStack)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 p-6 text-center text-slate-100">
        <h1 className="text-xl font-semibold">Något gick fel i visningen</h1>
        <p className="max-w-md text-sm text-slate-400">
          Resultaten finns kvar — det är bara den här fliken som behöver starta om.
        </p>
        <button
          type="button"
          onClick={() => location.reload()}
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
        >
          Ladda om sidan
        </button>
        <pre className="mt-4 max-w-full overflow-x-auto text-left text-xs text-slate-500">{this.state.error.message}</pre>
      </div>
    )
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
)
