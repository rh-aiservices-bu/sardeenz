import { TSchema, Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export interface ValidationError {
  path: string
  message: string
  value?: unknown
}

export interface ValidationResult<T> {
  success: boolean
  data?: T
  errors?: ValidationError[]
}

/**
 * Validate data against a TypeBox schema
 */
export function validate<T extends TSchema>(schema: T, data: unknown): ValidationResult<Static<T>> {
  const errors: ValidationError[] = []

  if (!Value.Check(schema, data)) {
    const issues = [...Value.Errors(schema, data)]
    for (const issue of issues) {
      errors.push({
        path: issue.path,
        message: issue.message,
        value: issue.value,
      })
    }

    return {
      success: false,
      errors,
    }
  }

  return {
    success: true,
    data: data as Static<T>,
  }
}

/**
 * Assert that data matches schema, throwing if invalid
 */
export function assertValid<T extends TSchema>(
  schema: T,
  data: unknown
): asserts data is Static<T> {
  const result = validate(schema, data)
  if (!result.success) {
    const errorMessages = result.errors?.map((e) => `${e.path}: ${e.message}`).join(', ')
    throw new Error(`Validation failed: ${errorMessages}`)
  }
}

/**
 * Create a validator function for a specific schema
 */
export function createValidator<T extends TSchema>(schema: T) {
  return (data: unknown): ValidationResult<Static<T>> => {
    return validate(schema, data)
  }
}
