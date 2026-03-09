export function onboardingGreetingMessages(locale: "en" | "de") {
  if (locale === "de") {
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

export function askOtpMessage(locale: "en" | "de", email: string) {
  if (locale === "de") {
    return `Ich habe dir einen 6-stelligen Code an ${email} gesendet. Schick ihn mir einfach hier.`;
  }

  return `I sent a 6-digit code to ${email}. Just reply with that code here.`;
}

export function invalidEmailMessage(locale: "en" | "de") {
  return locale === "de"
    ? "Das sieht nicht wie eine gültige E-Mail-Adresse aus. Versuch es bitte noch mal."
    : "That doesn’t look like a valid email address. Please try again.";
}

export function invalidOtpMessage(locale: "en" | "de") {
  return locale === "de"
    ? "Der Code passt leider nicht. Bitte sende den 6-stelligen Code noch einmal."
    : "That code doesn’t match. Please send the 6-digit code again.";
}

export function onboardingCompletedMessage(options: {
  locale: "en" | "de";
  organizationName: string;
}) {
  if (options.locale === "de") {
    return `Perfekt, dein WhatsApp ist jetzt mit ${options.organizationName} verbunden. Schreib mir einfach, wenn ich etwas erledigen soll.`;
  }

  return `Great, your WhatsApp is now connected to ${options.organizationName}. Message me anytime and I’ll take it from there.`;
}

export function onboardingSwitchHintMessage(locale: "en" | "de") {
  return locale === "de"
    ? "Tipp: Sende /switch, um die aktive Organisation zu wechseln."
    : "Tip: Send /switch to change the active organization.";
}

export function onboardingOtpAttemptsExceededMessage(locale: "en" | "de") {
  return locale === "de"
    ? "Zu viele Fehlversuche. Bitte starte neu mit deiner E-Mail-Adresse."
    : "Too many failed attempts. Please restart with your email address.";
}

export function readyQuestionMessage(locale: "en" | "de") {
  return locale === "de"
    ? "Soll ich das jetzt abschicken? Antworte mit 'Ja' oder 'Abschicken'."
    : "Want me to send this now? Reply with 'Yes' or 'Send'.";
}

export function waitForMoreMessage(locale: "en" | "de") {
  return locale === "de"
    ? "Alles klar, ich warte auf deine nächste Nachricht."
    : "Got it, I’ll wait for your next message.";
}

export function switchPromptMessage(options: {
  locale: "en" | "de";
  organizations: Array<{ name: string }>;
}) {
  const lines = options.organizations.map((organization, index) => {
    return `${index + 1}. ${organization.name}`;
  });

  if (options.locale === "de") {
    return `Zu welcher Organisation soll ich wechseln?\n${lines.join("\n")}`;
  }

  return `Which organization should I switch to?\n${lines.join("\n")}`;
}

export function switchSuccessMessage(options: {
  locale: "en" | "de";
  organizationName: string;
}) {
  return options.locale === "de"
    ? `Alles klar, ich arbeite jetzt in ${options.organizationName}.`
    : `Done, I’m now working in ${options.organizationName}.`;
}

export function unlinkConfirmationMessage(locale: "en" | "de") {
  return locale === "de"
    ? "Soll ich die WhatsApp-Verbindung wirklich trennen? Antworte mit 'Ja' oder 'Nein'."
    : "Do you want me to unlink this WhatsApp connection? Reply with 'Yes' or 'No'.";
}

export function unlinkSuccessMessage(locale: "en" | "de") {
  return locale === "de"
    ? "Fertig, die WhatsApp-Verbindung ist getrennt."
    : "Done, the WhatsApp connection is removed.";
}

export function unsupportedCommandMessage(locale: "en" | "de") {
  return locale === "de"
    ? "Das habe ich nicht erkannt. Nutze /switch oder /unlink."
    : "I didn’t catch that. Use /switch or /unlink.";
}

export function transcriptionPrefix(locale: "en" | "de", mediaType: "audio" | "video") {
  if (locale === "de") {
    return mediaType === "video"
      ? "Video-Transkription"
      : "Sprachnachricht-Transkription";
  }

  return mediaType === "video" ? "Video transcription" : "Voice transcription";
}

export function clarificationQuestionMessage(options: {
  locale: "en" | "de";
  title: string;
  prompt: string;
  options: Array<{ id: string; label: string; description: string }>;
  questionIndex: number;
  questionCount: number;
}) {
  const optionLines = options.options.map((item, index) => {
    return `${index + 1}. ${item.label} — ${item.description}`;
  });

  if (options.locale === "de") {
    return [
      `${options.title} (${options.questionIndex + 1}/${options.questionCount})`,
      options.prompt,
      optionLines.join("\n"),
      "Antworte mit einer Nummer und optionalem Freitext, z. B. `1 Projektleiter ist Max`.",
    ].join("\n\n");
  }

  return [
    `${options.title} (${options.questionIndex + 1}/${options.questionCount})`,
    options.prompt,
    optionLines.join("\n"),
    "Reply with a number and optional free text, e.g. `1 Project lead is Max`.",
  ].join("\n\n");
}

export function clarificationMissingAnswerMessage(locale: "en" | "de") {
  return locale === "de"
    ? "Bitte antworte mit einer gültigen Nummer oder kurzem Freitext."
    : "Please reply with a valid number or short free text.";
}

export function processingFallbackMessage(locale: "en" | "de") {
  return locale === "de"
    ? "Alles klar, ich arbeite dran..."
    : "Got it, I’m on it...";
}
