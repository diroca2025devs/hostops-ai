import type { z } from 'zod';

/**
 * Tipos do agente — espelham o formato "contents/parts" da Gemini API,
 * mas o módulo não depende de nenhum SDK: o provedor é uma porta (LlmProvider).
 */
export interface LlmPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
  /** Assinatura de raciocínio da Gemini: deve voltar intacta no turno seguinte. */
  thoughtSignature?: string;
  [extra: string]: unknown;
}

export interface LlmContent {
  role: 'user' | 'model';
  parts: LlmPart[];
}

export interface LlmFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmRequest {
  system: string;
  contents: LlmContent[];
  tools: LlmFunctionDeclaration[];
}

export interface LlmProvider {
  readonly model: string;
  generate(request: LlmRequest): Promise<{ content: LlmContent }>;
}

/** Contexto resolvido NO SERVIDOR a partir do telefone do hóspede. O modelo não pode alterá-lo. */
export interface AgentToolContext {
  organizationId: string;
  conversationId: string;
  guestId: string | null;
  reservationId: string | null;
  propertyId: string | null;
}

export interface AgentTool<Schema extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  /** JSON Schema enviado ao modelo (functionDeclarations). */
  parameters: Record<string, unknown>;
  /** Validação real dos argumentos devolvidos pelo modelo. */
  schema: Schema;
  /** Chaves do resultado mascaradas no histórico/auditoria. */
  redactKeys?: string[];
  execute(args: z.infer<Schema>, ctx: AgentToolContext): Promise<Record<string, unknown>>;
}

export interface AgentToolCallLog {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  result: Record<string, unknown>;
}

export interface AgentResult {
  reply: string;
  toolCalls: AgentToolCallLog[];
  /** true quando a conversa deve passar para atendimento humano. */
  escalated: boolean;
  escalationReason: string | null;
  steps: number;
}
