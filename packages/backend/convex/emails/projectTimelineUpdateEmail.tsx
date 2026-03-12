import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

type ProjectTimelineUpdateEmailProps = {
  preview: string;
  projectLocation: string;
  batchTitle: string;
  bodyText: string;
  imageAttachmentCount: number;
  videoLinks: Array<{
    label: string;
    url: string;
  }>;
};

function renderBodyText(bodyText: string) {
  const lines = bodyText.split("\n");

  return lines.map((line, index) => (
    <React.Fragment key={`${index}-${line}`}>
      {line.length > 0 ? line : "\u00a0"}
      {index < lines.length - 1 ? <br /> : null}
    </React.Fragment>
  ));
}

export function ProjectTimelineUpdateEmail({
  preview,
  projectLocation,
  batchTitle,
  bodyText,
  imageAttachmentCount,
  videoLinks,
}: ProjectTimelineUpdateEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={eyebrow}>Project documentation update</Text>
          <Heading style={heading}>{batchTitle}</Heading>
          <Text style={subheading}>{projectLocation}</Text>

          <Section style={messageSection}>
            <Text style={messageText}>{renderBodyText(bodyText)}</Text>
          </Section>

          {imageAttachmentCount > 0 ? (
            <Text style={metaText}>
              {imageAttachmentCount === 1
                ? "1 image is attached to this email."
                : `${imageAttachmentCount} images are attached to this email.`}
            </Text>
          ) : null}

          {videoLinks.length > 0 ? (
            <>
              <Hr style={divider} />
              <Section>
                <Text style={sectionTitle}>Videos</Text>
                {videoLinks.map((videoLink) => (
                  <Text key={videoLink.url} style={linkRow}>
                    <Link href={videoLink.url} style={linkStyle}>
                      {videoLink.label}
                    </Link>
                  </Text>
                ))}
              </Section>
            </>
          ) : null}
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
  maxWidth: "560px",
  padding: "24px",
};

const eyebrow = {
  color: "#64748b",
  fontSize: "12px",
  fontWeight: "600",
  letterSpacing: "0.08em",
  margin: "0 0 8px",
  textTransform: "uppercase" as const,
};

const heading = {
  color: "#0f172a",
  fontSize: "22px",
  margin: "0 0 6px",
};

const subheading = {
  color: "#475569",
  fontSize: "14px",
  margin: "0 0 18px",
};

const messageSection = {
  backgroundColor: "#f8fafc",
  borderRadius: "10px",
  padding: "16px",
};

const messageText = {
  color: "#334155",
  fontSize: "14px",
  lineHeight: "1.7",
  margin: "0",
};

const metaText = {
  color: "#475569",
  fontSize: "13px",
  margin: "16px 0 0",
};

const divider = {
  borderColor: "#e2e8f0",
  margin: "18px 0",
};

const sectionTitle = {
  color: "#0f172a",
  fontSize: "14px",
  fontWeight: "600",
  margin: "0 0 10px",
};

const linkRow = {
  color: "#334155",
  fontSize: "14px",
  margin: "0 0 8px",
};

const linkStyle = {
  color: "#0f172a",
  textDecoration: "underline",
};
