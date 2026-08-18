import * as XLSX from "xlsx";

// Arma un .xlsx de una o más hojas a partir de { nombre, filas }[] —
// cada 'filas' es un array de arrays (primera fila = encabezados) — y
// dispara la descarga. Extraído del App.jsx viejo (downloadXLSX) para
// que los modales nuevos de TaxiP (Cierre de Caja, Gastos) lo puedan
// reusar sin duplicar la lógica de autoancho.
export function downloadXLSX(filename, sheets) {
  const workbook = XLSX.utils.book_new();
  sheets.forEach(({ nombre, filas }) => {
    const worksheet = XLSX.utils.aoa_to_sheet(filas);
    // Autoancho: SheetJS no lo calcula solo — se estima el ancho de
    // cada columna a partir del texto más largo que tenga (encabezado
    // incluido), con un piso y un techo para que ni una columna vacía
    // quede microscópica ni un texto larguísimo se coma toda la hoja.
    if (filas.length > 0) {
      worksheet["!cols"] = filas[0].map((_, colIdx) => {
        const maxLen = filas.reduce((max, row) => {
          const cell = row[colIdx];
          const text = cell == null ? "" : String(cell);
          return Math.max(max, text.length);
        }, 0);
        return { wch: Math.min(Math.max(maxLen + 2, 8), 45) };
      });
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, nombre.slice(0, 31));
  });
  XLSX.writeFile(workbook, filename);
}
