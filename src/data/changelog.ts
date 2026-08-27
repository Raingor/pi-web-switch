// Version changelog shown in the "What's new" dialog. Newest first.
// `items` are i18n keys so the entries localize with the active language.
// When cutting a release, prepend a new entry here.

export interface ChangelogEntry {
  version: string;
  date: string; // ISO date
  itemKeys: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.8.0",
    date: "2026-08-27",
    itemKeys: ["changelog.0_8_0_1", "changelog.0_8_0_2", "changelog.0_8_0_3"],
  },
  {
    version: "0.7.0",
    date: "2026-08-27",
    itemKeys: [
      "changelog.0_7_0_1",
      "changelog.0_7_0_2",
      "changelog.0_7_0_3",
    ],
  },
  {
    version: "0.6.2",
    date: "2026-08-26",
    itemKeys: ["changelog.0_6_2_1"],
  },
  {
    version: "0.6.1",
    date: "2026-08-26",
    itemKeys: ["changelog.0_6_1_1"],
  },
  {
    version: "0.6.0",
    date: "2026-08-26",
    itemKeys: [
      "changelog.0_6_0_1",
      "changelog.0_6_0_2",
      "changelog.0_6_0_3",
      "changelog.0_6_0_4",
    ],
  },
  {
    version: "0.5.0",
    date: "2026-08-26",
    itemKeys: [
      "changelog.0_5_0_1",
      "changelog.0_5_0_2",
      "changelog.0_5_0_3",
    ],
  },
];
