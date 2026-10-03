import type { FastifyRequest } from "fastify";

export interface AuthUser {
  username: string;
  /** Only "admin" exists today. A read-only "viewer" role can be added without changing callers. */
  role: "admin";
}

/**
 * The app asks one question: who is this user? Swap the implementation for SSO (e.g. Entra ID) or a
 * reverse proxy that authenticates for you (read a trusted header) without touching routes or views.
 */
export interface AuthProvider {
  readonly kind: string;
  currentUser(req: FastifyRequest): Promise<AuthUser | null>;
  /** Only providers that use a username and password implement these. */
  login?(req: FastifyRequest, username: string, password: string): Promise<AuthUser | null>;
  logout?(req: FastifyRequest): Promise<void>;
}
