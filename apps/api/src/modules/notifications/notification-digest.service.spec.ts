import type { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@sales-platform/config";
import { NotificationDigestService } from "./notification-digest.service";
import type { MailerService } from "../../shared/mail/mailer.service";
import type { Database } from "../../database/database.module";

function makeConfig(): ConfigService<ApiEnv, true> {
  return { get: () => "http://localhost:3000" } as unknown as ConfigService<ApiEnv, true>;
}

type Row = { notificationId: string; userId: string; email: string; title: string; link: string | null };

/**
 * `sendDueDigests()`'s select is a fixed two-inner-join chain terminating in
 * `.where()` — no `.limit()`/further branching to worry about, unlike
 * NotificationsService's two-different-tables case. `update()` is asserted
 * separately per test via its own mock.
 */
function makeDb(rows: Row[]) {
  const where = jest.fn().mockResolvedValue(rows);
  const innerJoin2 = jest.fn().mockReturnValue({ where });
  const innerJoin1 = jest.fn().mockReturnValue({ innerJoin: innerJoin2 });
  const from = jest.fn().mockReturnValue({ innerJoin: innerJoin1 });
  const select = jest.fn().mockReturnValue({ from });

  const updateWhere = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn().mockReturnValue({ where: updateWhere });
  const update = jest.fn().mockReturnValue({ set });

  return { db: { select, update } as unknown as Database, set, updateWhere };
}

function makeMailer(sendImpl: (to: string) => Promise<void> = () => Promise.resolve()): MailerService {
  return { send: jest.fn().mockImplementation((input: { to: string }) => sendImpl(input.to)) } as unknown as MailerService;
}

describe("NotificationDigestService", () => {
  it("sends one email per due user covering all their undigested notifications, then stamps digestSentAt", async () => {
    const { db, set, updateWhere } = makeDb([
      { notificationId: "n1", userId: "user_1", email: "a@example.com", title: "A ticket was assigned to you", link: "/support/tickets/t1" },
      { notificationId: "n2", userId: "user_1", email: "a@example.com", title: "Your quote was accepted", link: "/quotes/q1" },
      { notificationId: "n3", userId: "user_2", email: "b@example.com", title: "Your opportunity was won", link: "/sales/opportunities/o1" },
    ]);
    const mailer = makeMailer();
    const service = new NotificationDigestService(db, mailer, makeConfig());

    const sent = await service.sendDueDigests();

    expect(sent).toBe(2);
    expect(mailer.send).toHaveBeenCalledTimes(2);
    expect(mailer.send).toHaveBeenCalledWith(expect.objectContaining({ to: "a@example.com" }));
    expect(mailer.send).toHaveBeenCalledWith(expect.objectContaining({ to: "b@example.com" }));
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ digestSentAt: expect.any(Date) }));
    expect(updateWhere).toHaveBeenCalledTimes(2);
  });

  it("does nothing when there are no undigested daily_digest-mode notifications", async () => {
    const { db } = makeDb([]);
    const mailer = makeMailer();
    const service = new NotificationDigestService(db, mailer, makeConfig());

    await expect(service.sendDueDigests()).resolves.toBe(0);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("swallows one user's mail failure without skipping the rest of the batch", async () => {
    const { db } = makeDb([
      { notificationId: "n1", userId: "user_1", email: "fails@example.com", title: "A ticket was assigned to you", link: null },
      { notificationId: "n2", userId: "user_2", email: "ok@example.com", title: "Your quote was accepted", link: null },
    ]);
    const mailer = makeMailer((to) => (to === "fails@example.com" ? Promise.reject(new Error("SMTP down")) : Promise.resolve()));
    const service = new NotificationDigestService(db, mailer, makeConfig());

    const sent = await service.sendDueDigests();

    expect(sent).toBe(1);
    expect(mailer.send).toHaveBeenCalledTimes(2);
  });
});
