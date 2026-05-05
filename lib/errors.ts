/**
 * Error hierarchy for n8n-nodes-brikko.
 *
 * The node `execute()` method maps these to `NodeOperationError` /
 * `NodeApiError` so n8n surfaces them with the right severity.
 */

export class BrikkoError extends Error {
	public override readonly cause?: unknown;
	constructor(message: string, cause?: unknown) {
		super(message);
		this.name = this.constructor.name;
		this.cause = cause;
	}
}

/** Sidecar / Gateway is unreachable (DNS, TCP refused, timeout). */
export class BrikkoUnavailableError extends BrikkoError {
	public readonly url: string;
	constructor(url: string, cause?: unknown) {
		super(`Brikko endpoint unreachable: ${url}`, cause);
		this.url = url;
	}
}

/** HTTP 4xx/5xx with body payload. */
export class BrikkoRequestError extends BrikkoError {
	public readonly status: number;
	public readonly body: string;
	constructor(status: number, body: string) {
		super(`Brikko HTTP ${status}: ${body.slice(0, 200)}`);
		this.status = status;
		this.body = body;
	}
}

/**
 * Thrown when a node is configured for `mode: local` but Studio is not
 * reachable, or `mode: gateway` but no API credential was provided. Used
 * to surface a clear, actionable message in the n8n UI.
 */
export class BrikkoConfigError extends BrikkoError {}
