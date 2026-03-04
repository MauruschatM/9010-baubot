import { query } from "./_generated/server";
import { authComponent } from "./auth";

export const get = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);

    return {
      isAuthenticated: !!authUser,
    };
  },
});
