// The signed-in member's team, read from the sign-in cookie on the server.
// Every server read of team data goes through this, so the team always
// comes from the signed cookie and never from anything the browser sends.

import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, readSession, type Role } from "./session";

export interface CurrentTeam {
  userId: string;
  teamId: number;
  role: Role;
}

/** Thrown when a server read needs a team but nobody is signed in. */
export class SignedOutError extends Error {
  constructor() {
    super("Sign in first");
    this.name = "SignedOutError";
  }
}

/** The signed-in member's user id, team id and role. Throws SignedOutError when there is no valid cookie. */
export async function currentTeam(): Promise<CurrentTeam> {
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) throw new SignedOutError();
  return { userId: session.userId, teamId: session.teamId, role: session.role };
}
