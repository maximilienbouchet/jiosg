// TODO: Implement email functionality with Resend

export async function sendDigestEmail(): Promise<void> {
  // TODO: Build HTML email with this week's events, send via Resend
  throw new Error("Not implemented");
}

export async function addSubscriber(_email: string): Promise<{ unsubscribeToken: string }> {
  // TODO: Insert subscriber into DB, return unsubscribe token
  throw new Error("Not implemented");
}

export async function removeSubscriber(_token: string): Promise<boolean> {
  // TODO: Set is_active = false for subscriber with matching token
  throw new Error("Not implemented");
}
