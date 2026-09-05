import type { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@sales-platform/config";
import { NotificationsService } from "./notifications.service";
import type { MailerService } from "../../shared/mail/mailer.service";
import { notificationPreferences } from "../../database/schema";
import type { Database } from "../../database/database.module";

function makeConfig(): ConfigService<ApiEnv, true> {
  return { get: () => "http://localhost:3000" } as unknown as ConfigService<ApiEnv, true>;
}

function makeMailer(sendImpl: () => Promise<void> = () => Promise.resolve()): MailerService {
  return { send: jest.fn().mockImplementation(sendImpl) } as unknown as MailerService;
}

/**
 * Same "hand-mock the chained select().from().where()..." shape as
 * dunning.scheduler.spec.ts, branching on which table `.from()` was called
 * with rather than call-counting — the two selects here target different
 * tables (notificationPreferences vs. users), so this is simpler and more
 * robust than counting calls.
 */
function makeDb(options: { preferenceRow?: { emailDelivery: string }; userRow?: { email: string } } = {}) {
  const preferenceLimit = jest.fn().mockResolvedValue(options.preferenceRow ? [options.preferenceRow] : []);
  const preferenceWhere = jest.fn().mockReturnValue({ limit: preferenceLimit });
  const userLimit = jest.fn().mockResolvedValue(options.userRow ? [options.userRow] : []);
  const userWhere = jest.fn().mockReturnValue({ limit: userLimit });

  const select = jest.fn().mockImplementation(() => ({
    from: jest.fn().mockImplementation((table: unknown) => ({
      where: table === notificationPreferences ? preferenceWhere : userWhere,
    })),
  }));

  const insertValues = jest.fn().mockResolvedValue(undefined);
  const insert = jest.fn().mockReturnValue({ values: insertValues });

  return { db: { select, insert } as unknown as Database, insertValues };
}

describe("NotificationsService", () => {
  describe("getPreferences", () => {
    it("returns \"off\" when the user has no preference row yet", async () => {
      const { db } = makeDb({});
      const service = new NotificationsService(db, makeMailer(), makeConfig());

      await expect(service.getPreferences("org_1", "user_1")).resolves.toEqual({ emailDelivery: "off" });
    });

    it("returns the stored preference when one exists", async () => {
      const { db } = makeDb({ preferenceRow: { emailDelivery: "daily_digest" } });
      const service = new NotificationsService(db, makeMailer(), makeConfig());

      await expect(service.getPreferences("org_1", "user_1")).resolves.toEqual({ emailDelivery: "daily_digest" });
    });
  });

  describe("setPreferences", () => {
    it("upserts via onConflictDoUpdate targeting the (organizationId, userId) unique index", async () => {
      const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
      const values = jest.fn().mockReturnValue({ onConflictDoUpdate });
      const insert = jest.fn().mockReturnValue({ values });
      const db = { insert } as unknown as Database;
      const service = new NotificationsService(db, makeMailer(), makeConfig());

      await service.setPreferences("org_1", "user_1", { emailDelivery: "immediate" });

      expect(values).toHaveBeenCalledWith({ organizationId: "org_1", userId: "user_1", emailDelivery: "immediate" });
      expect(onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ target: [notificationPreferences.organizationId, notificationPreferences.userId] }),
      );
    });
  });

  describe("create", () => {
    /**
     * create() deliberately does not await its email dispatch (see the
     * comment on NotificationsService.create()) — the in-app insert
     * resolves immediately, and the preference-check/send happens in the
     * background. Flushing a macrotask here lets that background chain's
     * mocked promises settle before asserting on them.
     */
    function flushMicrotasks(): Promise<void> {
      return new Promise((resolve) => setImmediate(resolve));
    }

    it("sends an immediate email when the recipient's preference is \"immediate\"", async () => {
      const { db } = makeDb({ preferenceRow: { emailDelivery: "immediate" }, userRow: { email: "assignee@example.com" } });
      const mailer = makeMailer();
      const service = new NotificationsService(db, mailer, makeConfig());

      await service.create("org_1", "user_1", { type: "ticket.assigned", title: "A ticket was assigned to you", link: "/support/tickets/t1" });
      await flushMicrotasks();

      expect(mailer.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: "assignee@example.com", subject: "A ticket was assigned to you" }),
      );
    });

    it("does not send an email when the recipient's preference is \"off\" (the default)", async () => {
      const { db } = makeDb({ userRow: { email: "assignee@example.com" } });
      const mailer = makeMailer();
      const service = new NotificationsService(db, mailer, makeConfig());

      await service.create("org_1", "user_1", { type: "ticket.assigned", title: "A ticket was assigned to you" });
      await flushMicrotasks();

      expect(mailer.send).not.toHaveBeenCalled();
    });

    it("does not send an immediate email when the recipient's preference is \"daily_digest\"", async () => {
      const { db } = makeDb({ preferenceRow: { emailDelivery: "daily_digest" }, userRow: { email: "assignee@example.com" } });
      const mailer = makeMailer();
      const service = new NotificationsService(db, mailer, makeConfig());

      await service.create("org_1", "user_1", { type: "ticket.assigned", title: "A ticket was assigned to you" });
      await flushMicrotasks();

      expect(mailer.send).not.toHaveBeenCalled();
    });

    it("does not throw when the immediate email fails to send", async () => {
      const { db } = makeDb({ preferenceRow: { emailDelivery: "immediate" }, userRow: { email: "assignee@example.com" } });
      const mailer = makeMailer(() => Promise.reject(new Error("SMTP down")));
      const service = new NotificationsService(db, mailer, makeConfig());

      await expect(
        service.create("org_1", "user_1", { type: "ticket.assigned", title: "A ticket was assigned to you" }),
      ).resolves.toBeUndefined();
    });
  });
});
