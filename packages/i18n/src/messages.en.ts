export const messagesEn = {
  common: {
    roles: {
      member: "Member",
      admin: "Admin",
      owner: "Owner",
    },
    labels: {
      email: "Email",
      name: "Name",
      slug: "Slug",
      role: "Role",
      avatar: "Avatar",
      verificationCode: "Verification code",
      organization: "Organization",
      invitedEmail: "Invited email",
      invitedBy: "Invited by",
    },
    actions: {
      cancel: "Cancel",
      continue: "Continue",
      create: "Create",
      save: "Save",
      saveChanges: "Save changes",
      saveRole: "Save role",
      remove: "Remove",
      delete: "Delete",
      leave: "Leave",
      switch: "Switch",
      settings: "Settings",
      invite: "Invite",
      sendInvite: "Send invite",
      signOut: "Sign out",
      goToLogin: "Go to login",
      getStarted: "Get started",
      openApp: "Open app",
      resendCode: "Resend code",
      sendCode: "Send code",
      accept: "Accept",
      decline: "Decline",
      revoke: "Revoke",
      editRole: "Edit role",
      switchOrganization: "Switch organization",
      removeMember: "Remove member",
      close: "Close",
      previous: "Previous",
      next: "Next",
    },
    state: {
      loading: "Loading...",
      sending: "Sending...",
      saving: "Saving...",
      creating: "Creating...",
      deleting: "Deleting...",
      leaving: "Leaving...",
      switching: "Switching...",
      verifying: "Verifying...",
      accepting: "Accepting...",
      declining: "Declining...",
      removing: "Removing...",
      revoking: "Revoking...",
    },
    theme: {
      label: "Theme",
      system: "System",
      light: "Light",
      dark: "Dark",
    },
    language: {
      label: "Language",
      system: "System",
      english: "English",
      german: "Deutsch",
    },
    a11y: {
      pagination: "Pagination",
      breadcrumb: "Breadcrumb",
      goToPreviousPage: "Go to previous page",
      goToNextPage: "Go to next page",
      morePages: "More pages",
      more: "More",
      previousSlide: "Previous slide",
      nextSlide: "Next slide",
      sidebar: "Sidebar",
      sidebarDescription: "Displays the mobile sidebar.",
      toggleSidebar: "Toggle sidebar",
    },
    misc: {
      notFound: "Not found",
      unknown: "Unknown",
      unknownUser: "Unknown user",
      user: "User",
      untitledWorkspace: "Untitled workspace",
      active: "Active",
      workspace: "Workspace",
      account: "Account",
      organization: "Organization",
    },
  },
  landing: {
    eyebrow: "MVP Template",
    title: "Build your workspace faster.",
    description:
      "Authentication, onboarding, organizations, and the app shell are already wired. Start by signing in with OTP.",
  },
  auth: {
    login: {
      title: "Login",
      description:
        "Use your email and one-time code. New users are created automatically.",
      emailPlaceholder: "you@example.com",
      toasts: {
        enterEmail: "Enter your email address",
        failedSendCode: "Failed to send code",
        codeSent: "Verification code sent",
        enterSixDigitCode: "Enter the 6-digit code",
        invalidCode: "Invalid code",
        failedVerifyCode: "Failed to verify code",
      },
    },
    onboarding: {
      title: "Welcome",
      description: "Set your display name to finish setup.",
      namePlaceholder: "Your name",
      toasts: {
        nameMinLength: "Name must be at least 2 characters",
        failedUpdateProfile: "Failed to update profile",
      },
    },
    organization: {
      title: "Create Organization",
      description: "Enter your organization name to continue.",
      namePlaceholder: "Acme Inc",
      slugPlaceholder: "acme-inc",
      toasts: {
        nameMinLength: "Organization name must be at least 2 characters",
        invalidName: "Enter a valid organization name",
        failedCreate: "Failed to create organization",
        createdButSetActiveFailed:
          "Organization created, but setting active failed",
        created: "Organization created",
      },
    },
    invitation: {
      invalidLinkTitle: "Invalid Invitation Link",
      invalidLinkDescription:
        "This invitation link is missing an invitation ID.",
      loadingTitle: "Loading Invitation",
      loadingDescription: "Checking your session...",
      signInTitle: "Sign in to Continue",
      signInDescription:
        "Sign in first, then return to this page to accept or decline the invitation.",
      title: "Organization Invitation",
      description: "Review this invitation and choose whether to join.",
      loadingInvitation: "Loading invitation...",
      invitationMayBeInvalid:
        "This invitation may be invalid, expired, or no longer pending.",
      toasts: {
        missingInvitationId: "Invitation link is missing an invitation ID",
        invitationNotFoundOrExpired: "Invitation not found or expired",
        failedLoadInvitation: "Failed to load invitation",
        failedAcceptInvitation: "Failed to accept invitation",
        invitationAccepted: "Invitation accepted",
        failedRejectInvitation: "Failed to reject invitation",
        invitationDeclined: "Invitation declined",
      },
    },
  },
  app: {
    shell: {
      dashboard: "Dashboard",
      members: "Members",
      workspace: "Workspace",
      searchMembers: "Search members",
      invite: "Invite",
      organizationMenuLabel: "Organization",
      accountMenuLabel: "Account",
      openMemberActions: "Open member actions",
      openInvitationActions: "Open invitation actions",
      openLanguageMenu: "Open language menu",
    },
    dashboard: {
      eyebrow: "Workspace overview",
      title: "Dashboard",
      privateLoading: "Loading protected dashboard data...",
      accessTitle: "Access",
      accessDescription: "Private route enabled",
      statusTitle: "Status",
      statusDescription: "Session and organization are active",
      nextStepTitle: "Next step",
      nextStepDescription: "Invite members to start collaborating",
      privateDataAuthenticated: "This is private",
      privateDataUnauthenticated: "Not authenticated",
    },
    dialogs: {
      inviteMember: {
        title: "Invite Member",
        description: "Send an invitation to join this organization.",
        emailPlaceholder: "person@company.com",
        selectRole: "Select role",
      },
      profile: {
        title: "Profile Settings",
        description: "Update your display name and avatar.",
        avatarHint: "PNG, JPG, or WEBP up to 10MB (optimized automatically).",
      },
      switchOrganization: {
        title: "Switch Organization",
        description: "Select one of your organizations.",
        loading: "Loading organizations...",
        empty: "You do not have any organizations yet.",
      },
      createOrganization: {
        title: "Create Organization",
        description: "Create a new organization and switch to it.",
        namePlaceholder: "Acme Inc",
        slugPlaceholder: "acme-inc",
      },
      organization: {
        title: "Organization",
        description: "Edit your organization name and review its slug.",
        logoHint: "PNG, JPG, or WEBP up to 2MB.",
      },
      leaveOrganization: {
        title: "Leave organization?",
        descriptionWithName:
          "You will lose access to {organizationName} unless someone invites you again.",
        descriptionWithoutName:
          "You will lose access to this organization unless someone invites you again.",
      },
      deleteOrganization: {
        title: "Delete organization?",
        descriptionWithName:
          "This permanently deletes {organizationName}, including members and invitations.",
        descriptionWithoutName:
          "This permanently deletes the organization, including members and invitations.",
      },
    },
    members: {
      noActiveOrganization: "No active organization selected.",
      goToOrganizationSettings: "Go to organization settings",
      unableToLoad: "Unable to load members for this organization.",
      noMembersMatchSearch: "No members match your search.",
      noMembersFound: "No members found.",
      pendingInvitations: "Pending Invitations",
      noPendingInvitations: "No pending invitations.",
      expires: "Expires: {date}",
      editMemberRoleTitle: "Edit Member Role",
      editMemberRoleDescriptionWithName:
        "Change role for {memberName}.",
      editMemberRoleDescriptionDefault: "Select a new role for this member.",
      selectRole: "Select role",
      removeMemberTitle: "Remove member?",
      removeMemberDescriptionWithName:
        "This will remove {memberName} ({memberEmail}) from the organization.",
      removeMemberDescriptionDefault:
        "This member will be removed from the organization.",
      toasts: {
        failedUpdateMemberRole: "Failed to update member role",
        memberRoleUpdated: "Member role updated",
        cannotRemoveSelf:
          "You can't remove yourself. Use Leave Organization in settings.",
        failedRemoveMember: "Failed to remove member",
        memberRemoved: "Member removed",
        failedRevokeInvitation: "Failed to revoke invitation",
        invitationRevoked: "Invitation revoked",
      },
    },
    toasts: {
      organizationNameMinLength:
        "Organization name must be at least 2 characters",
      invalidOrganizationName: "Enter a valid organization name",
      failedUpdateOrganization: "Failed to update organization",
      organizationUpdated: "Organization updated",
      userNameMinLength: "Name must be at least 2 characters",
      failedUpdateProfile: "Failed to update profile",
      profileUpdated: "Profile updated",
      selectImageFile: "Please select an image file",
      imageTooLarge: "Image must be 10MB or smaller",
      failedProcessImage: "Failed to process image",
      failedSwitchOrganization: "Failed to switch organization",
      organizationSwitched: "Organization switched",
      failedCreateOrganization: "Failed to create organization",
      createdButSwitchFailed: "Organization created, but switching failed",
      organizationCreated: "Organization created",
      noActiveOrganization: "No active organization selected",
      ownersCannotLeave:
        "Owners can't leave. Delete the organization instead.",
      failedLeaveOrganization: "Failed to leave organization",
      organizationLeft: "You left the organization",
      onlyOwnersCanDelete:
        "Only organization owners can delete the organization.",
      failedDeleteOrganization: "Failed to delete organization",
      organizationDeleted: "Organization deleted",
      enterEmailAddress: "Enter an email address",
      enterValidEmailAddress: "Enter a valid email address",
      failedSendInvitation: "Failed to send invitation",
      invitationSentTo: "Invitation sent to {email}",
      languageUpdated: "Language updated",
      languageSaveFailed: "Failed to save language preference",
    },
  },
  emails: {
    otp: {
      titleSignIn: "Sign in code",
      titleEmailVerification: "Email verification code",
      titleForgetPassword: "Password reset code",
      preview: "{title} for {appName}",
      useCodeToContinue: "Use this code to continue:",
      expiresInFiveMinutes: "This code expires in 5 minutes.",
      subject: "{appName} verification code",
    },
    invitation: {
      preview: "Join {organizationName} on the workspace",
      heading: "Organization invitation",
      body:
        "{inviterName} invited you to join {organizationName} as {role}.",
      acceptCta: "Accept invitation",
      fallbackHint: "If the button does not work, copy this URL:",
      subject: "Invitation to join {organizationName}",
    },
  },
  errors: {
    genericUnexpected: "Something went wrong. Please try again.",
    provider: {
      USER_NOT_FOUND: "User not found",
      FAILED_TO_CREATE_USER: "Failed to create user",
      FAILED_TO_CREATE_SESSION: "Failed to create session",
      FAILED_TO_UPDATE_USER: "Failed to update user",
      FAILED_TO_GET_SESSION: "Failed to get session",
      INVALID_PASSWORD: "Invalid password",
      INVALID_EMAIL: "Invalid email",
      INVALID_EMAIL_OR_PASSWORD: "Invalid email or password",
      SOCIAL_ACCOUNT_ALREADY_LINKED: "Social account already linked",
      PROVIDER_NOT_FOUND: "Provider not found",
      INVALID_TOKEN: "Invalid token",
      ID_TOKEN_NOT_SUPPORTED: "ID token not supported",
      FAILED_TO_GET_USER_INFO: "Failed to get user info",
      USER_EMAIL_NOT_FOUND: "User email not found",
      EMAIL_NOT_VERIFIED: "Email not verified",
      PASSWORD_TOO_SHORT: "Password too short",
      PASSWORD_TOO_LONG: "Password too long",
      USER_ALREADY_EXISTS: "User already exists",
      USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
        "User already exists. Use another email.",
      EMAIL_CAN_NOT_BE_UPDATED: "Email cannot be updated",
      CREDENTIAL_ACCOUNT_NOT_FOUND: "Credential account not found",
      SESSION_EXPIRED: "Session expired. Re-authenticate to perform this action.",
      FAILED_TO_UNLINK_LAST_ACCOUNT: "You can't unlink your last account",
      ACCOUNT_NOT_FOUND: "Account not found",
      USER_ALREADY_HAS_PASSWORD:
        "User already has a password. Provide that to delete the account.",
      INVALID_OTP: "Invalid OTP",
      OTP_EXPIRED: "OTP expired",
      TOO_MANY_ATTEMPTS: "Too many attempts",
      YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION:
        "You are not allowed to create a new organization",
      YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS:
        "You have reached the maximum number of organizations",
      ORGANIZATION_ALREADY_EXISTS: "Organization already exists",
      ORGANIZATION_SLUG_ALREADY_TAKEN: "Organization slug already taken",
      ORGANIZATION_NOT_FOUND: "Organization not found",
      USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION:
        "User is not a member of the organization",
      YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION:
        "You are not allowed to update this organization",
      YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_ORGANIZATION:
        "You are not allowed to delete this organization",
      NO_ACTIVE_ORGANIZATION: "No active organization",
      USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION:
        "User is already a member of this organization",
      MEMBER_NOT_FOUND: "Member not found",
      ROLE_NOT_FOUND: "Role not found",
      YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_TEAM:
        "You are not allowed to create a new team",
      TEAM_ALREADY_EXISTS: "Team already exists",
      TEAM_NOT_FOUND: "Team not found",
      YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER:
        "You cannot leave the organization as the only owner",
      YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER:
        "You cannot leave the organization without an owner",
      YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER:
        "You are not allowed to delete this member",
      YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION:
        "You are not allowed to invite users to this organization",
      USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION:
        "User is already invited to this organization",
      INVITATION_NOT_FOUND: "Invitation not found",
      YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION:
        "You are not the recipient of the invitation",
      EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION:
        "Email verification required before accepting or rejecting invitation",
      YOU_ARE_NOT_ALLOWED_TO_CANCEL_THIS_INVITATION:
        "You are not allowed to cancel this invitation",
      INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION:
        "Inviter is no longer a member of the organization",
      YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE:
        "You are not allowed to invite a user with this role",
      FAILED_TO_RETRIEVE_INVITATION: "Failed to retrieve invitation",
      YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_TEAMS:
        "You have reached the maximum number of teams",
      UNABLE_TO_REMOVE_LAST_TEAM: "Unable to remove last team",
      YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER:
        "You are not allowed to update this member",
      ORGANIZATION_MEMBERSHIP_LIMIT_REACHED:
        "Organization membership limit reached",
      YOU_ARE_NOT_ALLOWED_TO_CREATE_TEAMS_IN_THIS_ORGANIZATION:
        "You are not allowed to create teams in this organization",
      YOU_ARE_NOT_ALLOWED_TO_DELETE_TEAMS_IN_THIS_ORGANIZATION:
        "You are not allowed to delete teams in this organization",
      YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_TEAM:
        "You are not allowed to update this team",
      YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_TEAM:
        "You are not allowed to delete this team",
      INVITATION_LIMIT_REACHED: "Invitation limit reached",
      TEAM_MEMBER_LIMIT_REACHED: "Team member limit reached",
      USER_IS_NOT_A_MEMBER_OF_THE_TEAM: "User is not a member of the team",
      YOU_CAN_NOT_ACCESS_THE_MEMBERS_OF_THIS_TEAM:
        "You are not allowed to list the members of this team",
      YOU_DO_NOT_HAVE_AN_ACTIVE_TEAM: "You do not have an active team",
      YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_TEAM_MEMBER:
        "You are not allowed to create a new member",
      YOU_ARE_NOT_ALLOWED_TO_REMOVE_A_TEAM_MEMBER:
        "You are not allowed to remove a team member",
      YOU_ARE_NOT_ALLOWED_TO_ACCESS_THIS_ORGANIZATION:
        "You are not allowed to access this organization as an owner",
      YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION:
        "You are not a member of this organization",
      MISSING_AC_INSTANCE:
        "Dynamic Access Control requires a pre-defined access control instance",
      YOU_MUST_BE_IN_AN_ORGANIZATION_TO_CREATE_A_ROLE:
        "You must be in an organization to create a role",
      YOU_ARE_NOT_ALLOWED_TO_CREATE_A_ROLE:
        "You are not allowed to create a role",
      YOU_ARE_NOT_ALLOWED_TO_UPDATE_A_ROLE:
        "You are not allowed to update a role",
      YOU_ARE_NOT_ALLOWED_TO_DELETE_A_ROLE:
        "You are not allowed to delete a role",
      YOU_ARE_NOT_ALLOWED_TO_READ_A_ROLE:
        "You are not allowed to read a role",
      YOU_ARE_NOT_ALLOWED_TO_LIST_A_ROLE:
        "You are not allowed to list a role",
      YOU_ARE_NOT_ALLOWED_TO_GET_A_ROLE:
        "You are not allowed to get a role",
      TOO_MANY_ROLES: "This organization has too many roles",
      INVALID_RESOURCE:
        "The provided permission includes an invalid resource",
      ROLE_NAME_IS_ALREADY_TAKEN: "That role name is already taken",
      CANNOT_DELETE_A_PRE_DEFINED_ROLE: "Cannot delete a pre-defined role",
    },
  },
} as const;
