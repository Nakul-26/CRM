import { PasswordService } from "./password.service";

describe("PasswordService", () => {
  const service = new PasswordService();

  it("hashes a password and verifies the correct plaintext against it", async () => {
    const hash = await service.hash("Sup3rSecret!!");
    expect(hash).not.toEqual("Sup3rSecret!!");
    await expect(service.compare("Sup3rSecret!!", hash)).resolves.toBe(true);
  });

  it("rejects an incorrect plaintext against a hash", async () => {
    const hash = await service.hash("Sup3rSecret!!");
    await expect(service.compare("WrongPassword!!", hash)).resolves.toBe(false);
  });

  it("generates temporary passwords that are non-empty and unique across calls", () => {
    const a = service.generateTemporaryPassword();
    const b = service.generateTemporaryPassword();
    expect(a.length).toBeGreaterThan(16);
    expect(a).not.toEqual(b);
  });
});
