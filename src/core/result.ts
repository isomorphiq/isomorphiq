/**
 * Result type for handling operations that can fail
 */
export type Result<T, E = Error> =
	| {
			success: true;
			data: T;
	  }
	| {
			success: false;
			error: E;
	  };

/**
 * Helper functions for working with Result types
 */
export const ResultUtils = {
	ok<T>(data: T): Result<T> {
		return { success: true, data };
	},

	err<E = Error>(error: E): Result<never, E> {
		return { success: false, error };
	},

	async wrap<T>(promise: Promise<T>): Promise<Result<T>> {
		try {
			const data = await promise;
			return ResultUtils.ok(data);
		} catch (error) {
			return ResultUtils.err(error instanceof Error ? error : new Error(String(error)));
		}
	},

	map<T, U>(result: Result<T>, fn: (data: T) => U): Result<U> {
		if (result.success) {
			return ResultUtils.ok(fn(result.data));
		}
		return result as Result<U>;
	},

	flatMap<T, U>(result: Result<T>, fn: (data: T) => Result<U>): Result<U> {
		if (result.success) {
			return fn(result.data);
		}
		return result as Result<U>;
	},
};

/**
 * Base domain entity
 */
export interface BaseEntity {
	id: string;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Domain-specific errors
 */
export class DomainError extends Error {
	public readonly code: string;
	public readonly details?: Record<string, unknown> | undefined;

	constructor(message: string, code: string, details?: Record<string, unknown>) {
		super(message);
		this.name = "DomainError";
		this.code = code;
		this.details = details as Record<string, unknown> | undefined;
	}
}

export class ValidationError extends DomainError {
	constructor(message: string, field?: string) {
		super(message, "VALIDATION_ERROR", { field });
		this.name = "ValidationError";
	}
}

export class NotFoundError extends DomainError {
	constructor(resource: string, id?: string) {
		super(`${resource}${id ? ` with id ${id}` : ""} not found`, "NOT_FOUND", { resource, id });
		this.name = "NotFoundError";
	}
}

export class UnauthorizedError extends DomainError {
	constructor(action: string, resource: string) {
		super(`Unauthorized to ${action} ${resource}`, "UNAUTHORIZED", { action, resource });
		this.name = "UnauthorizedError";
	}
}

export class ConflictError extends DomainError {
	constructor(message: string, details?: Record<string, unknown>) {
		super(message, "CONFLICT", details);
		this.name = "ConflictError";
	}
}
