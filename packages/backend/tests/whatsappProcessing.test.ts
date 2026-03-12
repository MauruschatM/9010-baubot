import { describe, expect, test } from "bun:test";

import {
  batchSearchText,
  buildProjectSearchDocument,
  buildRoutingContextText,
  findProjectsByLocation,
  resolveProjectChoiceFromSignals,
} from "../convex/whatsappProcessing";

describe("whatsapp routing helpers", () => {
  test("project search document includes project location and customer name", () => {
    const customer = {
      _id: "customer-1",
      name: "Musterkunde GmbH",
      contactName: "Max Muster",
    } as any;
    const customerById = new Map([[String(customer._id), customer]]);
    const project = {
      customerId: "customer-1",
      location: "Dachsanierung Haus 4",
      description: "Geruest und Abdichtung",
    } as any;

    const document = buildProjectSearchDocument(project, customerById);

    expect(document).toContain("Dachsanierung Haus 4");
    expect(document).toContain("Musterkunde GmbH");
  });

  test("routing context surfaces canonical project location and customer for high-similarity hits", () => {
    const context = buildRoutingContextText({
      projectHits: [
        {
          projectId: "project-1",
          projectLocation: "Dachsanierung Haus 4",
          customerName: "Musterkunde GmbH",
          similarity: 0.92,
        },
      ] as any,
      customerHits: [],
    });

    expect(context).toContain("Dachsanierung Haus 4");
    expect(context).toContain("customer Musterkunde GmbH");
  });

  test("batch search text uses message text and transcriptions", () => {
    const searchText = batchSearchText([
      {
        text: "Baustelle Hauptstrasse",
        media: [
          {
            transcription: "Musterkunde bittet um Rueckruf",
            extractedText: "OCR sollte ignoriert werden",
          },
        ],
      },
    ] as any);

    expect(searchText).toContain("baustelle hauptstrasse");
    expect(searchText).toContain("musterkunde bittet um rueckruf");
    expect(searchText).not.toContain("ocr sollte ignoriert werden");
  });

  test("project location matching ignores punctuation and accents", () => {
    const projects = [
      {
        _id: "project-1",
        location: "Bornstedter Straße 12.",
      },
    ] as any;

    expect(findProjectsByLocation(projects, "bornstedter strasse 12")).toHaveLength(1);
  });

  test("routing falls back to a choice when one plausible project hit exists", () => {
    const project = {
      _id: "project-1",
      location: "Nikias Wohnung",
    } as any;

    const result = resolveProjectChoiceFromSignals({
      projects: [project],
      customers: [],
      exactProjectMatches: [],
      projectHits: [
        {
          projectId: "project-1",
          projectLocation: "Nikias Wohnung",
          similarity: 0.81,
        },
      ] as any,
      routingDecision: {
        decision: "none",
        confidence: 0.2,
        reason: "low_confidence_ai_result",
      },
      suggestedProjectLocation: "Nikias Wohnung",
      routingContext: "Relevant workspace matches",
    });

    expect(result).toEqual({
      kind: "choose",
      options: [project],
      reason: "low_confidence_ai_result",
      suggestedProjectLocation: "Nikias Wohnung",
      routingContext: "Relevant workspace matches",
    });
  });
});
