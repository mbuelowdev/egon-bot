import type { Client } from "discord.js";
import { featurePageUrl, type Config } from "../config.js";
import {
  answerButtonRow,
  formatQuestionBody,
  normalizeChoices,
  parseNumberedChoices,
} from "../discord/answerButtons.js";
import { postToChannel } from "../discord/channel.js";
import {
  waitForQuestionAnswer,
  QuestionWaitCancelledError,
  QuestionWaitTimeoutError,
  ASK_DISCORD_TIMEOUT_MS,
} from "../discord/qaWaiters.js";
import { formatFeatureName, PHASE_EMOJI } from "../format.js";
import { accumulateGameDecisions, parseGameDecisionTopic } from "../features/gameDecisions.js";
import type { Feature, FeatureStore, PlannerQuestion } from "../features/store.js";
import { beginAgentIdle, endAgentIdle } from "./agentIdle.js";

export type AskUsersDeps = {
  client: Client;
  store: FeatureStore;
  config: Config;
  featureId: number;
  postQuestion?: (
    feature: Pick<Feature, "id" | "name">,
    question: string,
  ) => Promise<void>;
  questionTimeoutMs?: number;
};

const MAX_CHOICES = 3;

export const MAX_ASK_ROUNDS = 2;
export const MAX_ASK_QUESTIONS = 5;

export const ASK_BUDGET_LINE =
  `at most ${String(MAX_ASK_ROUNDS)} rounds, ${String(MAX_ASK_QUESTIONS)} questions total; if a detail stays unanswered use the stated default`;

export const ASK_BUDGET_EXHAUSTED =
  `Ask budget exhausted (already ${String(MAX_ASK_ROUNDS)} rounds / ${String(MAX_ASK_QUESTIONS)} questions). Do not call ask_discord_users again. Use each question's stated default for anything still unanswered and write the spec. End with PLAN_COMPLETE, not PLAN_BLOCKED.`;

export const ASK_TOOL_DESCRIPTION =
  `Ask the humans in Discord clarifying questions. ${ASK_BUDGET_LINE[0].toUpperCase()}${ASK_BUDGET_LINE.slice(1)}. Pass ALL independent questions in one call as \`questions\`. Each item has \`question\`, a required \`default\` used if Discord does not answer, optional \`choices\` (up to 3), and optional \`topic\` (\`art-style\`, \`camera\`, \`control-scheme\`, or \`palette\`) for game-wide choices that persist in GAME_DECISIONS. Discord posts them one at a time. This tool returns after the list is answered or unanswered items take their defaults. A second call is only for follow-ups that depend on those answers.`;

