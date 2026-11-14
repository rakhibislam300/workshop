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
const sameGenerationKinds = ["partner", "spouse", "husband", "wife", "sibling", "brother", "sister", "cousin"] as const;
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
export type TreePerson = z.infer<typeof personInput> & { id: string; family_id: string; updated_at: string; linked_user_id?: string | null };
export type TreeEdge = { id: string; from_person: string; to_person: string; kind: keyof typeof edgeKinds };
export type RelativeConnection = { id: string; sender_id: string; recipient_id: string | null; recipient_email: string; sender_name: string; recipient_name: string | null; relationship: Relation; status: string; expires_at: string };

const inverseTreeKind: Record<keyof typeof edgeKinds, keyof typeof edgeKinds> = {
  parent: "child", father: "child", mother: "child", adoptive_parent: "child", step_parent: "child", guardian: "child",
  child: "parent", son: "parent", daughter: "parent", sibling: "sibling", brother: "sibling", sister: "sibling",
  partner: "partner", spouse: "spouse", husband: "wife", wife: "husband", grandparent: "grandchild", grandfather: "grandchild", grandmother: "grandchild",
  grandchild: "grandparent", grandson: "grandparent", granddaughter: "grandparent", aunt_uncle: "niece_nephew", aunt: "niece_nephew", uncle: "niece_nephew",
  niece_nephew: "aunt_uncle", niece: "aunt_uncle", nephew: "aunt_uncle", cousin: "cousin", in_law: "in_law", other_relative: "other_relative",
};
function compactRelation(kind: keyof typeof edgeKinds) { return edgeKinds[kind].replace(/\s+of$/, "").toLowerCase(); }

// Finds a short declared relationship path from the signed-in person. It never
// invents lineage: labels only come from saved tree edges.
export function relationshipToViewer(viewerId: string | undefined, targetId: string, edges: TreeEdge[]) {
  if (!viewerId) return null;
  if (viewerId === targetId) return "This is your linked family profile.";
  const queue: Array<{ id: string; path: Array<keyof typeof edgeKinds> }> = [{ id: viewerId, path: [] }];
  const seen = new Set([viewerId]);
  while (queue.length) {
    const current = queue.shift()!;
    if (current.path.length >= 4) continue;
    for (const edge of edges) {
      let nextId: string | null = null; let relation: keyof typeof edgeKinds | null = null;
      if (edge.to_person === current.id) { nextId = edge.from_person; relation = edge.kind; }
      else if (edge.from_person === current.id) { nextId = edge.to_person; relation = inverseTreeKind[edge.kind]; }
      if (!nextId || !relation || seen.has(nextId)) continue;
      const path = [...current.path, relation];
      if (nextId === targetId) {
        if (path.length === 1) return `Your ${compactRelation(path[0])}.`;
        if (path.length === 2 && path[0] === "parent" && path[1] === "parent") return "Your grandparent.";
        if (path.length === 2 && path[0] === "child" && path[1] === "child") return "Your grandchild.";
        return `Your ${compactRelation(path[0])}'s ${compactRelation(path[1])}${path.length > 2 ? " (through recorded family connections)" : ""}.`;
      }
      seen.add(nextId); queue.push({ id: nextId, path });
    }
  }
  return "No declared relationship path to your linked profile yet.";
}

