import { describe, expect, test } from "bun:test";

import {
  batchSearchText,
  buildProjectSearchDocument,
  buildRoutingContextText,
} from "../convex/whatsappProcessing";

describe("whatsapp routing helpers", () => {
  test("project search document includes project name, location, and customer name", () => {
    const customer = {
      _id: "customer-1",
      name: "Musterkunde GmbH",
      contactName: "Max Muster",
    } as any;
    const customerById = new Map([[String(customer._id), customer]]);
    const project = {
      customerId: "customer-1",
      name: "Dachsanierung Haus 4",
      location: "Hauptstrasse 12",
      description: "Geruest und Abdichtung",
    } as any;

    const document = buildProjectSearchDocument(project, customerById);

    expect(document).toContain("Dachsanierung Haus 4");
    expect(document).toContain("Hauptstrasse 12");
    expect(document).toContain("Musterkunde GmbH");
  });

  test("routing context surfaces project location and customer for high-similarity hits", () => {
    const context = buildRoutingContextText({
      projectHits: [
        {
          projectId: "project-1",
          projectName: "Dachsanierung Haus 4",
          projectLocation: "Hauptstrasse 12",
          customerName: "Musterkunde GmbH",
          similarity: 0.92,
        },
      ] as any,
      customerHits: [],
    });

    expect(context).toContain("Dachsanierung Haus 4");
    expect(context).toContain("location Hauptstrasse 12");
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
});
