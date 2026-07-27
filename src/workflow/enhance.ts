/**
 * Official FG / $G LLM helpers for Teach Claude.
 * Uses the user's configured relay (createMessage).
 */

import type { ContentBlockParam, MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { createMessage, describeApiError } from '@/api/client';
import { hasUsableCredentials, peekSettings } from '@/storage/settings';
import type { WorkflowStep } from './types';

const STEP_SYSTEM = `You are generating step-by-step instructions to teach Claude how to automate browser tasks.

Your task: Create a clear, actionable instruction based on WHAT YOU SEE in the screenshot and what the USER SAID.

PRIORITY: If the user provided spoken narration, USE THEIR WORDS as the primary source for understanding intent.

CRITICAL RULES FOR SCREENSHOTS:
1. A BLUE CIRCLE shows EXACTLY where the user clicked
2. Look at what's INSIDE or NEAR the blue circle
3. Describe what you SEE - icons, buttons, text, symbols
4. IGNORE the HTML element info if it's generic (like DIV, SPAN, etc.)
5. NEVER say "Click on div element" or "Click on span element"
6. If you can't see clear text, describe the icon/button visually

WHAT TO LOOK FOR IN THE BLUE CIRCLE:
- Icon buttons (⋮ three dots, × close, hamburger menu, gear settings, etc.)
- Button labels and link text
- Form fields with placeholders
- Menu items

RULES FOR THE INSTRUCTION:
- Start with "Click on" for clickable elements (or "Type"/"Select" if appropriate)
- Prefer aria-label / title / visible text over tag names
- Keep under 50 characters when possible
- Return ONLY the instruction inside <description>...</description>`;

const SUMMARY_SYSTEM = `You are analyzing a recorded browser automation demonstration to understand the user's semantic intent and create a REUSABLE workflow prompt.

CRITICAL RULES:
1. The user's SPOKEN NARRATION is the PRIMARY source of truth - use their words to understand intent
2. Capture SEMANTIC INTENT, not exact actions (e.g., "enter the price" not "enter 24.99")
3. Identify DYNAMIC INPUTS that will change each time the workflow runs

Your goal: Create a prompt that Claude can use to repeat this workflow with DIFFERENT inputs each time.

DYNAMIC INPUT DETECTION:
- ANY specific values the user entered (prices, names, emails, dates, quantities, etc.) are DYNAMIC
- Replace specific values with descriptive placeholders
- Add elicitation questions at the START of the prompt to gather these inputs

FORMAT YOUR OUTPUT AS:
<inputs>
[List each dynamic input that needs to be collected before running the workflow]
- Input name: Description of what this input is for
</inputs>

<prompt>
[The reusable prompt that references the inputs and describes the workflow semantically]
</prompt>

Remember: The workflow should be reusable with DIFFERENT inputs each time.`;

export type EnhanceStepInput = {
  tagName: string;
  text?: string;
  attributes: Record<string, string>;
  url?: string;
  pageTitle?: string;
  action: string;
  selector?: string;
  screenshot?: string;
  speechTranscript?: string;
};

function parseDescription(raw: string): string {
  if (!raw) return '';
  const m = raw.match(/<description>([\s\S]*?)<\/description>/i);
  if (m?.[1]) return m[1].trim();
  const m2 = raw.match(/^([\s\S]*?)<\/description>/i);
  if (m2?.[1]) return m2[1].trim();
  // model sometimes returns bare instruction
  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^(click|type|select|enter|navigate)/i.test(l));
  return line || raw.trim().slice(0, 80);
}

function buildElementPrompt(e: EnhanceStepInput): string {
  const attrs = e.attributes || {};
  const classes = attrs.class || '';
  const semantic = classes
    .split(/\s+/)
    .filter(Boolean)
    .filter((c) =>
      /btn|button|menu|nav|submit|close|icon|toggle|dropdown|modal|search|login|save|delete/i.test(
        c,
      ),
    )
    .join(', ');
  const speech = e.speechTranscript
    ? `\n\nUSER'S NARRATION (spoken while performing this action):\n"${e.speechTranscript}"\n\nIMPORTANT: The user's spoken words provide valuable context about their intent. Use this narration to understand what they're trying to do and create a more accurate description. The user's words should take priority over inferred meanings.`
    : '';

  return `<element_clicked>
HTML Element: ${(e.tagName || 'div').toUpperCase()}
Visible Text: "${e.text || ''}"
${e.text && e.text.length <= 3 ? `Note: This might be an icon character` : ''}${speech}

Current Page Context:
- Page Title: ${e.pageTitle || 'unknown'}
- Page URL: ${e.url || 'unknown'}

All Element Attributes (use these to understand purpose):
- ID: ${attrs.id || 'none'}
- Classes: ${classes || 'none'}
${semantic ? `- Semantic Classes Found: ${semantic}` : ''}
- Name: ${attrs.name || 'none'}
- Type: ${attrs.type || 'none'}
- Role: ${attrs.role || 'none'}
- Href: ${attrs.href || 'none'}

Accessibility & Tooltip Information (PRIORITIZE THESE):
- Aria-Label: "${attrs['aria-label'] || ''}"
- Title/Tooltip: "${attrs.title || ''}"
- Data-Tooltip: "${attrs['data-tooltip'] || ''}"
- Data-Tip: "${attrs['data-tip'] || ''}"
- Aria-Description: "${attrs['aria-description'] || ''}"
- Placeholder: "${attrs.placeholder || ''}"
- Alt Text: "${attrs.alt || ''}"
- Value: "${attrs.value || ''}"

User Action: ${e.action || 'click'}

INSTRUCTION NEEDED:
Generate a clear action instruction starting with "Click on" (or "Type"/"Select" if appropriate).
The instruction should tell someone exactly what to click/type to replicate this action.
Remember: Start with "Click on" for clickable elements!`;
}

