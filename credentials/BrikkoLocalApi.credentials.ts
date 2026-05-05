import type {
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from "n8n-workflow";

/**
 * Local Studio credential. Class name is `BrikkoLocalApi` (suffixed
 * `-Api`) to satisfy n8n's community-node lint rules; the user-facing
 * display name is "Brikko Local Studio API" so the UI is still clear.
 */
export class BrikkoLocalApi implements ICredentialType {
	name = "brikkoLocalApi";

	displayName = "Brikko Local Studio API";

	documentationUrl = "https://github.com/brikkoAI/brikko-studio";

	properties: INodeProperties[] = [
		{
			displayName: "Studio URL",
			name: "url",
			type: "string",
			default: "http://localhost:8403",
			description:
				"URL of the Brikko Studio Anonymizer sidecar. " +
				"URL сайдкара Brikko Studio.",
		},
		{
			displayName: "Workspace ID",
			name: "workspaceId",
			type: "string",
			default: "default",
			description:
				"Workspace identifier used to scope mappings. " +
				"Идентификатор рабочей области для разделения маппингов.",
		},
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: "={{$credentials.url}}",
			url: "/health",
			method: "GET",
		},
	};
}
