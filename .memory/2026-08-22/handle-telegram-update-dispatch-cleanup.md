# Telegram Bot Message Stops at "Prompt diterima. Sedang dalam antrian..."

**Issue:** User sends a prompt but receives only the message "Prompt diterima. Sedang dalam antrian..." without any further response from the bot.

**Root Cause:** The webhook dispatched the job processor asynchronously (`await dispatchToProcessor` was fire-and-forget) before sending the user confirmation message. If the dispatcher failed, the job remained `queued` indefinitely without any feedback to the user.

**Fix:** Changed `src/server/application/handle-telegram-update.ts:316-324` to:
1. Call `dispatchToProcessor` **synchronously** first
2. Only send the "prompt_received" message after successful dispatch
3. If dispatch fails, send an error message: "Gagal memulai pemrosesan. Silakan coba lagi."

**Testing:** All unit tests pass (242 tests), linting passes, type checking passes.

**Verification:**
1. Send a new prompt via Telegram
2. Verify the bot immediately responds with the confirmation message only after the job is successfully queued
3. User no longer sees "stuck" status messages

**Files Changed:**
- `src/server/application/handle-telegram-update.ts`

**Commit Message (Suggested):**
```
fix(telegram): dispatch processor synchronously before sending queued message
```