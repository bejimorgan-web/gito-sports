import type { AiNewsGeneration, AiNewsTask, CreateAiNewsTaskRequest, NewsArticle, StoryUnderstandingCanonicalEntity, StoryUnderstandingEntityType, StoryUnderstandingInput, StoryUnderstandingOutput } from "@gito/shared";
import type { AiNewsTaskRepository } from "../repositories/ai-news-task-repository.js";
import type { NewsRepository } from "../repositories/news-repository.js";
import { AiNewsTaskService } from "./ai-news-task-service.js";
import { AiNewsTaskRunner, getAiProviderConfiguration, type AiProviderConfiguration } from "./ai-news-provider.js";
import { STORY_UNDERSTANDING_INSTRUCTIONS, STORY_UNDERSTANDING_PROMPT_VERSION, STORY_UNDERSTANDING_TASK_TYPE, validateStoryUnderstandingOutput } from "./story-understanding-contract.js";
import { normalizeNewsText } from "./news-content-normalizer.js";

const MAX_STORY_INPUT_BYTES = 512 * 1024;

export class StoryUnderstandingInputError extends Error {
  constructor(readonly code: "article_not_found" | "article_input_too_large" | "prompt_version_unsupported") {
    super(code);
  }
}

export interface StoryUnderstandingExecution {
  task: AiNewsTask;
  generation: AiNewsGeneration | null;
}

function safeSourceUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function buildCanonicalEntities(article: NewsArticle): StoryUnderstandingCanonicalEntity[] {
  const knownTypes = new Set<StoryUnderstandingEntityType>(["sport", "country", "host", "team", "club", "competition", "match"]);
  const entries: StoryUnderstandingCanonicalEntity[] = [];
  const add = (entityType: StoryUnderstandingEntityType, id?: string | null, name?: string | null) => {
    if (!id) return;
    if (!entries.some((entry) => entry.entityType === entityType && entry.id === id)) entries.push({ entityType, id, name: name ?? null });
  };
  add("sport", article.sportId, article.sport?.name);
  add("country", article.countryId, article.country?.name);
  add("team", article.teamId, article.team?.name);
  add("competition", article.competitionId, article.competition?.name);
  add("match", article.matchId ?? article.match?.id, null);
  for (const category of article.categories ?? []) {
    if (category.classificationStatus !== "approved" || !knownTypes.has(category.categoryType)) continue;
    const relatedName = category.categoryType === "sport" && category.entityId === article.sportId ? article.sport?.name
      : category.categoryType === "country" && category.entityId === article.countryId ? article.country?.name
        : category.categoryType === "team" && category.entityId === article.teamId ? article.team?.name
          : category.categoryType === "competition" && category.entityId === article.competitionId ? article.competition?.name
            : null;
    add(category.categoryType, category.entityId, relatedName);
  }
  return entries;
}

export function buildStoryUnderstandingInput(article: NewsArticle): StoryUnderstandingInput {
  const input: StoryUnderstandingInput = {
    articleId: article.id,
    title: normalizeNewsText(article.title),
    summary: article.summary ? normalizeNewsText(article.summary) : null,
    body: article.body ? normalizeNewsText(article.body) : null,
    fetchedBody: article.fetchedBody ? normalizeNewsText(article.fetchedBody) : null,
    author: article.author ?? null,
    source: {
      id: article.sourceId ?? article.source?.id ?? null,
      name: article.sourceName ?? article.source?.name ?? null,
      type: article.source?.sourceType ?? null,
      url: safeSourceUrl(article.sourceUrl)
    },
    publishedAt: article.publishedAt ?? null,
    contentAvailability: article.contentAvailability ?? null,
    categories: (article.categories ?? []).map((category) => ({
      entityType: category.categoryType,
      entityId: category.entityId,
      status: category.classificationStatus
    })),
    tags: Array.isArray(article.tags) ? article.tags.filter((tag): tag is string => typeof tag === "string") : [],
    canonicalEntities: buildCanonicalEntities(article)
  };
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > MAX_STORY_INPUT_BYTES) throw new StoryUnderstandingInputError("article_input_too_large");
  return input;
}

export class StoryUnderstandingService {
  constructor(
    private readonly newsRepository: Pick<NewsRepository, "getArticleById">,
    private readonly taskRepository: AiNewsTaskRepository,
    private readonly taskService: AiNewsTaskService,
    private readonly runner: AiNewsTaskRunner,
    private readonly providerConfiguration: AiProviderConfiguration = getAiProviderConfiguration("story_understanding")
  ) {}

  async understand(articleId: string, actorId: string, actorRole: string, request: Omit<CreateAiNewsTaskRequest, "taskType" | "articleId" | "promptVersion"> & { promptVersion: string }): Promise<StoryUnderstandingExecution> {
    if (request.promptVersion !== STORY_UNDERSTANDING_PROMPT_VERSION) throw new StoryUnderstandingInputError("prompt_version_unsupported");
    const article = this.newsRepository.getArticleById(articleId);
    if (!article) throw new StoryUnderstandingInputError("article_not_found");
    const input = buildStoryUnderstandingInput(article);
    const taskRequest: CreateAiNewsTaskRequest = {
      taskType: STORY_UNDERSTANDING_TASK_TYPE,
      articleId: article.id,
      promptVersion: STORY_UNDERSTANDING_PROMPT_VERSION,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey
    };
    let task = this.taskService.create(taskRequest, actorId, this.providerConfiguration, actorRole);

    if (task.status === "queued") {
      try {
        task = await this.runner.run(task, { instructions: STORY_UNDERSTANDING_INSTRUCTIONS, article: input }, (output) => validateStoryUnderstandingOutput(output, input));
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "ai_task_invalid_transition") throw error;
        task = this.taskRepository.getById(task.id) ?? task;
      }
    }

    const generation = task.status === "completed" ? this.taskRepository.getGeneration(task.id) : null;
    return { task, generation };
  }

  getForActor(taskId: string, actorId: string): StoryUnderstandingExecution | null {
    const task = this.taskRepository.getByActorAndId(taskId, actorId);
    if (!task || task.taskType !== STORY_UNDERSTANDING_TASK_TYPE) return null;
    return { task, generation: this.taskRepository.getGeneration(task.id) };
  }
}
