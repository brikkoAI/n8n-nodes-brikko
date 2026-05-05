/**
 * Wire types for the Brikko Anonymizer HTTP API.
 *
 * Field names mirror the Pydantic schemas in
 * `brikko-studio/anonymizer/brikko_anonymizer/schemas.py` byte-for-byte
 * (snake_case). Do not rename without coordinating with the backend.
 */

export type PolicyProfileName = "strict" | "balanced" | "permissive";

export interface Entity {
	placeholder: string;
	category: string;
	confidence: number;
}

// --- /anonymize -------------------------------------------------------

export interface AnonymizeRequest {
	workspace_id: string;
	text: string;
	policy_profile?: PolicyProfileName;
	session_id?: string;
	request_id: string;
}

export interface AnonymizeResponse {
	masked_text: string;
	entities: Entity[];
	request_id: string;
	degraded_mode: boolean;
	latency_ms: number;
}

// --- /restore --------------------------------------------------------

export interface RestoreRequest {
	workspace_id: string;
	text: string;
	request_id: string;
}

export interface HallucinatedEntity {
	placeholder: string;
}

export interface RestoreResponse {
	restored_text: string;
	hallucinated: HallucinatedEntity[];
	request_id: string;
	latency_ms: number;
}

// --- node-side aggregates --------------------------------------------

/**
 * What every Brikko node emits in its output `json` payload, on top of
 * the original item. Stable contract — downstream nodes (and end-user
 * workflows) reference these names.
 */
export interface BrikkoAnonymizeOutput {
	masked_text: string;
	mapping_id: string;
	entities: Entity[];
	policy: PolicyProfileName;
	source: "studio" | "gateway" | "regex";
	latency_ms: number;
}

export interface BrikkoRestoreOutput {
	restored_text: string;
	hallucinated: string[];
	source: "studio" | "gateway" | "regex";
	latency_ms: number;
}

export interface BrikkoChatOutput {
	response: string;
	masked_prompt: string;
	masked_response: string;
	mapping_id: string;
	model: string;
	latency_ms: number;
	source: "studio" | "gateway";
}

export interface BrikkoDetectOutput {
	found_pii: Array<{
		category: string;
		count: number;
		samples: string[];
	}>;
	total_count: number;
	source: "studio" | "regex";
}

// --- Brikko Gateway (OpenAI-compatible chat completion) --------------

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface ChatCompletionRequest {
	model: string;
	messages: ChatMessage[];
	temperature?: number;
	max_tokens?: number;
	stream?: false;
}

export interface ChatCompletionChoice {
	index: number;
	message: ChatMessage;
	finish_reason: string;
}

export interface ChatCompletionResponse {
	id: string;
	object: "chat.completion";
	created: number;
	model: string;
	choices: ChatCompletionChoice[];
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}
