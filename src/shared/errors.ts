export interface FieldError {
  field: string;
  message: string;
}

export abstract class DomainError extends Error {
  override readonly name: string = this.constructor.name;
}

export class NotFoundError extends DomainError {
  constructor(message = 'Resource not found') {
    super(message);
  }
}

export class ConflictError extends DomainError {}

export class ValidationError extends DomainError {
  readonly errors: readonly FieldError[];

  constructor(errors: readonly FieldError[], message = 'Request is invalid') {
    super(message);
    this.errors = errors;
  }
}
