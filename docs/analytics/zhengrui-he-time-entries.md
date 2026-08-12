# Employee time entries — Zhengrui He

Scratch export for local analytics. **Not used by the app at runtime.**

| | |
|--|--|
| Employee | Zhengrui He |
| Source | BQE CORE `/timeentry` |
| Window | `date >= 2023-08-11` (~sync window) |
| Pulled at | 2026-08-11T22:21:20.410Z |
| Entries | 5,082 |
| Date range | 2023-08-11 → 2026-08-10 |
| Total hours | 6,681 |
| Billable hours | 5,471.5 |
| Non-billable hours | 1,209.5 |

## Full row-level data

All CORE fields for every entry are in:

[`docs/analytics/zhengrui-he-time-entries.json`](./zhengrui-he-time-entries.json)

Shape:

```json
{ "meta": { ... }, "entries": [ { /* full CORE time entry */ }, ... ] }
```

Load in Python: `json.load(open("docs/analytics/zhengrui-he-time-entries.json"))["entries"]`

## Fields present (53)

| Field | Notes |
|-------|-------|
| `activity` | Activity label |
| `activityId` | Activity id |
| `actualHours` | Hours worked |
| `billRate` | Client bill rate $/hr |
| `billStatus` | 0=Unbilled, 2=Billed (typical) |
| `billable` | Billable flag |
| `class` |  |
| `classId` |  |
| `classification` | Classification |
| `client` | Client name |
| `clientHours` | Hours billed to client |
| `compensationTime` |  |
| `costRate` | Cost rate $/hr |
| `createdById` |  |
| `createdOn` |  |
| `customFields` |  |
| `date` | Work date |
| `description` | Entry description |
| `expenseAccount` |  |
| `expenseAccountId` |  |
| `extra` | Extra time flag |
| `flag1` |  |
| `flag2` |  |
| `flag3` |  |
| `id` | CORE time entry id |
| `incomeAccount` |  |
| `incomeAccountId` |  |
| `invoiceId` | Linked invoice id (empty GUID if none) |
| `invoiceNumber` | Linked invoice number |
| `isWrittenOff` | Written off |
| `lastUpdated` |  |
| `lastUpdatedById` |  |
| `memo` | Memo text |
| `objectState` |  |
| `overtime` |  |
| `project` | Project / phase display name |
| `projectId` | CORE project/phase id |
| `resource` | Employee display name |
| `resourceId` | Employee id |
| `startInterval` |  |
| `startTime` | Start time |
| `stopInterval` |  |
| `stopTime` | Stop time |
| `tax1` |  |
| `tax2` |  |
| `tax3` |  |
| `token` |  |
| `vendorBillId` |  |
| `vendorBillNumber` |  |
| `version` |  |
| `workflow` | Workflow state |
| `wudMultiplier` | Write-up/down multiplier on bill value |
| `wudPercent` | Write-up/down percent |

## Quick breakdowns (from this export)

### By phase type (heuristic from project name)

| Phase | Hours | Billable | NB | Entries |
|-------|------:|---------:|---:|--------:|
| SD | 1977.50 | 1971.25 | 6.25 | 1246 |
| CD | 1590.00 | 1590.00 | 0.00 | 1005 |
| INTERNAL | 1189.75 | 0.00 | 1189.75 | 1080 |
| PP | 620.00 | 620.00 | 0.00 | 446 |
| AS | 442.25 | 437.25 | 5.00 | 345 |
| DD | 232.75 | 232.75 | 0.00 | 231 |
| CST | 181.00 | 176.50 | 4.50 | 183 |
| CS | 162.75 | 159.00 | 3.75 | 222 |
| PD | 103.25 | 103.25 | 0.00 | 106 |
| OTHER | 77.75 | 77.50 | 0.25 | 94 |
| PM | 53.25 | 53.25 | 0.00 | 47 |
| ID | 49.75 | 49.75 | 0.00 | 76 |
| RS | 1.00 | 1.00 | 0.00 | 1 |

### Top projects (hours)

| Project | Hours | Billable | NB | Entries |
|---------|------:|---------:|---:|--------:|
| Internal Office | 1174.00 | 0.00 | 1174.00 | 1061 |
| Birla Sanjay | 746.00 | 746.00 | 0.00 | 487 |
| Chen Jiawei | 583.75 | 577.50 | 6.25 | 474 |
| Bersot-Ee, Yuin & Stephane | 568.50 | 565.50 | 3.00 | 403 |
| Wendy & Ben Tessone | 483.50 | 483.50 | 0.00 | 396 |
| Qian Lillian and Huang Charles | 448.50 | 447.00 | 1.50 | 280 |
| Naveen and Usman Rao | 440.00 | 440.00 | 0.00 | 347 |
| Winchester Julie & Sean | 402.50 | 402.50 | 0.00 | 298 |
| Chen, Henry II | 369.25 | 369.25 | 0.00 | 209 |
| Kim & Andy Scott | 292.50 | 292.50 | 0.00 | 200 |
| Shams, Zehra & Khwaja | 289.50 | 288.75 | 0.75 | 227 |
| Ana And Akhtar Amer | 241.75 | 240.50 | 1.25 | 192 |
| Shams, Zehra & Khawaja | 132.75 | 132.50 | 0.25 | 99 |
| Hongene Biotech Corporation | 127.75 | 127.75 | 0.00 | 120 |
| Atkerson, Eric | 126.00 | 126.00 | 0.00 | 73 |
| Jennifer and Karl Hsu | 90.50 | 90.50 | 0.00 | 58 |
| Varzaghani-Roberts | 55.25 | 53.00 | 2.25 | 56 |
| Balakrishnan Nikil | 28.25 | 28.25 | 0.00 | 15 |
| Othmer Residence | 18.75 | 16.25 | 2.50 | 18 |
| Training and Development | 15.25 | 0.00 | 15.25 | 18 |