export function plannerAskDiscordInstructions(): string {
  return [
    `Ask in rounds: ${ASK_BUDGET_LINE}.`,
    "Privately list every material unknown, then call ask_discord_users ONCE with `questions`: an array of every independent question.",
    "Never one question per tool call when more than one unknown is already known. Discord will ask them sequentially; do not wait between items yourself.",
    "After the tool returns, write the spec or make a second call only for questions that truly depend on those answers, and only if budget remains.",
    "Each question must be short and concrete, with up to 3 numbered choices plus Other, and a `default` you will use if Discord does not answer.",
    "Do not re-ask settled GAME_DECISIONS (art style, camera, control scheme, palette). For a new game-wide choice, set `topic` to art-style, camera, control-scheme, or palette so the answer is recorded and later plans skip it.",
    "Do not end with PLAN_BLOCKED because a detail was unanswered — use the stated default and write the spec.",
  ].join(" ");
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function remainingAskBudget(roundsUsed: number, questionsUsed: number): {
  rounds: number;
  questions: number;
} {
  return {
    rounds: Math.max(0, MAX_ASK_ROUNDS - Math.max(0, roundsUsed)),
    questions: Math.max(0, MAX_ASK_QUESTIONS - Math.max(0, questionsUsed)),
  };
}

export function questionDefault(item: PlannerQuestion): string {
  const explicit = item.default.trim();
  if (explicit !== "") {
    return explicit;
  }
  return (item.choices[0] ?? "").trim();
}

export function formatDefaultAnswer(defaultValue: string): string {
  const value = defaultValue.trim();
  if (value === "") {
    return "(no Discord answer; no default was provided)";
  }
  return `(no Discord answer; using default: ${value})`;
}

export async function postPlannerQuestion(
  deps: AskUsersDeps,
  feature: Pick<Feature, "id" | "name">,
  question: string,
): Promise<void> {
  const choices = parseNumberedChoices(question);
  const prompt = [
    `${PHASE_EMOJI.planning} Planner question for ${formatFeatureName(feature.name, featurePageUrl(deps.config, feature.name))}`,
    question,
  ].join("\n\n");
  const posted = await postToChannel(deps.client, deps.config.discordChannelId, prompt, {
    components: [answerButtonRow(feature.id, choices.length)],
  });
  deps.store.setDiscordIds(feature.id, { messageId: posted.id });
}

export function parsePlannerQuestions(args: unknown): PlannerQuestion[] | { error: string } {
  const rec = args !== null && typeof args === "object" && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : undefined;
  if (!rec) {
    return { error: "questions is required" };
  }
  if (!Array.isArray(rec.questions)) {
    return { error: "questions must be a non-empty array" };
  }
  const questions: PlannerQuestion[] = [];
  for (const item of rec.questions) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return { error: "each question must be an object with a question string" };
    }
    const row = item as Record<string, unknown>;
    const question = asString(row.question).trim();
    if (question === "") {
      return { error: "each item needs a non-empty question" };
    }
    const choices = normalizeChoices(row.choices).slice(0, MAX_CHOICES);
    const fallback = asString(row.default).trim() || (choices[0] ?? "");
    if (fallback === "") {
      return { error: "each item needs a non-empty default (or a first choice to use as the default)" };
    }
    const topic = parseGameDecisionTopic(row.topic);
    questions.push({
      question,
      choices,
      default: fallback,
      ...(topic ? { topic } : {}),
    });
  }
  if (questions.length === 0) {
    return { error: "questions must be a non-empty array" };
  }
  if (questions.length > MAX_ASK_QUESTIONS) {
    return {
      error: `at most ${String(MAX_ASK_QUESTIONS)} questions total; pick the most important and put defaults on the rest`,
    };
  }
  return questions;
}

export function formatQuestionBodies(questions: PlannerQuestion[]): string[] {
  return questions.map((item) => {
    const body = formatQuestionBody(item.question, item.choices);
    const fallback = questionDefault(item);
    if (fallback === "") {
      return body;
    }
    if (/\bdefault if unanswered:/i.test(body)) {
      return body;
    }
    return `${body}\nDefault if unanswered: ${fallback}`;
  });
}

export function formatHumansAnswered(bodies: string[], answers: string[]): string {
  const lines = ["The humans answered:"];
  for (let i = 0; i < bodies.length; i += 1) {
    const n = String(i + 1);
    lines.push(`Q${n}: ${bodies[i] ?? ""}`);
    lines.push(`A${n}: ${answers[i] ?? ""}`);
  }
  return lines.join("\n");
}

function persistGameDecisions(deps: AskUsersDeps, questions: PlannerQuestion[], answers: string[]): void {
  const gameRepoDir = deps.config.gameRepoDir;
  if (typeof gameRepoDir !== "string" || gameRepoDir === "") {
    return;
  }
  try {
    accumulateGameDecisions(
      { gameRepoDir },
      questions.map((item, index) => ({
        question: item.question,
        answer: answers[index] ?? "",
        topic: item.topic,
      })),
    );
  } catch (error) {
    console.error("failed to update GAME_DECISIONS.md", error);
  }
}

async function askOne(
  deps: AskUsersDeps,
  feature: { id: number; name: string },
  body: string,
): Promise<string> {
  deps.store.setPendingQuestion(feature.id, body);
  if (deps.postQuestion) {
    await deps.postQuestion(feature, body);
  } else {
    await postPlannerQuestion(deps, feature, body);
  }
  beginAgentIdle();
  try {
    return await waitForQuestionAnswer(feature.id, deps.questionTimeoutMs ?? ASK_DISCORD_TIMEOUT_MS);
  } finally {
    endAgentIdle();
  }
}

function persistBatch(
  deps: AskUsersDeps,
  questions: PlannerQuestion[],
  answers: string[],
  index: number,
): void {
  deps.store.setQuestionBatch(deps.featureId, { questions, answers, index });
}

