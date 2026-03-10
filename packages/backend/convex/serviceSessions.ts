import { components } from "./_generated/api";

const SERVICE_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const SESSION_PAGE_SIZE = 20;

type SessionDoc = {
  _id: string;
  expiresAt: number | string | Date;
  token: string;
  createdAt: number;
  updatedAt: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  userId: string;
  activeOrganizationId?: string | null;
};

function normalizeDateLike(value: number | string | Date | null | undefined) {
  if (typeof value === "number") {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

function createToken() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

async function listSessionsForUser(ctx: {
  runQuery: (
    queryRef: any,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}, userId: string) {
  const sessionsResult = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "session",
    where: [
      {
        field: "userId",
        operator: "eq",
        value: userId,
      },
    ],
    paginationOpts: {
      cursor: null,
      numItems: SESSION_PAGE_SIZE,
    },
  })) as { page?: SessionDoc[] };

  return (sessionsResult.page ?? []) as SessionDoc[];
}

export async function ensureServiceSessionForUser(
  ctx: {
    runQuery: (
      queryRef: any,
      args: Record<string, unknown>,
    ) => Promise<unknown>;
    runMutation: (
      mutationRef: any,
      args: Record<string, unknown>,
    ) => Promise<unknown>;
  },
  args: {
    userId: string;
    organizationId: string;
    userAgent?: string;
  },
) {
  const sessions = await listSessionsForUser(ctx, args.userId);
  const now = Date.now();
  const activeMatching = sessions
    .filter((session) => {
      return (
        session.token &&
        normalizeDateLike(session.expiresAt) > now &&
        session.activeOrganizationId === args.organizationId
      );
    })
    .sort((sessionA, sessionB) => (sessionB.updatedAt ?? 0) - (sessionA.updatedAt ?? 0))[0];

  if (activeMatching?.token) {
    return activeMatching.token;
  }

  const token = createToken();
  await ctx.runMutation(components.betterAuth.adapter.create as never, {
    input: {
      model: "session",
      data: {
        expiresAt: now + SERVICE_SESSION_TTL_MS,
        token,
        createdAt: now,
        updatedAt: now,
        ipAddress: null,
        userAgent: args.userAgent ?? "whatsapp-service-session",
        userId: args.userId,
        activeOrganizationId: args.organizationId,
      },
    },
  } as never);

  return token;
}

export async function getSessionHeadersForUser(
  ctx: {
    runQuery: (
      queryRef: any,
      args: Record<string, unknown>,
    ) => Promise<unknown>;
  },
  userId: string,
  organizationId?: string,
) {
  const sessions = await listSessionsForUser(ctx, userId);
  const now = Date.now();
  const activeSessions = sessions
    .filter((session) => session.token && normalizeDateLike(session.expiresAt) > now)
    .sort((sessionA, sessionB) => (sessionB.updatedAt ?? 0) - (sessionA.updatedAt ?? 0));

  const activeSession =
    (organizationId
      ? activeSessions.find((session) => session.activeOrganizationId === organizationId)
      : null) ?? activeSessions[0];

  const headers = new Headers();
  if (activeSession?.token) {
    headers.set("cookie", `better-auth.session_token=${activeSession.token}`);
  }

  return headers;
}

export async function deleteSessionsForUser(ctx: {
  runMutation: (
    mutationRef: any,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}, userId: string) {
  await ctx.runMutation(components.betterAuth.adapter.deleteMany as never, {
    input: {
      model: "session",
      where: [
        {
          field: "userId",
          operator: "eq",
          value: userId,
        },
      ],
    },
    paginationOpts: {
      cursor: null,
      numItems: 100,
    },
  } as never);
}
