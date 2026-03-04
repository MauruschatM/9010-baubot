import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

type OrganizationInvitationEmailProps = {
  inviteUrl: string;
  inviterName: string;
  organizationName: string;
  role: string;
};

export function OrganizationInvitationEmail({
  inviteUrl,
  inviterName,
  organizationName,
  role,
}: OrganizationInvitationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        Join {organizationName} on the workspace
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>Organization invitation</Heading>
          <Text style={text}>
            {inviterName} invited you to join <strong>{organizationName}</strong> as {" "}
            <strong>{role}</strong>.
          </Text>
          <Section style={buttonContainer}>
            <Button href={inviteUrl} style={button}>
              Accept invitation
            </Button>
          </Section>
          <Text style={muted}>If the button does not work, copy this URL:</Text>
          <Text style={urlText}>{inviteUrl}</Text>
        </Container>
      </Body>
    </Html>
  );
}

const body = {
  backgroundColor: "#f8fafc",
  fontFamily:
    "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  padding: "24px",
};

const container = {
  backgroundColor: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: "12px",
  margin: "0 auto",
  maxWidth: "480px",
  padding: "24px",
};

const heading = {
  color: "#0f172a",
  fontSize: "20px",
  margin: "0 0 12px",
};

const text = {
  color: "#334155",
  fontSize: "14px",
  lineHeight: "1.5",
  margin: "0 0 16px",
};

const buttonContainer = {
  margin: "0 0 16px",
};

const button = {
  backgroundColor: "#0f172a",
  borderRadius: "8px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "14px",
  padding: "10px 16px",
  textDecoration: "none",
};

const muted = {
  color: "#64748b",
  fontSize: "12px",
  margin: "0 0 6px",
};

const urlText = {
  color: "#0f172a",
  fontSize: "12px",
  margin: "0",
  wordBreak: "break-all" as const,
};
