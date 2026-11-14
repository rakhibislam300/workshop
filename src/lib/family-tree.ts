import { z } from "zod";

const uuid = z.string().uuid();
const year = z.number().int().min(1000).max(2200).nullable();
export const personInput = z.object({
  name: z.string().trim().min(1).max(120), birth_year: year, death_year: year,
  biography: z.string().trim().max(2000), birthplace: z.string().trim().max(160),
}).refine(p => !p.birth_year || !p.death_year || p.death_year >= p.birth_year, { message: "Death year cannot precede birth year." });
export const edgeKinds = {
  parent: "Parent of", father: "Father of", mother: "Mother of", adoptive_parent: "Adoptive parent of", step_parent: "Step-parent of", guardian: "Guardian of",
  child: "Child of", son: "Son of", daughter: "Daughter of",
  sibling: "Sibling of", brother: "Brother of", sister: "Sister of",
  partner: "Partner of", spouse: "Spouse of", husband: "Husband of", wife: "Wife of",
  grandparent: "Grandparent of", grandfather: "Grandfather of", grandmother: "Grandmother of", grandchild: "Grandchild of", grandson: "Grandson of", granddaughter: "Granddaughter of",
  aunt_uncle: "Aunt / uncle of", aunt: "Aunt of", uncle: "Uncle of", niece_nephew: "Niece / nephew of", niece: "Niece of", nephew: "Nephew of",
  cousin: "Cousin of", in_law: "In-law of", other_relative: "Relative of",
} as const;
export const parentalKinds = ["parent", "father", "mother", "adoptive_parent", "step_parent", "guardian"] as const;
export const childKinds = ["child", "son", "daughter"] as const;
export const partnerKinds = ["partner", "spouse", "husband", "wife"] as const;
export function relationshipEnds(edge: TreeEdge) {
  if ((parentalKinds as readonly string[]).includes(edge.kind)) return { parent: edge.from_person, child: edge.to_person };
  if ((childKinds as readonly string[]).includes(edge.kind)) return { parent: edge.to_person, child: edge.from_person };
  return null;
}
export function isPartnerEdge(edge: TreeEdge) { return (partnerKinds as readonly string[]).includes(edge.kind); }
export const treeCommand = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_person"), family_id: uuid, person: personInput,
    related_to: uuid.nullable().optional(), relationship: z.enum(Object.keys(edgeKinds) as [keyof typeof edgeKinds, ...Array<keyof typeof edgeKinds>]).nullable().optional(),
    co_parent: uuid.nullable().optional(), account_email: z.string().trim().email().max(320).nullable().optional(),
  }).refine(v => Boolean(v.related_to) === Boolean(v.relationship), { message: "Choose both the relationship and the related person." })
    .refine(v => !v.co_parent || (v.co_parent !== v.related_to), { message: "Choose a different second parent." })
    .refine(v => !v.co_parent || (v.relationship ? [...parentalKinds, ...childKinds].includes(v.relationship as never) : false), { message: "A second parent can only be used with a parent or child relationship." }),
  z.object({ action: z.literal("save_person"), family_id: uuid, id: uuid.optional(), person: personInput }),
  z.object({ action: z.literal("delete_person"), family_id: uuid, id: uuid }),
  z.object({ action: z.literal("add_edge"), family_id: uuid, from_person: uuid, to_person: uuid, co_parent: uuid.nullable().optional(), kind: z.enum(Object.keys(edgeKinds) as [keyof typeof edgeKinds, ...Array<keyof typeof edgeKinds>]) })
    .refine(e => e.from_person !== e.to_person, { message: "Choose two different people." })
    .refine(e => !e.co_parent || (e.co_parent !== e.from_person && e.co_parent !== e.to_person), { message: "Choose a different second parent." })
    .refine(e => !e.co_parent || [...parentalKinds, ...childKinds].includes(e.kind as never), { message: "A second parent can only be used with a parent or child relationship." }),
  z.object({ action: z.literal("delete_edge"), family_id: uuid, id: uuid }),
]);
export const relationLabels = {
  parent: "Parent", father: "Father", mother: "Mother", child: "Child", son: "Son", daughter: "Daughter",
  sibling: "Sibling", brother: "Brother", sister: "Sister", partner: "Partner", spouse: "Spouse", husband: "Husband", wife: "Wife",
  cousin: "Cousin", grandparent: "Grandparent", grandfather: "Grandfather", grandmother: "Grandmother", grandchild: "Grandchild", grandson: "Grandson", granddaughter: "Granddaughter",
  aunt_uncle: "Aunt / uncle", aunt: "Aunt", uncle: "Uncle", niece_nephew: "Niece / nephew", niece: "Niece", nephew: "Nephew", in_law: "In-law", other_relative: "Relative",
} as const;
export type Relation = keyof typeof relationLabels;
export const inverseRelation: Record<Relation, Relation> = {
  parent: "child", father: "child", mother: "child", child: "parent", son: "parent", daughter: "parent",
  sibling: "sibling", brother: "sibling", sister: "sibling", partner: "partner", spouse: "spouse", husband: "wife", wife: "husband", cousin: "cousin",
  grandparent: "grandchild", grandfather: "grandchild", grandmother: "grandchild", grandchild: "grandparent", grandson: "grandparent", granddaughter: "grandparent",
  aunt_uncle: "niece_nephew", aunt: "niece_nephew", uncle: "niece_nephew", niece_nephew: "aunt_uncle", niece: "aunt_uncle", nephew: "aunt_uncle", in_law: "in_law", other_relative: "other_relative",
};
export const connectionCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("invite"), email: z.string().trim().email().max(320), name: z.string().trim().min(1).max(120), relationship: z.enum(Object.keys(relationLabels) as [Relation, ...Relation[]]), consent: z.literal(true) }),
  z.object({ action: z.literal("accept"), id: uuid, name: z.string().trim().min(1).max(120), consent: z.literal(true) }),
  z.object({ action: z.enum(["decline", "cancel", "disconnect", "block"]), id: uuid }),
]);
export type TreePerson = z.infer<typeof personInput> & { id: string; family_id: string; updated_at: string };
export type TreeEdge = { id: string; from_person: string; to_person: string; kind: keyof typeof edgeKinds };
export type RelativeConnection = { id: string; sender_id: string; recipient_id: string | null; recipient_email: string; sender_name: string; recipient_name: string | null; relationship: Relation; status: string; expires_at: string };

