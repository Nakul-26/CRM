import { toCsv } from "./to-csv";

interface Row {
  id: string;
  name: string | null;
  note?: string;
}

const columns = [
  { key: "id" as const, label: "ID" },
  { key: "name" as const, label: "Name" },
  { key: "note" as const, label: "Note" },
];

describe("toCsv", () => {
  it("renders a header row followed by one line per row", () => {
    const rows: Row[] = [
      { id: "1", name: "Alice", note: "vip" },
      { id: "2", name: "Bob", note: "" },
    ];
    expect(toCsv(rows, columns)).toBe("ID,Name,Note\r\n1,Alice,vip\r\n2,Bob,");
  });

  it("returns just the header row for an empty input", () => {
    expect(toCsv<Row>([], columns)).toBe("ID,Name,Note");
  });

  it("quotes and escapes a field containing a comma", () => {
    const rows: Row[] = [{ id: "1", name: "Smith, John" }];
    expect(toCsv(rows, columns)).toContain('"Smith, John"');
  });

  it("quotes and doubles internal quotes in a field containing a double-quote", () => {
    const rows: Row[] = [{ id: "1", name: 'The "Big" Deal' }];
    expect(toCsv(rows, columns)).toContain('"The ""Big"" Deal"');
  });

  it("quotes a field containing an embedded newline", () => {
    const rows: Row[] = [{ id: "1", name: "Line one\nLine two" }];
    expect(toCsv(rows, columns)).toContain('"Line one\nLine two"');
  });

  it("renders null and undefined values as empty fields", () => {
    const rows: Row[] = [{ id: "1", name: null }];
    expect(toCsv(rows, columns)).toBe("ID,Name,Note\r\n1,,");
  });
});
