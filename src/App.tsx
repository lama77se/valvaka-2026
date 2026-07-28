import { Button } from '@/components/ui/button'

function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          Fas 0 — skelett
        </p>
        <h1 className="text-4xl font-bold tracking-tight">Valvaka 2026</h1>
        <p className="max-w-md text-muted-foreground">
          Realtidsvisualisering av svenska valresultat per valdistrikt. Kartan
          renderas i Fas 1.
        </p>
      </div>
      <Button>Kom igång</Button>
    </main>
  )
}

export default App
