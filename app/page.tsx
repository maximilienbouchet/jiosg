// TODO: Implement main events page with WeekNav, TagFilter, EventCards, SubscribeForm

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="font-[family-name:var(--font-space-grotesk)] text-4xl font-bold tracking-tight">
          SG Events
        </h1>
        <p className="mt-4 text-[var(--color-muted)]">
          Curated things to do in Singapore this week.
        </p>
      </div>
    </main>
  );
}
