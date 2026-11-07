// U-05: task CSV import. The parser handles the quoting spreadsheets and Notion emit
// (embedded commas, newlines and doubled quotes), detects the delimiter, and maps the
// headers every tool names differently onto TaCos fields.

export type CsvTable = {
  headers: string[];
  rows: string[][];
  delimiter: string;
};

export type CsvMapping = {
  // canonical field -> column index
  columns: Partial<Record<TaskCsvField, number>>;
  unmapped: string[];
  duplicated: string[];
};

export type TaskCsvField =
  | "identifier"
  | "title"
  | "description"
  | "status"
  | "priority"
  | "project"
  | "assignees"
  | "labels"
  | "dueDate"
  | "estimate"
  | "parent"
  | "recurrence"
  | "createdAt";

const ALIASES: Record<TaskCsvField, string[]> = {
  identifier: ["identifier", "id", "issue id", "task id", "key", "issue key"],
  title: ["title", "name", "task", "task name", "issue", "issue title", "summary", "item", "page"],
  description: ["description", "notes", "note", "body", "details", "content"],
  status: ["status", "state", "stage", "workflow status"],
  priority: ["priority", "importance", "urgency", "severity"],
  project: ["project", "project name", "team", "list", "database", "board", "space"],
  assignees: ["assignee", "assignees", "assignee(s)", "owner", "owners", "people", "person", "responsible"],
  labels: ["labels", "label", "tags", "tag", "categories", "category"],
  dueDate: ["due", "due date", "due_date", "duedate", "deadline", "date"],
  estimate: ["estimate", "estimation", "points", "story points", "effort", "size"],
  parent: ["parent", "parent task", "parent_task", "subtask of", "parent id", "parent identifier"],
  recurrence: ["recurrence", "repeat", "repeating"],
  createdAt: ["created", "created at", "created_at", "createdat", "created time", "created on"],
};

function headerKey(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.indexOf("\n") >= 0 ? text.indexOf("\n") : text.length);
  let best = ",";
  let bestCount = 0;
  for (const candidate of [",", ";", "\t"]) {
    let count = 0;
    let quoted = false;
    for (const char of firstLine) {
      if (char === '"') quoted = !quoted;
      else if (!quoted && char === candidate) count++;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsv(input: string): CsvTable {
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // A trailing blank line is an artefact of "save as CSV", not an empty task.
  while (rows.length > 0 && rows[rows.length - 1].every((cell) => cell.trim() === "")) rows.pop();
  const headers = (rows.shift() ?? []).map((cell) => cell.replace(/^\uFEFF/, "").trim());
  return { headers, rows, delimiter };
}

export function mapCsvHeaders(headers: string[]): CsvMapping {
  const columns: CsvMapping["columns"] = {};
  const unmapped: string[] = [];
  const duplicated: string[] = [];
  const seen = new Set<string>();
  headers.forEach((header, index) => {
    const key = headerKey(header);
    const field = (Object.keys(ALIASES) as TaskCsvField[]).find((name) =>
      ALIASES[name].includes(key)
    );
    if (!field) {
      if (key) unmapped.push(header);
      return;
    }
    if (columns[field] !== undefined) {
      duplicated.push(header);
      return;
    }
    columns[field] = index;
    seen.add(field);
  });
  return { columns, unmapped, duplicated };
}

export function splitList(value: string): string[] {
  return value
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function cell(row: string[], index: number | undefined): string {
  if (index === undefined) return "";
  return (row[index] ?? "").trim();
}
