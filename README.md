# n8n-nodes-brikko

[![npm version](https://img.shields.io/npm/v/n8n-nodes-brikko.svg)](https://www.npmjs.com/package/n8n-nodes-brikko)
[![npm downloads](https://img.shields.io/npm/dm/n8n-nodes-brikko.svg)](https://www.npmjs.com/package/n8n-nodes-brikko)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![n8n community node](https://img.shields.io/badge/n8n-community%20node-FF6D5A.svg)](https://docs.n8n.io/integrations/community-nodes/)
[![GitHub stars](https://img.shields.io/github/stars/brikkoAI/n8n-nodes-brikko?style=social)](https://github.com/brikkoAI/n8n-nodes-brikko/stargazers)
[![152-ФЗ](https://img.shields.io/badge/152--ФЗ-compliant-success.svg)](#compliance-notes--по-152-фз)

> **Часть [Brikko Privacy Ecosystem](https://brikko.ru)** — open-source инфраструктура маскинга персональных данных перед AI для русского рынка.

> Privacy-aware n8n nodes by [Brikko](https://brikko.ru). Mask Russian and
> English PII before any data leaves your workflow for an LLM. Built for
> teams that need 152-ФЗ compliance.
>
> Узлы n8n с защитой персональных данных: маскируем PII перед отправкой
> в LLM. Для бизнеса РФ, работающего по 152-ФЗ.

This is an **[n8n community node](https://docs.n8n.io/integrations/community-nodes/)** — install через Settings → Community Nodes в self-hosted n8n.

---

## What you get / Что внутри

Four community nodes:

| Node | What it does | Что делает |
|---|---|---|
| **Brikko Anonymize** | Replaces PII (name, email, phone, INN, SNILS, card, etc.) with placeholders like `<NAME_001>`. Returns the masked text plus a `mapping_id`. | Заменяет ПДн на плейсхолдеры. Возвращает маскированный текст и `mapping_id`. |
| **Brikko Restore** | Inverse of Anonymize. Pass it the masked text + `mapping_id` to get the original back. | Обратная операция: по `mapping_id` восстанавливает оригинал. |
| **Brikko Chat** | One-node pipeline: anonymize → call a Brikko Gateway LLM (Claude / GPT / YandexGPT / GigaChat / DeepSeek / Gemini) → restore. | Полный конвейер в одном узле: маскирование → LLM → восстановление. |
| **Brikko Detect PII** | Scans text without modifying it. Returns categories, counts, and (optionally) sample values. Use it for audits and compliance gates. | Только обнаружение, без изменения текста. Категории, счётчики, примеры. |

## Three operation modes / Три режима работы

You pick one per node:

1. **Auto** (default) — try the local [Brikko Studio](https://github.com/brikkoAI/brikko-studio)
   sidecar at `localhost:8403`. If that's not running, fall back to the
   hosted **Brikko Gateway** at `api.brikko.ru`. If neither is configured,
   degrade to a built-in regex masker.
2. **Local Studio** — only the sidecar. PII never leaves the machine.
3. **Gateway** — hosted only. No local install required.
4. **Regex** — pure offline regex with checksum validators for INN, SNILS,
   and bank cards. Lower fidelity than NER but zero network calls.

---

## Install / Установка

### Via the n8n UI / Через интерфейс n8n

1. Settings → **Community Nodes**
2. Enter `n8n-nodes-brikko` and click **Install**
3. Reload the n8n editor.

### Via npm (self-hosted) / Через npm

```bash
cd ~/.n8n
npm install n8n-nodes-brikko
# restart n8n
```

### Local development / Локальная разработка

```bash
git clone https://github.com/brikkoAI/n8n-nodes-brikko
cd n8n-nodes-brikko
pnpm install
pnpm run build
# link into a local n8n instance
mkdir -p ~/.n8n/custom
ln -s "$PWD" ~/.n8n/custom/n8n-nodes-brikko
```

---

## Credentials / Учётные данные

You configure these once under **Credentials** in the n8n UI.

### Brikko API (for hosted Gateway / Шлюз)

| Field | Default | Notes |
|---|---|---|
| API Key | — | Get one at [brikko.ru](https://brikko.ru) |
| Base URL | `https://api.brikko.ru` | Override only for staging |

### Brikko Local Studio API (for the on-prem sidecar)

| Field | Default | Notes |
|---|---|---|
| Studio URL | `http://localhost:8403` | Where your Brikko Studio sidecar listens |
| Workspace ID | `default` | Scopes the per-workspace mapping store |

You can configure both — `auto` mode will use whichever is reachable.

---

## Example workflows / Примеры сценариев

### 1. Bitrix24 lead → privacy-aware LLM reply / Брикко-чат для Битрикс24

The most common Russian usecase: a new lead lands in Bitrix24, you want an
LLM to draft a personalised reply, but you can't ship the customer's name,
phone, and email to OpenAI in the clear.

```
Bitrix24 Trigger (new lead)
        ↓
Brikko Chat
  prompt:   "Напиши приветствие для лида: {{ $json.NAME }} {{ $json.PHONE }}, интерес: {{ $json.COMMENTS }}"
  model:    claude-sonnet-4-6
  policy:   balanced
        ↓
Bitrix24: Create Comment on Lead
  text: {{ $json.brikko_chat.response }}
```

What happens under the hood:
1. Brikko masks the prompt → `Напиши приветствие для лида: <NAME_001> <PHONE_001>, интерес: ...`
2. Sends the masked version to Claude via Brikko Gateway.
3. Restores `<NAME_001>`/`<PHONE_001>` in Claude's response before writing
   back to Bitrix24.
4. The audit log on the Anonymizer side records exactly which categories
   were touched, with no plaintext PII.

### 2. CSV upload → audit which rows leak PII / Аудит CSV

Marketing exports a CSV and asks "which rows contain personal data?"

```
Read Binary File (input.csv)
        ↓
Spreadsheet File (parse rows)
        ↓
Brikko Detect PII
  text:       {{ JSON.stringify($json) }}
  categories: [INN, SNILS, CARD, EMAIL, PHONE]
  includeSamples: false
        ↓
IF $json.brikko_pii.total_count > 0
        ↓                ↓
   write to flagged.csv  pass through
```

Detect-only mode never rewrites your data — it just tells you what's
there. Sample values default to placeholders (not raw PII) when you call
through Studio or Gateway.

### 3. Manual three-node control / Ручной 3-узловый pipeline

When you want to use a third-party LLM provider directly (e.g. you already
have an OpenAI account) but still want the masking layer:

```
Slack Trigger (new message in #support)
        ↓
Brikko Anonymize
  text: {{ $json.text }}
  policy: strict
        ↓
OpenAI: Chat
  prompt: {{ $json.brikko.masked_text }}
  model: gpt-4o
        ↓
Brikko Restore
  text:       {{ $json.choices[0].message.content }}
  mappingId:  {{ $('Brikko Anonymize').item.json.brikko.mapping_id }}
        ↓
Slack: Send Message
  text: {{ $json.brikko_restored.restored_text }}
```

This is the most flexible shape — you control which model, which provider,
and you can drop the Restore step entirely if the LLM's response is just a
classification label that doesn't need to expose the original PII.

---

## Output schema / Схема результата

Each node writes its result under a configurable field (default names below).

### `Brikko Anonymize` → `$json.brikko`

```json
{
  "masked_text": "Hi <NAME_001>, your order <PHONE_001> ships tomorrow.",
  "mapping_id":  "0e1f7a3a-d6e5-4d12-b1e1-a36b66e1c2f0",
  "entities": [
    { "placeholder": "<NAME_001>",  "category": "NAME",  "confidence": 0.95 },
    { "placeholder": "<PHONE_001>", "category": "PHONE", "confidence": 0.99 }
  ],
  "policy":     "balanced",
  "source":     "studio",
  "latency_ms": 14
}
```

### `Brikko Restore` → `$json.brikko_restored`

```json
{
  "restored_text": "Hi Ivan Petrov, your order +7 495 123-45-67 ships tomorrow.",
  "hallucinated":  [],
  "source":        "studio",
  "latency_ms":    7
}
```

### `Brikko Chat` → `$json.brikko_chat`

```json
{
  "response":         "Здравствуйте, Иван! Спасибо за заявку...",
  "masked_prompt":    "Напиши ответ для <NAME_001>...",
  "masked_response":  "Здравствуйте, <NAME_001>! Спасибо...",
  "mapping_id":       "0e1f7a3a-d6e5-4d12-b1e1-a36b66e1c2f0",
  "model":            "claude-sonnet-4-6",
  "latency_ms":       1840,
  "source":           "gateway"
}
```

### `Brikko Detect PII` → `$json.brikko_pii`

```json
{
  "found_pii": [
    { "category": "EMAIL", "count": 2, "samples": ["a@x.ru", "b@y.com"] },
    { "category": "PHONE", "count": 1, "samples": ["+7 495 123-45-67"] }
  ],
  "total_count": 3,
  "source":      "regex"
}
```

---

## Compliance notes / По 152-ФЗ

- **Local Studio mode** never sends the unredacted text off the host
  running n8n. The encrypted mapping store stays on disk on your
  infrastructure.
- **Gateway mode** sends the unredacted text to `api.brikko.ru`, which is
  hosted on a Russian data-centre subject to 152-ФЗ. See
  [brikko.ru/dpa](https://brikko.ru) for the data-processing agreement.
- **Regex mode** is the only mode with no network egress at all. Use it
  for air-gapped pipelines.

If you have an Information Security team that needs Studio source to
audit, the full code is at
[github.com/brikkoAI/brikko-studio](https://github.com/brikkoAI/brikko-studio)
under MIT.

---

## Pro tier / Подписка Brikko

Free tier of `api.brikko.ru` ships with a 200 ₽ welcome bonus. Pro tier
unlocks 19 LLM models, prepaid balance with рублёвая касса, and full
ЮКасса closing documents (чек, акт, договор) — see
[brikko.ru/pricing](https://brikko.ru) for details.

The npm package is and stays MIT-licensed. Pro vs Free is purely a
Gateway-side concern.

---

## Contributing / Как помочь

PRs welcome at [github.com/brikkoAI/n8n-nodes-brikko](https://github.com/brikkoAI/n8n-nodes-brikko).

```bash
pnpm install
pnpm run build
pnpm run test
pnpm run lint
```

## License

MIT — see [LICENSE](LICENSE).

Brikko (brikko.ru), 2026.

---

## 🔗 Связанные продукты Brikko

| Артефакт | Установка | Аудитория |
|---|---|---|
| [brikko-studio](https://github.com/brikkoAI/brikko-studio) | `curl install.brikko.ru/studio.sh \| bash` | Desktop AI agent с MCP |
| [brikko-shield](https://github.com/brikkoAI/brikko-shield) | Chrome Web Store (скоро) | Маскинг в ChatGPT/Claude.ai |
| [brikko-cli](https://github.com/brikkoAI/brikko-cli) | `npm install -g brikko-cli` | CLI для Studio |
| [brikko-pii-skill](https://github.com/brikkoAI/brikko-pii-skill) | `git clone` | Skill для Claude Code/Cursor |
| **n8n-nodes-brikko** ★ (вы здесь) | `npm install n8n-nodes-brikko` | Маскинг в n8n workflows |
| [presidio-ru-recognizers](https://github.com/brikkoAI/presidio-ru-recognizers) | `pip install presidio-ru-recognizers` | Python recognizers для Presidio |
