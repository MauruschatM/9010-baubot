import { afterEach, describe, expect, test } from "bun:test";

import {
  batchSearchText,
  buildProjectSearchDocument,
  buildRoutingContextText,
  findProjectsByLocation,
  resolveProjectLocationInputChoice,
  resolveProjectChoiceFromSignals,
} from "../convex/whatsappProcessing";

const originalFetch = globalThis.fetch;
const originalVoyageApiKey = process.env.VOYAGE_API_KEY;

function mockVoyageEmbeddings(
  resolver: (input: string, inputType: "query" | "document") => number[],
) {
  process.env.VOYAGE_API_KEY = "test-voyage-key";
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body ?? "{}")) as {
      input?: string[];
      input_type?: "query" | "document";
    };
    const inputs = Array.isArray(payload.input) ? payload.input : [];
    const inputType = payload.input_type === "query" ? "query" : "document";

    return new Response(
      JSON.stringify({
        data: inputs.map((input, index) => ({
          index,
          embedding: resolver(input, inputType),
        })),
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalVoyageApiKey === undefined) {
    delete process.env.VOYAGE_API_KEY;
  } else {
    process.env.VOYAGE_API_KEY = originalVoyageApiKey;
  }
});

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
      customerHits: [],
    });

    expect(result).toEqual({
      kind: "choose",
      options: [project],
      reason: "low_confidence_ai_result",
      suggestedProjectLocation: "Nikias Wohnung",
      routingContext: "Relevant workspace matches",
    });
  });

  test("routing selects a dominant semantic project hit when the AI label is not exact", () => {
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
          similarity: 0.92,
        },
      ] as any,
      customerHits: [],
      routingDecision: {
        decision: "project",
        confidence: 0.9,
        projectLocation: "Niklas Wohnung",
        reason: "ai_project_guess",
      },
      suggestedProjectLocation: "Niklas Wohnung",
      routingContext: "Relevant workspace matches",
    });

    expect(result).toEqual({
      kind: "selected",
      project,
      reason: "semantic_project_match",
      confidence: 0.9,
      routingContext: "Relevant workspace matches",
    });
  });

  test("routing selects a dominant semantic customer hit and scopes projects to that customer", () => {
    const customer = {
      _id: "customer-1",
      name: "Nikias GmbH",
    } as any;
    const project = {
      _id: "project-1",
      location: "Nikias Wohnung",
      customerId: "customer-1",
    } as any;

    const result = resolveProjectChoiceFromSignals({
      projects: [project],
      customers: [customer],
      exactProjectMatches: [],
      projectHits: [
        {
          projectId: "project-1",
          projectLocation: "Nikias Wohnung",
          customerId: "customer-1",
          customerName: "Nikias GmbH",
          similarity: 0.89,
        },
      ] as any,
      customerHits: [
        {
          customerId: "customer-1",
          customerName: "Nikias GmbH",
          similarity: 0.91,
        },
      ] as any,
      routingDecision: {
        decision: "customer",
        confidence: 0.9,
        customerName: "Niklas GmbH",
        reason: "ai_customer_guess",
      },
      suggestedProjectLocation: "Nikias Wohnung",
      routingContext: "Relevant workspace matches",
    });

    expect(result).toEqual({
      kind: "selected",
      project,
      reason: "semantic_customer_match",
      confidence: 0.9,
      routingContext: "Relevant workspace matches",
    });
  });

  test("manual project location input prefers plausible same-customer semantic hits", async () => {
    mockVoyageEmbeddings((input, inputType) => {
      if (inputType === "query") {
        return [1, 0];
      }

      if (input.includes("Nikias Wohnung Hinterhaus")) {
        return [0.86, 0.14];
      }

      if (input.includes("Nikias Wohnung")) {
        return [0.99, 0.01];
      }

      return [0, 1];
    });

    const result = await resolveProjectLocationInputChoice({
      projects: [
        {
          _id: "project-1",
          location: "Nikias Wohnung",
          customerId: "customer-1",
        },
        {
          _id: "project-2",
          location: "Nikias Wohnung Hinterhaus",
          customerId: "customer-2",
        },
      ] as any,
      customers: [
        { _id: "customer-1", name: "Nikias GmbH" },
        { _id: "customer-2", name: "Andere GmbH" },
      ] as any,
      projectLocation: "Niklas Wohnung",
      customerId: "customer-2" as any,
    });

    expect(result).toEqual({
      kind: "choose",
      options: [
        {
          _id: "project-2",
          location: "Nikias Wohnung Hinterhaus",
          customerId: "customer-2",
        },
      ],
      reason: "similar_existing_location_matches",
    });
  });

  test("manual project location input creates a new project when no semantic match is available", async () => {
    delete process.env.VOYAGE_API_KEY;

    const result = await resolveProjectLocationInputChoice({
      projects: [
        {
          _id: "project-1",
          location: "Nikias Wohnung",
        },
      ] as any,
      customers: [],
      projectLocation: "Completely New Site",
    });

    expect(result).toEqual({
      kind: "create",
      reason: "created_from_whatsapp",
    });
  });
});
