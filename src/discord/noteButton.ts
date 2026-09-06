import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

export const DELETE_NOTE_CUSTOM_ID_PREFIX = "egon-del-note:";
export const ADD_NOTE_CUSTOM_ID_PREFIX = "egon-add-note:";
export const ADD_NOTE_MODAL_CUSTOM_ID_PREFIX = "egon-add-note-modal:";
export const ADD_NOTE_TEXT_INPUT_ID = "text";

const MODAL_TITLE_LIMIT = 45;

export type DeleteNoteTarget = {
  noteId: number;
  attachmentId?: number;
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

export function deleteNoteButtonRow(
  noteId: number,
  attachmentId?: number,
): ActionRowBuilder<ButtonBuilder> {
  const customId =
    attachmentId === undefined
      ? `${DELETE_NOTE_CUSTOM_ID_PREFIX}${String(noteId)}`
      : `${DELETE_NOTE_CUSTOM_ID_PREFIX}${String(noteId)}:${String(attachmentId)}`;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(customId).setLabel("Delete").setStyle(ButtonStyle.Danger),
  );
}

export function parseDeleteNoteCustomId(customId: string): DeleteNoteTarget | undefined {
  if (!customId.startsWith(DELETE_NOTE_CUSTOM_ID_PREFIX)) {
    return undefined;
  }
  const rest = customId.slice(DELETE_NOTE_CUSTOM_ID_PREFIX.length);
  const match = /^(\d+)(?::(\d+))?$/.exec(rest);
  if (!match || match[1] === undefined) {
    return undefined;
  }
  const noteId = parsePositiveInt(match[1]);
  if (noteId === undefined) {
    return undefined;
  }
  if (match[2] === undefined) {
    return { noteId };
  }
  const attachmentId = parsePositiveInt(match[2]);
  if (attachmentId === undefined) {
    return undefined;
  }
  return { noteId, attachmentId };
}

export function addNoteButtonRow(featureId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${ADD_NOTE_CUSTOM_ID_PREFIX}${String(featureId)}`)
      .setLabel("Add note")
      .setStyle(ButtonStyle.Primary),
  );
}

export function parseAddNoteCustomId(customId: string): number | undefined {
  if (!customId.startsWith(ADD_NOTE_CUSTOM_ID_PREFIX)) {
    return undefined;
  }
  return parsePositiveInt(customId.slice(ADD_NOTE_CUSTOM_ID_PREFIX.length));
}

export function parseAddNoteModalCustomId(customId: string): number | undefined {
  if (!customId.startsWith(ADD_NOTE_MODAL_CUSTOM_ID_PREFIX)) {
    return undefined;
  }
  return parsePositiveInt(customId.slice(ADD_NOTE_MODAL_CUSTOM_ID_PREFIX.length));
}

function modalTitle(featureName: string): string {
  const trimmed = featureName.trim() === "" ? "feature" : featureName.trim();
  const prefix = "Note: ";
  if (prefix.length + trimmed.length <= MODAL_TITLE_LIMIT) {
    return `${prefix}${trimmed}`;
  }
  return `${prefix}${trimmed.slice(0, MODAL_TITLE_LIMIT - prefix.length - 1)}…`;
}

export function addNoteModal(featureId: number, featureName: string): ModalBuilder {
  const text = new TextInputBuilder()
    .setCustomId(ADD_NOTE_TEXT_INPUT_ID)
    .setLabel("Note")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(2000);
  return new ModalBuilder()
    .setCustomId(`${ADD_NOTE_MODAL_CUSTOM_ID_PREFIX}${String(featureId)}`)
    .setTitle(modalTitle(featureName))
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(text));
}
