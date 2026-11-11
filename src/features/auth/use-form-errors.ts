import { useState } from "react";
import type { z } from "zod";

export type FieldErrors<T> = Partial<Record<keyof T, string>>;

/** Validates form values with a shared Zod schema and keeps the first error per field. */
export function useFormErrors<Schema extends z.ZodObject>(schema: Schema) {
  const [errors, setErrors] = useState<FieldErrors<z.infer<Schema>>>({});

  function validate(values: unknown): z.infer<Schema> | null {
    const result = schema.safeParse(values);
    if (result.success) {
      setErrors({});
      return result.data;
    }
    const next: FieldErrors<z.infer<Schema>> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof z.infer<Schema> | undefined;
      if (key !== undefined && !next[key]) next[key] = issue.message;
    }
    setErrors(next);
    return null;
  }

  return { errors, validate };
}
