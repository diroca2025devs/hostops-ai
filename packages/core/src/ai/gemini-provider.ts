import type { LlmContent, LlmProvider, LlmRequest } from './types';

export interface GeminiProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Cliente da Gemini API via REST (models.generateContent) com Function Calling.
 * Referência: https://ai.google.dev/gemini-api/docs/function-calling
 * A chave vai no cabeçalho x-goog-api-key (nunca na URL, para não vazar em logs).
 */
export class GeminiProvider implements LlmProvider {
  readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GeminiProviderOptions) {
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generate(request: LlmRequest): Promise<{ content: LlmContent }> {
    const base = this.options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    const url = `${base}/models/${encodeURIComponent(this.model)}:generateContent`;
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: request.system }] },
      contents: request.contents,
      tools: request.tools.length ? [{ functionDeclarations: request.tools }] : undefined,
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
    });

    const maxRetries = this.options.maxRetries ?? 2;
    let lastError: Error = new Error('Gemini: falha desconhecida');
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': this.options.apiKey },
          body,
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
        });
        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`Gemini respondeu HTTP ${response.status}`);
        } else if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw Object.assign(new Error(`Gemini respondeu HTTP ${response.status}: ${detail.slice(0, 300)}`), { fatal: true });
        } else {
          const json = (await response.json()) as {
            candidates?: Array<{ content?: LlmContent; finishReason?: string }>;
            promptFeedback?: { blockReason?: string };
          };
          const candidate = json.candidates?.[0];
          if (!candidate?.content?.parts?.length) {
            const reason = json.promptFeedback?.blockReason ?? candidate?.finishReason ?? 'sem conteúdo';
            throw Object.assign(new Error(`Gemini não retornou conteúdo (${reason}).`), { fatal: true });
          }
          return { content: { role: 'model', parts: candidate.content.parts } };
        }
      } catch (error) {
        if ((error as { fatal?: boolean }).fatal) throw error;
        lastError = error as Error;
      }
      if (attempt < maxRetries) await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
    throw lastError;
  }
}
