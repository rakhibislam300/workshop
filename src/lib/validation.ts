import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const taskInput = z.object({ title: z.string().trim().min(1).max(160), description: z.string().trim().max(2000).nullable().optional(), due_date: date.nullable().optional(), priority: z.enum(["low", "medium", "high"]), assigned_member_id: z.string().uuid().nullable().optional() });
export const billInput = z.object({ title: z.string().trim().min(1).max(160), amount: z.coerce.number().min(0).max(9999999999.99), category: z.string().trim().min(1).max(60), due_date: date, is_paid: z.boolean().default(false) });
export const appointmentInput = z.object({ title: z.string().trim().min(1).max(160), appointment_at: z.string().datetime({ offset: true }), location: z.string().trim().max(300).nullable().optional(), assigned_member_id: z.string().uuid().nullable().optional() });
export const profileInput = z.object({ display_name: z.string().trim().min(1, "Enter the name you want your household to use.").max(80) });
export const familyMemberInput = z.object({ name: z.string().trim().min(1, "Enter a household member name.").max(80), relationship: z.string().trim().max(80).nullable().optional() });
export const familyCreateInput = z.object({ name: z.string().trim().min(1, "Enter a family name.").max(120) });
export const familyInvitationInput = z.object({ email: z.string().trim().email("Enter a valid email address.").max(320) });
export const invitationTokenInput = z.object({ token: z.string().uuid("This invitation link is invalid.") });
export const collaboratorRoleInput = z.object({ role: z.enum(["owner", "admin", "member"]) });
export const smartAddResponse = z.object({ kind: z.enum(["task", "bill", "appointment"]).nullable(), proposal: z.record(z.string(), z.unknown()).nullable(), needs_clarification: z.boolean(), questions: z.array(z.string()).max(3) });

export const familyAssistantInput = z.object({
  family_id: z.string().uuid(),
  message: z.string().trim().min(1, "Enter a question or request.").max(1200),
});

const timezone = z.string().trim().min(1).max(64);
export const reminderScheduleInput = z.object({
  family_id: z.string().uuid(),
  entity_type: z.enum(["task", "bill", "appointment"]),
  entity_id: z.string().uuid(),
  scheduled_for: z.string().datetime({ offset: true }),
  timezone,
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]),
});
export const notificationPreferenceInput = z.object({
  family_id: z.string().uuid(),
  timezone,
  in_app_enabled: z.boolean(),
  email_enabled: z.boolean(),
});

export const documentCategory = z.enum(["identity", "medical", "finance", "home", "education", "other"]);
export const documentVisibility = z.enum(["private", "family"]);
export const documentUploadInput = z.object({
  family_id: z.string().uuid(),
  title: z.string().trim().min(1, "Enter a document title.").max(160),
  category: documentCategory,
  visibility: documentVisibility,
});
export const documentListInput = z.object({
  family_id: z.string().uuid(),
  query: z.string().trim().max(100).optional(),
  category: documentCategory.optional(),
});

const assistantFields = z.object({
  title: z.string().trim().max(160).nullable(),
  description: z.string().trim().max(2000).nullable(),
  due_date: date.nullable(),
  priority: z.enum(["low", "medium", "high"]).nullable(),
  assigned_member_id: z.string().uuid().nullable(),
  amount: z.number().min(0).max(9999999999.99).nullable(),
  category: z.string().trim().max(60).nullable(),
  is_paid: z.boolean().nullable(),
  appointment_at: z.string().datetime({ offset: true }).nullable(),
  location: z.string().trim().max(300).nullable(),
}).strict();

export const familyAssistantProposal = z.object({
  operation: z.enum(["create", "update"]),
  entity: z.enum(["task", "bill", "appointment"]),
  record_id: z.string().uuid().nullable(),
  fields: assistantFields,
}).superRefine((proposal, context) => {
  if (proposal.operation === "update" && !proposal.record_id) context.addIssue({ code: z.ZodIssueCode.custom, message: "An update needs the existing record ID." });
  if (proposal.operation === "create" && proposal.record_id) context.addIssue({ code: z.ZodIssueCode.custom, message: "A new record cannot include an existing record ID." });
});

export type FamilyAssistantProposal = z.infer<typeof familyAssistantProposal>;

export function familyAssistantProposalToInput(proposal: FamilyAssistantProposal) {
  const { fields } = proposal;
  if (proposal.entity === "task") return taskInput.safeParse({
    title: fields.title ?? "", description: fields.description, due_date: fields.due_date,
    priority: fields.priority ?? "medium", assigned_member_id: fields.assigned_member_id,
  });
  if (proposal.entity === "bill") return billInput.safeParse({
    title: fields.title ?? "", amount: fields.amount, category: fields.category ?? "", due_date: fields.due_date ?? "", is_paid: fields.is_paid ?? false,
  });
  return appointmentInput.safeParse({
    title: fields.title ?? "", appointment_at: fields.appointment_at ?? "", location: fields.location, assigned_member_id: fields.assigned_member_id,
  });
}