### By month

| Month | Hours | Billable | NB | Entries |
|-------|------:|---------:|---:|--------:|
| 2023-08 | 128.25 | 111.25 | 17.00 | 89 |
| 2023-09 | 179.50 | 148.50 | 31.00 | 103 |
| 2023-10 | 188.50 | 167.25 | 21.25 | 130 |
| 2023-11 | 190.25 | 144.00 | 46.25 | 138 |
| 2023-12 | 177.00 | 118.00 | 59.00 | 123 |
| 2024-01 | 197.50 | 157.75 | 39.75 | 164 |
| 2024-02 | 179.75 | 144.00 | 35.75 | 135 |
| 2024-03 | 179.50 | 148.00 | 31.50 | 139 |
| 2024-04 | 191.00 | 173.25 | 17.75 | 156 |
| 2024-05 | 197.25 | 169.50 | 27.75 | 160 |
| 2024-06 | 172.00 | 161.50 | 10.50 | 151 |
| 2024-07 | 197.75 | 169.00 | 28.75 | 162 |
| 2024-08 | 190.75 | 166.25 | 24.50 | 155 |
| 2024-09 | 181.50 | 158.75 | 22.75 | 138 |
| 2024-10 | 197.75 | 182.00 | 15.75 | 155 |
| 2024-11 | 178.00 | 133.00 | 45.00 | 95 |
| 2024-12 | 183.50 | 97.00 | 86.50 | 79 |
| 2025-01 | 195.25 | 140.25 | 55.00 | 142 |
| 2025-02 | 170.50 | 124.00 | 46.50 | 127 |
| 2025-03 | 180.50 | 153.00 | 27.50 | 146 |
| 2025-04 | 191.75 | 170.75 | 21.00 | 155 |
| 2025-05 | 188.50 | 152.25 | 36.25 | 148 |
| 2025-06 | 181.25 | 155.25 | 26.00 | 116 |
| 2025-07 | 197.75 | 174.00 | 23.75 | 130 |
| 2025-08 | 181.75 | 168.25 | 13.50 | 147 |
| 2025-09 | 189.00 | 164.25 | 24.75 | 156 |
| 2025-10 | 196.25 | 178.00 | 18.25 | 214 |
| 2025-11 | 170.00 | 134.75 | 35.25 | 131 |
| 2025-12 | 189.50 | 81.00 | 108.50 | 101 |
| 2026-01 | 185.00 | 130.75 | 54.25 | 129 |
| 2026-02 | 169.75 | 148.75 | 21.00 | 130 |
| 2026-03 | 187.75 | 173.75 | 14.00 | 156 |
| 2026-04 | 187.25 | 153.25 | 34.00 | 166 |
| 2026-05 | 178.00 | 141.50 | 36.50 | 147 |
| 2026-06 | 188.00 | 164.50 | 23.50 | 161 |
| 2026-07 | 195.25 | 173.00 | 22.25 | 163 |
| 2026-08 | 48.25 | 41.25 | 7.00 | 45 |

### Top activities

| Activity | Hours | Billable | NB | Entries |
|----------|------:|---------:|---:|--------:|
| Drafting: | 3220.75 | 3214.50 | 6.25 | 1847 |
| Design: | 1127.50 | 1119.25 | 8.25 | 676 |
| Consultant Coordination: | 780.75 | 775.75 | 5.00 | 1029 |
| Office Admin: | 331.00 | 2.75 | 328.25 | 513 |
| Project Coord: | 258.75 | 254.00 | 4.75 | 359 |
| Vacation: | 215.50 | 0.00 | 215.50 | 31 |
| Lunch: | 188.00 | 0.00 | 188.00 | 368 |
| Holiday: | 152.00 | 0.00 | 152.00 | 19 |
| Sick Time: | 84.75 | 0.00 | 84.75 | 21 |
| Sales & Marketing: | 73.25 | 0.00 | 73.25 | 31 |
| Personal Time: | 56.50 | 0.00 | 56.50 | 9 |
| Training: | 42.00 | 0.00 | 42.00 | 44 |
| Construction Coordination: | 30.50 | 30.50 | 0.00 | 27 |
| Client Coordination: | 23.75 | 23.75 | 0.00 | 20 |
| General Office: | 17.25 | 0.00 | 17.25 | 9 |
| Plan Check: | 16.75 | 16.75 | 0.00 | 17 |
| Site Visit: | 13.00 | 13.00 | 0.00 | 6 |
| Initial Meeting: | 12.25 | 0.00 | 12.25 | 15 |
| Zoning: | 10.00 | 10.00 | 0.00 | 7 |
| Notes for the meeting: | 7.00 | 0.00 | 7.00 | 8 |
| Administration: | 3.25 | 3.25 | 0.00 | 5 |
| R&D: | 3.25 | 0.00 | 3.25 | 3 |
| File Archiving: | 3.00 | 3.00 | 0.00 | 4 |
| Programming: | 3.00 | 3.00 | 0.00 | 2 |
| Negotiation/ Review: | 2.75 | 0.00 | 2.75 | 3 |

## Notes

- Raw CORE — sync exclusions (test / Internal Office) are **not** applied.
- Bill value proxy: `clientHours ?? actualHours` × `billRate` × `wudMultiplier`.
- Safe to delete this folder after your analysis.
