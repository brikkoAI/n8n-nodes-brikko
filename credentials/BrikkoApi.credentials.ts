import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from "n8n-workflow";

export class BrikkoApi implements ICredentialType {
	name = "brikkoApi";

	displayName = "Brikko API";

	documentationUrl = "https://brikko.ru/docs/api";

	properties: INodeProperties[] = [
		{
			displayName: "API Key",
			name: "apiKey",
			type: "string",
			typeOptions: { password: true },
			default: "",
			required: true,
			description:
				"API key from your Brikko dashboard (https://brikko.ru). " +
				"Ключ API из вашей панели Brikko.",
		},
		{
			displayName: "Base URL",
			name: "baseUrl",
			type: "string",
			default: "https://api.brikko.ru",
			description:
				"Brikko Gateway base URL. Override only for self-hosted or " +
				"staging deployments. Базовый URL шлюза Brikko.",
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: "generic",
		properties: {
			headers: {
				Authorization: "=Bearer {{$credentials.apiKey}}",
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: "={{$credentials.baseUrl}}",
			url: "/v1/models",
			method: "GET",
		},
	};
}
