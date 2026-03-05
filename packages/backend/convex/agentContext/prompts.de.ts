import type { ClarificationPromptPack } from "./types";

export const clarificationPromptsDe: ClarificationPromptPack = {
  generic: {
    title: "Mehr Kontext benötigt",
    description:
      "Ich kann fortfahren, sobald die genaue Aktion und das Ziel bestätigt sind.",
    assistantMessage:
      "Ich kann das erledigen, brauche dafür aber zuerst ein paar Details.",
    questions: [
      {
        id: "operation",
        prompt: "Was soll ich genau tun?",
        options: [
          {
            id: "read",
            label: "Nur lesen (Empfohlen)",
            description: "Daten abrufen und zusammenfassen, ohne Änderungen.",
          },
          {
            id: "update",
            label: "Daten aktualisieren",
            description: "Bestehende Unternehmensdaten ändern.",
          },
          {
            id: "create_or_remove",
            label: "Erstellen oder entfernen",
            description: "Einladen, entfernen oder Mitgliederstatus ändern.",
          },
        ],
        allowOther: true,
        required: true,
      },
    ],
  },
  invite_member: {
    title: "Fehlende Einladungsdetails",
    description: "Bitte bestätigen, wer eingeladen werden soll und mit welcher Rolle.",
    assistantMessage:
      "Ich kann Mitglieder sofort einladen, sobald die fehlenden Details vorliegen.",
    questions: [
      {
        id: "invitee",
        prompt: "Wer soll eingeladen werden?",
        options: [
          {
            id: "single_email",
            label: "Eine E-Mail (Empfohlen)",
            description: "Eine einzelne E-Mail-Adresse angeben.",
          },
          {
            id: "multiple_emails",
            label: "Mehrere E-Mails",
            description: "Mehrere E-Mail-Adressen kommagetrennt angeben.",
          },
          {
            id: "reuse_pending",
            label: "Vorhandene Einladung nutzen",
            description: "Auf eine bestehende ausstehende Einladung verweisen.",
          },
        ],
        allowOther: true,
        required: true,
      },
      {
        id: "role",
        prompt: "Welche Rolle soll die eingeladene Person erhalten?",
        options: [
          {
            id: "member",
            label: "Mitglied (Empfohlen)",
            description: "Standardzugriff ohne Admin-Rechte.",
          },
          {
            id: "admin",
            label: "Admin",
            description: "Kann Mitglieder und Organisationseinstellungen verwalten.",
          },
          {
            id: "owner",
            label: "Inhaber",
            description: "Höchste Berechtigungsstufe.",
          },
        ],
        allowOther: true,
        required: true,
      },
    ],
  },
  remove_member: {
    title: "Fehlendes Zielmitglied",
    description: "Bitte bestätigen, welches Mitglied entfernt werden soll.",
    assistantMessage:
      "Ich kann das Mitglied entfernen, sobald die Person eindeutig angegeben ist.",
    questions: [
      {
        id: "member_target",
        prompt: "Welches Mitglied soll entfernt werden?",
        options: [
          {
            id: "by_email",
            label: "Per E-Mail (Empfohlen)",
            description: "Die E-Mail-Adresse des Mitglieds angeben.",
          },
          {
            id: "by_member_id",
            label: "Per Mitglieds-ID",
            description: "Die interne Mitglieds-ID angeben.",
          },
          {
            id: "latest_added",
            label: "Zuletzt hinzugefügt",
            description: "Das zuletzt hinzugefügte Mitglied entfernen.",
          },
        ],
        allowOther: true,
        required: true,
      },
    ],
  },
  update_member_role: {
    title: "Fehlende Rollenänderungsdetails",
    description: "Bitte Mitglied und Zielrolle bestätigen.",
    assistantMessage:
      "Ich kann die Rolle ändern, sobald die fehlenden Angaben bestätigt sind.",
    questions: [
      {
        id: "member_target",
        prompt: "Wessen Rolle soll geändert werden?",
        options: [
          {
            id: "by_email",
            label: "Per E-Mail (Empfohlen)",
            description: "Die E-Mail-Adresse des Mitglieds angeben.",
          },
          {
            id: "by_member_id",
            label: "Per Mitglieds-ID",
            description: "Die interne Mitglieds-ID angeben.",
          },
          {
            id: "current_user",
            label: "Meine eigene Rolle",
            description: "Eigene Rolle ändern, falls erlaubt.",
          },
        ],
        allowOther: true,
        required: true,
      },
      {
        id: "role",
        prompt: "Welche neue Rolle soll gesetzt werden?",
        options: [
          {
            id: "member",
            label: "Mitglied (Empfohlen)",
            description: "Standardzugriff ohne Admin-Rechte.",
          },
          {
            id: "admin",
            label: "Admin",
            description: "Kann Mitglieder und Organisationseinstellungen verwalten.",
          },
          {
            id: "owner",
            label: "Inhaber",
            description: "Höchste Berechtigungsstufe.",
          },
        ],
        allowOther: true,
        required: true,
      },
    ],
  },
  cancel_invitation: {
    title: "Fehlender Einladungsbezug",
    description: "Bitte bestätigen, welche Einladung widerrufen werden soll.",
    assistantMessage:
      "Ich kann die Einladung widerrufen, sobald das Ziel eindeutig ist.",
    questions: [
      {
        id: "invitation_target",
        prompt: "Welche Einladung soll widerrufen werden?",
        options: [
          {
            id: "by_email",
            label: "Per E-Mail (Empfohlen)",
            description: "Die eingeladene E-Mail-Adresse verwenden.",
          },
          {
            id: "by_invitation_id",
            label: "Per Einladungs-ID",
            description: "Die Einladungs-ID angeben.",
          },
          {
            id: "all_pending",
            label: "Alle ausstehenden",
            description: "Alle aktuell ausstehenden Einladungen widerrufen.",
          },
        ],
        allowOther: true,
        required: true,
      },
    ],
  },
  update_organization: {
    title: "Fehlende Organisationsdetails",
    description: "Bitte bestätigen, welche Felder geändert werden sollen.",
    assistantMessage:
      "Ich kann Unternehmensdaten aktualisieren, sobald Ziel und Werte klar sind.",
    questions: [
      {
        id: "field",
        prompt: "Welches Feld soll aktualisiert werden?",
        options: [
          {
            id: "name",
            label: "Name (Empfohlen)",
            description: "Den Anzeigenamen der Organisation ändern.",
          },
          {
            id: "slug",
            label: "Slug",
            description: "Den URL-Slug ändern.",
          },
          {
            id: "logo",
            label: "Logo",
            description: "Die Logo-URL der Organisation ändern.",
          },
        ],
        allowOther: true,
        required: true,
      },
      {
        id: "new_value",
        prompt: "Wie soll der neue Wert lauten?",
        options: [
          {
            id: "provide_now",
            label: "Ich gebe ihn jetzt an (Empfohlen)",
            description: "Den exakten Wert im Freitextfeld eintragen.",
          },
          {
            id: "derive_from_brand",
            label: "Aus Marke ableiten",
            description: "Wert aus bestehenden Marken-/Firmenkonventionen ableiten.",
          },
          {
            id: "keep_current",
            label: "Unverändert lassen",
            description: "Dieses Feld nicht ändern.",
          },
        ],
        allowOther: true,
        required: true,
      },
    ],
  },
};
