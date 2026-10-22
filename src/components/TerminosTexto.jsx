import { Fragment } from "react";
import textoTerminos from "../legal/terminos.md?raw";

// Términos y Condiciones (src/legal/terminos.md, el mismo texto en Taxi PE
// y en Tonazo). La versión sale de la línea "**Versión X.Y" del propio
// texto: al publicar un cambio importante se sube ahí y la app vuelve a
// pedir aceptarlos a todos. Las líneas que empiezan con ">" son notas para
// quien edita el texto y no se muestran.
export const TERMINOS_VERSION = textoTerminos.match(/Versión\s+([\d.]+)/)?.[1] ?? "1.0";

// **negrita** dentro de una línea.
function enLinea(texto) {
  return texto.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
    parte.startsWith("**") && parte.endsWith("**") ? <strong key={i}>{parte.slice(2, -2)}</strong> : <Fragment key={i}>{parte}</Fragment>
  );
}

// Markdown mínimo del archivo: títulos (#, ##), listas numeradas y con
// guion (un nivel de anidado) y párrafos.
function bloques(texto) {
  const salida = [];
  let lista = null;
  const cerrarLista = () => {
    if (lista) salida.push(lista);
    lista = null;
  };
  texto.split(/\r?\n/).forEach((linea) => {
    if (!linea.trim() || linea.startsWith(">")) {
      cerrarLista();
      return;
    }
    const sub = linea.match(/^\s{2,}[-\d.]+\s+(.*)$/);
    if (sub && lista?.items.length) {
      lista.items[lista.items.length - 1].sub.push(sub[1]);
      return;
    }
    const item = linea.match(/^(\d+\.|-)\s+(.*)$/);
    if (item) {
      const tipo = item[1] === "-" ? "ul" : "ol";
      if (!lista || lista.tipo !== tipo) {
        cerrarLista();
        lista = { tipo, items: [] };
      }
      lista.items.push({ texto: item[2], sub: [] });
      return;
    }
    cerrarLista();
    if (linea.startsWith("## ")) salida.push({ tipo: "h3", texto: linea.slice(3) });
    else if (linea.startsWith("# ")) salida.push({ tipo: "h2", texto: linea.slice(2) });
    else salida.push({ tipo: "p", texto: linea });
  });
  cerrarLista();
  return salida;
}

const BLOQUES = bloques(textoTerminos);

export default function TerminosTexto() {
  return (
    <div className="tz-terminos-texto">
      {BLOQUES.map((b, i) => {
        if (b.tipo === "h2") return <h2 key={i}>{enLinea(b.texto)}</h2>;
        if (b.tipo === "h3") return <h3 key={i}>{enLinea(b.texto)}</h3>;
        if (b.tipo === "p") return <p key={i}>{enLinea(b.texto)}</p>;
        const Lista = b.tipo;
        return (
          <Lista key={i}>
            {b.items.map((it, j) => (
              <li key={j}>
                {enLinea(it.texto)}
                {it.sub.length > 0 && (
                  <ul>
                    {it.sub.map((s, k) => (
                      <li key={k}>{enLinea(s)}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </Lista>
        );
      })}
    </div>
  );
}
