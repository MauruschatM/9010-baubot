import { ConvexError, v } from "convex/values";

import { components } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireActiveOrganization, requireAuthUserId } from "./authhelpers";
import {
  archivedCustomerResponseFields,
  customerResponseFields,
  normalizeCustomerContactName,
  normalizeCustomerEmail,
  normalizeCustomerName,
  normalizeCustomerPhone,
  toArchivedCustomerResponse,
  toCustomerResponse,
} from "./customerFields";
import { resolveProjectStatus } from "./projectStatus";

const customerListItemValidator = v.object({
  ...customerResponseFields,
  activeProjectCount: v.number(),
  doneProjectCount: v.number(),
});

type MemberDoc = {
  _id: string;
  organizationId: string;
  userId: string;
};

function ensureCustomerBelongsToOrganization(
  customer: Doc<"customers"> | null,
  organizationId: string,
) {
  if (!customer) {
    throw new ConvexError("Customer not found");
  }

  if (customer.organizationId !== organizationId) {
    throw new ConvexError("Unauthorized");
  }

  return customer;
}

async function requireOrganizationMember(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
  userId: string,
) {
  const member = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "member",
    where: [
      {
        field: "organizationId",
        operator: "eq",
        value: organizationId,
      },
      {
        field: "userId",
        operator: "eq",
        value: userId,
      },
    ],
  })) as MemberDoc | null;

  if (!member) {
    throw new ConvexError("Unauthorized");
  }

  return member;
}

function buildCustomerCounts(projects: Array<Doc<"projects">>) {
  const countsByCustomerId = new Map<string, { active: number; done: number }>();

  for (const project of projects) {
    if (!project.customerId) {
      continue;
    }

    const key = String(project.customerId);
    const current = countsByCustomerId.get(key) ?? { active: 0, done: 0 };
    if (resolveProjectStatus(project.status) === "done") {
      current.done += 1;
    } else {
      current.active += 1;
    }
    countsByCustomerId.set(key, current);
  }

  return countsByCustomerId;
}

async function listCustomersForOrganization(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    userId: string;
  },
) {
  await requireOrganizationMember(ctx, args.organizationId, args.userId);
  const [customers, projects] = await Promise.all([
    ctx.db
      .query("customers")
      .withIndex("by_organization_deletedAt_updatedAt", (q) =>
        q.eq("organizationId", args.organizationId).eq("deletedAt", undefined),
      )
      .order("desc")
      .collect(),
    ctx.db
      .query("projects")
      .withIndex("by_organization_deletedAt_updatedAt", (q) =>
        q.eq("organizationId", args.organizationId).eq("deletedAt", undefined),
      )
      .order("desc")
      .collect(),
  ]);

  const countsByCustomerId = buildCustomerCounts(projects);

  return customers.map((customer) => {
    const counts = countsByCustomerId.get(String(customer._id)) ?? { active: 0, done: 0 };

    return {
      ...toCustomerResponse(customer),
      activeProjectCount: counts.active,
      doneProjectCount: counts.done,
    };
  });
}

async function getCustomerByIdForOrganization(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    userId: string;
    customerId: Doc<"customers">["_id"];
  },
) {
  await requireOrganizationMember(ctx, args.organizationId, args.userId);
  const customer = await ctx.db.get(args.customerId);

  if (
    !customer ||
    customer.organizationId !== args.organizationId ||
    customer.deletedAt !== undefined
  ) {
    return null;
  }

  const linkedProjects = await ctx.db
    .query("projects")
    .withIndex("by_customerId_updatedAt", (q) => q.eq("customerId", args.customerId))
    .order("desc")
    .collect();

  let activeProjectCount = 0;
  let doneProjectCount = 0;
  for (const project of linkedProjects) {
    if (project.organizationId !== args.organizationId || project.deletedAt !== undefined) {
      continue;
    }

    if (resolveProjectStatus(project.status) === "done") {
      doneProjectCount += 1;
    } else {
      activeProjectCount += 1;
    }
  }

  return {
    ...toCustomerResponse(customer),
    activeProjectCount,
    doneProjectCount,
  };
}

