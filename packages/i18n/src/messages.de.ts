export const messagesDe = {
  common: {
    roles: {
      member: "Mitglied",
      admin: "Admin",
      owner: "Inhaber",
    },
    labels: {
      email: "E-Mail",
      name: "Name",
      slug: "Slug",
      role: "Rolle",
      avatar: "Avatar",
      verificationCode: "Bestätigungscode",
      organization: "Organisation",
      invitedEmail: "Eingeladene E-Mail",
      invitedBy: "Eingeladen von",
    },
    actions: {
      cancel: "Abbrechen",
      continue: "Weiter",
      create: "Erstellen",
      save: "Speichern",
      saveChanges: "Änderungen speichern",
      saveRole: "Rolle speichern",
      remove: "Entfernen",
      delete: "Löschen",
      leave: "Verlassen",
      switch: "Wechseln",
      settings: "Einstellungen",
      invite: "Einladen",
      sendInvite: "Einladung senden",
      signOut: "Abmelden",
      goToLogin: "Zum Login",
      getStarted: "Loslegen",
      openApp: "App öffnen",
      resendCode: "Code erneut senden",
      sendCode: "Code senden",
      accept: "Annehmen",
      decline: "Ablehnen",
      revoke: "Widerrufen",
      editRole: "Rolle bearbeiten",
      switchOrganization: "Organisation wechseln",
      removeMember: "Mitglied entfernen",
      close: "Schließen",
      previous: "Zurück",
      next: "Weiter",
    },
    state: {
      loading: "Lädt...",
      sending: "Wird gesendet...",
      saving: "Wird gespeichert...",
      creating: "Wird erstellt...",
      deleting: "Wird gelöscht...",
      leaving: "Wird verlassen...",
      switching: "Wird gewechselt...",
      verifying: "Wird geprüft...",
      accepting: "Wird angenommen...",
      declining: "Wird abgelehnt...",
      removing: "Wird entfernt...",
      revoking: "Wird widerrufen...",
    },
    theme: {
      label: "Design",
      system: "System",
      light: "Hell",
      dark: "Dunkel",
    },
    language: {
      label: "Sprache",
      system: "System",
      english: "English",
      german: "Deutsch",
    },
    a11y: {
      pagination: "Seitennavigation",
      breadcrumb: "Brotkrumenpfad",
      goToPreviousPage: "Zur vorherigen Seite",
      goToNextPage: "Zur nächsten Seite",
      morePages: "Weitere Seiten",
      more: "Mehr",
      previousSlide: "Vorherige Folie",
      nextSlide: "Nächste Folie",
      sidebar: "Seitenleiste",
      sidebarDescription: "Zeigt die mobile Seitenleiste an.",
      toggleSidebar: "Seitenleiste umschalten",
    },
    misc: {
      notFound: "Nicht gefunden",
      unknown: "Unbekannt",
      unknownUser: "Unbekannter Benutzer",
      user: "Benutzer",
      untitledWorkspace: "Unbenannter Workspace",
      active: "Aktiv",
      workspace: "Workspace",
      account: "Konto",
      organization: "Organisation",
    },
  },
  landing: {
    eyebrow: "MVP Template",
    title: "Baue deinen Workspace schneller.",
    description:
      "Authentifizierung, Onboarding, Organisationen und die App-Shell sind bereits eingerichtet. Starte mit der OTP-Anmeldung.",
  },
  auth: {
    login: {
      title: "Login",
      description:
        "Nutze deine E-Mail und einen Einmalcode. Neue Benutzer werden automatisch erstellt.",
      emailPlaceholder: "du@example.com",
      toasts: {
        enterEmail: "Gib deine E-Mail-Adresse ein",
        failedSendCode: "Code konnte nicht gesendet werden",
        codeSent: "Bestätigungscode wurde gesendet",
        enterSixDigitCode: "Gib den 6-stelligen Code ein",
        invalidCode: "Ungültiger Code",
        failedVerifyCode: "Code konnte nicht verifiziert werden",
      },
    },
    onboarding: {
      title: "Willkommen",
      description: "Lege deinen Anzeigenamen fest, um die Einrichtung abzuschließen.",
      namePlaceholder: "Dein Name",
      toasts: {
        nameMinLength: "Der Name muss mindestens 2 Zeichen lang sein",
        failedUpdateProfile: "Profil konnte nicht aktualisiert werden",
      },
    },
    organization: {
      title: "Organisation erstellen",
      description: "Gib den Namen deiner Organisation ein, um fortzufahren.",
      namePlaceholder: "Acme GmbH",
      slugPlaceholder: "acme-gmbh",
      toasts: {
        nameMinLength:
          "Der Organisationsname muss mindestens 2 Zeichen lang sein",
        invalidName: "Gib einen gültigen Organisationsnamen ein",
        failedCreate: "Organisation konnte nicht erstellt werden",
        createdButSetActiveFailed:
          "Organisation wurde erstellt, aber konnte nicht aktiviert werden",
        created: "Organisation wurde erstellt",
      },
    },
    invitation: {
      invalidLinkTitle: "Ungültiger Einladungslink",
      invalidLinkDescription:
        "Dieser Einladungslink enthält keine Einladung-ID.",
      loadingTitle: "Einladung wird geladen",
      loadingDescription: "Deine Sitzung wird geprüft...",
      signInTitle: "Anmelden, um fortzufahren",
      signInDescription:
        "Melde dich zuerst an und kehre dann zu dieser Seite zurück, um die Einladung anzunehmen oder abzulehnen.",
      title: "Organisationseinladung",
      description: "Prüfe diese Einladung und entscheide, ob du beitreten möchtest.",
      loadingInvitation: "Einladung wird geladen...",
      invitationMayBeInvalid:
        "Diese Einladung ist möglicherweise ungültig, abgelaufen oder nicht mehr offen.",
      toasts: {
        missingInvitationId:
          "Dem Einladungslink fehlt eine Einladung-ID",
        invitationNotFoundOrExpired:
          "Einladung nicht gefunden oder abgelaufen",
        failedLoadInvitation: "Einladung konnte nicht geladen werden",
        failedAcceptInvitation: "Einladung konnte nicht angenommen werden",
        invitationAccepted: "Einladung angenommen",
        failedRejectInvitation: "Einladung konnte nicht abgelehnt werden",
        invitationDeclined: "Einladung abgelehnt",
      },
    },
  },
  app: {
    shell: {
      dashboard: "Dashboard",
      members: "Mitglieder",
      workspace: "Workspace",
      searchMembers: "Mitglieder suchen",
      invite: "Einladen",
      organizationMenuLabel: "Organisation",
      accountMenuLabel: "Konto",
      openMemberActions: "Mitgliederaktionen öffnen",
      openInvitationActions: "Einladungsaktionen öffnen",
      openLanguageMenu: "Sprachmenü öffnen",
    },
    dashboard: {
      eyebrow: "Workspace-Übersicht",
      title: "Dashboard",
      privateLoading: "Geschützte Dashboard-Daten werden geladen...",
      accessTitle: "Zugriff",
      accessDescription: "Private Route ist aktiviert",
      statusTitle: "Status",
      statusDescription: "Sitzung und Organisation sind aktiv",
      nextStepTitle: "Nächster Schritt",
      nextStepDescription: "Lade Mitglieder ein, um zusammenzuarbeiten",
      privateDataAuthenticated: "Dies ist privat",
      privateDataUnauthenticated: "Nicht angemeldet",
    },
    dialogs: {
      inviteMember: {
        title: "Mitglied einladen",
        description: "Sende eine Einladung, um dieser Organisation beizutreten.",
        emailPlaceholder: "person@firma.de",
        selectRole: "Rolle auswählen",
      },
      profile: {
        title: "Profileinstellungen",
        description: "Aktualisiere deinen Anzeigenamen und Avatar.",
        avatarHint:
          "PNG, JPG oder WEBP bis 10 MB (automatisch optimiert).",
      },
      switchOrganization: {
        title: "Organisation wechseln",
        description: "Wähle eine deiner Organisationen aus.",
        loading: "Organisationen werden geladen...",
        empty: "Du hast noch keine Organisationen.",
      },
      createOrganization: {
        title: "Organisation erstellen",
        description: "Erstelle eine neue Organisation und wechsle zu ihr.",
        namePlaceholder: "Acme GmbH",
        slugPlaceholder: "acme-gmbh",
      },
      organization: {
        title: "Organisation",
        description: "Bearbeite den Organisationsnamen und prüfe den Slug.",
        logoHint: "PNG, JPG oder WEBP bis 2 MB.",
      },
      leaveOrganization: {
        title: "Organisation verlassen?",
        descriptionWithName:
          "Du verlierst den Zugriff auf {organizationName}, sofern dich niemand erneut einlädt.",
        descriptionWithoutName:
          "Du verlierst den Zugriff auf diese Organisation, sofern dich niemand erneut einlädt.",
      },
      deleteOrganization: {
        title: "Organisation löschen?",
        descriptionWithName:
          "Dadurch wird {organizationName} dauerhaft gelöscht, inklusive Mitglieder und Einladungen.",
        descriptionWithoutName:
          "Dadurch wird die Organisation dauerhaft gelöscht, inklusive Mitglieder und Einladungen.",
      },
    },
    members: {
      noActiveOrganization: "Keine aktive Organisation ausgewählt.",
      goToOrganizationSettings: "Zu den Organisationseinstellungen",
      unableToLoad:
        "Mitglieder für diese Organisation konnten nicht geladen werden.",
      noMembersMatchSearch:
        "Keine Mitglieder entsprechen deiner Suche.",
      noMembersFound: "Keine Mitglieder gefunden.",
      pendingInvitations: "Ausstehende Einladungen",
      noPendingInvitations: "Keine ausstehenden Einladungen.",
      expires: "Läuft ab: {date}",
      editMemberRoleTitle: "Mitgliederrolle bearbeiten",
      editMemberRoleDescriptionWithName:
        "Rolle für {memberName} ändern.",
      editMemberRoleDescriptionDefault:
        "Wähle eine neue Rolle für dieses Mitglied aus.",
      selectRole: "Rolle auswählen",
      removeMemberTitle: "Mitglied entfernen?",
      removeMemberDescriptionWithName:
        "{memberName} ({memberEmail}) wird aus der Organisation entfernt.",
      removeMemberDescriptionDefault:
        "Dieses Mitglied wird aus der Organisation entfernt.",
      toasts: {
        failedUpdateMemberRole:
          "Mitgliederrolle konnte nicht aktualisiert werden",
        memberRoleUpdated: "Mitgliederrolle aktualisiert",
        cannotRemoveSelf:
          "Du kannst dich nicht selbst entfernen. Nutze in den Einstellungen " +
          "\"Organisation verlassen\".",
        failedRemoveMember: "Mitglied konnte nicht entfernt werden",
        memberRemoved: "Mitglied entfernt",
        failedRevokeInvitation: "Einladung konnte nicht widerrufen werden",
        invitationRevoked: "Einladung widerrufen",
      },
    },
    toasts: {
      organizationNameMinLength:
        "Der Organisationsname muss mindestens 2 Zeichen lang sein",
      invalidOrganizationName: "Gib einen gültigen Organisationsnamen ein",
      failedUpdateOrganization: "Organisation konnte nicht aktualisiert werden",
      organizationUpdated: "Organisation aktualisiert",
      userNameMinLength: "Der Name muss mindestens 2 Zeichen lang sein",
      failedUpdateProfile: "Profil konnte nicht aktualisiert werden",
      profileUpdated: "Profil aktualisiert",
      selectImageFile: "Bitte wähle eine Bilddatei aus",
      imageTooLarge: "Bild muss 10 MB oder kleiner sein",
      failedProcessImage: "Bild konnte nicht verarbeitet werden",
      failedSwitchOrganization: "Organisation konnte nicht gewechselt werden",
      organizationSwitched: "Organisation gewechselt",
      failedCreateOrganization: "Organisation konnte nicht erstellt werden",
      createdButSwitchFailed:
        "Organisation wurde erstellt, aber Wechsel ist fehlgeschlagen",
      organizationCreated: "Organisation erstellt",
      noActiveOrganization: "Keine aktive Organisation ausgewählt",
      ownersCannotLeave:
        "Inhaber können die Organisation nicht verlassen. Lösche stattdessen die Organisation.",
      failedLeaveOrganization: "Organisation konnte nicht verlassen werden",
      organizationLeft: "Du hast die Organisation verlassen",
      onlyOwnersCanDelete:
        "Nur Inhaber der Organisation können sie löschen.",
      failedDeleteOrganization: "Organisation konnte nicht gelöscht werden",
      organizationDeleted: "Organisation gelöscht",
      enterEmailAddress: "Gib eine E-Mail-Adresse ein",
      enterValidEmailAddress: "Gib eine gültige E-Mail-Adresse ein",
      failedSendInvitation: "Einladung konnte nicht gesendet werden",
      invitationSentTo: "Einladung gesendet an {email}",
      languageUpdated: "Sprache aktualisiert",
      languageSaveFailed: "Spracheinstellung konnte nicht gespeichert werden",
    },
  },
  emails: {
    otp: {
      titleSignIn: "Anmeldecode",
      titleEmailVerification: "E-Mail-Bestätigungscode",
      titleForgetPassword: "Passwort-Reset-Code",
      preview: "{title} für {appName}",
      useCodeToContinue: "Nutze diesen Code, um fortzufahren:",
      expiresInFiveMinutes: "Dieser Code läuft in 5 Minuten ab.",
      subject: "{appName} Bestätigungscode",
    },
    invitation: {
      preview: "Tritt {organizationName} im Workspace bei",
      heading: "Organisationseinladung",
      body:
        "{inviterName} hat dich eingeladen, {organizationName} als {role} beizutreten.",
      acceptCta: "Einladung annehmen",
      fallbackHint:
        "Wenn der Button nicht funktioniert, kopiere diese URL:",
      subject: "Einladung zum Beitritt zu {organizationName}",
    },
  },
  errors: {
    genericUnexpected:
      "Etwas ist schiefgelaufen. Bitte versuche es erneut.",
    provider: {
      USER_NOT_FOUND: "Benutzer nicht gefunden",
      FAILED_TO_CREATE_USER: "Benutzer konnte nicht erstellt werden",
      FAILED_TO_CREATE_SESSION: "Sitzung konnte nicht erstellt werden",
      FAILED_TO_UPDATE_USER: "Benutzer konnte nicht aktualisiert werden",
      FAILED_TO_GET_SESSION: "Sitzung konnte nicht geladen werden",
      INVALID_PASSWORD: "Ungültiges Passwort",
      INVALID_EMAIL: "Ungültige E-Mail",
      INVALID_EMAIL_OR_PASSWORD: "Ungültige E-Mail oder ungültiges Passwort",
      SOCIAL_ACCOUNT_ALREADY_LINKED: "Social-Account ist bereits verknüpft",
      PROVIDER_NOT_FOUND: "Provider nicht gefunden",
      INVALID_TOKEN: "Ungültiger Token",
      ID_TOKEN_NOT_SUPPORTED: "ID-Token wird nicht unterstützt",
      FAILED_TO_GET_USER_INFO: "Benutzerdaten konnten nicht geladen werden",
      USER_EMAIL_NOT_FOUND: "Benutzer-E-Mail nicht gefunden",
      EMAIL_NOT_VERIFIED: "E-Mail nicht verifiziert",
      PASSWORD_TOO_SHORT: "Passwort ist zu kurz",
      PASSWORD_TOO_LONG: "Passwort ist zu lang",
      USER_ALREADY_EXISTS: "Benutzer existiert bereits",
      USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
        "Benutzer existiert bereits. Nutze eine andere E-Mail.",
      EMAIL_CAN_NOT_BE_UPDATED: "E-Mail kann nicht aktualisiert werden",
      CREDENTIAL_ACCOUNT_NOT_FOUND: "Zugangskonto nicht gefunden",
      SESSION_EXPIRED:
        "Sitzung abgelaufen. Bitte erneut anmelden, um fortzufahren.",
      FAILED_TO_UNLINK_LAST_ACCOUNT:
        "Dein letztes Konto kann nicht entkoppelt werden",
      ACCOUNT_NOT_FOUND: "Konto nicht gefunden",
      USER_ALREADY_HAS_PASSWORD:
        "Benutzer hat bereits ein Passwort. Verwende es, um das Konto zu löschen.",
      INVALID_OTP: "Ungültiger OTP-Code",
      OTP_EXPIRED: "OTP-Code ist abgelaufen",
      TOO_MANY_ATTEMPTS: "Zu viele Versuche",
      YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION:
        "Du darfst keine neue Organisation erstellen",
      YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS:
        "Du hast die maximale Anzahl an Organisationen erreicht",
      ORGANIZATION_ALREADY_EXISTS: "Organisation existiert bereits",
      ORGANIZATION_SLUG_ALREADY_TAKEN: "Organisations-Slug ist bereits vergeben",
      ORGANIZATION_NOT_FOUND: "Organisation nicht gefunden",
      USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION:
        "Benutzer ist kein Mitglied der Organisation",
      YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION:
        "Du darfst diese Organisation nicht aktualisieren",
      YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_ORGANIZATION:
        "Du darfst diese Organisation nicht löschen",
      NO_ACTIVE_ORGANIZATION: "Keine aktive Organisation",
      USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION:
        "Benutzer ist bereits Mitglied dieser Organisation",
      MEMBER_NOT_FOUND: "Mitglied nicht gefunden",
      ROLE_NOT_FOUND: "Rolle nicht gefunden",
      YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_TEAM:
        "Du darfst kein neues Team erstellen",
      TEAM_ALREADY_EXISTS: "Team existiert bereits",
      TEAM_NOT_FOUND: "Team nicht gefunden",
      YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER:
        "Du kannst die Organisation als einziger Inhaber nicht verlassen",
      YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER:
        "Du kannst die Organisation nicht ohne Inhaber verlassen",
      YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER:
        "Du darfst dieses Mitglied nicht löschen",
      YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION:
        "Du darfst keine Benutzer in diese Organisation einladen",
      USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION:
        "Benutzer wurde bereits in diese Organisation eingeladen",
      INVITATION_NOT_FOUND: "Einladung nicht gefunden",
      YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION:
        "Du bist nicht der Empfänger dieser Einladung",
      EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION:
        "E-Mail-Verifizierung erforderlich, bevor die Einladung angenommen oder abgelehnt werden kann",
      YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION:
        "Du darfst diese Einladung nicht stornieren",
      INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION:
        "Der Einladende ist kein Mitglied der Organisation mehr",
      YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE:
        "Du darfst keinen Benutzer mit dieser Rolle einladen",
      FAILED_TO_RETRIEVE_INVITATION: "Einladung konnte nicht geladen werden",
      YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_TEAMS:
        "Du hast die maximale Anzahl an Teams erreicht",
      UNABLE_TO_REMOVE_LAST_TEAM: "Letztes Team kann nicht entfernt werden",
      YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER:
        "Du darfst dieses Mitglied nicht aktualisieren",
      ORGANIZATION_MEMBERSHIP_LIMIT_REACHED:
        "Mitgliederlimit der Organisation erreicht",
      YOU_ARE_NOT_ALLOWED_TO_CREATE_TEAMS_IN_THIS_ORGANIZATION:
        "Du darfst in dieser Organisation keine Teams erstellen",
      YOU_ARE_NOT_ALLOWED_TO_DELETE_TEAMS_IN_THIS_ORGANIZATION:
        "Du darfst in dieser Organisation keine Teams löschen",
      YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_TEAM:
        "Du darfst dieses Team nicht aktualisieren",
      YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_TEAM:
        "Du darfst dieses Team nicht löschen",
      INVITATION_LIMIT_REACHED: "Einladungslimit erreicht",
      TEAM_MEMBER_LIMIT_REACHED: "Team-Mitgliederlimit erreicht",
      USER_IS_NOT_A_MEMBER_OF_THE_TEAM: "Benutzer ist kein Teammitglied",
      YOU_CAN_NOT_ACCESS_THE_MEMBERS_OF_THIS_TEAM:
        "Du darfst die Mitglieder dieses Teams nicht auflisten",
      YOU_DO_NOT_HAVE_AN_ACTIVE_TEAM: "Du hast kein aktives Team",
      YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_TEAM_MEMBER:
        "Du darfst kein neues Teammitglied erstellen",
      YOU_ARE_NOT_ALLOWED_TO_REMOVE_A_TEAM_MEMBER:
        "Du darfst kein Teammitglied entfernen",
      YOU_ARE_NOT_ALLOWED_TO_ACCESS_THIS_ORGANIZATION:
        "Du darfst auf diese Organisation nicht zugreifen",
      YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION:
        "Du bist kein Mitglied dieser Organisation",
      MISSING_AC_INSTANCE:
        "Dynamische Zugriffskontrolle erfordert eine vordefinierte Access-Control-Instanz",
      YOU_MUST_BE_IN_AN_ORGANIZATION_TO_CREATE_A_ROLE:
        "Du musst in einer Organisation sein, um eine Rolle zu erstellen",
      YOU_ARE_NOT_ALLOWED_TO_CREATE_A_ROLE:
        "Du darfst keine Rolle erstellen",
      YOU_ARE_NOT_ALLOWED_TO_UPDATE_A_ROLE:
        "Du darfst diese Rolle nicht aktualisieren",
      YOU_ARE_NOT_ALLOWED_TO_DELETE_A_ROLE:
        "Du darfst diese Rolle nicht löschen",
      YOU_ARE_NOT_ALLOWED_TO_READ_A_ROLE:
        "Du darfst diese Rolle nicht lesen",
      YOU_ARE_NOT_ALLOWED_TO_LIST_A_ROLE:
        "Du darfst diese Rolle nicht auflisten",
      YOU_ARE_NOT_ALLOWED_TO_GET_A_ROLE:
        "Du darfst diese Rolle nicht abrufen",
      TOO_MANY_ROLES: "Diese Organisation hat zu viele Rollen",
      INVALID_RESOURCE:
        "Die angegebene Berechtigung enthält eine ungültige Ressource",
      ROLE_NAME_IS_ALREADY_TAKEN: "Dieser Rollenname ist bereits vergeben",
      CANNOT_DELETE_A_PRE_DEFINED_ROLE:
        "Eine vordefinierte Rolle kann nicht gelöscht werden",
    },
  },
} as const;