export async function enhanceStepDescription(input: EnhanceStepInput): Promise<string> {
  if (!hasUsableCredentials()) return '';
  try {
    const text = buildElementPrompt(input);
    let userContent: string | ContentBlockParam[] = text;
    if (input.screenshot) {
      userContent = [
        {
          type: 'text',
          text:
            text +
            '\n\nIMPORTANT: Look at the screenshot with the blue highlight box. What is the user clicking on? Use what you SEE in the image to create a better description.',
        },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: input.screenshot,
          },
        },
      ];
    }
    const messages: MessageParam[] = [
      { role: 'user', content: userContent },
      {
        role: 'assistant',
        content: 'Here is the action instruction:\n\n<description>',
      },
    ];
    const s = peekSettings();
    const raw = await createMessage({
      system: STEP_SYSTEM,
      messages,
      model: s.model,
      maxTokens: 64,
    });
    return parseDescription(raw);
  } catch {
    return '';
  }
}

export async function generateWorkflowSummary(
  steps: WorkflowStep[],
  opts?: { detailScreenshots?: boolean },
): Promise<{ prompt: string; error?: string }> {
  if (steps.length === 0) return { prompt: '' };
  if (!hasUsableCredentials()) {
    return { prompt: '', error: 'no_credentials' };
  }

  try {
    const list = steps.map((s, i) => `${i + 1}. ${s.description}`).join('\n');
    const narration = steps
      .map((s) => s.speechTranscript)
      .filter(Boolean)
      .join(' ');
    const detail = opts?.detailScreenshots
      ? `\n\nCRITICAL: You have screenshots for each action, but these screenshots will NOT be saved. Therefore, you MUST describe what you see in the screenshots in EXTENSIVE DETAIL. Be extremely specific about visual elements, locations, labels, and context needed to recreate these actions without seeing the screenshots.`
      : `\n\nIMPORTANT: You have screenshots showing each action. Use them to understand the context and create a clear, actionable prompt.`;

    const blocks: ContentBlockParam[] = [
      {
        type: 'text',
        text: `Here is a sequence of browser automation steps that were just recorded:\n\n${list}${
          narration
            ? `\n\nUSER'S SPOKEN NARRATION DURING DEMONSTRATION:\n"${narration}"\n\nCRITICAL: The user's spoken words reveal their TRUE INTENT. Use this narration as the PRIMARY source to understand what they want to accomplish.`
            : ''
        }${detail}\n\nBased on these steps${narration ? " and the user's spoken narration" : ''} and the detailed screenshots, generate a clear, actionable prompt that describes what task is being accomplished and what the goal is.`,
      },
    ];

    // Cap images to keep request size reasonable
    let imgCount = 0;
    for (const s of steps) {
      if (!s.screenshot || imgCount >= 8) continue;
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: s.screenshot,
        },
      });
      imgCount += 1;
    }

    const messages: MessageParam[] = [
      { role: 'user', content: blocks },
      {
        role: 'assistant',
        content: "I'll analyze this workflow and create a reusable prompt.\n\n<inputs>",
      },
    ];

    const s = peekSettings();
    const raw = await createMessage({
      system: SUMMARY_SYSTEM,
      messages,
      model: s.model,
      maxTokens: 512,
    });

    const inputsBlock = raw.match(/<inputs>([\s\S]*?)<\/inputs>/i);
    const promptBlock = raw.match(/<prompt>([\s\S]*?)<\/prompt>/i);
    const inputs: { name: string; description: string }[] = [];
    if (inputsBlock?.[1]) {
      for (const line of inputsBlock[1].split('\n')) {
        const m = line.match(/-\s*([^:]+):\s*(.*)/);
        if (m) inputs.push({ name: m[1]!.trim(), description: m[2]!.trim() });
      }
    }
    let prompt = promptBlock?.[1]?.trim() || '';
    if (!prompt) {
      const summary = raw.match(/<summary>([\s\S]*?)<\/summary>/i);
      prompt =
        summary?.[1]?.trim() ||
        raw
          .replace(/<inputs>[\s\S]*?<\/inputs>/gi, '')
          .replace(/<\/?prompt>/gi, '')
          .trim();
    }

    if (inputs.length > 0) {
      prompt = `Before running this workflow, please provide the following information:\n${inputs
        .map((i) => `- ${i.name}: ${i.description}`)
        .join('\n')}\n\n${prompt}`;
    }

    return { prompt };
  } catch (e) {
    return { prompt: '', error: describeApiError(e) };
  }
}