async function collectAnswers(
  deps: AskUsersDeps,
  feature: { id: number; name: string },
  questions: PlannerQuestion[],
  bodies: string[],
  answers: string[],
  startIndex: number,
): Promise<string> {
  let useDefaults = false;
  persistBatch(deps, questions, answers, startIndex);
  try {
    for (let i = startIndex; i < questions.length; i += 1) {
      persistBatch(deps, questions, answers, i);
      const body = bodies[i] ?? "";
      const fallback = questionDefault(questions[i] ?? { question: "", choices: [], default: "" });
      let answer: string;
      if (useDefaults) {
        answer = formatDefaultAnswer(fallback);
      } else {
        try {
          answer = await askOne(deps, feature, body);
        } catch (error) {
          if (error instanceof QuestionWaitTimeoutError) {
            answer = formatDefaultAnswer(fallback);
            useDefaults = true;
          } else {
            throw error;
          }
        }
      }
      answers.push(answer);
    }
    persistBatch(deps, questions, answers, questions.length);
    deps.store.clearPendingQuestion(feature.id);
    deps.store.setQuestionBatch(feature.id, null);
    persistGameDecisions(deps, questions, answers);
    return formatHumansAnswered(bodies, answers);
  } catch (error) {
    if (error instanceof QuestionWaitCancelledError) {
      deps.store.clearPendingQuestion(feature.id);
      deps.store.setQuestionBatch(feature.id, null);
    }
    throw error;
  }
}

export async function askDiscordQuestionRound(
  deps: AskUsersDeps,
  questions: PlannerQuestion[],
): Promise<string> {
  const feature = deps.store.getFeatureById(deps.featureId);
  if (!feature) {
    throw new Error("Feature not found");
  }
  const remaining = remainingAskBudget(feature.plannerAskRounds, feature.plannerAskQuestions);
  if (remaining.rounds <= 0 || remaining.questions <= 0) {
    return ASK_BUDGET_EXHAUSTED;
  }
  const limited = questions.slice(0, remaining.questions);
  deps.store.addPlannerAskUsage(feature.id, limited.length);
  const bodies = formatQuestionBodies(limited);
  const answers: string[] = [];
  const text = await collectAnswers(deps, feature, limited, bodies, answers, 0);
  if (limited.length >= questions.length) {
    return text;
  }
  const dropped = questions.length - limited.length;
  return `${text}\n(${String(dropped)} extra question(s) dropped; ${ASK_BUDGET_LINE}. Use stated defaults for the rest.)`;
}

/** Finish an in-flight batch (or a single pending question) after a bot restart. */
export async function continueDiscordQuestionRound(deps: AskUsersDeps): Promise<string | undefined> {
  const feature = deps.store.getFeatureById(deps.featureId);
  if (!feature) {
    return undefined;
  }
  const batch = feature.pendingQuestionBatch;
  if (!batch) {
    if (!feature.pendingQuestion) {
      return undefined;
    }
    if (feature.pendingAnswer) {
      const answer = feature.pendingAnswer;
      const question = feature.pendingQuestion;
      deps.store.clearPendingQuestion(feature.id);
      persistGameDecisions(deps, [{ question, choices: [], default: "" }], [answer]);
      return formatHumansAnswered([question], [answer]);
    }
    const fallback = "";
    try {
      const answer = await askOne(deps, feature, feature.pendingQuestion);
      const question = feature.pendingQuestion;
      deps.store.clearPendingQuestion(feature.id);
      persistGameDecisions(deps, [{ question, choices: [], default: "" }], [answer]);
      return formatHumansAnswered([question], [answer]);
    } catch (error) {
      if (error instanceof QuestionWaitTimeoutError) {
        const question = feature.pendingQuestion;
        deps.store.clearPendingQuestion(feature.id);
        const answer = formatDefaultAnswer(fallback);
        persistGameDecisions(deps, [{ question, choices: [], default: "" }], [answer]);
        return formatHumansAnswered([question], [answer]);
      }
      throw error;
    }
  }

  const bodies = formatQuestionBodies(batch.questions);
  const answers = [...batch.answers];
  let index = Math.min(Math.max(0, batch.index), batch.questions.length);
  if (answers.length < index) {
    index = answers.length;
  }
  if (answers.length === index && feature.pendingAnswer && feature.pendingQuestion) {
    answers.push(feature.pendingAnswer);
    index += 1;
  }
  persistBatch(deps, batch.questions, answers, index);
  if (index >= batch.questions.length) {
    deps.store.clearPendingQuestion(feature.id);
    deps.store.setQuestionBatch(feature.id, null);
    persistGameDecisions(deps, batch.questions, answers);
    return formatHumansAnswered(bodies, answers);
  }
  return collectAnswers(deps, feature, batch.questions, bodies, answers, index);
}
