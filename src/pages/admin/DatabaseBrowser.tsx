import { useEffect, useState } from "react";
import { Database, Table2, ChevronRight, Rows3, Hash, Loader2, RefreshCw, ChevronLeft, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ColumnInfo {
  name: string;
  type: string;
  notnull: boolean;
  pk: boolean;
  dflt_value: string | null;
}

interface TableInfo {
  name: string;
  rowCount: number;
  columns: ColumnInfo[];
}

const PAGE_SIZE = 50;

export default function DatabaseBrowser() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loadingSchema, setLoadingSchema] = useState(true);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [showSchema, setShowSchema] = useState(true);
  const [tableData, setTableData] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [page, setPage] = useState(0);
  const [totalRows, setTotalRows] = useState(0);

  const fetchSchema = async () => {
    setLoadingSchema(true);
    try {
      const res = await fetch("/api/db/_schema/tables");
      const data = await res.json();
      setTables(data);
    } catch (e) {
      console.error("Failed to load schema:", e);
    } finally {
      setLoadingSchema(false);
    }
  };

  useEffect(() => {
    fetchSchema();
  }, []);

  const fetchTableData = async (table: string, pageNum: number) => {
    setLoadingData(true);
    try {
      const offset = pageNum * PAGE_SIZE;
      // First get count
      const countRes = await fetch(`/api/db/${table}?limit=1&count=true`);
      const countResult = await countRes.json();
      if (countResult.count !== undefined) {
        setTotalRows(countResult.count);
      }
      // Then get paginated data
      const res = await fetch(
        `/api/db/${table}?limit=${PAGE_SIZE}&offset=${offset}`
      );
      const result = await res.json();
      if (Array.isArray(result)) {
        setTableData(result);
      } else if (result.data) {
        setTableData(result.data);
      }
    } catch (e) {
      console.error("Failed to load table data:", e);
    } finally {
      setLoadingData(false);
    }
  };

  const handleSelectTable = (tableName: string) => {
    setSelectedTable(tableName);
    setPage(0);
    setShowSchema(true);
    fetchTableData(tableName, 0);
  };

  const handlePageChange = (newPage: number) => {
    if (!selectedTable) return;
    setPage(newPage);
    fetchTableData(selectedTable, newPage);
  };

  const selectedTableInfo = tables.find((t) => t.name === selectedTable);
  const totalPages = Math.ceil(totalRows / PAGE_SIZE);

  const formatCellValue = (value: any): string => {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "object") return JSON.stringify(value);
    const str = String(value);
    if (str.length > 120) return str.slice(0, 120) + "...";
    return str;
  };

  const getCellClass = (value: any): string => {
    if (value === null || value === undefined) return "text-muted-foreground italic";
    if (typeof value === "number") return "font-mono";
    if (typeof value === "boolean") return "font-mono";
    return "";
  };

  if (loadingSchema) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Database className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-xl font-semibold">Database Browser</h2>
            <p className="text-sm text-muted-foreground">
              {tables.length} tables &bull; SQLite
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={fetchSchema}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Table List - Sidebar */}
        <div className="lg:col-span-1 space-y-1">
          {tables.map((table) => (
            <button
              key={table.name}
              onClick={() => handleSelectTable(table.name)}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors text-left",
                selectedTable === table.name
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              )}
            >
              <span className="flex items-center gap-2 min-w-0">
                <Table2 className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">{table.name}</span>
              </span>
              <Badge
                variant={selectedTable === table.name ? "secondary" : "outline"}
                className="ml-2 flex-shrink-0 text-xs"
              >
                {table.rowCount}
              </Badge>
            </button>
          ))}
        </div>

        {/* Main Content */}
        <div className="lg:col-span-3 space-y-4">
          {!selectedTable ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Database className="h-12 w-12 mb-4 opacity-50" />
                <p>Select a table to view its schema and data</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Schema Section */}
              {selectedTableInfo && (
                <Card>
                  <CardHeader className="py-3 cursor-pointer" onClick={() => setShowSchema(!showSchema)}>
                    <CardTitle className="text-sm font-medium flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <Hash className="h-4 w-4" />
                        Schema: {selectedTable}
                        <Badge variant="outline" className="ml-1">
                          {selectedTableInfo.columns.length} columns
                        </Badge>
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 transition-transform",
                          !showSchema && "-rotate-90"
                        )}
                      />
                    </CardTitle>
                  </CardHeader>
                  {showSchema && (
                    <CardContent className="pt-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-2 px-3 font-medium text-muted-foreground">Column</th>
                              <th className="text-left py-2 px-3 font-medium text-muted-foreground">Type</th>
                              <th className="text-left py-2 px-3 font-medium text-muted-foreground">Constraints</th>
                              <th className="text-left py-2 px-3 font-medium text-muted-foreground">Default</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedTableInfo.columns.map((col) => (
                              <tr key={col.name} className="border-b last:border-0 hover:bg-muted/50">
                                <td className="py-2 px-3 font-mono text-xs">
                                  {col.pk && <span className="text-amber-500 mr-1" title="Primary Key">PK</span>}
                                  {col.name}
                                </td>
                                <td className="py-2 px-3">
                                  <Badge variant="secondary" className="font-mono text-xs">
                                    {col.type || "ANY"}
                                  </Badge>
                                </td>
                                <td className="py-2 px-3 text-xs">
                                  {col.notnull && (
                                    <Badge variant="outline" className="text-xs mr-1">NOT NULL</Badge>
                                  )}
                                  {col.pk && (
                                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                                      PRIMARY KEY
                                    </Badge>
                                  )}
                                </td>
                                <td className="py-2 px-3 font-mono text-xs text-muted-foreground max-w-[200px] truncate">
                                  {col.dflt_value || "-"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  )}
                </Card>
              )}

              {/* Data Section */}
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm font-medium flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <Rows3 className="h-4 w-4" />
                      Data
                      <Badge variant="outline">{totalRows} rows</Badge>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => selectedTable && fetchTableData(selectedTable, page)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {loadingData ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : tableData.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      No data in this table
                    </p>
                  ) : (
                    <>
                      <div className="overflow-x-auto border rounded-md">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-muted/50">
                              {selectedTableInfo?.columns.map((col) => (
                                <th
                                  key={col.name}
                                  className="text-left py-2 px-3 font-medium text-muted-foreground whitespace-nowrap border-b"
                                >
                                  {col.name}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {tableData.map((row, i) => (
                              <tr
                                key={i}
                                className="border-b last:border-0 hover:bg-muted/30"
                              >
                                {selectedTableInfo?.columns.map((col) => (
                                  <td
                                    key={col.name}
                                    className={cn(
                                      "py-1.5 px-3 max-w-[250px] truncate whitespace-nowrap",
                                      getCellClass(row[col.name])
                                    )}
                                    title={
                                      row[col.name] !== null && row[col.name] !== undefined
                                        ? String(
                                            typeof row[col.name] === "object"
                                              ? JSON.stringify(row[col.name])
                                              : row[col.name]
                                          )
                                        : "NULL"
                                    }
                                  >
                                    {formatCellValue(row[col.name])}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Pagination */}
                      {totalPages > 1 && (
                        <div className="flex items-center justify-between mt-3">
                          <p className="text-xs text-muted-foreground">
                            Page {page + 1} of {totalPages}
                          </p>
                          <div className="flex gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={page === 0}
                              onClick={() => handlePageChange(page - 1)}
                            >
                              <ChevronLeft className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={page >= totalPages - 1}
                              onClick={() => handlePageChange(page + 1)}
                            >
                              <ChevronRight className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
