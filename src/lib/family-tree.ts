import { z } from "zod";

const uuid = z.string().uuid();
const year = z.number().int().min(1000).max(2200).nullable();
export const personInput = z.object({
  name: z.string().trim().min(1).max(120), birth_year: year, death_year: year,
  biography: z.string().trim().max(2000), birthplace: z.string().trim().max(160),
}).refine(p => !p.birth_year || !p.death_year || p.death_year >= p.birth_year, { message: "Death year cannot precede birth year." });
export const edgeKinds = { parent: "Parent of", adoptive_parent: "Adoptive parent of", step_parent: "Step-parent of", partner: "Partner of" } as const;
export const treeCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_person"), family_id: uuid, id: uuid.optional(), person: personInput }),
  z.object({ action: z.literal("delete_person"), family_id: uuid, id: uuid }),
  z.object({ action: z.literal("add_edge"), family_id: uuid, from_person: uuid, to_person: uuid, kind: z.enum(Object.keys(edgeKinds) as [keyof typeof edgeKinds, ...Array<keyof typeof edgeKinds>]) }).refine(e => e.from_person !== e.to_person, { message: "Choose two different people." }),
  z.object({ action: z.literal("delete_edge"), family_id: uuid, id: uuid }),
]);
export const relationLabels = { parent: "Parent", child: "Child", sibling: "Sibling", partner: "Partner", cousin: "Cousin", grandparent: "Grandparent", grandchild: "Grandchild", aunt_uncle: "Aunt / uncle", niece_nephew: "Niece / nephew", other_relative: "Relative" } as const;
export type Relation = keyof typeof relationLabels;
export const inverseRelation: Record<Relation, Relation> = { parent: "child", child: "parent", sibling: "sibling", partner: "partner", cousin: "cousin", grandparent: "grandchild", grandchild: "grandparent", aunt_uncle: "niece_nephew", niece_nephew: "aunt_uncle", other_relative: "other_relative" };
export const connectionCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("invite"), email: z.string().trim().email().max(320), name: z.string().trim().min(1).max(120), relationship: z.enum(Object.keys(relationLabels) as [Relation, ...Relation[]]), consent: z.literal(true) }),
  z.object({ action: z.literal("accept"), id: uuid, name: z.string().trim().min(1).max(120), consent: z.literal(true) }),
  z.object({ action: z.enum(["decline", "cancel", "disconnect", "block"]), id: uuid }),
]);
export type TreePerson = z.infer<typeof personInput> & { id: string; family_id: string; updated_at: string };
export type TreeEdge = { id: string; from_person: string; to_person: string; kind: keyof typeof edgeKinds };
export type RelativeConnection = { id: string; sender_id: string; recipient_id: string | null; recipient_email: string; sender_name: string; recipient_name: string | null; relationship: Relation; status: string; expires_at: string };

// Parent edges determine generations; partnerships never invent ancestry.
export function treeLayout(people: TreePerson[], edges: TreeEdge[]) {
  const levels = new Map<string, number>();
  const parents = new Map<string, string[]>();
  for (const e of edges) if (e.kind !== "partner") parents.set(e.to_person, [...(parents.get(e.to_person) ?? []), e.from_person]);
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
