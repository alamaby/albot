# Pollinations Provider Implementation Plan

Created: 2026-08-22 15:30:00

## Objective

Add Pollinations (https://gen.pollinations.ai) as a new provider for both reasoning (text generation) and image generation capabilities. Pollinations offers OpenAI-compatible APIs for both chat completions and image generation.

## Scope

- Create Pollinations reasoning adapter (reusing OpenAI-compatible pattern)
- Create Pollinations image generation adapter
- Register both adapters in the provider registry
- Add database migration to seed default provider configs
- Update schema integration test with new migration timestamp
- Add unit tests for new adapters
- Verify all checks pass (lint, typecheck, tests, build)

## Milestones

1. **Create adapters** - Implement reasoning and image generation adapters for Pollinations
2. **Register adapters** - Add factories to provider registry (index.ts)
3. **Database migration** - Add seed data for Pollinations provider configs
4. **Update tests** - Add unit tests and update integration test expectations
5. **Verification** - Run all checks and verify implementation

## Tasks

### 1. Create Pollinations Reasoning Adapter
- [ ] Create `src/server/providers/reasoning/pollinations.adapter.ts`
- [ ] Extend or reuse `OpenAICompatibleReasoningAdapter` pattern
- [ ] Configure for Pollinations base URL: `https://gen.pollinations.ai/v1`
- [ ] Support Pollinations model names (e.g., `openai`, `gpt-5.4`, `claude-sonnet-5`, `gemini`, `deepseek`, `qwen`, etc.)
- [ ] Handle authentication via Bearer token
- [ ] Include required headers: `HTTP-Referer`, `X-Title`

### 2. Create Pollinations Image Generation Adapter
- [ ] Create `src/server/providers/image/pollinations.adapter.ts`
- [ ] Implement `ImageGenerationProvider` interface
- [ ] Use OpenAI-compatible `/v1/images/generations` endpoint
- [ ] Support Pollinations image models (e.g., `flux`, `gptimage`, `ideogram-v4`, `seedream`, `nanobanana`, etc.)
- [ ] Handle request/response format per OpenAI Images API
- [ ] Support parameters: prompt, negative_prompt, aspect_ratio (mapped to size), seed, model-specific params
- [ ] Return `ImageGenerationResult` with imageUrl, mimeType, metadata

### 3. Register Adapters in Provider Registry
- [ ] Update `src/server/providers/index.ts`
- [ ] Register reasoning adapter: `pollinations_openai_compatible` (or similar)
- [ ] Register image adapters: `pollinations_flux`, `pollinations_gptimage`, `pollinations_ideogram`, etc. (one per model family)
- [ ] Set appropriate defaults for baseUrl, model, timeoutMs

### 4. Database Migration for Seed Configs
- [ ] Create migration `supabase/migrations/20260822150000_add_pollinations_provider_configs.sql`
- [ ] Insert provider configs for:
  - Reasoning: `pollinations_openai_compatible` (capability: reasoning)
  - Image: `pollinations_flux`, `pollinations_gptimage`, `pollinations_ideogram_v4`, `pollinations_seedream`, `pollinations_nanobanana` (capability: image_generation)
- [ ] Set appropriate priority, weight, selection_strategy
- [ ] Mark as active

### 5. Update Schema Integration Test
- [ ] Update `EXPECTED_MIGRATIONS` in `tests/integration/schema.integration.test.ts`
- [ ] Add new migration timestamp: `20260822150000`

### 6. Add Unit Tests
- [ ] Create `tests/contract/pollinations-provider.contract.test.ts`
- [ ] Test reasoning adapter: request format, response parsing, error handling
- [ ] Test image adapter: request format, response parsing, error handling
- [ ] Test HTTPS URL validation
- [ ] Test provider request ID extraction

### 7. Run Verification Checks
- [ ] `npm run db:lint`
- [ ] `npm run db:check-migrations`
- [ ] `npm run db:types:check` (regenerate types if needed via `npm run db:types`)
- [ ] `npm run test:unit`
- [ ] `npm run test:contract`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run format:check`

## Risks

- **Model availability**: Pollinations has many models; need to select which to support initially
- **API differences**: While OpenAI-compatible, there may be subtle differences in request/response format
- **Rate limits**: Need to handle 429 responses appropriately (already handled by base error handling)
- **Authentication**: Uses Bearer token; ensure apiKey is passed correctly from provider_keys table

## Notes

- Pollinations text generation uses `/v1/chat/completions` (OpenAI-compatible)
- Pollinations image generation uses `/v1/images/generations` (OpenAI-compatible)
- The reasoning adapter can reuse `OpenAICompatibleReasoningAdapter` with minor configuration
- The image adapter needs custom implementation since the response format differs from Pixazo
- Environment variable for API key is not needed - keys are stored encrypted in `provider_keys` table
- Default models to support:
  - Reasoning: `openai` (default), `gpt-5.4`, `claude-sonnet-5`, `gemini`, `deepseek`, `qwen3.8-max`
  - Image: `flux` (default), `gptimage`, `ideogram-v4-turbo`, `seedream`, `nanobanana`

## Progress Log

- 2026-08-22 15:30:00 — Plan created, ready for implementation
