import { initializeDb, deactivateSubscriber } from "../../lib/db";

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  let status: "success" | "invalid" | "not-found";

  if (!token) {
    status = "invalid";
  } else {
    await initializeDb();
    const deactivated = await deactivateSubscriber(token);
    status = deactivated ? "success" : "not-found";
  }

  const heading =
    status === "success"
      ? "You\u2019ve been unsubscribed."
      : status === "invalid"
        ? "Invalid unsubscribe link."
        : "Already unsubscribed.";

  const body =
    status === "success"
      ? "No more emails from jio."
      : status === "invalid"
        ? "This link is missing a token. Try clicking the link from your email again."
        : "You\u2019re already unsubscribed, or this link has expired.";

  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="text-center max-w-md px-4">
        <h1 className="font-[family-name:var(--font-space-grotesk)] text-2xl font-bold">
          {heading}
        </h1>
        <p className="mt-4 text-[var(--color-muted)]">{body}</p>
        <a
          href="/"
          className="mt-8 inline-block text-sm text-[var(--color-link)] hover:underline"
        >
          Back to jio
        </a>
      </div>
    </main>
  );
}
