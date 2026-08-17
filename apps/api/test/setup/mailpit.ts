const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:8025";

export interface MailpitMessageSummary {
  ID: string;
  To: { Address: string; Name: string }[];
  From: { Address: string; Name: string };
  Subject: string;
}

interface MailpitListResponse {
  messages: MailpitMessageSummary[];
}

export interface MailpitMessage extends MailpitMessageSummary {
  HTML: string;
  Text: string;
}

export async function clearMailpit(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" });
}

async function listMessages(): Promise<MailpitMessageSummary[]> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/messages`);
  const body = (await res.json()) as MailpitListResponse;
  return body.messages;
}

export async function getMessage(id: string): Promise<MailpitMessage> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);
  return (await res.json()) as MailpitMessage;
}

/** Polls Mailpit's real REST API until a message matching `predicate` shows up, or times out. */
export async function waitForMessage(
  predicate: (message: MailpitMessageSummary) => boolean,
  timeoutMs = 5000,
): Promise<MailpitMessageSummary> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await listMessages();
    const match = messages.find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for a matching message in Mailpit`);
}

/** Asserts no matching message arrives within a short window — used for "should not email" cases. */
export async function assertNoMessage(predicate: (message: MailpitMessageSummary) => boolean, windowMs = 1500): Promise<void> {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    const messages = await listMessages();
    if (messages.some(predicate)) {
      throw new Error("Expected no matching message, but one arrived");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
