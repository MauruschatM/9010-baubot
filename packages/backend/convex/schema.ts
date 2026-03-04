import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  userPreferences: defineTable({
    userId: v.string(),
    locale: v.union(v.literal("en"), v.literal("de")),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),
});
