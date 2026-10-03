import { hash, verify } from "@node-rs/argon2";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AuthUser } from "./provider.js";

const UserRecord = z.object({
  username: z.string().min(1),
  passwordHash: z.string().min(1),
  role: z.literal("admin"),
  createdAt: z.string(),
});
const UsersFile = z.object({ users: z.array(UserRecord) });
type UserRecord = z.infer<typeof UserRecord>;

export const MIN_PASSWORD_LENGTH = 12;

/** Users live in the data volume: <data>/config/users.json (mode 0600). Passwords are argon2id hashes. */
export class UserStore {
  private users: UserRecord[] = [];
  private dummyHash = "";

  constructor(private readonly dataDir: string) {}

  private get file(): string {
    return join(this.dataDir, "config", "users.json");
  }

  async load(): Promise<void> {
    try {
      this.users = UsersFile.parse(JSON.parse(await readFile(this.file, "utf8"))).users;
    } catch {
      this.users = [];
    }
    // Used to burn the same time when a username does not exist, so response time does not reveal it.
    this.dummyHash = await hash("not-a-real-password-" + Math.random());
  }

  get count(): number {
    return this.users.length;
  }

  async create(username: string, password: string): Promise<void> {
    if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    if (this.users.some((u) => u.username === username)) throw new Error(`User "${username}" already exists`);
    this.users.push({ username, passwordHash: await hash(password), role: "admin", createdAt: new Date().toISOString() });
    await mkdir(join(this.dataDir, "config"), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify({ users: this.users }, null, 2) + "\n", { mode: 0o600 });
    await rename(tmp, this.file);
  }

  async verify(username: string, password: string): Promise<AuthUser | null> {
    const user = this.users.find((u) => u.username === username);
    if (!user) {
      await verify(this.dummyHash, password).catch(() => false);
      return null;
    }
    const ok = await verify(user.passwordHash, password).catch(() => false);
    return ok ? { username: user.username, role: user.role } : null;
  }
}
