import type { AppLocale } from "@mvp-template/i18n";

function toBinaryLocale(locale: AppLocale): "en" | "de" {
  return locale === "de" ? "de" : "en";
}

export function onboardingGreetingMessages(locale: AppLocale) {
  if (toBinaryLocale(locale) === "de") {
    return [
      "Hi, ich bin dein KI-Mitarbeiter.",
      "Lass uns kurz dein Konto verbinden.",
      "*Wie lautet deine E-Mail-Adresse?*",
    ];
  }

  return [
    "Hi, I’m your AI coworker.",
    "Let’s quickly connect your account.",
    "*What's your email address?*",
  ];
}

export function askPasswordMessage(options: {
  locale: AppLocale;
  email: string;
  isExistingUser: boolean;
}) {
  if (toBinaryLocale(options.locale) === "de") {
    return options.isExistingUser
      ? `Alles klar. Antworte jetzt mit dem Passwort für ${options.email}, damit ich dein WhatsApp verbinden kann.`
      : `Alles klar. Antworte jetzt mit einem Passwort für ${options.email}. Das nutzt du später auch für die Web-App.`;
  }

  return options.isExistingUser
    ? `Got it. Reply with the password for ${options.email} so I can connect your WhatsApp.`
    : `Got it. Reply with a password for ${options.email}. You'll use it for the web app too.`;
}

export function invalidEmailMessage(locale: AppLocale) {
  return toBinaryLocale(locale) === "de"
    ? "Das sieht nicht wie eine gültige E-Mail-Adresse aus. Versuch es bitte noch mal."
    : "That doesn’t look like a valid email address. Please try again.";
}

export function invalidPasswordMessage(locale: AppLocale) {
  return toBinaryLocale(locale) === "de"
    ? "Das hat nicht funktioniert. Bitte sende dein Passwort noch einmal."
    : "That didn't work. Please send your password again.";
}

export function onboardingCompletedMessage(options: {
  locale: AppLocale;
  organizationName: string;
}) {
  if (toBinaryLocale(options.locale) === "de") {
    return `Perfekt, dein WhatsApp ist jetzt mit ${options.organizationName} verbunden. Schreib mir einfach, wenn ich etwas erledigen soll.`;
  }

  return `Great, your WhatsApp is now connected to ${options.organizationName}. Message me anytime and I’ll take it from there.`;
}

export function onboardingSwitchHintMessage(locale: AppLocale) {
  return toBinaryLocale(locale) === "de"
    ? "Tipp: Sende /switch, um die aktive Organisation zu wechseln."
    : "Tip: Send /switch to change the active organization.";
}

export function onboardingPasswordAttemptsExceededMessage(locale: AppLocale) {
  return toBinaryLocale(locale) === "de"
    ? "Zu viele Fehlversuche. Bitte starte neu mit deiner E-Mail-Adresse."
    : "Too many failed attempts. Please restart with your email address.";
}

export function readyQuestionMessage(locale: AppLocale) {
  return toBinaryLocale(locale) === "de"
    ? "Soll ich das jetzt abschicken? Antworte mit 'Ja' oder 'Abschicken'."
    : "Want me to send this now? Reply with 'Yes' or 'Send'.";
}

export function waitForMoreMessage(locale: AppLocale) {
  return toBinaryLocale(locale) === "de"
    ? "Alles klar, ich warte auf deine nächste Nachricht."
    : "Got it, I’ll wait for your next message.";
}

export function documentationReminderMessage(locale: AppLocale) {
  return toBinaryLocale(locale) === "de"
    ? "Soll ich das für das Projekt dokumentieren? Antworte mit 'Ja' oder 'Nein'."
    : "Want me to document this for the project? Reply with 'Yes' or 'No'.";
}

export function documentationStartedMessage(locale: AppLocale) {
  return toBinaryLocale(locale) === "de"
    ? "Alles klar, ich dokumentiere das jetzt."
    : "Alright, I’m documenting this now.";
}

