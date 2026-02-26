import { EventsView } from "../components/EventsView";
import { SubscribeForm } from "../components/SubscribeForm";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <header>
        <div className="max-w-[640px] mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="font-[family-name:var(--font-space-grotesk)] text-lg font-bold tracking-tight">
            <span
              className="bg-clip-text text-transparent animate-gradient-shift bg-[length:200%_auto]
                motion-reduce:animate-none motion-reduce:text-[var(--color-text)]"
              style={{
                backgroundImage: "linear-gradient(90deg, #F5A623, #6B8AFF, #7C3AED, #F5A623)",
              }}
            >
              jio
            </span>
          </h1>
          <span className="text-xs text-[var(--color-muted)] hidden sm:block">
            Curated things to do this week
          </span>
        </div>
        <div
          className="h-px w-full animate-border-glow bg-[length:200%_auto]
            motion-reduce:animate-none motion-reduce:bg-white/5"
          style={{
            backgroundImage: "linear-gradient(90deg, transparent, #F5A623, #6B8AFF, #7C3AED, transparent)",
          }}
          aria-hidden="true"
        />
      </header>

      <main className="flex-1 max-w-[640px] mx-auto w-full px-4 pt-0 pb-6">
        <EventsView />
      </main>

      <section className="border-t border-white/10 py-12">
        <div className="max-w-[640px] mx-auto px-4 text-center">
          <p className="text-sm text-[var(--color-muted)] mb-4">
            Get the list every Thursday.
          </p>
          <SubscribeForm />
        </div>
      </section>

      <footer className="border-t border-white/5 py-8">
        <div className="max-w-[640px] mx-auto px-4 text-center">
          <p className="text-xs text-[var(--color-muted)]">
            Built by a guy who was tired of not knowing what&apos;s on. Singapore.
          </p>
        </div>
      </footer>
    </div>
  );
}
