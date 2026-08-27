/**
 * Buildspace API module: src/providers/nvidia.ts
 * Encapsulates NVIDIA-compatible AI completion calls so models and quotas can change without route rewrites.
 */

import type { AppConfig } from "../config/env.js";

export type AiMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * NVIDIA NIM is hidden behind this interface so the product can switch models,
 * impose per-Space limits, or introduce a local model without changing API routes.
 */
export class NvidiaAiProvider {
  constructor(private readonly config: AppConfig) {}
  configured(): boolean { return Boolean(this.config.NVIDIA_NIM_BASE_URL && this.config.NVIDIA_NIM_API_KEY && this.config.NVIDIA_NIM_MODEL_ID); }

  async complete(messages: AiMessage[]): Promise<{ content: string; model: string; usage?: { promptTokens?: number; completionTokens?: number } }> {
    if (!this.configured()) throw new Error("NVIDIA NIM has not been configured.");
    const response = await fetch(`${this.config.NVIDIA_NIM_BASE_URL!.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.NVIDIA_NIM_API_KEY}` },
      body: JSON.stringify({ model: this.config.NVIDIA_NIM_MODEL_ID, messages, temperature: 0.3 }),
    });
    if (!response.ok) throw new Error(`NVIDIA AI request failed with status ${response.status}.`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }>; model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("NVIDIA AI returned no completion.");
    return { content, model: body.model ?? this.config.NVIDIA_NIM_MODEL_ID!, usage: { ...(body.usage?.prompt_tokens !== undefined ? { promptTokens: body.usage.prompt_tokens } : {}), ...(body.usage?.completion_tokens !== undefined ? { completionTokens: body.usage.completion_tokens } : {}) } };
  }
}
