import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

export const ANSWER_BUTTON_CUSTOM_ID_PREFIX = "egon-qa:";
export const ANSWER_MODAL_CUSTOM_ID_PREFIX = "egon-qa-modal:";
export const ANSWER_TEXT_INPUT_ID = "answer";

export const MAX_NUMBERED_CHOICES = 3;

const MODAL_TITLE_LIMIT = 45;

export type AnswerChoice = 1 | 2 | 3 | "other";

export type ParsedAnswerButton = {
  featureId: number;
  choice: AnswerChoice;
};

function parsePositiveInt(value: string): number | undefined {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    return undefined;
  }
  return id;
}

function isChoiceIndex(value: number): value is 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3;
}

/** Pull consecutive `1.` / `2.` / `3.` options out of a question body. */
export function parseNumberedChoices(question: string): string[] {
  const found = new Map<number, string>();
  for (const line of question.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)[.)]\s*(.*)$/);
    if (!match) {
      continue;
    }
    const n = Number(match[1]);
    if (!isChoiceIndex(n)) {
      continue;
    }
    found.set(n, (match[2] ?? "").trim());
  }
  const choices: string[] = [];
  for (let i = 1; i <= MAX_NUMBERED_CHOICES; i++) {
    if (!found.has(i)) {
      break;
    }
    choices.push(found.get(i) ?? "");
  }
  return choices;
}

export function normalizeChoices(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed = item.trim();
    if (trimmed === "") {
      continue;
    }
    out.push(trimmed);
    if (out.length === MAX_NUMBERED_CHOICES) {
      break;
    }
  }
  return out;
}

/** Append numbered choices when the question does not already list them. */
export function formatQuestionBody(question: string, choices: readonly string[]): string {
  if (parseNumberedChoices(question).length > 0 || choices.length === 0) {
    return question;
  }
  const lines = choices.map((choice, index) => `${String(index + 1)}. ${choice}`);
  return `${question}\n${lines.join("\n")}`;
}

export function formatChoiceAnswer(question: string, choice: 1 | 2 | 3): string {
  const text = parseNumberedChoices(question)[choice - 1];
  if (text === undefined || text === "") {
    return String(choice);
  }
  return `${choice}. ${text}`;
}

export function answerButtonRow(
  featureId: number,
  choiceCount: number,
): ActionRowBuilder<ButtonBuilder> {
  const count = Math.max(0, Math.min(MAX_NUMBERED_CHOICES, Math.floor(choiceCount)));
  const row = new ActionRowBuilder<ButtonBuilder>();
  for (let i = 1; i <= count; i++) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${ANSWER_BUTTON_CUSTOM_ID_PREFIX}${String(featureId)}:${String(i)}`)
        .setLabel(`${String(i)}.`)
        .setStyle(ButtonStyle.Primary),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`${ANSWER_BUTTON_CUSTOM_ID_PREFIX}${String(featureId)}:other`)
      .setLabel(count > 0 ? "Answer other" : "Answer")
      .setStyle(count > 0 ? ButtonStyle.Secondary : ButtonStyle.Primary),
  );
  return row;
}

export function parseAnswerButtonCustomId(customId: string): ParsedAnswerButton | undefined {
  if (!customId.startsWith(ANSWER_BUTTON_CUSTOM_ID_PREFIX)) {
    return undefined;
  }
  const rest = customId.slice(ANSWER_BUTTON_CUSTOM_ID_PREFIX.length);
  const split = rest.lastIndexOf(":");
  if (split <= 0) {
    return undefined;
  }
  const featureId = parsePositiveInt(rest.slice(0, split));
  const choiceRaw = rest.slice(split + 1);
  if (featureId === undefined) {
    return undefined;
  }
  if (choiceRaw === "other") {
    return { featureId, choice: "other" };
  }
  const choice = parsePositiveInt(choiceRaw);
  if (choice === undefined || !isChoiceIndex(choice)) {
    return undefined;
  }
  return { featureId, choice };
}

export function parseAnswerModalCustomId(customId: string): number | undefined {
  if (!customId.startsWith(ANSWER_MODAL_CUSTOM_ID_PREFIX)) {
    return undefined;
  }
  return parsePositiveInt(customId.slice(ANSWER_MODAL_CUSTOM_ID_PREFIX.length));
}

function modalTitle(featureName: string): string {
  const trimmed = featureName.trim() === "" ? "feature" : featureName.trim();
  const prefix = "Answer: ";
  if (prefix.length + trimmed.length <= MODAL_TITLE_LIMIT) {
    return `${prefix}${trimmed}`;
  }
  return `${prefix}${trimmed.slice(0, MODAL_TITLE_LIMIT - prefix.length - 1)}…`;
}

export function answerOtherModal(featureId: number, featureName: string): ModalBuilder {
  const text = new TextInputBuilder()
    .setCustomId(ANSWER_TEXT_INPUT_ID)
    .setLabel("Answer")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000);
  return new ModalBuilder()
    .setCustomId(`${ANSWER_MODAL_CUSTOM_ID_PREFIX}${String(featureId)}`)
    .setTitle(modalTitle(featureName))
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(text));
}
