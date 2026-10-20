import { zValidator } from "@hono/zod-validator";
import type { ZodType } from "zod";

/** JSON body validation with one error shape for the whole API. */
export const json = <T extends ZodType>(schema: T) =>
  zValidator("json", schema, (result, c) => {
    if (!result.success) return c.json({ error: "invalid input", issues: result.error.issues }, 400);
  });
