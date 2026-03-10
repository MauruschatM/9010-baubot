import { ConvexError, v } from "convex/values";

import type { Doc } from "./_generated/dataModel";

const MAX_CUSTOMER_NAME_LENGTH = 120;
const MAX_CUSTOMER_CONTACT_NAME_LENGTH = 120;
const MAX_CUSTOMER_EMAIL_LENGTH = 320;
const MAX_CUSTOMER_PHONE_LENGTH = 40;

export const customerResponseFields = {
  _id: v.id("customers"),
  _creationTime: v.number(),
  organizationId: v.string(),
  createdBy: v.string(),
  name: v.string(),
  contactName: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const customerResponseValidator = v.object(customerResponseFields);

export const archivedCustomerResponseFields = {
  ...customerResponseFields,
  deletedAt: v.number(),
};

export const archivedCustomerResponseValidator = v.object(archivedCustomerResponseFields);

function normalizeOptionalField(
  value: string | undefined,
  fieldLabel: string,
  maxLength: number,
  options?: {
    lowercase?: boolean;
    pattern?: RegExp;
    invalidMessage?: string;
  },
) {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const normalized = options?.lowercase ? trimmed.toLowerCase() : trimmed;
  if (normalized.length > maxLength) {
    throw new ConvexError(`${fieldLabel} cannot exceed ${maxLength} characters`);
  }

  if (options?.pattern && !options.pattern.test(normalized)) {
    throw new ConvexError(options.invalidMessage ?? `Enter a valid ${fieldLabel.toLowerCase()}`);
  }

  return normalized;
}

export function toCustomerResponse(customer: Doc<"customers">) {
  return {
    _id: customer._id,
    _creationTime: customer._creationTime,
    organizationId: customer.organizationId,
    createdBy: customer.createdBy,
    name: customer.name,
    contactName: customer.contactName,
    email: customer.email,
    phone: customer.phone,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

export function toArchivedCustomerResponse(customer: Doc<"customers">) {
  return {
    ...toCustomerResponse(customer),
    deletedAt: customer.deletedAt ?? customer.updatedAt,
  };
}

export function normalizeCustomerName(name: string) {
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    throw new ConvexError("Customer name is required");
  }

  if (trimmed.length > MAX_CUSTOMER_NAME_LENGTH) {
    throw new ConvexError(
      `Customer name cannot exceed ${MAX_CUSTOMER_NAME_LENGTH} characters`,
    );
  }

  return trimmed;
}

export function normalizeCustomerContactName(contactName: string | undefined) {
  return normalizeOptionalField(
    contactName,
    "Customer contact name",
    MAX_CUSTOMER_CONTACT_NAME_LENGTH,
  );
}

export function normalizeCustomerEmail(email: string | undefined) {
  return normalizeOptionalField(email, "Customer email", MAX_CUSTOMER_EMAIL_LENGTH, {
    lowercase: true,
    pattern: /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i,
    invalidMessage: "Enter a valid customer email address",
  });
}

export function normalizeCustomerPhone(phone: string | undefined) {
  return normalizeOptionalField(phone, "Customer phone", MAX_CUSTOMER_PHONE_LENGTH);
}
