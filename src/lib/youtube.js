// Convierte cualquier URL de YouTube que alguien pueda pegar
// (youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID, o ya un
// /embed/ID) al formato /embed/ID que un <iframe> puede reproducir. Si
// no matchea ningún patrón conocido, devuelve null — el caller decide
// qué hacer (no reventar con un iframe roto).
export function toYoutubeEmbedUrl(url) {
  if (!url) return null;
  const trimmed = url.trim();

  const patterns = [
    /youtube\.com\/watch\?v=([\w-]{6,})/,
    /youtu\.be\/([\w-]{6,})/,
    /youtube\.com\/shorts\/([\w-]{6,})/,
    /youtube\.com\/embed\/([\w-]{6,})/,
  ];

  for (const re of patterns) {
    const match = re.exec(trimmed);
    if (match) return `https://www.youtube.com/embed/${match[1]}`;
  }
  return null;
}
