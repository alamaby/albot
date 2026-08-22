# Rencana Implementasi Detail: Pollinations Provider

Dibuat: 2026-08-22

## Ringkasan Eksekutif

Menambahkan **Pollinations** (https://gen.pollinations.ai) sebagai provider baru untuk:
- **Reasoning/Text Generation** - via `/v1/chat/completions` (OpenAI-compatible)
- **Image Generation** - via `/v1/images/generations` (OpenAI-compatible)

---

## Arsitektur & Desain

### 1. Reasoning Adapter

**File:** `src/server/providers/reasoning/pollinations.adapter.ts`

```typescript
// Reuse OpenAICompatibleReasoningAdapter dengan konfigurasi Pollinations
export class PollinationsReasoningAdapter extends OpenAICompatibleReasoningAdapter {
  constructor(config: OpenAICompatibleConfig, apiKey: string) {
    super({
      baseUrl: config.baseUrl ?? "https://gen.pollinations.ai/v1",
      model: config.model ?? "openai",
      timeoutMs: config.timeoutMs ?? 60000,
    }, apiKey);
  }
  
  // Override headers untuk Pollinations requirements
  protected buildHeaders(): Record<string, string> {
    return {
      ...super.buildHeaders(),
      "HTTP-Referer": "https://albot-ten.vercel.app",
      "X-Title": "albot",
    };
  }
}
```

**Model yang didukung (pilihan awal):**
| Model | Deskripsi |
|-------|-----------|
| `openai` | Default, model umum |
| `gpt-5.4` | GPT-5.4 |
| `claude-sonnet-5` | Claude Sonnet 5 |
| `gemini` | Google Gemini |
| `deepseek` | DeepSeek |
| `qwen3.8-max` | Qwen 3.8 Max |
| `grok` | xAI Grok |
| `llama` | Meta Llama |

### 2. Image Generation Adapter

**File:** `src/server/providers/image/pollinations.adapter.ts`

```typescript
export type PollinationsImageModel = 
  | "flux" 
  | "gptimage" 
  | "ideogram-v4-turbo" 
  | "ideogram-v4-balanced" 
  | "ideogram-v4-quality"
  | "seedream" 
  | "seedream-pro"
  | "nanobanana"
  | "nanobanana-2"
  | "nanobanana-pro"
  | "kontext"
  | "krea"
  | "dreamshaper"
  | "gpt-image-2"
  | "zimage"
  | "wan-image"
  | "qwen-image"
  | "grok-imagine"
  | "recraft-v4.1-vector"
  | "nova-canvas";

export interface PollinationsImageConfig {
  baseUrl: string;           // https://gen.pollinations.ai/v1
  model: PollinationsImageModel;
  timeoutMs?: number;        // default 120000
}

export class PollinationsImageAdapter implements ImageGenerationProvider {
  private readonly baseUrl: string;
  private readonly model: PollinationsImageModel;
  private readonly timeoutMs: number;

  constructor(config: PollinationsImageConfig, private readonly apiKey: string) {
    // Validasi HTTPS
    // Set defaults
  }

  async generateImage(input: GenerateImageInput): Promise<ImageGenerationResult> {
    // POST ke ${this.baseUrl}/images/generations
    // Body: { prompt, model, n, size, response_format: "url", ... }
    // Response: { data: [{ url, revised_prompt }], created }
  }
}
```

**Mapping Parameter:**
| Domain Input | Pollinations API |
|--------------|------------------|
| `prompt` | `prompt` (required) |
| `negativePrompt` | Tidak didukung langsung (bisa via prompt engineering) |
| `aspectRatio` | `size` mapping: `1:1`→`1024x1024`, `16:9`→`1792x1024`, `9:16`→`1024x1792`, `4:3`→`1152x896`, `3:4`→`896x1152` |
| `parameters.seed` | `seed` (jika didukung model) |
| `parameters.quality` | `quality` (standard/hd untuk gptimage) |
| `parameters.style` | `style` (vivid/natural untuk gptimage) |

**Response Format (OpenAI-compatible):**
```json
{
  "created": 1234567890,
  "data": [
    {
      "url": "https://media.pollinations.ai/...",
      "revised_prompt": "Enhanced prompt used"
    }
  ]
}
```

### 3. Registry Registration

**File:** `src/server/providers/index.ts` - Tambahkan:

```typescript
import { PollinationsReasoningAdapter } from "./reasoning/pollinations.adapter";
import { PollinationsImageAdapter } from "./image/pollinations.adapter";

// Reasoning
registry.registerReasoning("pollinations_openai_compatible", (config, apiKey) => {
  return new PollinationsReasoningAdapter({
    baseUrl: (config["base_url"] as string) ?? "https://gen.pollinations.ai/v1",
    model: (config["model"] as string) ?? "openai",
    timeoutMs: (config["timeout_ms"] as number) ?? 60000,
  }, apiKey);
});

// Image - satu adapter per model family
const IMAGE_MODELS = [
  { id: "pollinations_flux", model: "flux", defaultSize: "1024x1024" },
  { id: "pollinations_gptimage", model: "gptimage", defaultSize: "1024x1024" },
  { id: "pollinations_ideogram_v4_turbo", model: "ideogram-v4-turbo", defaultSize: "1024x1024" },
  { id: "pollinations_ideogram_v4_balanced", model: "ideogram-v4-balanced", defaultSize: "1024x1024" },
  { id: "pollinations_ideogram_v4_quality", model: "ideogram-v4-quality", defaultSize: "1024x1024" },
  { id: "pollinations_seedream", model: "seedream", defaultSize: "1024x1024" },
  { id: "pollinations_seedream_pro", model: "seedream-pro", defaultSize: "1024x1024" },
  { id: "pollinations_nanobanana", model: "nanobanana", defaultSize: "1024x1024" },
  { id: "pollinations_nanobanana_2", model: "nanobanana-2", defaultSize: "1024x1024" },
  { id: "pollinations_nanobanana_pro", model: "nanobanana-pro", defaultSize: "1024x1024" },
  { id: "pollinations_kontext", model: "kontext", defaultSize: "1024x1024" },
  { id: "pollinations_krea", model: "krea", defaultSize: "1024x1024" },
  { id: "pollinations_dreamshaper", model: "dreamshaper", defaultSize: "1024x1024" },
  { id: "pollinations_gpt_image_2", model: "gpt-image-2", defaultSize: "1024x1024" },
  { id: "pollinations_zimage", model: "zimage", defaultSize: "1024x1024" },
  { id: "pollinations_wan_image", model: "wan-image", defaultSize: "1024x1024" },
  { id: "pollinations_qwen_image", model: "qwen-image", defaultSize: "1024x1024" },
  { id: "pollinations_grok_imagine", model: "grok-imagine", defaultSize: "1024x1024" },
  { id: "pollinations_recraft_v4", model: "recraft-v4.1-vector", defaultSize: "1024x1024" },
  { id: "pollinations_nova_canvas", model: "nova-canvas", defaultSize: "1024x1024" },
];

for (const m of IMAGE_MODELS) {
  registry.registerImage(m.id, (config, apiKey) => {
    return new PollinationsImageAdapter({
      baseUrl: (config["base_url"] as string) ?? "https://gen.pollinations.ai/v1",
      model: m.model,
      timeoutMs: (config["timeout_ms"] as number) ?? 120000,
    }, apiKey);
  });
}
```

---

## Database Migration

**File:** `supabase/migrations/20260822150000_add_pollinations_provider_configs.sql`

```sql
-- Pollinations Reasoning Config
INSERT INTO provider_configs (
  capability, adapter_type, name, base_url, model, 
  settings, selection_strategy, priority, weight, is_active
) VALUES (
  'reasoning',
  'pollinations_openai_compatible',
  'Pollinations OpenAI Compatible',
  'https://gen.pollinations.ai/v1',
  'openai',
  '{}'::jsonb,
  'priority_failover',
  10,
  1,
  true
) ON CONFLICT DO NOTHING;

-- Pollinations Image Configs
INSERT INTO provider_configs (
  capability, adapter_type, name, base_url, model, 
  settings, selection_strategy, priority, weight, is_active
) VALUES 
  ('image_generation', 'pollinations_flux', 'Pollinations Flux', 'https://gen.pollinations.ai/v1', 'flux', '{}', 'priority_failover', 10, 1, true),
  ('image_generation', 'pollinations_gptimage', 'Pollinations GPTImage', 'https://gen.pollinations.ai/v1', 'gptimage', '{}', 'priority_failover', 20, 1, true),
  ('image_generation', 'pollinations_ideogram_v4_turbo', 'Pollinations Ideogram v4 Turbo', 'https://gen.pollinations.ai/v1', 'ideogram-v4-turbo', '{}', 'priority_failover', 30, 1, true),
  ('image_generation', 'pollinations_ideogram_v4_balanced', 'Pollinations Ideogram v4 Balanced', 'https://gen.pollinations.ai/v1', 'ideogram-v4-balanced', '{}', 'priority_failover', 40, 1, true),
  ('image_generation', 'pollinations_ideogram_v4_quality', 'Pollinations Ideogram v4 Quality', 'https://gen.pollinations.ai/v1', 'ideogram-v4-quality', '{}', 'priority_failover', 50, 1, true),
  ('image_generation', 'pollinations_seedream', 'Pollinations Seedream', 'https://gen.pollinations.ai/v1', 'seedream', '{}', 'priority_failover', 60, 1, true),
  ('image_generation', 'pollinations_seedream_pro', 'Pollinations Seedream Pro', 'https://gen.pollinations.ai/v1', 'seedream-pro', '{}', 'priorit