// Direct parent/child labels determine generations. Other labels stay visible as relationships without inventing ancestry.
export function treeLayout(people: TreePerson[], edges: TreeEdge[]) {
  const levels = new Map<string, number>();
  const parents = new Map<string, string[]>();
  for (const e of edges) { const ends = relationshipEnds(e); if (ends) parents.set(ends.child, [...(parents.get(ends.child) ?? []), ends.parent]); }
  function level(id: string, seen = new Set<string>()): number {
    if (levels.has(id)) return levels.get(id)!;
    if (seen.has(id)) return 0;
    const next = new Set(seen).add(id);
    const value = Math.max(0, ...(parents.get(id) ?? []).map(p => level(p, next) + 1));
    levels.set(id, value); return value;
  }
  people.forEach(p => level(p.id));
  const rows: TreePerson[][] = [];
  for (const p of people) (rows[levels.get(p.id)!] ??= []).push(p);
  const columns = Math.max(1, ...rows.map(r => r.length));
  const width = Math.max(620, columns * 210 + 40);
  const positions = new Map<string, { x: number; y: number }>();
  rows.forEach((row, rowIndex) => row.forEach((p, i) => positions.set(p.id, { x: (width - row.length * 210) / 2 + i * 210, y: 48 + rowIndex * 220 })));
  return { rows, positions, width, height: Math.max(270, rows.length * 220 + 40) };
}
