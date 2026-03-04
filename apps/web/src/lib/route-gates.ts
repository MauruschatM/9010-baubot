import { createServerFn } from "@tanstack/react-start";

import { getToken } from "@/lib/auth-server";

export const getAuthTokenForRouting = createServerFn({ method: "GET" }).handler(
  async () => {
    try {
      return await getToken();
    } catch (error) {
      console.error("Failed to get auth token for routing", error);
      return null;
    }
  },
);
