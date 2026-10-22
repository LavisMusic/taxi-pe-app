import { Fragment } from "react";

// Texto con los enlaces que tenga (https://…, http://… o www.…) convertidos
// en links que se abren al tocarlos, en otra pestaña. Lo usan la
// descripción de los anuncios (pop-up) y los mensajes de los chats fijados.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)\]}"'])/gi;

export default function TextoConEnlaces({ texto }) {
  if (!texto) return null;
  return String(texto)
    .split(URL_RE)
    .map((parte, i) => {
      if (i % 2 === 0) return <Fragment key={i}>{parte}</Fragment>;
      const href = /^https?:\/\//i.test(parte) ? parte : `https://${parte}`;
      return (
        <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="tz-enlace" onClick={(e) => e.stopPropagation()}>
          {parte}
        </a>
      );
    });
}
