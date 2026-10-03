import "@fastify/session";
import type { FastifyRequest } from "fastify";
import type { AuthProvider, AuthUser } from "./provider.js";
import type { UserStore } from "./users.js";

declare module "@fastify/session" {
  interface FastifySessionObject {
    user?: AuthUser;
    flash?: string;
  }
}

/** Username and password against the local user store, remembered in a server-side session. */
export class LocalAuthProvider implements AuthProvider {
  readonly kind = "local";

  constructor(private readonly users: UserStore) {}

  async currentUser(req: FastifyRequest): Promise<AuthUser | null> {
    return req.session.user ?? null;
  }

  async login(req: FastifyRequest, username: string, password: string): Promise<AuthUser | null> {
    const user = await this.users.verify(username, password);
    if (!user) return null;
    await req.session.regenerate(); // new session id on login, prevents session fixation
    req.session.user = user;
    return user;
  }

  async logout(req: FastifyRequest): Promise<void> {
    await req.session.destroy();
  }
}