// Layout parent groups first, then place each child one generation lower. Partners,
// siblings, cousins, and co-parents stay on one horizontal generation line.
export function treeLayout(people: TreePerson[], edges: TreeEdge[]) {
  const index = new Map(people.map((person, position) => [person.id, position]));
  const parent = new Map(people.map(person => [person.id, person.id]));
  function root(id: string): string {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const resolved = root(current); parent.set(id, resolved); return resolved;
  }
  function join(left: string, right: string) {
    const a = root(left); const b = root(right);
    if (a !== b) parent.set(b, a);
  }
  for (const edge of edges) if ((sameGenerationKinds as readonly string[]).includes(edge.kind)) join(edge.from_person, edge.to_person);
  const directParents = new Map<string, string[]>();
  for (const edge of edges) {
    const ends = relationshipEnds(edge);
    if (ends) directParents.set(ends.child, [...(directParents.get(ends.child) ?? []), ends.parent]);
  }
  // A child with two recorded parents should always have both parents on one row,
  // even where only one parent currently has older relatives in the tree.
  for (const parents of directParents.values()) parents.slice(1).forEach(other => join(parents[0], other));

  const components = new Map<string, string[]>();
  for (const person of people) { const component = root(person.id); components.set(component, [...(components.get(component) ?? []), person.id]); }
  const parentsByComponent = new Map<string, Set<string>>();
  const childrenByComponent = new Map<string, Set<string>>();
  for (const [childId, parentIds] of directParents) {
    const child = root(childId);
    for (const parentId of parentIds) {
      const ancestor = root(parentId);
      if (ancestor === child) continue;
      parentsByComponent.set(child, new Set([...(parentsByComponent.get(child) ?? []), ancestor]));
      childrenByComponent.set(ancestor, new Set([...(childrenByComponent.get(ancestor) ?? []), child]));
    }
  }
  const levels = new Map<string, number>();
  function level(component: string, seen = new Set<string>()): number {
    if (levels.has(component)) return levels.get(component)!;
    if (seen.has(component)) return 0;
    const next = new Set(seen).add(component);
    const value = Math.max(0, ...[...(parentsByComponent.get(component) ?? [])].map(ancestor => level(ancestor, next) + 1));
    levels.set(component, value); return value;
  }
  for (const component of components.keys()) level(component);
  const componentRows: string[][] = [];
  for (const component of components.keys()) (componentRows[levels.get(component)!] ??= []).push(component);
  const baseOrder = (component: string) => Math.min(...(components.get(component) ?? []).map(id => index.get(id) ?? 0));
  componentRows.forEach(row => row.sort((a, b) => baseOrder(a) - baseOrder(b)));
  // Short barycentric passes keep parents above their children and reduce crossed connectors.
  for (let pass = 0; pass < 3; pass += 1) {
    for (let rowIndex = 1; rowIndex < componentRows.length; rowIndex += 1) {
      const previousPositions = new Map(componentRows[rowIndex - 1].map((component, position) => [component, position]));
      componentRows[rowIndex].sort((a, b) => average([...parentsByComponent.get(a) ?? []].map(parentId => previousPositions.get(parentId)).filter((value): value is number => value !== undefined), baseOrder(a)) - average([...parentsByComponent.get(b) ?? []].map(parentId => previousPositions.get(parentId)).filter((value): value is number => value !== undefined), baseOrder(b)));
    }
    for (let rowIndex = componentRows.length - 2; rowIndex >= 0; rowIndex -= 1) {
      const nextPositions = new Map(componentRows[rowIndex + 1].map((component, position) => [component, position]));
      componentRows[rowIndex].sort((a, b) => average([...childrenByComponent.get(a) ?? []].map(childId => nextPositions.get(childId)).filter((value): value is number => value !== undefined), baseOrder(a)) - average([...childrenByComponent.get(b) ?? []].map(childId => nextPositions.get(childId)).filter((value): value is number => value !== undefined), baseOrder(b)));
    }
  }
  const byId = new Map(people.map(person => [person.id, person]));
  const rows = componentRows.map(row => row.flatMap(component => (components.get(component) ?? []).sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0)).map(id => byId.get(id)!)));
  const columns = Math.max(1, ...rows.map(r => r.length));
  const width = Math.max(620, columns * 220 + 60);
  const positions = new Map<string, { x: number; y: number }>();
  rows.forEach((row, rowIndex) => row.forEach((p, i) => positions.set(p.id, { x: (width - row.length * 220) / 2 + i * 220, y: 48 + rowIndex * 220 })));
  return { rows, positions, width, height: Math.max(270, rows.length * 220 + 40) };
}

function average(values: number[], fallback: number) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback; }
