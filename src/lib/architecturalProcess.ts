export type ProcessPhaseId =
  | 'pre-design'
  | 'schematic'
  | 'planning'
  | 'contractor'
  | 'design-dev'
  | 'cd'
  | 'construction'
  | 'additional';

export type ProcessPhase = {
  id: ProcessPhaseId;
  name: string;
  shortName: string;
  color: string;
  colorSoft: string;
  milestone: string;
  summary: string;
  architect: string[];
  client: string[];
  /** Substrings used to match pa_projects.phase */
  match: string[];
};

/** M. Designs architectural process — customer progress monitor content. */
export const PROCESS_PHASES: ProcessPhase[] = [
  {
    id: 'pre-design',
    name: 'Pre-Design',
    shortName: 'Pre-Design',
    color: '#146C6B',
    colorSoft: '#D2E6E4',
    milestone: 'Research',
    summary:
      'We learn your property constraints and program — what you need, how you live, and what the site will allow.',
    architect: [
      'Review ordinances for planning and zoning issues and constraints.',
      'Conduct an in-depth programming session with you and share inspiration images for feedback.',
      'Get proposals from consultants for as-builts, survey, soils investigation, arborist, and other consultants as needed.',
    ],
    client: [
      'Provide title report and any other documents with information about the property.',
      'Provide inspiration images to convey design ideas.',
      'Provide information on space needs and budget.',
    ],
    match: ['pre-design', 'predesign'],
  },
  {
    id: 'schematic',
    name: 'Conceptual / Schematic Design',
    shortName: 'Schematic',
    color: '#3A6EA5',
    colorSoft: '#D6E4F2',
    milestone: 'Preliminary Site Plan',
    summary:
      'We translate your program into floor plans and elevations so you can react to the big design moves early.',
    architect: [
      'Prepare conceptual design sketches — graphic interpretation of the program in plans and elevations, with 2D and 3D rendering as needed.',
      'Refine the design through review cycles until the concept is ready for your approval.',
    ],
    client: [
      'Review presentations and share clear feedback on layout, flow, and character.',
      'Approve the floor plan direction and refine the estimated budget as needed.',
    ],
    match: ['schematic', 'conceptual', 'design'],
  },
  {
    id: 'planning',
    name: 'Planning Package',
    shortName: 'Planning',
    color: '#2F4F7A',
    colorSoft: '#D5DEEA',
    milestone: 'Outline Specs',
    summary:
      'We prepare the package your city or county needs for design review and planning approvals.',
    architect: [
      'Prepare Planning Package documents required by the County/Town/City, including plans, elevations, and color board.',
      'Assist with staff-level Design Review and Approval processes.',
      'Prepare application forms, models, colored renderings, and material boards, and represent you in public hearings as needed.',
    ],
    client: [
      'Be available as needed to talk with neighbors and attend staff-level meetings or public hearings if required.',
      'Pay all planning and application fees on time as required.',
    ],
    match: ['planning'],
  },
  {
    id: 'contractor',
    name: 'Contractor Selection',
    shortName: 'Contractor',
    color: '#6B4C8A',
    colorSoft: '#E6DCEC',
    milestone: 'Technical Drawings & Specs',
    summary:
      'We help you qualify and compare general contractors so you can choose a builder you trust.',
    architect: [
      'Assist you in qualifying, soliciting, and evaluating general contractors.',
      'Help select and compare bids from contractors.',
      'Coordinate value engineering with the selected contractor when scope or budget adjustments are needed.',
    ],
    client: [
      'Meet and interview potential contractors. Check references. Understand each contractor’s process.',
      'Finalize the contractor and be comfortable with their estimated budget.',
      'Decide on value-engineering changes with the contractor and approve drawing adjustments.',
    ],
    match: ['contractor', 'value engineering', 'value-engineering'],
  },
  {
    id: 'design-dev',
    name: 'Design Development',
    shortName: 'Design Dev',
    color: '#8B6B8A',
    colorSoft: '#EBE0EA',
    milestone: 'Approval of 3D Design',
    summary:
      'We lock in scale, materials, and systems — windows, doors, MEP, and other elements that drive cost and drawings.',
    architect: [
      'Prepare documents that fix scale and dimension for construction and begin coordination with the general contractor, engineers, and consultants.',
      'Work with you to finalize items required for Construction Documents.',
    ],
    client: [
      'Finalize windows, doors, mechanical, electrical, plumbing, and other design elements as needed for Construction Documents.',
      'Understand cost implications as products and finishes are finalized.',
    ],
    match: ['design development'],
  },
  {
    id: 'cd',
    name: 'Construction Documents',
    shortName: 'CDs',
    color: '#A8783A',
    colorSoft: '#E4D3B4',
    milestone: 'Building Permit',
    summary:
      'We produce the detailed drawings needed for permits and for building the project.',
    architect: [
      'Prepare detailed construction drawings required for permits and for constructing the project.',
      'Coordinate with mechanical, electrical, plumbing, and other consultants as required for the construction permit.',
    ],
    client: [
      'Pay school impact fees or any other fees as required.',
      'Sign forms for the construction permit.',
      'Review draft drawings when requested by the architect.',
      'Finalize as many interior finishes as possible to solidify budget and schedule.',
      'Approve the construction budget with the contractor.',
    ],
    match: ['construction documents', 'cd'],
  },
  {
    id: 'construction',
    name: 'Construction Support',
    shortName: 'Construction',
    color: '#C47A5A',
    colorSoft: '#F0DDD4',
    milestone: 'Final Review',
    summary:
      'We stay engaged through construction — submittals, field questions, punch list, and final review.',
    architect: [
      'Assist the contractor and you during the construction process.',
      'Review shop drawings and other submittals.',
      'Prepare and manage punch lists near project completion.',
    ],
    client: [
      'Respond to any field changes in a timely manner.',
      'Order items on time and coordinate with the contractor to protect schedule.',
      'Inform the architect of any field changes from the permitted documents.',
      'Make payments to the contractor on time.',
    ],
    match: ['construction support', 'construction admin', 'ca'],
  },
  {
    id: 'additional',
    name: 'Additional Services',
    shortName: 'Add. Services',
    color: '#9AA8B5',
    colorSoft: '#E3E7EC',
    milestone: 'Scope Additions',
    summary:
      'Work outside the core design phases — added scope, special studies, and other services as agreed. Additional Services runs in parallel with base contract phases (Planning, Contractor Selection, Design Development, CDs, and Interior).',
    architect: [
      'Define and track additional-service scope separately from the base contract phases.',
      'Coordinate deliverables and fees for approved additions with the client.',
    ],
    client: [
      'Confirm additional-service scope and fees before work proceeds.',
      'Provide information needed for studies, revisions, or other added scope.',
    ],
    match: ['additional service', 'additional services'],
  },
];