export function switchPromptMessage(options: {
  locale: AppLocale;
  organizations: Array<{ name: string }>;
}) {
  const lines = options.organizations.map((organization, index) => `${index + 1}. ${organization.name}`);

  if (toBinaryLocale(options.locale) === "de") {
    return ["Bitte wähle deine Organisation:", ...lines].join("\n");
  }

  return ["Please choose your organization:", ...lines].join("\n");
}

export function switchSuccessMessage(options: {
  locale: AppLocale;
  organizationName: string;
}) {
  return toBinaryLocale(options.locale) === "de"
    ? `Aktive Organisation ist jetzt ${options.organizationName}.`
    : `Your active organization is now ${options.organizationName}.`;
}

export function unlinkConfirmationMessage(locale: AppLocale) {
  return toBinaryLocale(locale) === "de"
    ? "Möchtest du WhatsApp wirklich trennen? Antworte mit 'Ja'."
    : "Do you really want to disconnect WhatsApp? Reply with 'Yes'.";
}

export function unlinkSuccessMessage(locale: AppLocale) {
  return toBinaryLocale(locale) === "de"
    ? "WhatsApp wurde getrennt."
    : "WhatsApp has been disconnected.";
}

export function unsupportedCommandMessage(locale: AppLocale) {
  return toBinaryLocale(locale) === "de"
    ? "Diesen Befehl habe ich nicht verstanden."
    : "I didn’t understand that command.";
}

export function transcriptionPrefix(locale: AppLocale, mediaType: "audio" | "video") {
  if (toBinaryLocale(locale) === "de") {
    return mediaType === "video" ? "Video-Transkript" : "Audio-Transkript";
  }

  return mediaType === "video" ? "Video transcript" : "Audio transcript";
}

export function clarificationQuestionMessage(options: {
  locale: AppLocale;
  title: string;
  description?: string | null;
  prompt?: string;
  questions?: Array<{
    prompt: string;
    options?: Array<{ label: string; description?: string | null }>;
  }>;
  options?: Array<{ label: string; description?: string | null }>;
  questionIndex?: number;
  questionCount?: number;
}) {
  const prompts =
    options.questions?.map((question) => question.prompt) ??
    (options.prompt ? [options.prompt] : []);
  const counter =
    typeof options.questionIndex === "number" && typeof options.questionCount === "number"
      ? `(${options.questionIndex + 1}/${options.questionCount})`
      : null;
  const header = counter ? `${options.title} ${counter}` : options.title;
  return [header, options.description ?? "", ...prompts].filter(Boolean).join("\n").trim();
}

export function clarificationMissingAnswerMessage(locale: AppLocale) {
  return toBinaryLocale(locale) === "de"
    ? "Bitte beantworte zuerst die offene Rückfrage."
    : "Please answer the pending clarification first.";
}

export function processingFallbackMessage(locale: AppLocale) {
  return toBinaryLocale(locale) === "de"
    ? "Bei der Verarbeitung ist etwas schiefgelaufen. Versuch es bitte noch einmal."
    : "Something went wrong while processing that. Please try again.";
}

export function workingOnThatMessage(locale: AppLocale) {
  return toBinaryLocale(locale) === "de"
    ? "Ich arbeite noch daran. Ich schicke dir gleich die Antwort."
    : "Working on that. I'll send the answer shortly.";
}

export function documentationCapturedMessage(options: {
  locale: AppLocale;
  count: number;
}) {
  if (toBinaryLocale(options.locale) === "de") {
    return `Alles klar, ich dokumentiere jetzt ${options.count} WhatsApp-Nachricht${options.count === 1 ? "" : "en"}.`;
  }

  return `Alright, I’m documenting ${options.count} WhatsApp message${options.count === 1 ? "" : "s"} now.`;
}

export function documentationEmptyMessage(locale: AppLocale) {
  return toBinaryLocale(locale) === "de"
    ? "Es gibt gerade keine gepufferten WhatsApp-Nachrichten zum Dokumentieren."
    : "There are no buffered WhatsApp messages to document right now.";
}

