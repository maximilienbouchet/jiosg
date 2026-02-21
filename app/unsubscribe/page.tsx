// TODO: Implement unsubscribe handler — read token from query params, deactivate subscriber

export default function UnsubscribePage() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="font-[family-name:var(--font-space-grotesk)] text-2xl font-bold">
          Unsubscribe
        </h1>
        <p className="mt-4 text-[var(--color-muted)]">
          You have been unsubscribed.
        </p>
      </div>
    </main>
  );
}
