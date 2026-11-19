import type { AiFulfiller } from "@flawdot/core-model";

/**
 * Who answers the AI when nobody does (the "rules only" mode): it says that nothing was analyzed, so the categories of
 * the AI have no score ("—") and the total is made of the categories that were. It never reads the request.
 */
export function createNoAiFulfiller(): AiFulfiller {
  return { mode: "none", fulfill: async () => "not_analyzed" };
}
