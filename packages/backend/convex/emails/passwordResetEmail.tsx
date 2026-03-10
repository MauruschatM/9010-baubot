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

type PasswordResetEmailProps = {
  resetUrl: string;
  preview: string;
  headingText: string;
  bodyText: string;
  resetCta: string;
  fallbackHint: string;
};

export function PasswordResetEmail({
  resetUrl,
  preview,
  headingText,
  bodyText,
  resetCta,
  fallbackHint,
}: PasswordResetEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>{headingText}</Heading>
          <Text style={text}>{bodyText}</Text>
          <Section style={buttonContainer}>
            <Button href={resetUrl} style={button}>
              {resetCta}
            </Button>
          </Section>
          <Text style={muted}>{fallbackHint}</Text>
          <Text style={urlText}>{resetUrl}</Text>
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
