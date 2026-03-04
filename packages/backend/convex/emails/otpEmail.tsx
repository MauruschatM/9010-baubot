import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

type OtpEmailProps = {
  otp: string;
  preview: string;
  title: string;
  useCodeToContinue: string;
  expiresInFiveMinutes: string;
};

export function OtpEmail({
  otp,
  preview,
  title,
  useCodeToContinue,
  expiresInFiveMinutes,
}: OtpEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={heading}>{title}</Heading>
          <Text style={text}>{useCodeToContinue}</Text>
          <Section style={otpContainer}>
            <Text style={otpText}>{otp}</Text>
          </Section>
          <Text style={muted}>{expiresInFiveMinutes}</Text>
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
  margin: "0 0 12px",
};

const otpContainer = {
  backgroundColor: "#f1f5f9",
  borderRadius: "10px",
  margin: "0 0 12px",
  padding: "12px 16px",
  textAlign: "center" as const,
};

const otpText = {
  color: "#0f172a",
  fontSize: "28px",
  fontWeight: "700",
  letterSpacing: "0.3em",
  lineHeight: "1",
  margin: "0",
};

const muted = {
  color: "#64748b",
  fontSize: "12px",
  margin: "0",
};
