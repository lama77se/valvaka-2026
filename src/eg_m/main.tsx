// Helt egen entry-punkt (eg_m.html), fristående från src/main.tsx — ingen delad
// state/App.tsx/router. Samma minimala ErrorBoundary-mönster som huvudsidan
// (medvetet duplicerad, inte importerad — håller denna sida strukturellt oberoende).
import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { EgMApp } from './EgMApp'

class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[eg_m] okänt renderfel', error, info.componentStack)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 p-6 text-center text-slate-100">
        <h1 className="text-xl font-semibold">Något gick fel</h1>
        <button
          type="button"
          onClick={() => location.reload()}
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
        >
          Ladda om sidan
        </button>
      </div>
    )
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <EgMApp />
    </RootErrorBoundary>
  </StrictMode>,
)
