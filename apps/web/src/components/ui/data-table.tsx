import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[] | undefined;
  isLoading?: boolean;
  emptyMessage?: string;
  rowKey: (row: T) => string;
}

export function DataTable<T>({ columns, data, isLoading, emptyMessage = "Nothing here yet.", rowKey }: DataTableProps<T>) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          {columns.map((col, i) => (
            <th key={i} className={cn("py-2 font-medium", col.className)}>
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={rowKey(row)} className="border-b border-border last:border-0">
            {columns.map((col, i) => (
              <td key={i} className={cn("py-2", col.className)}>
                {col.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
