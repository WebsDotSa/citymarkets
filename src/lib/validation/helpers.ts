/**
 * Helper functions for request-body validation. Kept separate so
 * feature schemas can `import { validateBody } from "./helpers"`
 * without dragging in unrelated Zod schema modules.
 */

import { z } from "zod";

/**
 * Helper function to validate request body
 */
export function validateBody<T>(
  schema: z.ZodSchema<T>,
  body: unknown,
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(body);

  if (!result.success) {
    const firstError = result.error.errors[0];
    return {
      success: false,
      error: firstError?.message || "بيانات غير صالحة",
    };
  }

  return { success: true, data: result.data };
}

/**
 * Helper function to create validation error response
 */
export function validationError(error: string) {
  return {
    error,
    success: false,
  };
}