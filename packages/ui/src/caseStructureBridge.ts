import type { HttpInterfaceStructure } from "./interfaceStructure";

const pendingCaseStructures = new Map<string, HttpInterfaceStructure>();

export function stashCaseInterfaceStructure(caseId: string, structure: HttpInterfaceStructure) {
  pendingCaseStructures.set(caseId, structure);
}

export function consumeCaseInterfaceStructure(caseId: string): HttpInterfaceStructure | null {
  const structure = pendingCaseStructures.get(caseId) ?? null;
  pendingCaseStructures.delete(caseId);
  return structure;
}
