import type { KnowledgeInput } from '@hostops/shared';
import { notFound } from '../errors';
import type { Core, TenantContext } from '../types';
import { recordAudit, userActor } from './audit';

export async function listKnowledge(core: Core, ctx: TenantContext, propertyId?: string) {
  return core.db.knowledgeArticle.findMany({
    where: { organizationId: ctx.organizationId, ...(propertyId ? { OR: [{ propertyId }, { propertyId: null }] } : {}) },
    include: { property: { select: { id: true, name: true } } },
    orderBy: [{ propertyId: 'asc' }, { title: 'asc' }],
  });
}

async function assertProperty(core: Core, ctx: TenantContext, propertyId?: string | null) {
  if (!propertyId) return;
  const property = await core.db.property.findFirst({ where: { id: propertyId, organizationId: ctx.organizationId } });
  if (!property) throw notFound('Imóvel');
}

export async function createKnowledge(core: Core, ctx: TenantContext, input: KnowledgeInput) {
  await assertProperty(core, ctx, input.propertyId);
  const article = await core.db.knowledgeArticle.create({
    data: { ...input, propertyId: input.propertyId ?? null, category: input.category ?? null, organizationId: ctx.organizationId },
  });
  await recordAudit(core.db, {
    organizationId: ctx.organizationId,
    actor: userActor(ctx),
    action: 'knowledge.create',
    entityType: 'KnowledgeArticle',
    entityId: article.id,
  });
  return article;
}

export async function updateKnowledge(core: Core, ctx: TenantContext, id: string, input: Partial<KnowledgeInput>) {
  const current = await core.db.knowledgeArticle.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!current) throw notFound('Artigo');
  await assertProperty(core, ctx, input.propertyId);
  const article = await core.db.knowledgeArticle.update({ where: { id }, data: input });
  await recordAudit(core.db, {
    organizationId: ctx.organizationId,
    actor: userActor(ctx),
    action: 'knowledge.update',
    entityType: 'KnowledgeArticle',
    entityId: id,
  });
  return article;
}

export async function deleteKnowledge(core: Core, ctx: TenantContext, id: string) {
  const current = await core.db.knowledgeArticle.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!current) throw notFound('Artigo');
  await core.db.knowledgeArticle.delete({ where: { id } });
  await recordAudit(core.db, {
    organizationId: ctx.organizationId,
    actor: userActor(ctx),
    action: 'knowledge.delete',
    entityType: 'KnowledgeArticle',
    entityId: id,
  });
}

const STOPWORDS = new Set(['para', 'como', 'qual', 'quais', 'onde', 'que', 'com', 'uma', 'por', 'dos', 'das', 'tem', 'posso', 'pode', 'sobre', 'the', 'and']);

export function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Busca por palavras-chave na base de conhecimento do imóvel + artigos gerais da organização.
 * Simples de propósito (MVP): a base é pequena e o resultado é sempre restrito ao tenant.
 */
export async function searchKnowledge(core: Core, organizationId: string, propertyId: string | null, query: string, limit = 3) {
  const tokens = [...new Set(tokenize(query))];
  if (tokens.length === 0) return [];
  const articles = await core.db.knowledgeArticle.findMany({
    where: { organizationId, isActive: true, OR: [{ propertyId: null }, ...(propertyId ? [{ propertyId }] : [])] },
    take: 500,
  });
  return articles
    .map((article) => {
      const title = tokenize(article.title);
      const body = new Set(tokenize(`${article.category ?? ''} ${article.content}`));
      const score = tokens.reduce((sum, t) => sum + (title.includes(t) ? 3 : 0) + (body.has(t) ? 1 : 0), 0) + (article.propertyId ? 0.5 : 0);
      return { article, score };
    })
    .filter((r) => r.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => ({ title: r.article.title, category: r.article.category, content: r.article.content.slice(0, 1500) }));
}
