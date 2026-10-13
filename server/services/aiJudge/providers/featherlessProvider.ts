// server/services/aiJudge/providers/featherlessProvider.ts
import OpenAI from 'openai';
import { IAIJudgeProvider, DeckEvaluationParams, RawJudgeResponse } from '../types';
import { activeRubricEvaluator } from '../rubricEvaluator';

export class FeatherlessProvider implements IAIJudgeProvider {
  readonly name = 'featherless' as const;
  readonly defaultModel = 'meta-llama/Llama-3.2-11B-Vision-Instruct';

  private client: OpenAI | null = null;
  private configuredApiKey?: string;
  private configuredBaseUrl?: string;
  private configuredModel?: string;

  constructor(apiKey?: string, baseUrl?: string, model?: string, client?: OpenAI) {
    if (apiKey) this.configuredApiKey = apiKey;
    if (baseUrl) this.configuredBaseUrl = baseUrl;
    if (model) this.configuredModel = model;
    if (client) this.client = client;
  }

  private getClient(): OpenAI {
    if (this.client) return this.client;
    const apiKey = this.configuredApiKey || process.env.FEATHERLESS_API_KEY;
    if (!apiKey) {
      throw new Error('FEATHERLESS_API_KEY is not configured in environment variables.');
    }
    const baseURL = (this.configuredBaseUrl || process.env.FEATHERLESS_BASE_URL || 'https://api.featherless.ai/v1').replace(/\/+$/, '');
    this.client = new OpenAI({
      apiKey,
      baseURL,
    });
    return this.client;
  }

  validateConfig(): { valid: boolean; error?: string } {
    if (this.client) return { valid: true };
    const key = this.configuredApiKey || process.env.FEATHERLESS_API_KEY;
    if (!key || key.trim().length === 0) {
      return {
        valid: false,
        error: 'FEATHERLESS_API_KEY is missing. Please configure FEATHERLESS_API_KEY in server environment.',
      };
    }
    if (key.includes('your_featherless_api_key_here') || key === 'placeholder') {
      return {
        valid: false,
        error: 'FEATHERLESS_API_KEY contains placeholder text. Please provide an active Featherless API key.',
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
    const model = params.modelOverride || process.env.FEATHERLESS_JUDGE_MODEL || this.defaultModel;

    const deck = params.deck || (params as any).parsedDeck;
    const teamName = params.teamName || 'Evaluated Team';
    const submissionName = params.submissionName || 'Case Submission';

    const systemPrompt = (params as any).systemPrompt || activeRubricEvaluator.getSystemPrompt();
    const textPrompt = (params as any).userPrompt || (deck ? activeRubricEvaluator.formatDeckForEvaluation(
      deck,
      teamName,
      submissionName
    ) : 'No deck provided');

    // Multimodal payload for Featherless vision models
    const contentParts: any[] = [
      {
        type: 'text',
        text: textPrompt,
      },
    ];

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
      temperature: 0.1,
      max_tokens: maxTokens,
    });

    const latencyMs = Date.now() - startTime;
    const choice = response.choices[0];
    const rawJson = choice?.message?.content || '{}';

    const parsedOutput = activeRubricEvaluator.validateAndParseOutput(rawJson);
    if (!parsedOutput.valid || !parsedOutput.output) {
      throw new Error(`Featherless output schema validation failed: ${parsedOutput.error}`);
    }

    const usageData = response.usage;
    const promptTokens = usageData?.prompt_tokens || 0;
    const completionTokens = usageData?.completion_tokens || 0;
    const totalTokens = usageData?.total_tokens || (promptTokens + completionTokens);

    return {
      rawJson,
      structuredOutput: parsedOutput.output,
      rawOutput: parsedOutput.output,
      usage: {
        promptTokens,
        completionTokens,
        cachedTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        totalTokens,
        providerRequestId: response.id,
      },
      providerRequestId: response.id,
      model: response.model || model,
      provider: 'featherless',
      latencyMs,
    };
  }
}

export const activeFeatherlessProvider = new FeatherlessProvider();