export function matchProcessPhaseIndex(phase: string | null | undefined): number {
  if (!phase) return -1;
  const p = phase.trim().toLowerCase();
  if (!p || p === 'internal/pto' || p.includes('internal/pto')) return -1;

  const additionalIdx = PROCESS_PHASES.findIndex((s) => s.id === 'additional');

  // Prefer specific matches before schematic's broad "design" and the additional catchall
  const specific = PROCESS_PHASES.findIndex(
    (step) =>
      step.id !== 'schematic' &&
      step.id !== 'additional' &&
      step.match.some((m) => p === m || p.includes(m)),
  );
  if (specific >= 0) return specific;

  if (p === 'design' || p.includes('schematic') || p.includes('conceptual')) {
    return PROCESS_PHASES.findIndex((s) => s.id === 'schematic');
  }

  if (p.includes('interior')) {
    // Interior often runs alongside later phases; treat as design development+
    return PROCESS_PHASES.findIndex((s) => s.id === 'design-dev');
  }

  // Catchall: Additional Services, Other, and any unmapped phase label
  return additionalIdx;
}

export function processPhaseLabel(phase: string | null | undefined): string {
  const idx = matchProcessPhaseIndex(phase);
  if (idx >= 0) return PROCESS_PHASES[idx].name;
  return phase?.trim() || '—';
}
