export class ConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigurationError";
	}
}

export class CloudflareApiError extends Error {
	constructor(
		message: string,
		readonly status?: number,
		readonly details?: unknown,
	) {
		super(message);
		this.name = "CloudflareApiError";
	}
}

export class RecordSizeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RecordSizeError";
	}
}
