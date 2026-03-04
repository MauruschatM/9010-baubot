import { defineSchema } from "convex/server";

import { tables as generatedTables } from "./schema.generated";

const tables = {
  ...generatedTables,
  member: generatedTables.member.index("by_organizationId_userId", [
    "organizationId",
    "userId",
  ]),
  invitation: generatedTables.invitation.index("by_organizationId_status", [
    "organizationId",
    "status",
  ]),
};

export default defineSchema(tables);