async function listArchivedCustomersForOrganization(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    userId: string;
  },
) {
  await requireOrganizationMember(ctx, args.organizationId, args.userId);
  const customers = await ctx.db
    .query("customers")
    .withIndex("by_organization_deletedAt_updatedAt", (q) =>
      q.eq("organizationId", args.organizationId).gt("deletedAt", undefined),
    )
    .order("desc")
    .collect();

  return await Promise.all(
    customers.map(async (customer) => {
      const linkedProjects = await ctx.db
        .query("projects")
        .withIndex("by_customerId_updatedAt", (q) => q.eq("customerId", customer._id))
        .collect();

      return {
        ...toArchivedCustomerResponse(customer),
        linkedProjectCount: linkedProjects.filter(
          (project) => project.organizationId === args.organizationId,
        ).length,
      };
    }),
  );
}

export const list = query({
  args: {},
  returns: v.array(customerListItemValidator),
  handler: async (ctx) => {
    const [organization, userId] = await Promise.all([
      requireActiveOrganization(ctx),
      requireAuthUserId(ctx),
    ]);
    return await listCustomersForOrganization(ctx, {
      organizationId: organization.id,
      userId,
    });
  },
});

export const getById = query({
  args: {
    customerId: v.id("customers"),
  },
  returns: v.union(
    v.object({
      _id: v.id("customers"),
      _creationTime: v.number(),
      organizationId: v.string(),
      createdBy: v.string(),
      name: v.string(),
      contactName: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
      activeProjectCount: v.number(),
      doneProjectCount: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const [organization, userId] = await Promise.all([
      requireActiveOrganization(ctx),
      requireAuthUserId(ctx),
    ]);
    return await getCustomerByIdForOrganization(ctx, {
      organizationId: organization.id,
      userId,
      customerId: args.customerId,
    });
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    contactName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  returns: v.id("customers"),
  handler: async (ctx, args) => {
    const [organization, userId] = await Promise.all([
      requireActiveOrganization(ctx),
      requireAuthUserId(ctx),
    ]);
    const now = Date.now();

    return await ctx.db.insert("customers", {
      organizationId: organization.id,
      createdBy: userId,
      name: normalizeCustomerName(args.name),
      contactName: normalizeCustomerContactName(args.contactName),
      email: normalizeCustomerEmail(args.email),
      phone: normalizeCustomerPhone(args.phone),
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const listForOrganization = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
  },
  returns: v.array(customerListItemValidator),
  handler: async (ctx, args) => {
    return await listCustomersForOrganization(ctx, args);
  },
});

export const getByIdForOrganization = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    customerId: v.id("customers"),
  },
  returns: v.union(
    v.object({
      _id: v.id("customers"),
      _creationTime: v.number(),
      organizationId: v.string(),
      createdBy: v.string(),
      name: v.string(),
      contactName: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
      activeProjectCount: v.number(),
      doneProjectCount: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return await getCustomerByIdForOrganization(ctx, args);
  },
});

export const createForOrganization = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    name: v.string(),
    contactName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  returns: v.id("customers"),
  handler: async (ctx, args) => {
    await requireOrganizationMember(ctx, args.organizationId, args.userId);
    const now = Date.now();

    return await ctx.db.insert("customers", {
      organizationId: args.organizationId,
      createdBy: args.userId,
      name: normalizeCustomerName(args.name),
      contactName: normalizeCustomerContactName(args.contactName),
      email: normalizeCustomerEmail(args.email),
      phone: normalizeCustomerPhone(args.phone),
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateForOrganization = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    customerId: v.id("customers"),
    name: v.optional(v.string()),
    contactName: v.optional(v.union(v.string(), v.null())),
    email: v.optional(v.union(v.string(), v.null())),
    phone: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrganizationMember(ctx, args.organizationId, args.userId);
    const customer = ensureCustomerBelongsToOrganization(
      await ctx.db.get(args.customerId),
      args.organizationId,
    );

    if (customer.deletedAt !== undefined) {
      throw new ConvexError("Customer not found");
    }

    if (
      args.name === undefined &&
      args.contactName === undefined &&
      args.email === undefined &&
      args.phone === undefined
    ) {
      return null;
    }

    const patch: Partial<Doc<"customers">> = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) {
      patch.name = normalizeCustomerName(args.name);
    }

    if (args.contactName !== undefined) {
      patch.contactName = normalizeCustomerContactName(args.contactName ?? undefined);
    }

    if (args.email !== undefined) {
      patch.email = normalizeCustomerEmail(args.email ?? undefined);
    }

    if (args.phone !== undefined) {
      patch.phone = normalizeCustomerPhone(args.phone ?? undefined);
    }

    await ctx.db.patch(args.customerId, patch);
    return null;
  },
});

export const restoreForOrganization = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    customerId: v.id("customers"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrganizationMember(ctx, args.organizationId, args.userId);
    const customer = ensureCustomerBelongsToOrganization(
      await ctx.db.get(args.customerId),
      args.organizationId,
    );

    if (customer.deletedAt === undefined) {
      return null;
    }

    await ctx.db.patch(args.customerId, {
      deletedAt: undefined,
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const listArchivedForOrganization = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
  },
  returns: v.array(
    v.object({
      ...archivedCustomerResponseFields,
      linkedProjectCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    return await listArchivedCustomersForOrganization(ctx, args);
  },
});

export const update = mutation({
  args: {
    customerId: v.id("customers"),
    name: v.optional(v.string()),
    contactName: v.optional(v.union(v.string(), v.null())),
    email: v.optional(v.union(v.string(), v.null())),
    phone: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const organization = await requireActiveOrganization(ctx);
    const customer = ensureCustomerBelongsToOrganization(
      await ctx.db.get(args.customerId),
      organization.id,
    );

    if (customer.deletedAt !== undefined) {
      throw new ConvexError("Customer not found");
    }

    if (
      args.name === undefined &&
      args.contactName === undefined &&
      args.email === undefined &&
      args.phone === undefined
    ) {
      return null;
    }

    const patch: Partial<Doc<"customers">> = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) {
      patch.name = normalizeCustomerName(args.name);
    }

    if (args.contactName !== undefined) {
      patch.contactName = normalizeCustomerContactName(args.contactName ?? undefined);
    }

    if (args.email !== undefined) {
      patch.email = normalizeCustomerEmail(args.email ?? undefined);
    }

    if (args.phone !== undefined) {
      patch.phone = normalizeCustomerPhone(args.phone ?? undefined);
    }

    await ctx.db.patch(args.customerId, patch);
    return null;
  },
});

export const archive = mutation({
  args: {
    customerId: v.id("customers"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const organization = await requireActiveOrganization(ctx);
    const customer = ensureCustomerBelongsToOrganization(
      await ctx.db.get(args.customerId),
      organization.id,
    );

    if (customer.deletedAt !== undefined) {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(args.customerId, {
      deletedAt: now,
      updatedAt: now,
    });

    const linkedProjects = await ctx.db
      .query("projects")
      .withIndex("by_customerId_updatedAt", (q) => q.eq("customerId", args.customerId))
      .order("desc")
      .collect();

    await Promise.all(
      linkedProjects.map(async (project) => {
        if (project.organizationId !== organization.id || project.deletedAt !== undefined) {
          return;
        }

        await ctx.db.patch(project._id, {
          deletedAt: now,
          updatedAt: now,
        });
      }),
    );

    return null;
  },
});

export const restore = mutation({
  args: {
    customerId: v.id("customers"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const organization = await requireActiveOrganization(ctx);
    const customer = ensureCustomerBelongsToOrganization(
      await ctx.db.get(args.customerId),
      organization.id,
    );

    if (customer.deletedAt === undefined) {
      return null;
    }

    await ctx.db.patch(args.customerId, {
      deletedAt: undefined,
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const listArchived = query({
  args: {},
  returns: v.array(
    v.object({
      ...archivedCustomerResponseFields,
      linkedProjectCount: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const organization = await requireActiveOrganization(ctx);
    const customers = await ctx.db
      .query("customers")
      .withIndex("by_organization_deletedAt_updatedAt", (q) =>
        q.eq("organizationId", organization.id).gt("deletedAt", undefined),
      )
      .order("desc")
      .collect();

    return await Promise.all(
      customers.map(async (customer) => {
        const linkedProjects = await ctx.db
          .query("projects")
          .withIndex("by_customerId_updatedAt", (q) => q.eq("customerId", customer._id))
          .collect();

        return {
          ...toArchivedCustomerResponse(customer),
          linkedProjectCount: linkedProjects.filter(
            (project) => project.organizationId === organization.id,
          ).length,
        };
      }),
    );
  },
});