export function documentationBusyMessage(locale: AppLocale) {
  return toBinaryLocale(locale) === "de"
    ? "Bitte schließe zuerst die laufende Projektauswahl für deine letzte Dokumentation ab."
    : "Please finish the current project selection for your last documentation batch first.";
}

export function documentationInProgressMessage(locale: AppLocale) {
  return toBinaryLocale(locale) === "de"
    ? "Ich dokumentiere deine letzten WhatsApp-Nachrichten bereits."
    : "I'm already documenting your latest WhatsApp messages.";
}

export function documentationProjectChoiceMessage(options: {
  locale: AppLocale;
  projects: Array<{ location: string; customerName?: string | null }>;
  suggestedProjectLocation?: string | null;
}) {
  const lines = options.projects.map(
    (project, index) => `${index + 1}. ${formatProjectChoiceOption(project)}`,
  );

  if (toBinaryLocale(options.locale) === "de") {
    const suggestion = options.suggestedProjectLocation?.trim()
      ? `Neues Projekt: ${options.suggestedProjectLocation.trim()}`
      : "Antworte mit 'Neu', wenn ich ein neues Projekt anlegen soll.";

    return [
      "Für welches Projekt soll ich das speichern?",
      ...lines,
      "Antworte mit der Zahl oder mit 'Neu'.",
      suggestion,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const suggestion = options.suggestedProjectLocation?.trim()
    ? `New project suggestion: ${options.suggestedProjectLocation.trim()}`
    : "Reply with 'New' if I should create a new project.";

  return [
    "Which project should I save this to?",
    ...lines,
    "Reply with the number or with 'New'.",
    suggestion,
  ]
    .filter(Boolean)
    .join("\n");
}

export function documentationProjectLocationPrompt(options: {
  locale: AppLocale;
  suggestedProjectLocation?: string | null;
}) {
  if (toBinaryLocale(options.locale) === "de") {
    const suggestion = options.suggestedProjectLocation?.trim()
      ? `Vorschlag: ${options.suggestedProjectLocation.trim()}`
      : null;

    return [
      "Wie lautet der Projektort?",
      "Antworte einfach mit dem Projektort. Ich nutze ein bestehendes Projekt, falls es passt, oder lege es neu an.",
      suggestion,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const suggestion = options.suggestedProjectLocation?.trim()
    ? `Suggestion: ${options.suggestedProjectLocation.trim()}`
    : null;

  return [
    "What is the project location?",
    "Reply with the project location. I’ll use an existing project if it matches, or create it if needed.",
    suggestion,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatProjectChoiceOption(project: {
  location: string;
  customerName?: string | null;
}) {
  const customerName = project.customerName?.trim();
  return customerName ? `${project.location} (${customerName})` : project.location;
}

export function documentationProjectLocationLengthMessage(locale: AppLocale) {
  return toBinaryLocale(locale) === "de"
    ? "Der Projektort muss zwischen 2 und 120 Zeichen lang sein."
    : "The project location must be between 2 and 120 characters.";
}

export function pendingVoiceReplyTypingFallbackMessage(locale: AppLocale) {
  return toBinaryLocale(locale) === "de"
    ? "Ich konnte deine Sprachnachricht nicht sicher lesen. Bitte antworte kurz als Text."
    : "I couldn't reliably transcribe that voice reply. Please answer briefly in text.";
}

export function documentationSavedMessage(options: {
  locale: AppLocale;
  count: number;
  projectLocation: string;
}) {
  if (toBinaryLocale(options.locale) === "de") {
    return `Erledigt. Ich habe ${options.count} WhatsApp-Nachricht${options.count === 1 ? "" : "en"} in ${options.projectLocation} dokumentiert.`;
  }

  return `Done. I documented ${options.count} WhatsApp message${options.count === 1 ? "" : "s"} in ${options.projectLocation}.`;
}

export function documentationFailedMessage(locale: AppLocale) {
  return toBinaryLocale(locale) === "de"
    ? "Ich konnte die WhatsApp-Dokumentation nicht speichern. Versuch es bitte noch einmal."
    : "I couldn't save the WhatsApp documentation. Please try again.";
}
