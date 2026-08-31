---
name: Groq model availability
description: Provider-side model IDs can change independently of the app.
---

Use a model returned by Groq’s live models endpoint rather than assuming an older model ID remains available.

**Why:** A previously common model ID returned `model_not_found` even though the API key and endpoint were valid; the request worked after selecting a currently exposed model.

**How to apply:** Keep the model configurable with `GROQ_MODEL`, maintain a currently available default, and verify it with a real structured request after changing the integration.