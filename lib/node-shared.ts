/**
 * Shared property descriptors used by multiple Brikko nodes. Each node
 * builds its own `properties` array but pulls these definitions from
 * here so the labels, descriptions, and default values stay in sync.
 *
 * Bilingual UX strings: English first, then a slash and the Russian
 * translation. n8n does not yet support per-property i18n on community
 * nodes (the localization API is internal), so this is the cleanest
 * compromise — both audiences see both strings.
 */

import type { INodeProperties } from "n8n-workflow";

export const MODE_PROPERTY: INodeProperties = {
	displayName: "Mode / Режим",
	name: "mode",
	type: "options",
	default: "auto",
	description:
		"Where to run the privacy pipeline. " +
		"Где исполнять конвейер конфиденциальности.",
	options: [
		{
			name: "Auto (Studio Then Gateway) / Авто",
			value: "auto",
			description:
				"Try local Studio at localhost:8403 first; fall back to " +
				"the hosted Gateway, then to regex.",
		},
		{
			name: "Local Studio Only / Только локально",
			value: "local",
			description:
				"Use the Brikko Studio sidecar on localhost. Errors if " +
				"unreachable.",
		},
		{
			name: "Gateway Only / Только шлюз",
			value: "gateway",
			description:
				"Use the hosted Brikko Gateway at api.brikko.ru. Requires a " +
				"Brikko API credential.",
		},
		{
			name: "Regex Only (Offline) / Регулярки (офлайн)",
			value: "regex",
			description:
				"Pure local regex — never calls out. Lower fidelity; INN, " +
				"SNILS, card numbers checksum-validated.",
		},
	],
};

export const POLICY_PROPERTY: INodeProperties = {
	displayName: "Policy Profile / Политика",
	name: "policyProfile",
	type: "options",
	default: "balanced",
	description:
		"How aggressively to mask. Strict = mask anything suspicious; " +
		"permissive = mask only high-confidence PII. " +
		"Насколько агрессивно маскировать.",
	options: [
		{ name: "Strict / Строгая", value: "strict" },
		{ name: "Balanced / Сбалансированная", value: "balanced" },
		{ name: "Permissive / Разрешительная", value: "permissive" },
	],
};

export const WORKSPACE_PROPERTY: INodeProperties = {
	displayName: "Workspace ID / Рабочая область",
	name: "workspaceId",
	type: "string",
	default: "",
	description:
		"Override the workspace ID from credentials for this node only. " +
		"Leave blank to use the credential default. " +
		"Переопределение workspace_id для этого узла.",
};
