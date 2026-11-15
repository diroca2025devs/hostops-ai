import type {
  AgentResult,
  AgentTool,
  AgentToolCallLog,
  AgentToolContext,
  LlmContent,
  LlmPart,
  LlmProvider,
} from './types';

export const FALLBACK_REPLY =
  'Vou encaminhar sua mensagem para a nossa equipe, que responderá por aqui assim que possível.';
const MAX_REPLY_CHARS = 3500;

export interface RunAgentInput {
  llm: LlmProvider;
  tools: AgentTool[];
  system: string;
  /** Histórico recente da conversa (sem a mensagem atual). */
  history: LlmContent[];
  userMessage: string;
  toolContext: AgentToolContext;
  maxSteps?: number;
}

function redact(result: Record<string, unknown>, keys: string[] | undefined): Record<string, unknown> {
  if (!keys?.length) return result;
  return Object.fromEntries(Object.entries(result).map(([k, v]) => [k, keys.includes(k) && v ? '[REDACTED]' : v]));
}

/**
 * Laço de Function Calling.
 * Garantias que NÃO dependem do comportamento do modelo:
 *  - só executa ferramentas da lista autorizada (nome desconhecido => erro devolvido ao modelo);
 *  - argumentos são validados com Zod antes de qualquer execução;
 *  - o escopo (organização, reserva, imóvel) vem do toolContext, nunca dos argumentos;
 *  - número de passos limitado; ao estourar, responde com mensagem neutra e escala para humano.
 */
export async function runAgent(input: RunAgentInput): Promise<AgentResult> {
  const maxSteps = input.maxSteps ?? 5;
  const toolsByName = new Map(input.tools.map((t) => [t.name, t]));
  const declarations = input.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  const contents: LlmContent[] = [...input.history, { role: 'user', parts: [{ text: input.userMessage }] }];
  const toolCalls: AgentToolCallLog[] = [];
  let escalated = false;
  let escalationReason: string | null = null;

  for (let step = 1; step <= maxSteps; step++) {
    const { content } = await input.llm.generate({ system: input.system, contents, tools: declarations });
    const parts = content?.parts ?? [];
    const calls = parts.filter((p): p is LlmPart & { functionCall: NonNullable<LlmPart['functionCall']> } => !!p.functionCall);

    if (calls.length === 0) {
      const reply = parts
        .map((p) => p.text ?? '')
        .join('')
        .trim()
        .slice(0, MAX_REPLY_CHARS);
      if (!reply) {
        return { reply: FALLBACK_REPLY, toolCalls, escalated: true, escalationReason: 'Modelo não produziu resposta.', steps: step };
      }
      return { reply, toolCalls, escalated, escalationReason, steps: step };
    }

    // O conteúdo do modelo volta intacto (preserva thoughtSignature exigida pela Gemini).
    contents.push({ role: 'model', parts });
    const responses: LlmPart[] = [];
    for (const call of calls) {
      const { name, args = {}, id } = call.functionCall;
      const tool = toolsByName.get(name);
      let result: Record<string, unknown>;
      let ok = false;
      if (!tool) {
        result = { error: 'tool_not_available', message: 'Ferramenta não autorizada.' };
      } else {
        const parsed = tool.schema.safeParse(args);
        if (!parsed.success) {
          result = { error: 'invalid_arguments', message: parsed.error.issues.map((i) => i.message).join('; ') };
        } else {
          try {
            result = await tool.execute(parsed.data, input.toolContext);
            ok = true;
            if (result.escalated === true) {
              escalated = true;
              escalationReason = typeof result.reason === 'string' ? result.reason : escalationReason;
            }
          } catch (error) {
            result = { error: 'tool_failed', message: 'Não foi possível concluir a operação.' };
            escalated = true;
            escalationReason = `Falha na ferramenta ${name}: ${(error as Error).message}`.slice(0, 300);
          }
        }
      }
      toolCalls.push({ name, args, ok, result: redact(result, tool?.redactKeys) });
      responses.push({ functionResponse: { name, response: result, ...(id ? { id } : {}) } });
    }
    contents.push({ role: 'user', parts: responses });
  }

  return {
    reply: FALLBACK_REPLY,
    toolCalls,
    escalated: true,
    escalationReason: 'Limite de passos do agente atingido.',
    steps: maxSteps,
  };
}
