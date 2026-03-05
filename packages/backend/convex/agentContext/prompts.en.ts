import type { ClarificationPromptPack } from "./types";

export const clarificationPromptsEn: ClarificationPromptPack = {
  generic: {
    title: "Need a bit more context",
    description:
      "I can continue once you confirm the exact operation and target.",
    assistantMessage:
      "I can do that, but I need a few details first so I can act safely.",
    questions: [
      {
        id: "operation",
        prompt: "What should I do exactly?",
        options: [
          {
            id: "read",
            label: "Read only (Recommended)",
            description: "Fetch and summarize data without changing anything.",
          },
          {
            id: "update",
            label: "Update data",
            description: "Modify existing company data.",
          },
          {
            id: "create_or_remove",
            label: "Create or remove",
            description: "Invite, remove, or otherwise change membership state.",
          },
        ],
        allowOther: true,
        required: true,
      },
    ],
  },
  invite_member: {
    title: "Missing invitation details",
    description: "Please confirm who should be invited and with which role.",
    assistantMessage:
      "I can invite members right away once you provide the missing details.",
    questions: [
      {
        id: "invitee",
        prompt: "Who should be invited?",
        options: [
          {
            id: "single_email",
            label: "Single email (Recommended)",
            description: "Provide one email address.",
          },
          {
            id: "multiple_emails",
            label: "Multiple emails",
            description: "Provide a comma-separated list of email addresses.",
          },
          {
            id: "reuse_pending",
            label: "Use existing invite",
            description: "Reference an existing pending invitation.",
          },
        ],
        allowOther: true,
        required: true,
      },
      {
        id: "role",
        prompt: "Which role should the invited member get?",
        options: [
          {
            id: "member",
            label: "Member (Recommended)",
            description: "Standard access without admin controls.",
          },
          {
            id: "admin",
            label: "Admin",
            description: "Can manage members and organization settings.",
          },
          {
            id: "owner",
            label: "Owner",
            description: "Highest level of access.",
          },
        ],
        allowOther: true,
        required: true,
      },
    ],
  },
  remove_member: {
    title: "Missing member target",
    description: "Please confirm which member should be removed.",
    assistantMessage:
      "I can remove the member once you specify the exact person.",
    questions: [
      {
        id: "member_target",
        prompt: "Which member should be removed?",
        options: [
          {
            id: "by_email",
            label: "By email (Recommended)",
            description: "Provide the member email address.",
          },
          {
            id: "by_member_id",
            label: "By member ID",
            description: "Provide the internal member ID.",
          },
          {
            id: "latest_added",
            label: "Most recently added",
            description: "Remove the latest added member.",
          },
        ],
        allowOther: true,
        required: true,
      },
    ],
  },
  update_member_role: {
    title: "Missing role change details",
    description: "Please confirm the member and target role.",
    assistantMessage:
      "I can update the role once you confirm the missing details.",
    questions: [
      {
        id: "member_target",
        prompt: "Whose role should be changed?",
        options: [
          {
            id: "by_email",
            label: "By email (Recommended)",
            description: "Provide the member email address.",
          },
          {
            id: "by_member_id",
            label: "By member ID",
            description: "Provide the internal member ID.",
          },
          {
            id: "current_user",
            label: "My own role",
            description: "Change your own role if permitted.",
          },
        ],
        allowOther: true,
        required: true,
      },
      {
        id: "role",
        prompt: "What should the new role be?",
        options: [
          {
            id: "member",
            label: "Member (Recommended)",
            description: "Standard access without admin controls.",
          },
          {
            id: "admin",
            label: "Admin",
            description: "Can manage members and organization settings.",
          },
          {
            id: "owner",
            label: "Owner",
            description: "Highest level of access.",
          },
        ],
        allowOther: true,
        required: true,
      },
    ],
  },
  cancel_invitation: {
    title: "Missing invitation reference",
    description: "Please confirm which invitation should be canceled.",
    assistantMessage:
      "I can cancel the invitation once you specify the invitation target.",
    questions: [
      {
        id: "invitation_target",
        prompt: "Which invitation should be canceled?",
        options: [
          {
            id: "by_email",
            label: "By email (Recommended)",
            description: "Use the invited email address.",
          },
          {
            id: "by_invitation_id",
            label: "By invitation ID",
            description: "Provide the invitation ID.",
          },
          {
            id: "all_pending",
            label: "All pending",
            description: "Cancel all currently pending invitations.",
          },
        ],
        allowOther: true,
        required: true,
      },
    ],
  },
  update_organization: {
    title: "Missing organization update details",
    description: "Please confirm which fields should be changed.",
    assistantMessage:
      "I can update company data once you confirm the target fields and values.",
    questions: [
      {
        id: "field",
        prompt: "Which field should be updated?",
        options: [
          {
            id: "name",
            label: "Name (Recommended)",
            description: "Update the organization display name.",
          },
          {
            id: "slug",
            label: "Slug",
            description: "Update the URL slug.",
          },
          {
            id: "logo",
            label: "Logo",
            description: "Update the organization logo URL.",
          },
        ],
        allowOther: true,
        required: true,
      },
      {
        id: "new_value",
        prompt: "What should the new value be?",
        options: [
          {
            id: "provide_now",
            label: "I will provide it now (Recommended)",
            description: "Paste the exact value in the other field.",
          },
          {
            id: "derive_from_brand",
            label: "Derive from brand",
            description: "Use existing brand/company naming conventions.",
          },
          {
            id: "keep_current",
            label: "Keep current",
            description: "Do not change this field.",
          },
        ],
        allowOther: true,
        required: true,
      },
    ],
  },
};
