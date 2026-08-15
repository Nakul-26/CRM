import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import * as bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, SALT_ROUNDS);
  }

  compare(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  generateTemporaryPassword(): string {
    return randomBytes(18).toString("base64url");
  }
}
