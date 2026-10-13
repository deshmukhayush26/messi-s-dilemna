// server/services/aiJudge/providers/openAIProvider.ts
import OpenAI from 'openai';
import { IAIJudgeProvider, DeckEvaluationParams, RawJudgeResponse } from '../types';
import { activeRubricEvaluator } from '../rubricEvaluator';

export class OpenAIProvider implements IAIJudgeProvider {
  readonly name = 'openai' as const;
  readonly defaultModel = 'gpt-4o';

  private client: OpenAI | null = null;
  private configuredApiKey?: string;
  private configuredModel?: string;

  constructor(apiKey?: string, model?: string, client?: OpenAI) {
    if (apiKey) this.configuredApiKey = apiKey;
    if (model) this.configuredModel = model;
    if (client) this.client = client;
  }

  private getClient(): OpenAI {
    if (this.client) return this.client;
    const apiKey = this.configuredApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured in environment variables.');
    }
    this.client = new OpenAI({ apiKey });
    return this.client;
  }

  validateConfig(): { valid: boolean; error?: string } {
    if (this.client) return { valid: true };
    const key = this.configuredApiKey || process.env.OPENAI_API_KEY;
    if (!key || key.trim().length === 0) {
      return {
        valid: false,
        error: 'OPENAI_API_KEY is missing. Please set OPENAI_API_KEY in server environment.',
      };
    }
    if (key.includes('your_openai_api_key_here') || key === 'placeholder') {
      return {
        valid: false,
        error: 'OPENAI_API_KEY is using a placeholder value. Please provide a valid OpenAI secret key.',
      };
    }
    return { valid: true };
  }

  buildMultimodalPayload(deck: any, systemPrompt: string, userText: string): any[] {
    const contentParts: any[] = [{ type: 'text', text: userText }];
    for (const slide of deck.slides || []) {
      if (slide.imageDataUrl) {
        contentParts.push({
          type: 'text',
          text: `[Visual Representation of Slide ${slide.slideNumber}]:`,
        });
        contentParts.push({
          type: 'image_url',
          image_url: {
            url: slide.imageDataUrl,
            detail: 'high',
          },
        });
      }
    }
    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: contentParts },
    ];
  }

  async evaluateDeck(params: DeckEvaluationParams): Promise<RawJudgeResponse> {
    const validation = this.validateConfig();
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const client = this.getClient();
    const model = params.modelOverride || process.env.OPENAI_JUDGE_MODEL || this.defaultModel;

    const deck = params.deck || (params as any).parsedDeck;
    const teamName = params.teamName || 'Evaluated Team';
    const submissionName = params.submissionName || 'Case Submission';

    const systemPrompt = (params as any).systemPrompt || activeRubricEvaluator.getSystemPrompt();
    const textPrompt = (params as any).userPrompt || (deck ? activeRubricEvaluator.formatDeckForEvaluation(
      deck,
      teamName,
      submissionName
    ) : 'No deck provided');

    // Build multimodal content array (Text + Slide Visual Cards)
    const contentParts: any[] = [
      {
        type: 'text',
        text: textPrompt,
      },
    ];

    // Append visual slide representations for vision analysis
    if (deck?.slides) {
      for (const slide of deck.slides) {
        if (slide.imageDataUrl) {
          contentParts.push({
            type: 'text',
            text: `[Visual Representation of Slide ${slide.slideNumber}]:`,
          });
          contentParts.push({
            type: 'image_url',
            image_url: {
              url: slide.imageDataUrl,
              detail: 'high',
            },
          });
        }
      }
    }

    const maxTokens = Number(process.env.AI_JUDGE_MAX_OUTPUT_TOKENS || 2500);
    const startTime = Date.now();

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: contentParts },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1, // Low variance for scoring consistency
      max_tokens: maxTokens,
    });

    const latencyMs = Date.now() - startTime;
    const choice = response.choices[0];
    const rawJson = choice?.message?.content || '{}';

    const parsedOutput = activeRubricEvaluator.validateAndParseOutput(rawJson);
    if (!parsedOutput.valid || !parsedOutput.output) {
      throw new Error(`OpenAI output schema validation failed: ${parsedOutput.error}`);
    }

    const usageData = response.usage;
    const promptTokens = usageData?.prompt_tokens || 0;
    const completionTokens = usageData?.completion_tokens || 0;
    const cachedTokens = (usageData as any)?.prompt_tokens_details?.cached_tokens || 0;
    const reasoningTokens = (usageData as any)?.completion_tokens_details?.reasoning_tokens || 0;
    const totalTokens = usageData?.total_tokens || (promptTokens + completionTokens);

    return {
      rawJson,
      structuredOutput: parsedOutput.output,
      rawOutput: parsedOutput.output,
      usage: {
        promptTokens,
        completionTokens,
        cachedTokens,
        cachedInputTokens: cachedTokens,
        reasoningTokens,
        totalTokens,
        providerRequestId: response.id,
      },
      providerRequestId: response.id,
      model: response.model || model,
      provider: 'openai',
      latencyMs,
    };
  }
}

export const activeOpenAIProvider = new OpenAIProvider();
